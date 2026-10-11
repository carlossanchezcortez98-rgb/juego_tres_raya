-- Tres en Raya · esquema de Supabase
-- Pégalo entero en Supabase → SQL Editor → Run. Es idempotente en lo posible,
-- pero está pensado para ejecutarse una vez sobre un proyecto nuevo.
--
-- Requisito previo: Authentication → Sign In / Providers → "Allow anonymous sign-ins".

-- ============================================================================
-- Tablas
-- ============================================================================

-- Un registro por jugador (= usuario anónimo de Supabase Auth).
create table if not exists public.players (
  id           uuid primary key references auth.users (id) on delete cascade,
  alias        text check (alias is null or (alias = btrim(alias) and char_length(alias) between 2 and 20)),
  games_played integer not null default 0 check (games_played >= 0),
  wins         integer not null default 0 check (wins >= 0),
  draws        integer not null default 0 check (draws >= 0),
  losses       integer not null default 0 check (losses >= 0),
  points       integer generated always as (wins * 3 + draws) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Una fila por partida terminada. El dueño juega siempre con X.
create table if not exists public.games (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references public.players (id) on delete cascade,
  mode            text not null check (mode in ('cpu', 'pvp')),
  starting_player text not null check (starting_player in ('X', 'O')),
  result          text not null check (result in ('X', 'O', 'draw')),
  win_line        smallint[] check (win_line is null or array_length(win_line, 1) = 3),
  final_board     text not null check (final_board ~ '^[XO-]{9}$'),
  moves_count     smallint not null check (moves_count between 5 and 9),
  duration_ms     integer not null check (duration_ms >= 0),
  created_at      timestamptz not null default now(),
  check ((result = 'draw') = (win_line is null))
);

-- Jugadas de cada partida, en orden (para la repetición).
create table if not exists public.moves (
  game_id uuid not null references public.games (id) on delete cascade,
  ply     smallint not null check (ply between 1 and 9),
  mark    text not null check (mark in ('X', 'O')),
  cell    smallint not null check (cell between 0 and 8),
  primary key (game_id, ply),
  unique (game_id, cell)
);

create index if not exists games_player_created_idx on public.games (player_id, created_at desc);
create index if not exists players_ranking_idx on public.players (points desc, wins desc, games_played);

-- updated_at automático
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists players_touch_updated_at on public.players;
create trigger players_touch_updated_at
  before update on public.players
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Guardar una partida (única vía de escritura de games / moves / contadores)
-- ============================================================================
-- El cliente solo envía las casillas jugadas, en orden. Aquí se reproduce la
-- partida, así que resultado, línea ganadora y tablero final no se pueden falsear.

create or replace function public.save_game(
  p_mode            text,
  p_starting_player text,
  p_cells           smallint[],
  p_duration_ms     integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_lines   constant integer[] := array[0,1,2, 3,4,5, 6,7,8, 0,3,6, 1,4,7, 2,5,8, 0,4,8, 2,4,6];
  v_board   text[] := array_fill(null::text, array[9]);
  v_marks   text[] := '{}';
  v_mark    text := p_starting_player;
  v_n       integer := coalesce(array_length(p_cells, 1), 0);
  v_cell    integer;
  v_i       integer;
  v_l       integer;
  v_win     smallint[];
  v_result  text;
  v_final   text := '';
  v_game_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_mode is null or p_mode not in ('cpu', 'pvp') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;
  if p_starting_player is null or p_starting_player not in ('X', 'O') then
    raise exception 'invalid starting player' using errcode = '22023';
  end if;
  if v_n < 5 or v_n > 9 then
    raise exception 'invalid number of moves' using errcode = '22023';
  end if;

  for v_i in 1 .. v_n loop
    v_cell := p_cells[v_i];
    if v_cell is null or v_cell < 0 or v_cell > 8 then
      raise exception 'invalid cell at move %', v_i using errcode = '22023';
    end if;
    if v_win is not null then
      raise exception 'move after the game was over' using errcode = '22023';
    end if;
    if v_board[v_cell + 1] is not null then
      raise exception 'cell already taken at move %', v_i using errcode = '22023';
    end if;

    v_board[v_cell + 1] := v_mark;
    v_marks[v_i] := v_mark;

    for v_l in 0 .. 7 loop
      if v_board[v_lines[v_l * 3 + 1] + 1] = v_mark
         and v_board[v_lines[v_l * 3 + 2] + 1] = v_mark
         and v_board[v_lines[v_l * 3 + 3] + 1] = v_mark then
        v_win := array[v_lines[v_l * 3 + 1], v_lines[v_l * 3 + 2], v_lines[v_l * 3 + 3]]::smallint[];
        exit;
      end if;
    end loop;

    v_mark := case v_mark when 'X' then 'O' else 'X' end;
  end loop;

  if v_win is null and v_n <> 9 then
    raise exception 'game is not finished' using errcode = '22023';
  end if;

  v_result := case when v_win is null then 'draw' else v_board[v_win[1] + 1] end;

  for v_i in 1 .. 9 loop
    v_final := v_final || coalesce(v_board[v_i], '-');
  end loop;

  insert into public.players (id) values (v_uid) on conflict (id) do nothing;

  insert into public.games (player_id, mode, starting_player, result, win_line, final_board, moves_count, duration_ms)
  values (v_uid, p_mode, p_starting_player, v_result, v_win, v_final, v_n, greatest(coalesce(p_duration_ms, 0), 0))
  returning id into v_game_id;

  insert into public.moves (game_id, ply, mark, cell)
  select v_game_id, i, v_marks[i], p_cells[i]
  from generate_series(1, v_n) as i;

  -- Perspectiva del dueño: juega con X.
  update public.players
     set games_played = games_played + 1,
         wins   = wins   + (v_result = 'X')::int,
         losses = losses + (v_result = 'O')::int,
         draws  = draws  + (v_result = 'draw')::int
   where id = v_uid;

  return v_game_id;
end;
$$;

revoke all on function public.save_game(text, text, smallint[], integer) from public, anon;
grant execute on function public.save_game(text, text, smallint[], integer) to authenticated;

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.players enable row level security;
alter table public.games   enable row level security;
alter table public.moves   enable row level security;

-- Privilegios mínimos (Supabase concede todo por defecto a anon/authenticated).
revoke all on public.players, public.games, public.moves from anon, authenticated;
grant select on public.players to anon, authenticated;
grant insert (id, alias) on public.players to authenticated;
grant update (alias)     on public.players to authenticated;
grant select on public.games, public.moves to authenticated;

-- players: lectura pública (alimenta el ranking); cada cual crea y edita solo su fila.
drop policy if exists players_select on public.players;
create policy players_select on public.players
  for select using (true);

drop policy if exists players_insert_own on public.players;
create policy players_insert_own on public.players
  for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists players_update_own on public.players;
create policy players_update_own on public.players
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- games / moves: solo lectura de las propias; la escritura va por save_game().
drop policy if exists games_select_own on public.games;
create policy games_select_own on public.games
  for select to authenticated
  using (player_id = (select auth.uid()));

drop policy if exists moves_select_own on public.moves;
create policy moves_select_own on public.moves
  for select to authenticated
  using (exists (
    select 1 from public.games g
    where g.id = moves.game_id and g.player_id = (select auth.uid())
  ));
