-- Tres en Raya · esquema de Supabase (sin Auth)
-- Pégalo entero en Supabase → SQL Editor → Run.
--
-- No requiere activar ningún proveedor de Auth. Cada navegador genera un id
-- aleatorio (uuid) que guarda en localStorage y que actúa como "llave" de su
-- jugador. Las tablas no son accesibles directamente: todo pasa por funciones.
--
-- AVISO: las dos primeras sentencias borran las tablas anteriores (y sus datos)
-- si ya habías ejecutado una versión previa de este esquema (la que usaba Auth).

drop function if exists public.save_game(text, text, smallint[], integer);
drop table if exists public.moves, public.games, public.players cascade;

-- ============================================================================
-- Tablas
-- ============================================================================

-- Un registro por navegador. `id` es la llave secreta del jugador: nunca se
-- devuelve en el ranking ni en listados públicos.
create table public.players (
  id           uuid primary key,
  alias        text check (alias is null or (alias = btrim(alias) and char_length(alias) between 2 and 20)),
  games_played integer not null default 0 check (games_played >= 0),
  wins         integer not null default 0 check (wins >= 0),
  draws        integer not null default 0 check (draws >= 0),
  losses       integer not null default 0 check (losses >= 0),
  points       integer generated always as (wins * 3 + draws) stored,
  created_at   timestamptz not null default now()
);

-- Una fila por partida terminada. El dueño juega siempre con X.
create table public.games (
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
create table public.moves (
  game_id uuid not null references public.games (id) on delete cascade,
  ply     smallint not null check (ply between 1 and 9),
  mark    text not null check (mark in ('X', 'O')),
  cell    smallint not null check (cell between 0 and 8),
  primary key (game_id, ply),
  unique (game_id, cell)
);

create index games_player_created_idx on public.games (player_id, created_at desc);
create index players_ranking_idx on public.players (points desc, wins desc, games_played);

-- ============================================================================
-- Seguridad: las tablas no se tocan desde el cliente
-- ============================================================================
-- RLS activado y sin políticas = denegado para anon/authenticated. Solo las
-- funciones de abajo (security definer) leen y escriben.

alter table public.players enable row level security;
alter table public.games   enable row level security;
alter table public.moves   enable row level security;

revoke all on public.players, public.games, public.moves from public, anon, authenticated;

-- ============================================================================
-- Funciones (API del juego)
-- ============================================================================

-- Crea el jugador si no existe y devuelve su perfil.
create or replace function public.ensure_player(p_id uuid)
returns table (alias text, games_played integer, wins integer, draws integer, losses integer, points integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_id is null then
    raise exception 'invalid player' using errcode = '22023';
  end if;

  insert into public.players (id) values (p_id) on conflict (id) do nothing;

  return query
    select pl.alias, pl.games_played, pl.wins, pl.draws, pl.losses, pl.points
    from public.players pl
    where pl.id = p_id;
end;
$$;

-- Cambia el alias (null o vacío lo elimina). Devuelve true si existía el jugador.
create or replace function public.set_alias(p_id uuid, p_alias text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alias text := nullif(btrim(coalesce(p_alias, '')), '');
begin
  if v_alias is not null and char_length(v_alias) not between 2 and 20 then
    raise exception 'alias must have 2 to 20 characters' using errcode = '22023';
  end if;

  update public.players set alias = v_alias where id = p_id;
  return found;
end;
$$;

-- Guarda una partida. El cliente solo envía las casillas jugadas, en orden:
-- aquí se reproduce la partida, así que resultado, línea ganadora y tablero
-- final no se pueden falsear.
create or replace function public.save_game(
  p_player          uuid,
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
  if p_player is null then
    raise exception 'invalid player' using errcode = '22023';
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

  insert into public.players (id) values (p_player) on conflict (id) do nothing;

  insert into public.games (player_id, mode, starting_player, result, win_line, final_board, moves_count, duration_ms)
  values (p_player, p_mode, p_starting_player, v_result, v_win, v_final, v_n, greatest(coalesce(p_duration_ms, 0), 0))
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
   where id = p_player;

  return v_game_id;
end;
$$;

-- Últimas partidas del jugador.
create or replace function public.get_history(p_id uuid, p_limit integer default 10)
returns table (
  id uuid, mode text, starting_player text, result text,
  moves_count smallint, duration_ms integer, created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.mode, g.starting_player, g.result, g.moves_count, g.duration_ms, g.created_at
  from public.games g
  where g.player_id = p_id
  order by g.created_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

-- Jugadas de una partida del jugador (para la repetición).
create or replace function public.get_moves(p_id uuid, p_game_id uuid)
returns table (ply smallint, mark text, cell smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select m.ply, m.mark, m.cell
  from public.moves m
  join public.games g on g.id = m.game_id
  where g.id = p_game_id and g.player_id = p_id
  order by m.ply;
$$;

-- Ranking público. No devuelve ids; `is_me` marca la fila del jugador que pregunta.
create or replace function public.get_leaderboard(p_id uuid default null, p_limit integer default 10)
returns table (
  alias text, games_played integer, wins integer, draws integer,
  losses integer, points integer, is_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select pl.alias, pl.games_played, pl.wins, pl.draws, pl.losses, pl.points,
         coalesce(pl.id = p_id, false) as is_me
  from public.players pl
  where pl.games_played > 0
  order by pl.points desc, pl.wins desc, pl.games_played asc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

-- Permisos: solo estas funciones son la API.
revoke all on function public.ensure_player(uuid) from public;
revoke all on function public.set_alias(uuid, text) from public;
revoke all on function public.save_game(uuid, text, text, smallint[], integer) from public;
revoke all on function public.get_history(uuid, integer) from public;
revoke all on function public.get_moves(uuid, uuid) from public;
revoke all on function public.get_leaderboard(uuid, integer) from public;

grant execute on function public.ensure_player(uuid) to anon, authenticated;
grant execute on function public.set_alias(uuid, text) to anon, authenticated;
grant execute on function public.save_game(uuid, text, text, smallint[], integer) to anon, authenticated;
grant execute on function public.get_history(uuid, integer) to anon, authenticated;
grant execute on function public.get_moves(uuid, uuid) to anon, authenticated;
grant execute on function public.get_leaderboard(uuid, integer) to anon, authenticated;
