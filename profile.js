// Diálogo de perfil: alias, estadísticas, historial con repetición y ranking.
// Todo el texto del usuario se pinta con textContent (nunca innerHTML).
(() => {
  const $ = (id) => document.getElementById(id);
  const els = {
    open: $('open-profile'),
    label: $('profile-label'),
    dialog: $('profile-dialog'),
    close: $('close-profile'),
    tabs: document.querySelectorAll('.tab'),
    panels: document.querySelectorAll('.tab-panel'),
    aliasForm: $('alias-form'),
    aliasInput: $('alias-input'),
    aliasMsg: $('alias-msg'),
    games: $('stat-games'),
    wins: $('stat-wins'),
    draws: $('stat-draws'),
    losses: $('stat-losses'),
    points: $('stat-points'),
    historyList: $('history-list'),
    historyEmpty: $('history-empty'),
    rankingList: $('ranking-list'),
    rankingEmpty: $('ranking-empty'),
    offline: $('offline-note'),
  };

  const RESULT_LABEL = { X: 'Victoria', O: 'Derrota', draw: 'Empate' };
  const MODE_LABEL = { cpu: 'Contra la máquina', pvp: '2 jugadores' };

  let profile = null;
  let activeTab = 'profile';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  let connected = false;

  // El botón de perfil es siempre visible; sin conexión el diálogo explica cómo conectar.
  function setConnected(value) {
    connected = value;
    els.offline.hidden = value;
    $('dialog-offline').hidden = value;
    $('dialog-tabs').hidden = !value;
    if (!value) els.panels.forEach((panel) => { panel.hidden = true; });
    els.label.textContent = value && profile && profile.alias ? profile.alias : 'Perfil';
  }

  function renderProfile() {
    if (!profile) return;
    els.label.textContent = profile.alias || 'Perfil';
    els.aliasInput.value = profile.alias || '';
    els.games.textContent = profile.games_played;
    els.wins.textContent = profile.wins;
    els.draws.textContent = profile.draws;
    els.losses.textContent = profile.losses;
    els.points.textContent = profile.points;
  }

  async function refreshProfile() {
    const data = await db.loadProfile();
    if (data) {
      profile = data;
      renderProfile();
    }
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString('es-ES', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }

  function formatDuration(ms) {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
  }

  async function loadHistory() {
    const games = await db.fetchHistory(10);
    els.historyList.replaceChildren();
    els.historyEmpty.hidden = !games || games.length > 0;
    if (!games) return;

    for (const game of games) {
      const row = el('li', `list-row result-${game.result.toLowerCase()}`);
      const info = el('div', 'row-info');
      info.append(
        el('strong', 'row-title', RESULT_LABEL[game.result]),
        el('span', 'row-sub',
          `${MODE_LABEL[game.mode]} · ${game.moves_count} jugadas · ${formatDuration(game.duration_ms)} · ${formatDate(game.created_at)}`)
      );
      const btn = el('button', 'btn ghost row-btn', 'Ver');
      btn.type = 'button';
      btn.setAttribute('aria-label', `Ver repetición de la partida: ${RESULT_LABEL[game.result]}, ${formatDate(game.created_at)}`);
      btn.addEventListener('click', () => watchReplay(game, btn));
      row.append(info, btn);
      els.historyList.append(row);
    }
  }

  async function watchReplay(game, btn) {
    btn.disabled = true;
    const moves = await db.fetchMoves(game.id);
    btn.disabled = false;
    if (!moves || moves.length === 0) return;
    els.dialog.close();
    startReplay(game, moves);
  }

  async function loadRanking() {
    const players = await db.fetchLeaderboard(10);
    els.rankingList.replaceChildren();
    els.rankingEmpty.hidden = !players || players.length > 0;
    if (!players) return;

    players.forEach((p, i) => {
      const mine = p.is_me;
      const row = el('li', `list-row${mine ? ' mine' : ''}`);
      const info = el('div', 'row-info');
      info.append(
        el('strong', 'row-title', `${i + 1}. ${p.alias || 'Anónimo'}${mine ? ' (tú)' : ''}`),
        el('span', 'row-sub', `${p.wins} V · ${p.draws} E · ${p.losses} D · ${p.games_played} partidas`)
      );
      row.append(info, el('span', 'row-points', `${p.points} pts`));
      els.rankingList.append(row);
    });
  }

  function selectTab(name) {
    activeTab = name;
    els.tabs.forEach((tab) => {
      const on = tab.dataset.tab === name;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
    });
    els.panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
    if (name === 'history') loadHistory();
    if (name === 'ranking') loadRanking();
  }

  async function saveAlias(event) {
    event.preventDefault();
    const value = els.aliasInput.value.trim();
    if (value && (value.length < 2 || value.length > 20)) {
      els.aliasMsg.textContent = 'El alias debe tener entre 2 y 20 caracteres.';
      return;
    }
    els.aliasMsg.textContent = 'Guardando…';
    const ok = await db.setAlias(value || null);
    if (ok) {
      await refreshProfile();
      els.aliasMsg.textContent = value ? 'Alias guardado.' : 'Alias eliminado.';
    } else {
      els.aliasMsg.textContent = 'No se pudo guardar. Inténtalo de nuevo.';
    }
  }

  els.open.addEventListener('click', async () => {
    els.aliasMsg.textContent = '';
    if (!connected) {
      els.dialog.showModal();
      return;
    }
    selectTab('profile');
    els.dialog.showModal();
    await refreshProfile();
  });
  els.close.addEventListener('click', () => els.dialog.close());
  els.dialog.addEventListener('click', (event) => {
    if (event.target === els.dialog) els.dialog.close(); // clic en el fondo
  });
  els.tabs.forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));
  els.aliasForm.addEventListener('submit', saveAlias);

  // Una partida guardada actualiza contadores; refresca lo que esté visible.
  window.addEventListener('game-saved', async () => {
    await refreshProfile();
    if (els.dialog.open) selectTab(activeTab);
  });

  // Arranque: sin configuración el juego funciona igual, solo que sin guardar.
  if (!db.configured) {
    setConnected(false);
  } else {
    db.connect().then((id) => {
      setConnected(Boolean(id));
      if (id) refreshProfile();
    });
  }
})();
