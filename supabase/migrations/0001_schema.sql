-- =============================================================================
-- 0001_schema.sql  —  Data model cho FactoryKits mini-MES (ghi nhận downtime)
-- =============================================================================
-- Bài học trong file này:
--   * CREATE TYPE ... AS ENUM          → giá trị cố định (role, loại downtime)
--   * identity primary key             → khóa chính tự tăng chuẩn SQL
--   * FOREIGN KEY / UNIQUE / CHECK     → để database tự bảo vệ dữ liệu
--   * Generated column                 → cột tính sẵn (duration_min)
--   * EXCLUDE constraint (GiST)        → cấm 2 lần dừng máy chồng giờ nhau
--   * Trigger                          → tự gán ca, tự cập nhật updated_at
-- =============================================================================

-- btree_gist cho phép dùng toán tử "=" trên bigint bên trong ràng buộc EXCLUDE.
create extension if not exists btree_gist with schema extensions;

-- -----------------------------------------------------------------------------
-- ENUM
-- -----------------------------------------------------------------------------
-- Thứ tự khai báo có ý nghĩa: operator < technician < supervisor < admin.
-- Nhờ vậy có thể so sánh: role >= 'technician'.
create type public.app_role as enum ('operator', 'technician', 'supervisor', 'admin');

-- planned   = dừng có kế hoạch (changeover, bảo trì định kỳ, nghỉ giữa ca)
-- unplanned = dừng ngoài kế hoạch (hỏng máy, thiếu vật tư...)
create type public.downtime_kind as enum ('planned', 'unplanned');

