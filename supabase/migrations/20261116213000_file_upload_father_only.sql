-- File Upload is a father-only feature. Do not use the broader shared care-desk membership check here.
drop policy if exists "Parents can view synced file uploads" on public.file_upload_items;
create policy "Father can view synced file uploads"
on public.file_upload_items for select to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'tim@popotso.app');

drop policy if exists "Parents can download file uploads" on storage.objects;
create policy "Father can download file uploads"
on storage.objects for select to authenticated
using (bucket_id = 'file-upload' and lower(coalesce(auth.jwt() ->> 'email', '')) = 'tim@popotso.app');

-- Pairing infrastructure belonged only to the removed Android companion.
drop table if exists public.file_upload_pairing_codes;
drop table if exists public.file_upload_devices;
