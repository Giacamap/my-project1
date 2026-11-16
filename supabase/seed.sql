-- =============================================================================
-- seed.sql  —  Dữ liệu mẫu để có cái mà query
-- =============================================================================
-- Chạy SAU các file migrations. Chạy lại nhiều lần được (xóa dữ liệu cũ trước).
-- Bài học: INSERT ... SELECT, JOIN với VALUES, generate_series, random()
-- =============================================================================

truncate public.downtime_attachments, public.downtime_events,
         public.downtime_reasons, public.downtime_categories,
         public.shifts, public.machines, public.lines, public.areas
  restart identity cascade;

-- Khu vực --------------------------------------------------------------------
insert into public.areas (code, name) values
  ('SMT',  'Xưởng SMT'),
  ('ASSY', 'Xưởng lắp ráp');

-- Line: lấy area_id bằng JOIN thay vì gõ cứng số id ---------------------------
insert into public.lines (area_id, code, name)
select a.id, v.code, v.name
from (values
  ('SMT',  'SMT-L1',  'SMT Line 1'),
  ('SMT',  'SMT-L2',  'SMT Line 2'),
  ('ASSY', 'ASSY-L1', 'Lắp ráp Line 1')
) as v(area_code, code, name)
join public.areas a on a.code = v.area_code;

-- Máy: mỗi line SMT có 5 máy giống nhau → CROSS JOIN line × loại máy ---------
insert into public.machines (line_id, code, name)
select l.id, l.code || '-' || t.suffix, t.name
from public.lines l
cross join (values
  (1, 'PRN', 'Máy in kem hàn'),
  (2, 'SPI', 'Máy kiểm tra kem hàn (SPI)'),
  (3, 'PNP', 'Máy gắp đặt linh kiện'),
  (4, 'RFL', 'Lò reflow'),
  (5, 'AOI', 'Máy kiểm tra quang học (AOI)')
) as t(ord, suffix, name)
where l.code like 'SMT-%'
order by l.id, t.ord;

insert into public.machines (line_id, code, name)
select l.id, v.code, v.name
from (values
  ('ASSY-L1-ST1', 'Trạm lắp ráp 1'),
  ('ASSY-L1-ST2', 'Trạm lắp ráp 2'),
  ('ASSY-L1-TST', 'Trạm test chức năng')
) as v(code, name)
cross join public.lines l
where l.code = 'ASSY-L1';

-- Ca ------------------------------------------------------------------------
insert into public.shifts (code, name, start_time, end_time) values
  ('C1', 'Ca 1 (sáng)',  '06:00', '14:00'),
  ('C2', 'Ca 2 (chiều)', '14:00', '22:00'),
  ('C3', 'Ca 3 (đêm)',   '22:00', '06:00');

-- Nhóm & lý do dừng ------------------------------------------------------------
insert into public.downtime_categories (code, name, kind, color) values
  ('MECH', 'Cơ khí',             'unplanned', '#e5484d'),
  ('ELEC', 'Điện / điều khiển',  'unplanned', '#f5a524'),
  ('MAT',  'Vật tư',             'unplanned', '#a78bfa'),
  ('QUAL', 'Chất lượng',         'unplanned', '#f472b6'),
  ('CHG',  'Chuyển đổi model',   'planned',   '#3dd6c4'),
  ('PM',   'Bảo trì định kỳ',    'planned',   '#60a5fa');

insert into public.downtime_reasons (category_id, code, name)
select c.id, v.code, v.name
from (values
  ('MECH', 'MECH-JAM',    'Kẹt board / băng tải'),
  ('MECH', 'MECH-NOZZLE', 'Hỏng / mòn nozzle'),
  ('MECH', 'MECH-FEEDER', 'Lỗi feeder'),
  ('ELEC', 'ELEC-SENSOR', 'Lỗi cảm biến'),
  ('ELEC', 'ELEC-PLC',    'Lỗi PLC / phần mềm máy'),
  ('ELEC', 'ELEC-POWER',  'Mất điện / sụt áp'),
  ('MAT',  'MAT-SHORT',   'Thiếu linh kiện'),
  ('MAT',  'MAT-PASTE',   'Hết kem hàn'),
  ('MAT',  'MAT-PCB',     'Thiếu PCB'),
  ('QUAL', 'QUAL-FAI',    'Chờ kiểm tra mẫu đầu (FAI)'),
  ('QUAL', 'QUAL-DEFECT', 'Lỗi hàng loạt, dừng để xử lý'),
  ('CHG',  'CHG-MODEL',   'Đổi model sản phẩm'),
  ('CHG',  'CHG-STENCIL', 'Thay stencil'),
  ('PM',   'PM-DAILY',    'Bảo trì hằng ngày'),
  ('PM',   'PM-WEEKLY',   'Bảo trì hằng tuần')
) as v(cat_code, code, name)
join public.downtime_categories c on c.code = v.cat_code;

-- Downtime mẫu cho 30 ngày qua -----------------------------------------------
-- Mỗi máy, mỗi ngày có 2 "khung": sáng (6h–10h59) và chiều (13h–17h59).
-- Mỗi khung có ~35% khả năng xảy ra 1 lần dừng dài 5–64 phút
-- → không bao giờ chồng giờ (ràng buộc downtime_no_overlap sẽ hài lòng).
with reason_ids as (
  select array_agg(id order by id) as ids from public.downtime_reasons
)
insert into public.downtime_events (machine_id, reason_id, started_at, ended_at, note, reported_by)
select
  m.id,
  rs.ids[1 + floor(random() * cardinality(rs.ids))::int],
  t.started_at,
  t.started_at + make_interval(mins => 5 + floor(random() * 60)::int),
  'Dữ liệu mẫu',
  null
from public.machines m
cross join reason_ids rs
-- Ép kiểu ::timestamp (không múi giờ). Nếu để date, generate_series trả về
-- timestamptz và AT TIME ZONE bên dưới sẽ đổi NGƯỢC chiều → lệch 7 tiếng.
cross join generate_series((current_date - 30)::timestamp,
                           (current_date - 1)::timestamp,
                           interval '1 day') as d(day)
cross join (values (6), (13)) as slot(base_hour)
cross join lateral (
  -- Ghép giờ địa phương rồi đổi sang timestamptz theo múi giờ nhà máy.
  select (d.day + make_interval(hours => slot.base_hour + floor(random() * 5)::int,
                                mins  => floor(random() * 60)::int))
         at time zone 'Asia/Ho_Chi_Minh' as started_at
) t
where random() < 0.35;

-- Kiểm tra nhanh
select
  (select count(*) from public.machines)        as machines,
  (select count(*) from public.downtime_reasons) as reasons,
  (select count(*) from public.downtime_events)  as events;
