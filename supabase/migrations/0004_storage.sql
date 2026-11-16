-- =============================================================================
-- 0004_storage.sql  —  File storage: bucket chứa ảnh / video / PDF
-- =============================================================================
-- Supabase Storage lưu metadata file trong bảng storage.objects, nên phân quyền
-- file cũng viết bằng RLS policy giống hệt bảng thường.
-- Quy ước đường dẫn: <event_id>/<timestamp>-<tên file>
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'downtime-files',
  'downtime-files',
  false,                                   -- private: phải đăng nhập mới xem được
  20 * 1024 * 1024,                        -- tối đa 20 MB / file
  array['image/*', 'video/*', 'application/pdf']
)
on conflict (id) do nothing;

create policy "downtime-files: read for signed-in users" on storage.objects
  for select to authenticated
  using (bucket_id = 'downtime-files');

create policy "downtime-files: upload for signed-in users" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'downtime-files');

create policy "downtime-files: delete own or supervisor" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'downtime-files'
    and (owner_id = (select auth.uid())::text or public.has_role('supervisor'))
  );
