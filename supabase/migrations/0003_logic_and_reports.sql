-- =============================================================================
-- 0003_logic_and_reports.sql  —  Logic nghiệp vụ (RPC) + view + báo cáo
-- =============================================================================
-- Bài học:
--   * Hàm PL/pgSQL gọi từ frontend:  supabase.rpc('start_downtime', {...})
--   * Bắt lỗi theo mã lỗi (exclusion_violation) để trả thông báo dễ hiểu
--   * VIEW với security_invoker → view vẫn tôn trọng RLS của người gọi
--   * LEFT JOIN LATERAL, COALESCE, CASE
--   * Window function: sum() over (order by ...) cho biểu đồ Pareto
--   * generate_series để lấp các ngày không có dữ liệu
-- =============================================================================

-- -----------------------------------------------------------------------------
-- RPC: bắt đầu một lần dừng máy
-- -----------------------------------------------------------------------------
-- SECURITY INVOKER (mặc định): chạy với quyền người gọi → RLS vẫn áp dụng.
create or replace function public.start_downtime(
  p_machine_id bigint,
  p_reason_id  integer default null,
  p_note       text    default null
)
returns public.downtime_events
language plpgsql
set search_path = ''
as $$
declare
  v_event public.downtime_events;
begin
  insert into public.downtime_events (machine_id, reason_id, note, reported_by)
  values (p_machine_id, p_reason_id, nullif(trim(p_note), ''), auth.uid())
  returning * into v_event;
  return v_event;
exception
  when exclusion_violation then
    raise exception 'Máy này đang có một lần dừng chưa đóng' using errcode = 'P0001';
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: kết thúc một lần dừng máy
-- -----------------------------------------------------------------------------
create or replace function public.end_downtime(
  p_event_id  bigint,
  p_reason_id integer default null,
  p_note      text    default null
)
returns public.downtime_events
language plpgsql
set search_path = ''
as $$
declare
  v_event public.downtime_events;
begin
  update public.downtime_events
     set ended_at  = now(),
         closed_by = auth.uid(),
         reason_id = coalesce(p_reason_id, reason_id),
         note      = coalesce(nullif(trim(p_note), ''), note)
   where id = p_event_id
     and ended_at is null
  returning * into v_event;

  if v_event.id is null then
    raise exception 'Không tìm thấy lần dừng đang mở #% (hoặc bạn không có quyền)', p_event_id;
  end if;
  return v_event;
exception
  when check_violation then
    raise exception 'Hãy chọn lý do dừng máy trước khi đóng' using errcode = 'P0001';
end;
$$;

-- -----------------------------------------------------------------------------
-- VIEW: sự kiện kèm đầy đủ thông tin (denormalize để frontend đọc dễ)
-- -----------------------------------------------------------------------------
create or replace view public.v_downtime_events
with (security_invoker = true)
as
select
  e.id,
  e.machine_id,
  m.code               as machine_code,
  m.name               as machine_name,
  l.id                 as line_id,
  l.code               as line_code,
  a.code               as area_code,
  e.reason_id,
  r.code               as reason_code,
  r.name               as reason_name,
  c.code               as category_code,
  c.name               as category_name,
  c.kind               as category_kind,
  c.color              as category_color,
  s.code               as shift_code,
  e.started_at,
  e.ended_at,
  (e.ended_at is null) as is_open,
  -- Sự kiện đang mở: tính thời lượng tới hiện tại.
  coalesce(e.duration_min,
           round(extract(epoch from (now() - e.started_at)) / 60, 2)) as duration_min,
  e.note,
  e.reported_by,
  rp.full_name         as reported_by_name,
  cp.full_name         as closed_by_name,
  e.created_at,
  e.updated_at