-- -----------------------------------------------------------------------------
-- MASTER DATA: Khu vực → Line → Máy   (quan hệ 1-nhiều nối tiếp)
-- -----------------------------------------------------------------------------
create table public.areas (
  id          bigint generated always as identity primary key,
  code        text not null unique,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table public.lines (
  id          bigint generated always as identity primary key,
  area_id     bigint not null references public.areas (id),
  code        text not null unique,
  name        text not null,
  created_at  timestamptz not null default now()
);
-- Postgres KHÔNG tự tạo index cho foreign key → nên tạo tay để JOIN nhanh.
create index lines_area_id_idx on public.lines (area_id);

create table public.machines (
  id          bigint generated always as identity primary key,
  line_id     bigint not null references public.lines (id),
  code        text not null unique,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index machines_line_id_idx on public.machines (line_id);

-- -----------------------------------------------------------------------------
-- CA LÀM VIỆC
-- -----------------------------------------------------------------------------
-- Ca có thể qua nửa đêm (22:00 → 06:00), khi đó end_time < start_time.
create table public.shifts (
  id          smallint generated always as identity primary key,
  code        text not null unique,
  name        text not null,
  start_time  time not null,
  end_time    time not null,
  constraint shifts_not_zero_length check (start_time <> end_time)
);

-- -----------------------------------------------------------------------------
-- NGUYÊN NHÂN DỪNG MÁY: Nhóm → Lý do   (2 cấp)
-- -----------------------------------------------------------------------------
create table public.downtime_categories (
  id     smallint generated always as identity primary key,
  code   text not null unique,
  name   text not null,
  kind   public.downtime_kind not null,
  color  text not null default '#8892a6'
           check (color ~ '^#[0-9a-fA-F]{6}$')      -- regex trong CHECK
);

create table public.downtime_reasons (
  id           integer generated always as identity primary key,
  category_id  smallint not null references public.downtime_categories (id),
  code         text not null unique,
  name         text not null,
  is_active    boolean not null default true
);
create index downtime_reasons_category_id_idx on public.downtime_reasons (category_id);

-- -----------------------------------------------------------------------------
-- NGƯỜI DÙNG
-- -----------------------------------------------------------------------------
-- auth.users do Supabase quản lý (email, mật khẩu). Bảng profiles mở rộng thêm
-- thông tin nghiệp vụ, quan hệ 1-1 qua cùng khóa chính.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  role        public.app_role not null default 'operator',
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- BẢNG CHÍNH: DOWNTIME EVENT (fact table)
-- -----------------------------------------------------------------------------
create table public.downtime_events (
  id            bigint generated always as identity primary key,
  machine_id    bigint not null references public.machines (id),
  reason_id     integer references public.downtime_reasons (id),  -- có thể chọn sau
  shift_id      smallint references public.shifts (id),            -- trigger tự gán
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,                                       -- NULL = đang dừng
  -- Generated column: Postgres tự tính khi ended_at có giá trị.
  duration_min  numeric(10, 2) generated always as (
                  round(extract(epoch from (ended_at - started_at)) / 60, 2)
                ) stored,
  note          text,
  reported_by   uuid references public.profiles (id) default auth.uid(),
  closed_by     uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint downtime_end_after_start
    check (ended_at is null or ended_at > started_at),

  -- Quy tắc nghiệp vụ: muốn đóng sự kiện thì phải có lý do.
  constraint downtime_closed_needs_reason
    check (ended_at is null or reason_id is not null),

  -- Một máy không thể dừng 2 lần trùng thời gian.
  -- tstzrange(start, NULL) = khoảng tới vô cùng → sự kiện đang mở chặn luôn
  -- việc mở sự kiện mới trên cùng máy.
  constraint downtime_no_overlap
    exclude using gist (
      machine_id with =,
      tstzrange(started_at, ended_at, '[)') with &&
    )
);
create index downtime_events_started_at_idx on public.downtime_events (started_at desc);
create index downtime_events_reason_id_idx  on public.downtime_events (reason_id);
-- Partial index: chỉ index các sự kiện đang mở → tìm "máy nào đang dừng" rất nhanh.
create index downtime_events_open_idx on public.downtime_events (machine_id)
  where ended_at is null;

-- -----------------------------------------------------------------------------
-- FILE ĐÍNH KÈM (metadata; file thật nằm trong Supabase Storage)
-- -----------------------------------------------------------------------------
create table public.downtime_attachments (
  id            bigint generated always as identity primary key,
  event_id      bigint not null references public.downtime_events (id) on delete cascade,
  storage_path  text not null unique,     -- đường dẫn trong bucket 'downtime-files'
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint check (size_bytes >= 0),
  uploaded_by   uuid references public.profiles (id) default auth.uid(),
  created_at    timestamptz not null default now()
);
create index downtime_attachments_event_id_idx on public.downtime_attachments (event_id);

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- 1) Tự cập nhật updated_at mỗi khi UPDATE.
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger downtime_events_set_updated_at
  before update on public.downtime_events
  for each row execute function public.tg_set_updated_at();

-- 2) Tìm ca theo thời điểm (giờ nhà máy: Asia/Ho_Chi_Minh), xử lý ca qua đêm.
create or replace function public.shift_for(p_at timestamptz)
returns smallint
language sql
stable
set search_path = ''
as $$
  select s.id
  from public.shifts s
  cross join lateral (select (p_at at time zone 'Asia/Ho_Chi_Minh')::time as t) x
  where (s.start_time < s.end_time and x.t >= s.start_time and x.t < s.end_time)  -- ca thường
     or (s.start_time > s.end_time and (x.t >= s.start_time or x.t < s.end_time)) -- ca qua đêm
  order by s.id
  limit 1;
$$;

create or replace function public.tg_set_shift()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.shift_id := public.shift_for(new.started_at);
  return new;
end;
$$;

create trigger downtime_events_set_shift
  before insert or update of started_at on public.downtime_events
  for each row execute function public.tg_set_shift();

-- 3) Khi có người đăng ký (auth.users) → tạo profile.
--    Người đăng ký ĐẦU TIÊN được làm admin để tự quản trị hệ thống.
create or replace function public.tg_handle_new_user()
returns trigger
language plpgsql
security definer          -- chạy với quyền của owner vì cần ghi vào public.profiles
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles) then 'operator'::public.app_role
         else 'admin'::public.app_role end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tg_handle_new_user();
