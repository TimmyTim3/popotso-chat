-- Private in-game chat for participants in a Popotso game.
create table if not exists public.game_messages (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.game_challenges(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists game_messages_challenge_created_idx
  on public.game_messages(challenge_id, created_at);

grant select, insert on public.game_messages to authenticated;
alter table public.game_messages enable row level security;

drop policy if exists "Game participants can read in-game messages" on public.game_messages;
create policy "Game participants can read in-game messages"
  on public.game_messages for select to authenticated
  using (exists (
    select 1 from public.game_challenges c
    where c.id = challenge_id and (auth.uid() = c.challenger_id or auth.uid() = c.opponent_id)
  ));

drop policy if exists "Game participants can send in-game messages" on public.game_messages;
create policy "Game participants can send in-game messages"
  on public.game_messages for insert to authenticated
  with check (
    auth.uid() = sender_id and exists (
      select 1 from public.game_challenges c
      where c.id = challenge_id and c.status = 'active'
        and (auth.uid() = c.challenger_id or auth.uid() = c.opponent_id)
    )
  );

do $$
begin
  alter publication supabase_realtime add table public.game_messages;
exception when duplicate_object then null;
when undefined_object then null;
end $$;
