-- Message replies and lightweight private two-player games.
alter table public.messages
  add column if not exists reply_to_id uuid references public.messages(id) on delete set null;

create index if not exists messages_reply_to_id_idx
  on public.messages(reply_to_id);

alter table public.messages
  add column if not exists pinned_at timestamptz,
  add column if not exists favorited_by uuid[] not null default '{}';

create table if not exists public.game_challenges (
  id uuid primary key default gen_random_uuid(),
  game_type text not null check (game_type in ('tic-tac-toe', 'connect-four', 'rock-paper-scissors', 'word-scramble', 'quick-quiz')),
  challenger_id uuid not null references auth.users(id) on delete cascade,
  opponent_id uuid references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active', 'completed', 'declined')),
  state jsonb not null default '{}'::jsonb,
  winner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists game_challenges_opponent_status_idx
  on public.game_challenges(opponent_id, status, created_at desc);
create index if not exists game_challenges_challenger_status_idx
  on public.game_challenges(challenger_id, status, created_at desc);

grant select, insert, update on public.game_challenges to authenticated;

alter table public.game_challenges enable row level security;

drop policy if exists "Participants can read game challenges" on public.game_challenges;
create policy "Participants can read game challenges"
  on public.game_challenges for select to authenticated
  using (auth.uid() = challenger_id or auth.uid() = opponent_id or (opponent_id is null and status = 'pending'));

drop policy if exists "Authenticated users can create their own challenges" on public.game_challenges;
create policy "Authenticated users can create their own challenges"
  on public.game_challenges for insert to authenticated
  with check (auth.uid() = challenger_id and opponent_id is null and status = 'pending');

drop policy if exists "Participants can update game challenges" on public.game_challenges;
create policy "Participants can update game challenges"
  on public.game_challenges for update to authenticated
  using (auth.uid() = challenger_id or auth.uid() = opponent_id or (opponent_id is null and status = 'pending'))
  with check (
    auth.uid() = challenger_id
    or auth.uid() = opponent_id
    or (opponent_id = auth.uid() and status in ('active', 'declined'))
  );

-- Realtime updates let both phones see invitations and moves immediately.
do $$
begin
  alter publication supabase_realtime add table public.game_challenges;
exception when duplicate_object then null;
when undefined_object then null;
end $$;
