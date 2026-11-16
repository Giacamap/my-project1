// Cấu hình kết nối Supabase.
// Lấy 2 giá trị này ở: Supabase Dashboard → Project Settings → API.
//
// "anon key" là khóa CÔNG KHAI, được phép nằm trong frontend. Dữ liệu được bảo vệ
// bởi Row Level Security trong database (xem supabase/migrations/0002_security.sql),
// không phải bởi việc giấu khóa này.
//
// Nếu đặt repository variables SUPABASE_URL và SUPABASE_ANON_KEY, workflow deploy
// sẽ ghi đè file này (tiện khi muốn trỏ sang project Supabase khác).
export const SUPABASE_URL = 'https://zczbwjunvotmhdvbwdza.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjemJ3anVudm90bWhkdmJ3ZHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4MDM0NDcsImV4cCI6MjExMDM3OTQ0N30.mN4fMAL1k4zuSq64-fic1p7W1k7G8lYzlFyIcb0-SSc';
