// Capa de acceso a Supabase. Ninguna función lanza: si falta la configuración
// o falla la red devuelven null / false y el juego sigue funcionando sin guardar.
const db = (() => {
  const cfg = window.SUPABASE_CONFIG || {};
  const configured = Boolean(cfg.url && cfg.anonKey && window.supabase && window.supabase.createClient);
  const client = configured ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;

  let session = null;
  let userId = null;

  async function safe(fn) {
    try {
      return await fn();
    } catch (err) {
      console.warn('[db]', err && err.message ? err.message : err);
      return null;
    }
  }

  // Abre (o reutiliza) la sesión anónima y garantiza la fila del jugador.
  // Devuelve el id del jugador o null.
  function connect() {
    if (!client) return Promise.resolve(null);
    if (!session) {
      session = safe(async () => {
        const { data: current } = await client.auth.getSession();
        let user = current.session && current.session.user;
        if (!user) {
          const { data, error } = await client.auth.signInAnonymously();
          if (error) throw error;
          user = data.user;
        }
        const { error } = await client
          .from('players')
          .upsert({ id: user.id }, { onConflict: 'id', ignoreDuplicates: true });
        if (error) throw error;
        userId = user.id;
        return userId;
      }).then((id) => {
        if (!id) session = null; // permite reintentar más tarde
        return id;
      });
    }
    return session;
  }

  async function loadProfile() {
    const id = await connect();
    if (!id) return null;
    return safe(async () => {
      const { data, error } = await client
        .from('players')
        .select('id, alias, games_played, wins, draws, losses, points')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    });
  }

  async function setAlias(alias) {
    const id = await connect();
    if (!id) return false;
    const ok = await safe(async () => {
      const { error } = await client.from('players').update({ alias }).eq('id', id);
      if (error) throw error;
      return true;
    });
    return Boolean(ok);
  }

  // cells: casillas (0-8) en el orden jugado. El servidor reproduce la partida.
  async function saveGame({ mode, startingPlayer, cells, durationMs }) {
    const id = await connect();
    if (!id) return null;
    return safe(async () => {
      const { data, error } = await client.rpc('save_game', {
        p_mode: mode,
        p_starting_player: startingPlayer,
        p_cells: cells,
        p_duration_ms: Math.max(0, Math.round(durationMs)),
      });
      if (error) throw error;
      return data;
    });
  }

  async function fetchHistory(limit = 10) {
    const id = await connect();
    if (!id) return null;
    return safe(async () => {
      const { data, error } = await client
        .from('games')
        .select('id, mode, starting_player, result, moves_count, duration_ms, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data;
    });
  }

  async function fetchMoves(gameId) {
    const id = await connect();
    if (!id) return null;
    return safe(async () => {
      const { data, error } = await client
        .from('moves')
        .select('ply, mark, cell')
        .eq('game_id', gameId)
        .order('ply');
      if (error) throw error;
      return data;
    });
  }

  async function fetchLeaderboard(limit = 10) {
    const id = await connect();
    if (!id) return null;
    return safe(async () => {
      const { data, error } = await client
        .from('players')
        .select('id, alias, games_played, wins, draws, losses, points')
        .gt('games_played', 0)
        .order('points', { ascending: false })
        .order('wins', { ascending: false })
        .order('games_played', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return data;
    });
  }

  return {
    configured,
    connect,
    loadProfile,
    setAlias,
    saveGame,
    fetchHistory,
    fetchMoves,
    fetchLeaderboard,
  };
})();
