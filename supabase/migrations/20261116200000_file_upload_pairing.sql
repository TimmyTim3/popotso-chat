-- Device pairing and short-lived upload grants for the transparent Android companion.
create table if not exists public.file_upload_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.file_upload_devices (
  id uuid primary key default gen_random_uuid(),
  device_name text not null,
  token_hash text not null unique,
  paired_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
alter table public.file_upload_pairing_codes enable row level security;
alter table public.file_upload_devices enable row level security;
-- These tables are accessed only by the Edge Function with its service-role client.
revoke all on public.file_upload_pairing_codes from anon, authenticated;
revoke all on public.file_upload_devices from anon, authenticated;
