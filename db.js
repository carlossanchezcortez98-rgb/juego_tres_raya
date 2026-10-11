// Capa de acceso a Supabase (sin Auth). Cada navegador genera un id aleatorio,
// lo guarda en localStorage y lo envía a unas funciones RPC del servidor; las
// tablas no son accesibles directamente (ver supabase/schema.sql).
// Ninguna función lanza: si falta la configuración o falla la red devuelven
// null y el juego sigue funcionando sin guardar.
const db = (() => {
  const STORAGE_KEY = 'tres-en-raya.player-id';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const cfg = window.SUPABASE_CONFIG || {};
  const configured = Boolean(cfg.url && cfg.anonKey && window.supabase && window.supabase.createClient);
  const client = configured
    ? window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
    : null;

  function uuid4() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // Id del jugador: persiste en este navegador; si localStorage no está
  // disponible vale solo para la sesión.
  let memoryId = null;
  function playerId() {
    try {
      let id = localStorage.getItem(STORAGE_KEY);
      if (!id || !UUID_RE.test(id)) {
        id = uuid4();
        localStorage.setItem(STORAGE_KEY, id);
      }
      return id;
    } catch (err) {
      if (!memoryId) memoryId = uuid4();
      return memoryId;
    }
  }

  async function rpc(name, args) {
    if (!client) return null;
    try {
      const { data, error } = await client.rpc(name, args);
      if (error) throw error;
      return data;
    } catch (err) {
      console.warn('[db]', name, err && err.message ? err.message : err);
      return null;
    }
  }

  // Registra al jugador (si hace falta) y devuelve su perfil, o null.
  async function loadProfile() {
    const rows = await rpc('ensure_player', { p_id: playerId() });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  let ready = null;
  // Comprueba la conexión una vez; devuelve el id del jugador o null.
  function connect() {
    if (!client) return Promise.resolve(null);
    if (!ready) {
      ready = loadProfile().then((profile) => {
        if (!profile) ready = null; // permite reintentar más tarde
        return profile ? playerId() : null;
      });
    }
    return ready;
  }

  async function setAlias(alias) {
    return (await rpc('set_alias', { p_id: playerId(), p_alias: alias })) === true;
  }

  // cells: casillas (0-8) en el orden jugado. El servidor reproduce la partida.
  async function saveGame({ mode, startingPlayer, cells, durationMs }) {
    if (!client) return null;
    return rpc('save_game', {
      p_player: playerId(),
      p_mode: mode,
      p_starting_player: startingPlayer,
      p_cells: cells,
      p_duration_ms: Math.max(0, Math.round(durationMs)),
    });
  }

  function fetchHistory(limit = 10) {
    return rpc('get_history', { p_id: playerId(), p_limit: limit });
  }

  function fetchMoves(gameId) {
    return rpc('get_moves', { p_id: playerId(), p_game_id: gameId });
  }

  function fetchLeaderboard(limit = 10) {
    return rpc('get_leaderboard', { p_id: playerId(), p_limit: limit });
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
