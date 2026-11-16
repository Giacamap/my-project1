-- =============================================================================
-- 0005_lock_down_functions.sql  —  Siết quyền EXECUTE cho hàm SECURITY DEFINER
-- =============================================================================
-- Bài học: mặc định Postgres cho PUBLIC quyền EXECUTE mọi hàm mới, và Supabase
-- còn cấp thêm cho anon/authenticated. Mọi hàm trong schema public đều thành
-- API: /rest/v1/rpc/<tên hàm>. Hàm SECURITY DEFINER chạy với quyền owner, nên
-- chỉ cấp EXECUTE cho đúng ai cần (Supabase Security Advisor cảnh báo điều này).
-- =============================================================================

-- Hàm trigger: chỉ chạy qua trigger, không ai cần gọi trực tiếp qua API.
revoke execute on function public.tg_handle_new_user() from public, anon, authenticated;

-- Người chưa đăng nhập không cần các hàm này.
-- authenticated vẫn giữ quyền: my_role() được RLS policy gọi (qua has_role),
-- set_user_role() tự kiểm tra admin bên trong.
revoke execute on function public.my_role() from public, anon;
revoke execute on function public.set_user_role(uuid, public.app_role) from public, anon;
grant  execute on function public.my_role() to authenticated;
grant  execute on function public.set_user_role(uuid, public.app_role) to authenticated;
