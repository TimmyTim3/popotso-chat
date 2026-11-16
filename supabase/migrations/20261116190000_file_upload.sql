-- Private media library, deliberately separate from chat messages and chat attachments.
create table if not exists public.file_upload_items (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  object_path text not null unique,
  original_name text not null,
  content_type text not null,
  file_size bigint not null default 0 check (file_size >= 0),
  captured_at timestamptz,
  uploaded_at timestamptz not null default now(),
  status text not null default 'synced' check (status in ('synced','processing','failed')),
  metadata jsonb not null default '{}'::jsonb
);
alter table public.file_upload_items enable row level security;
drop policy if exists "Parents can view synced file uploads" on public.file_upload_items;
create policy "Parents can view synced file uploads" on public.file_upload_items for select to authenticated using (public.is_care_desk_member());
insert into storage.buckets (id, name, public, file_size_limit)
values ('file-upload', 'file-upload', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;
drop policy if exists "Parents can download file uploads" on storage.objects;
create policy "Parents can download file uploads" on storage.objects for select to authenticated using (bucket_id = 'file-upload' and public.is_care_desk_member());
-- Browser clients cannot upload or create metadata. A trusted paired Android companion must do that.
