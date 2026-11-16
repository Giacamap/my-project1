# Cài đặt & triển khai

## 1. Tạo database trên Supabase

1. Đăng ký [supabase.com](https://supabase.com), bấm **New project**
   - Name: `factorykits`
   - Region: **Southeast Asia (Singapore)** (gần Việt Nam nhất)
   - Lưu lại database password
2. Vào **SQL Editor → New query**, copy nội dung từng file rồi bấm **Run**, **đúng thứ tự**:
   1. `supabase/migrations/0001_schema.sql`
   2. `supabase/migrations/0002_security.sql`
   3. `supabase/migrations/0003_logic_and_reports.sql`
   4. `supabase/migrations/0004_storage.sql`
   5. `supabase/migrations/0005_lock_down_functions.sql`
   6. `supabase/seed.sql` (dữ liệu mẫu, chạy lại bao nhiêu lần cũng được)
3. Vào **Project Settings → API**, copy:
   - **Project URL**, ví dụ `https://abcdxyz.supabase.co`
   - **anon public** key (project mới có thể gọi là **Publishable key**, dạng `sb_publishable_...`, dùng y như nhau)

> **Về email xác nhận:** mặc định Supabase bắt xác nhận email khi đăng ký. Khi đang học,
> có thể tắt ở **Authentication → Sign In / Providers → Email → Confirm email**.
> Nếu để bật, hãy đặt **Authentication → URL Configuration → Site URL** = địa chỉ GitHub Pages ở bước 2.

## 2. Deploy frontend lên GitHub Pages

1. **(Nên làm)** Đổi tên repo thành `factorykits`: **Settings → General → Repository name**.
   Địa chỉ web sẽ là:
   - `https://giacamap.github.io/factorykits/` nếu đổi tên
   - `https://giacamap.github.io/my-project1/` nếu giữ tên cũ
2. Điền Project URL và anon key vào `frontend/js/config.js` (repo này đã điền sẵn cho project
   `factorykits`). Hoặc tạo repository variables `SUPABASE_URL` và `SUPABASE_ANON_KEY`
   (**Settings → Secrets and variables → Actions → Variables**) để workflow tự ghi đè.
3. **Settings → Pages → Build and deployment → Source: GitHub Actions**
4. Merge code vào `main` (hoặc vào **Actions → Deploy frontend to GitHub Pages → Run workflow**)
5. Mở địa chỉ web, **đăng ký tài khoản đầu tiên**: tài khoản này tự động là **admin**
   (xem trigger `tg_handle_new_user` trong `0001_schema.sql`). Người đăng ký sau là `operator`,
   admin nâng quyền trong trang **Quản trị**.

## 3. Chạy local (không bắt buộc)

Frontend không cần build, chỉ cần một web server tĩnh:

1. Sửa `frontend/js/config.js`, điền URL và anon key (**đừng commit** thay đổi này,
   bản deploy lấy giá trị từ repository variables)
2. Chạy server:

```bash
cd frontend && python3 -m http.server 8000
```

3. Mở http://localhost:8000 và thêm `http://localhost:8000` vào
   **Authentication → URL Configuration → Redirect URLs** của Supabase.

### Database local bằng Supabase CLI (khi muốn thử nghiệm thoải mái)

Cần Docker. CLI sẽ tự chạy các file trong `supabase/migrations/` và `supabase/seed.sql`.

```bash
npx supabase init
```

```bash
npx supabase start
```

```bash
npx supabase db reset
```

Studio local ở http://localhost:54323, lệnh `start` in ra URL và anon key để điền vào `config.js`.

## 4. Gắn tên miền riêng (khi đã mua, ví dụ `factorykits.vn`)

1. Ở nhà cung cấp tên miền, tạo bản ghi DNS:
   - Dùng subdomain `app.factorykits.vn` (đơn giản nhất): **CNAME** `app` → `giacamap.github.io`
   - Dùng tên miền gốc `factorykits.vn`: 4 bản ghi **A** trỏ tới
     `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
2. GitHub: **Settings → Pages → Custom domain**, nhập tên miền, chờ kiểm tra DNS xong
   rồi bật **Enforce HTTPS**
3. Supabase: cập nhật **Site URL** và **Redirect URLs** sang tên miền mới

Frontend dùng đường dẫn tương đối và hash router (`#/board`), nên chạy được cả ở
`/my-project1/` lẫn ở tên miền gốc mà không cần sửa code.

## Giới hạn của gói miễn phí

- Supabase free: 500 MB database, 1 GB file storage. Project **tạm dừng sau 7 ngày không có
  truy cập**; vào dashboard bấm Restore là chạy lại, dữ liệu không mất.
- GitHub Pages: repo phải **public** (với tài khoản GitHub Free). Không sao cả: anon key là
  khóa công khai, dữ liệu được bảo vệ bằng RLS trong database.