from public.downtime_events e
join public.machines m             on m.id = e.machine_id
join public.lines l                on l.id = m.line_id
join public.areas a                on a.id = l.area_id
left join public.downtime_reasons r    on r.id = e.reason_id
left join public.downtime_categories c on c.id = r.category_id
left join public.shifts s              on s.id = e.shift_id
left join public.profiles rp           on rp.id = e.reported_by
left join public.profiles cp           on cp.id = e.closed_by;

-- -----------------------------------------------------------------------------
-- VIEW: trạng thái hiện tại của từng máy (dùng cho màn hình Board)
-- -----------------------------------------------------------------------------
create or replace view public.v_machine_status
with (security_invoker = true)
as
select
  m.id          as machine_id,
  m.code        as machine_code,
  m.name        as machine_name,
  l.id          as line_id,
  l.code        as line_code,
  l.name        as line_name,
  a.code        as area_code,
  case when o.id is null then 'running' else 'down' end as status,
  o.id          as open_event_id,
  o.started_at  as down_since,
  o.reason_id,
  r.name        as reason_name,
  o.note
from public.machines m
join public.lines l on l.id = m.line_id
join public.areas a on a.id = l.area_id
-- LATERAL: với MỖI máy, lấy sự kiện đang mở (nếu có).
left join lateral (
  select e.*
  from public.downtime_events e
  where e.machine_id = m.id and e.ended_at is null
  limit 1
) o on true
left join public.downtime_reasons r on r.id = o.reason_id
where m.is_active;

-- -----------------------------------------------------------------------------
-- BÁO CÁO 1: Pareto theo lý do (window function)
-- -----------------------------------------------------------------------------
create or replace function public.downtime_pareto(p_from timestamptz, p_to timestamptz)
returns table (
  reason_code    text,
  reason_name    text,
  category_name  text,
  category_color text,
  events         bigint,
  total_min      numeric,
  pct            numeric,
  cumulative_pct numeric
)
language sql
stable
set search_path = ''
as $$
  with per_reason as (
    select
      coalesce(r.code, '—')            as reason_code,
      coalesce(r.name, 'Chưa phân loại') as reason_name,
      c.name                           as category_name,
      coalesce(c.color, '#8892a6')     as category_color,
      count(*)                         as events,
      sum(coalesce(e.duration_min,
          extract(epoch from (now() - e.started_at)) / 60)) as total_min
    from public.downtime_events e
    left join public.downtime_reasons r    on r.id = e.reason_id
    left join public.downtime_categories c on c.id = r.category_id
    where e.started_at >= p_from and e.started_at < p_to
    group by 1, 2, 3, 4
  )
  select
    reason_code, reason_name, category_name, category_color, events,
    round(total_min, 1),
    round(100 * total_min / nullif(sum(total_min) over (), 0), 1),
    round(100 * sum(total_min) over (order by total_min desc, reason_code
                                     rows between unbounded preceding and current row)
              / nullif(sum(total_min) over (), 0), 1)
  from per_reason
  order by total_min desc, reason_code;
$$;

-- -----------------------------------------------------------------------------
-- BÁO CÁO 2: tổng downtime theo ngày (có cả ngày = 0 nhờ generate_series)
-- -----------------------------------------------------------------------------
create or replace function public.downtime_by_day(p_from date, p_to date)
returns table (day date, events bigint, total_min numeric, mttr_min numeric)
language sql
stable
set search_path = ''
as $$
  select
    d::date,
    count(e.id),
    round(coalesce(sum(e.duration_min), 0), 1),
    round(avg(e.duration_min), 1)       -- MTTR ~ thời gian trung bình mỗi lần dừng
  from generate_series(p_from, p_to, interval '1 day') d
  left join public.downtime_events e
    on (e.started_at at time zone 'Asia/Ho_Chi_Minh')::date = d::date
   and e.ended_at is not null
  group by d
  order by d;
$$;

-- -----------------------------------------------------------------------------
-- Realtime: phát sự kiện khi downtime_events thay đổi (Board tự cập nhật)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.downtime_events;
  end if;
end;
$$;
