-- Allow the father account to manually add photos and videos from the browser.
-- Reads remain restricted by the existing father-only SELECT policies.

DROP POLICY IF EXISTS "Father can insert file upload records" ON public.file_upload_items;
CREATE POLICY "Father can insert file upload records"
ON public.file_upload_items
FOR INSERT
TO authenticated
WITH CHECK (
  lower(coalesce(auth.jwt() ->> 'email', '')) = 'tim@popotso.app'
);

DROP POLICY IF EXISTS "Father can upload file objects" ON storage.objects;
CREATE POLICY "Father can upload file objects"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'file-upload'
  AND lower(coalesce(auth.jwt() ->> 'email', '')) = 'tim@popotso.app'
);
