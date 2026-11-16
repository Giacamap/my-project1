# Bài tập SQL trên dữ liệu downtime

Chạy trong **Supabase → SQL Editor** sau khi đã chạy `seed.sql`.
Tự viết trước, rồi mới mở **Lời giải**. Các cấp độ đi từ dễ đến khó.

> SQL Editor chạy với quyền `postgres` nên **bỏ qua RLS**. Bài 18 hướng dẫn cách giả lập
> một user thật để thấy RLS hoạt động.

---

## Cấp 1: SELECT, WHERE, ORDER BY

**1.** Liệt kê tất cả máy (mã, tên), sắp theo mã.
<details><summary>Lời giải</summary>

```sql
select code, name from machines order by code;
```
</details>

**2.** Liệt kê các lý do thuộc nhóm `MECH`.
<details><summary>Lời giải</summary>

```sql
select r.code, r.name
from downtime_reasons r
join downtime_categories c on c.id = r.category_id
where c.code = 'MECH';
```
</details>

**3.** 10 lần dừng dài nhất (id, máy, số phút).
<details><summary>Lời giải</summary>

```sql
select id, machine_id, duration_min
from downtime_events
where duration_min is not null
order by duration_min desc
limit 10;
```
</details>

**4.** Các lần dừng bắt đầu trong 24 giờ qua.
<details><summary>Lời giải</summary>

```sql
select * from downtime_events
where started_at >= now() - interval '24 hours';
```
</details>

---

## Cấp 2: JOIN

**5.** Hiển thị 20 lần dừng gần nhất kèm **mã máy, mã line, tên lý do**.
<details><summary>Lời giải</summary>

```sql
select e.id, e.started_at, m.code as machine, l.code as line, r.name as reason, e.duration_min
from downtime_events e
join machines m on m.id = e.machine_id
join lines l    on l.id = m.line_id
left join downtime_reasons r on r.id = e.reason_id   -- LEFT vì reason có thể NULL
order by e.started_at desc
limit 20;
```
Câu hỏi: đổi `left join` thành `join` thì sự kiện nào biến mất?
</details>

**6.** Máy nào **chưa từng** dừng trong 30 ngày qua? (gợi ý: `LEFT JOIN ... IS NULL` hoặc `NOT EXISTS`)
<details><summary>Lời giải</summary>

```sql
select m.code
from machines m
where not exists (
  select 1 from downtime_events e
  where e.machine_id = m.id and e.started_at >= now() - interval '30 days'
);
```
</details>

**7.** So sánh với view: viết lại bài 5 dùng `v_downtime_events`. View giúp gì?
<details><summary>Lời giải</summary>

```sql
select id, started_at, machine_code, line_code, reason_name, duration_min
from v_downtime_events order by started_at desc limit 20;
```
View đóng gói phần JOIN lặp đi lặp lại thành một "bảng ảo".
</details>

---

## Cấp 3: GROUP BY, aggregate

**8.** Tổng số phút dừng và số lần dừng **theo line**.
<details><summary>Lời giải</summary>

```sql
select l.code, count(*) as events, sum(e.duration_min) as total_min
from downtime_events e
join machines m on m.id = e.machine_id
join lines l on l.id = m.line_id
group by l.code
order by total_min desc;
```
</details>

**9.** Tổng phút dừng **planned vs unplanned**.
<details><summary>Lời giải</summary>

```sql
select c.kind, round(sum(e.duration_min)) as total_min
from downtime_events e
join downtime_reasons r on r.id = e.reason_id
join downtime_categories c on c.id = r.category_id
group by c.kind;
```
</details>

**10.** Những máy có **trên 15 lần dừng** trong 30 ngày (gợi ý: `HAVING`).
<details><summary>Lời giải</summary>

```sql
select m.code, count(*) as events
from downtime_events e join machines m on m.id = e.machine_id
where e.started_at >= now() - interval '30 days'
group by m.code
having count(*) > 15
order by events desc;
```
`WHERE` lọc **dòng trước** khi nhóm, `HAVING` lọc **nhóm sau** khi tính aggregate.
</details>

**11.** Downtime theo **ca** và theo **ngày trong tuần** (Thứ 2…CN).
<details><summary>Lời giải</summary>

```sql
select s.code as shift,
       extract(isodow from e.started_at at time zone 'Asia/Ho_Chi_Minh') as dow,  -- 1 = Thứ 2
       round(sum(e.duration_min)) as total_min
from downtime_events e join shifts s on s.id = e.shift_id
group by 1, 2
order by 1, 2;
```
</details>

**12.** Tổng downtime **theo ngày** (giờ Việt Nam). Vì sao phải `AT TIME ZONE`?
<details><summary>Lời giải</summary>

```sql
select (started_at at time zone 'Asia/Ho_Chi_Minh')::date as day,
       round(sum(duration_min)) as total_min
from downtime_events
group by 1 order by 1;
```
Database lưu UTC. Một lần dừng lúc 06:30 sáng giờ VN là 23:30 **hôm trước** theo UTC.
</details>

