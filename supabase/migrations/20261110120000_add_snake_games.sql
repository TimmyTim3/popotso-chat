-- Allow the additional Popotso games in the existing challenge table.
alter table public.game_challenges
  drop constraint if exists game_challenges_game_type_check;

alter table public.game_challenges
  add constraint game_challenges_game_type_check
  check (game_type in (
    'tic-tac-toe',
    'connect-four',
    'rock-paper-scissors',
    'word-scramble',
    'quick-quiz',
    'snake',
    'snakes-ladders'
  )) not valid;

alter table public.game_challenges
  validate constraint game_challenges_game_type_check;
