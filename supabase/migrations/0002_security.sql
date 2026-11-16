-- =============================================================================
-- 0002_security.sql  —  Phân quyền: Row Level Security (RLS) + column grants
-- =============================================================================
-- Frontend nói chuyện TRỰC TIẾP với database qua API của Supabase (PostgREST),
-- nên phân quyền phải nằm trong database. Đây chính là phần "kiểm tra quyền"
-- của Backend trong sơ đồ kiến trúc.
--
-- Bài học:
--   * ENABLE ROW LEVEL SECURITY  → mặc định CHẶN mọi dòng, policy mở ra từng phần
--   * USING      → điều kiện để ĐỌC / SỬA / XÓA một dòng có sẵn
--   * WITH CHECK → điều kiện để dòng MỚI (sau insert/update) được chấp nhận
--   * GRANT UPDATE (cột)  → chỉ cho sửa một số cột nhất định
--   * SECURITY DEFINER    → hàm chạy với quyền owner (dùng cẩn thận!)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: role của user đang đăng nhập
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER để đọc profiles mà không bị chính RLS của profiles chặn
-- (tránh đệ quy policy).
create or replace function public.my_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- has_role('technician') = true nếu role hiện tại >= technician.
create or replace function public.has_role(p_min public.app_role)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(public.my_role() >= p_min, false);
$$;

-- -----------------------------------------------------------------------------
-- Bật RLS cho tất cả bảng
-- -----------------------------------------------------------------------------
alter table public.areas                enable row level security;
alter table public.lines                enable row level security;
alter table public.machines             enable row level security;
alter table public.shifts               enable row level security;
alter table public.downtime_categories  enable row level security;
alter table public.downtime_reasons     enable row level security;
alter table public.profiles             enable row level security;
alter table public.downtime_events      enable row level security;
alter table public.downtime_attachments enable row level security;

-- -----------------------------------------------------------------------------
-- Master data: ai đăng nhập cũng đọc được, chỉ admin được sửa
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['areas', 'lines', 'machines', 'shifts',
                           'downtime_categories', 'downtime_reasons']
  loop
    execute format(
      'create policy "%1$s: read for signed-in users" on public.%1$I
         for select to authenticated using (true)', t);
    execute format(
      'create policy "%1$s: admin manages" on public.%1$I
         for all to authenticated
         using (public.has_role(''admin'')) with check (public.has_role(''admin''))', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create policy "profiles: read for signed-in users" on public.profiles
  for select to authenticated using (true);

create policy "profiles: update own row" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Chỉ cho phép tự sửa full_name. Nếu không có dòng này, user có thể tự
-- UPDATE role = 'admin'. RLS lọc DÒNG, còn GRANT lọc CỘT.
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;

-- Đổi role: chỉ admin, qua hàm riêng.
create or replace function public.set_user_role(p_user_id uuid, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Chỉ admin được đổi quyền' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() and p_role <> 'admin' then
    raise exception 'Không thể tự hạ quyền admin của chính mình';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- downtime_events
-- -----------------------------------------------------------------------------
create policy "events: read for signed-in users" on public.downtime_events
  for select to authenticated using (true);

-- Ai có profile (>= operator) cũng ghi nhận được, nhưng phải đứng tên chính mình.
create policy "events: insert as self" on public.downtime_events
  for insert to authenticated
  with check (public.has_role('operator') and reported_by = (select auth.uid()));

-- Người báo cáo sửa được sự kiện của mình; technician trở lên sửa được tất cả.
create policy "events: update own or technician" on public.downtime_events
  for update to authenticated
  using (reported_by = (select auth.uid()) or public.has_role('technician'))
  with check (reported_by = (select auth.uid()) or public.has_role('technician'));

create policy "events: supervisor deletes" on public.downtime_events
  for delete to authenticated
  using (public.has_role('supervisor'));

-- -----------------------------------------------------------------------------
-- downtime_attachments
-- -----------------------------------------------------------------------------
create policy "attachments: read for signed-in users" on public.downtime_attachments
  for select to authenticated using (true);

create policy "attachments: insert as self" on public.downtime_attachments
  for insert to authenticated
  with check (uploaded_by = (select auth.uid()));

create policy "attachments: delete own or supervisor" on public.downtime_attachments
  for delete to authenticated
  using (uploaded_by = (select auth.uid()) or public.has_role('supervisor'));
