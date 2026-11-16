// Cấu hình kết nối Supabase.
// Lấy 2 giá trị này ở: Supabase Dashboard → Project Settings → API.
//
// "anon key" là khóa CÔNG KHAI, được phép nằm trong frontend. Dữ liệu được bảo vệ
// bởi Row Level Security trong database (xem supabase/migrations/0002_security.sql),
// không phải bởi việc giấu khóa này.
//
// Khi deploy bằng GitHub Actions, file này được ghi đè từ repository variables
// SUPABASE_URL và SUPABASE_ANON_KEY (xem .github/workflows/deploy-pages.yml).
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