---

## Cấp 4: CTE, CASE, window function

**13.** Phân loại mỗi lần dừng thành `ngắn` (<15 phút), `vừa` (15–45), `dài` (>45), rồi đếm.
<details><summary>Lời giải</summary>

```sql
select case
         when duration_min < 15 then 'ngắn'
         when duration_min <= 45 then 'vừa'
         else 'dài'
       end as loai,
       count(*)
from downtime_events
where duration_min is not null
group by 1;
```
</details>

**14.** Với mỗi line, máy nào dừng **nhiều phút nhất**? (gợi ý: `rank() over (partition by ...)`)
<details><summary>Lời giải</summary>

```sql
with per_machine as (
  select line_code, machine_code, sum(duration_min) as total_min
  from v_downtime_events
  group by 1, 2
), ranked as (
  select *, rank() over (partition by line_code order by total_min desc) as rnk
  from per_machine
)
select * from ranked where rnk = 1;
```
</details>

**15.** Tự viết **Pareto**: % và % tích lũy theo lý do. So sánh với hàm `downtime_pareto` trong `0003`.
<details><summary>Lời giải</summary>

```sql
with t as (
  select reason_code, sum(duration_min) as total_min
  from v_downtime_events
  where not is_open
  group by reason_code
)
select reason_code, total_min,
       round(100 * total_min / sum(total_min) over (), 1) as pct,
       round(100 * sum(total_min) over (order by total_min desc) / sum(total_min) over (), 1) as cum_pct
from t
order by total_min desc;
```
</details>

**16.** **Thời gian giữa 2 lần dừng** của cùng một máy (gần với MTBF). Gợi ý: `lag()`.
<details><summary>Lời giải</summary>

```sql
select machine_code, started_at,
       started_at - lag(ended_at) over (partition by machine_id order by started_at) as time_since_last
from v_downtime_events
order by machine_code, started_at;
```
Bài nâng cao: tính trung bình `time_since_last` theo máy.
</details>

**17.** Tổng downtime **mỗi ngày, kể cả ngày bằng 0** trong 7 ngày gần nhất.
<details><summary>Lời giải</summary>

```sql
select d::date as day, coalesce(round(sum(e.duration_min)), 0) as total_min
from generate_series(current_date - 6, current_date, interval '1 day') d
left join downtime_events e
  on (e.started_at at time zone 'Asia/Ho_Chi_Minh')::date = d::date
group by d order by d;
```
Hoặc dùng hàm có sẵn: `select * from downtime_by_day(current_date - 6, current_date);`
</details>

---

## Cấp 5: ràng buộc, transaction, RLS

**18.** Giả lập một operator để thấy RLS hoạt động.
<details><summary>Lời giải</summary>

```sql
begin;
-- Lấy id của 1 user có thật trong profiles
select id, role from profiles;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<DÁN-UUID-VÀO-ĐÂY>","role":"authenticated"}', true);

select auth.uid(), my_role();
insert into areas (code, name) values ('TEST', 'test');   -- operator → bị RLS chặn
rollback;
```
</details>

**19.** Thử phá ràng buộc. Đoán trước lỗi gì, rồi chạy để kiểm chứng (bọc trong `begin; ... rollback;`):
```sql
begin;
-- a) kết thúc trước khi bắt đầu
insert into downtime_events (machine_id, reason_id, started_at, ended_at)
values (1, 1, now(), now() - interval '1 hour');
rollback;

begin;
-- b) 2 lần dừng trùng giờ trên cùng máy
insert into downtime_events (machine_id, reason_id, started_at, ended_at)
values (1, 1, '2030-01-01 08:00+07', '2030-01-01 09:00+07'),
       (1, 1, '2030-01-01 08:30+07', '2030-01-01 08:45+07');
rollback;

begin;
-- c) đóng sự kiện mà không có lý do
insert into downtime_events (machine_id, started_at, ended_at)
values (1, '2030-01-02 08:00+07', '2030-01-02 09:00+07');
rollback;
```

**20.** Dùng `EXPLAIN ANALYZE` so sánh 2 câu sau, xem câu nào dùng index `downtime_events_open_idx`:
```sql
explain analyze select * from downtime_events where ended_at is null and machine_id = 3;
explain analyze select * from downtime_events where machine_id = 3;
```
<details><summary>Gợi ý</summary>

Đó là *partial index*: chỉ chứa các dòng `ended_at IS NULL`. Với dữ liệu nhỏ Postgres có thể
vẫn chọn `Seq Scan` vì đọc hết bảng còn nhanh hơn. Thử chạy `seed.sql` nhiều lần với nhiều
ngày hơn để thấy khác biệt.
</details>

**21.** (Thiết kế) Viết migration `0005_production.sql` thêm bảng sản lượng và tính **OEE**.
Xem phần "Ý tưởng mở rộng" trong [data-model.md](data-model.md).
