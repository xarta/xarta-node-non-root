/* Matrix Chat - Blueprints-native narrow Synapse client */

'use strict';

const MATRIX_CHAT_STORAGE_KEY = 'blueprintsMatrixChatActiveRoom';
const MATRIX_CHAT_HERMES_PREFIX = 'hermes-local-20260518: ';

const MatrixChat = (() => {
  const state = {
    bound: false,
    loading: false,
    status: null,
    joined: [],
    invites: [],
    activeRoomId: '',
    nextBatch: '',
    pollTimer: null,
    messagesByRoom: new Map(),
  };

  function el(id) {
    return document.getElementById(id);
  }

  function isActive() {
    return el('tab-matrix-chat')?.classList.contains('active');
  }

  function setStatus(message, tone = '') {
    const node = el('matrix-chat-status');
    if (!node) return;
    node.textContent = message || '';
    node.dataset.tone = tone || '';
    node.hidden = !message;
  }

  async function apiJson(url, options = {}) {
    const response = await apiFetch(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function fmtTime(ts) {
    if (!Number.isFinite(ts)) return '';
    try {
      return new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        day: '2-digit',
      }).format(new Date(ts));
    } catch (_) {
      return '';
    }
  }

  function roomTitle(room) {
    return room?.display_name || room?.name || room?.canonical_alias || room?.room_id || 'Room';
  }

  function isRoomIdLike(value) {
    return typeof value === 'string' && value.startsWith('!') && value.includes(':');
  }

  function hasUsefulRoomTitle(room) {
    if (!room) return false;
    const title = room.display_name || room.name || room.canonical_alias || '';
    return Boolean(title && !isRoomIdLike(title) && room.name_source !== 'fallback_room_id');
  }

  function mergeRoomSummary(existing, incoming) {
    if (!existing) return incoming;
    const merged = { ...existing, ...incoming };
    const incomingIsFallback = incoming?.name_source === 'fallback_room_id' || isRoomIdLike(incoming?.name);
    if (incomingIsFallback && hasUsefulRoomTitle(existing)) {
      merged.name = existing.name;
      merged.display_name = existing.display_name;
      merged.name_source = existing.name_source;
      merged.canonical_alias = existing.canonical_alias;
    }
    return merged;
  }

  function activeRoom() {
    return state.joined.find(room => room.room_id === state.activeRoomId) || null;
  }

  function rememberActiveRoom(roomId) {
    state.activeRoomId = roomId || '';
    try {
      if (state.activeRoomId) localStorage.setItem(MATRIX_CHAT_STORAGE_KEY, state.activeRoomId);
    } catch (_) {}
  }

  function preferredRoomId() {
    try {
      const saved = localStorage.getItem(MATRIX_CHAT_STORAGE_KEY) || '';
      if (saved && state.joined.some(room => room.room_id === saved)) return saved;
    } catch (_) {}
    const defaultId = state.status?.default_room_id || '';
    if (defaultId && state.joined.some(room => room.room_id === defaultId)) return defaultId;
    const smoke = state.joined.find(room => /hermes local smoke/i.test(room.name || ''));
    return smoke?.room_id || state.joined[0]?.room_id || '';
  }

  function chooseActiveRoom() {
    if (state.activeRoomId && state.joined.some(room => room.room_id === state.activeRoomId)) return;
    rememberActiveRoom(preferredRoomId());
  }

  function renderStatus() {
    const user = el('matrix-chat-user');
    const home = el('matrix-chat-homeserver');
    const features = el('matrix-chat-features');
    if (user) user.textContent = state.status?.user_id || 'Not configured';
    if (home) home.textContent = state.status?.homeserver_url || 'Matrix';
    if (features) {
      const encrypted = activeRoom()?.encrypted ? 'Encrypted' : 'Unencrypted private room';
      features.textContent = `${encrypted} - Blueprints push off`;
    }
  }

  function renderRooms() {
    const roomsNode = el('matrix-chat-rooms');
    const invitesNode = el('matrix-chat-invites');
    if (!roomsNode || !invitesNode) return;

    roomsNode.innerHTML = '';
    if (!state.joined.length) {
      const empty = document.createElement('div');
      empty.className = 'matrix-chat-empty';
      empty.textContent = 'No joined rooms';
      roomsNode.appendChild(empty);
    } else {
      state.joined.forEach(room => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'matrix-chat-room';
        btn.classList.toggle('active', room.room_id === state.activeRoomId);
        btn.dataset.roomId = room.room_id;
        btn.title = room.room_id;

        const name = document.createElement('span');
        name.className = 'matrix-chat-room-name';
        name.textContent = roomTitle(room);
        const meta = document.createElement('span');
        meta.className = 'matrix-chat-room-meta';
        meta.textContent = room.last_preview || room.room_id;
        btn.append(name, meta);
        btn.addEventListener('click', () => selectRoom(room.room_id));
        roomsNode.appendChild(btn);
      });
    }

    invitesNode.innerHTML = '';
    state.invites.forEach(room => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'matrix-chat-invite';
      row.textContent = `Join ${roomTitle(room)}`;
      row.addEventListener('click', () => joinRoom(room.room_id));
      invitesNode.appendChild(row);
    });
    invitesNode.hidden = state.invites.length === 0;
  }

  function renderMessages() {
    const timeline = el('matrix-chat-timeline');
    const title = el('matrix-chat-room-title');
    const roomId = el('matrix-chat-room-id');
    const active = activeRoom();
    if (title) title.textContent = active ? roomTitle(active) : 'No room selected';
    if (roomId) roomId.textContent = active?.room_id || '';
    renderStatus();
    if (!timeline) return;
    timeline.innerHTML = '';

    if (!active) {
      const empty = document.createElement('div');
      empty.className = 'matrix-chat-empty matrix-chat-empty--center';
      empty.textContent = 'Join or create a Matrix room to start chatting.';
      timeline.appendChild(empty);
      return;
    }

    const messages = state.messagesByRoom.get(active.room_id) || [];
    if (!messages.length) {
      const empty = document.createElement('div');
      empty.className = 'matrix-chat-empty matrix-chat-empty--center';
      empty.textContent = 'No recent messages.';
      timeline.appendChild(empty);
      return;
    }

    const ownUser = state.status?.user_id || '';
    messages.forEach(message => {
      const item = document.createElement('article');
      item.className = 'matrix-chat-message';
      if (message.sender === ownUser) item.classList.add('is-self');
      if ((message.sender || '').includes('hermes-local')) item.classList.add('is-hermes');

      const meta = document.createElement('div');
      meta.className = 'matrix-chat-message-meta';
      const sender = document.createElement('span');
      sender.textContent = message.sender || 'unknown';
      const ts = document.createElement('time');
      ts.textContent = fmtTime(message.origin_server_ts);
      meta.append(sender, ts);

      const body = document.createElement('div');
      body.className = 'matrix-chat-message-body';
      body.textContent = message.body || '';
      item.append(meta, body);
      timeline.appendChild(item);
    });
    timeline.scrollTop = timeline.scrollHeight;
  }

  function mergeMessages(roomId, messages) {
    if (!roomId || !Array.isArray(messages) || !messages.length) return;
    const existing = state.messagesByRoom.get(roomId) || [];
    const seen = new Set(existing.map(message => message.event_id).filter(Boolean));
    const merged = existing.slice();
    messages.forEach(message => {
      if (!message) return;
      if (message.event_id && seen.has(message.event_id)) return;
      if (message.event_id) seen.add(message.event_id);
      merged.push(message);
    });
    merged.sort((a, b) => (a.origin_server_ts || 0) - (b.origin_server_ts || 0));
    state.messagesByRoom.set(roomId, merged.slice(-120));
  }

  async function loadStatus() {
    state.status = await apiJson('/api/v1/matrix-chat/status');
    if (!state.status.configured) {
      setStatus('Matrix chat credentials are not configured on the Blueprints server.', 'warn');
    } else if (!state.status.reachable) {
      setStatus('Matrix homeserver is not reachable from Blueprints.', 'warn');
    } else {
      setStatus('');
    }
    renderStatus();
  }

  async function loadRooms() {
    const data = await apiJson('/api/v1/matrix-chat/rooms');
    state.joined = Array.isArray(data.joined) ? data.joined : [];
    state.invites = Array.isArray(data.invites) ? data.invites : [];
    state.nextBatch = data.next_batch || state.nextBatch || '';
    chooseActiveRoom();
    renderRooms();
  }

  async function loadMessages(roomId = state.activeRoomId) {
    if (!roomId) {
      renderMessages();
      return;
    }
    const data = await apiJson(`/api/v1/matrix-chat/rooms/${encodeURIComponent(roomId)}/messages?limit=60`);
    state.messagesByRoom.set(roomId, Array.isArray(data.messages) ? data.messages : []);
    renderMessages();
  }

  async function refreshAll() {
    if (state.loading) return;
    state.loading = true;
    try {
      const priorRoom = state.activeRoomId;
      await loadStatus();
      await loadRooms();
      if (priorRoom && state.joined.some(room => room.room_id === priorRoom)) {
        rememberActiveRoom(priorRoom);
      }
      await loadMessages();
      renderRooms();
      renderMessages();
    } catch (error) {
      setStatus(`Matrix chat load failed: ${error.message}`, 'error');
    } finally {
      state.loading = false;
      scheduleViewportFit();
    }
  }

  async function selectRoom(roomId) {
    rememberActiveRoom(roomId);
    closeRailOnMobile();
    renderRooms();
    renderMessages();
    await loadMessages(roomId);
  }

  async function createRoom() {
    const input = el('matrix-chat-create-name');
    const name = (input?.value || '').trim();
    if (!name) return;
    try {
      const data = await apiJson('/api/v1/matrix-chat/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (input) input.value = '';
      if (data.room_id) rememberActiveRoom(data.room_id);
      closeRailOnMobile();
      await refreshAll();
    } catch (error) {
      setStatus(`Create room failed: ${error.message}`, 'error');
    }
  }

  async function joinRoom(roomIdOrAlias) {
    const input = el('matrix-chat-join-id');
    const target = (roomIdOrAlias || input?.value || '').trim();
    if (!target) return;
    try {
      const data = await apiJson('/api/v1/matrix-chat/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id_or_alias: target }),
      });
      if (input) input.value = '';
      if (data.room_id) rememberActiveRoom(data.room_id);
      closeRailOnMobile();
      await refreshAll();
    } catch (error) {
      setStatus(`Join room failed: ${error.message}`, 'error');
    }
  }

  async function inviteUser() {
    const input = el('matrix-chat-invite-user');
    const userId = (input?.value || '').trim();
    if (!userId || !state.activeRoomId) return;
    try {
      await apiJson(`/api/v1/matrix-chat/rooms/${encodeURIComponent(state.activeRoomId)}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      setStatus(`Invite sent to ${userId}`, 'ok');
    } catch (error) {
      setStatus(`Invite failed: ${error.message}`, 'error');
    }
  }

  function insertHermesMention() {
    const composer = el('matrix-chat-composer');
    if (!composer) return;
    const value = composer.value || '';
    if (value.startsWith(MATRIX_CHAT_HERMES_PREFIX)) {
      composer.focus();
      return;
    }
    const start = composer.selectionStart || 0;
    const end = composer.selectionEnd || 0;
    const prefix = start === 0 ? MATRIX_CHAT_HERMES_PREFIX : ` ${MATRIX_CHAT_HERMES_PREFIX}`;
    composer.value = `${value.slice(0, start)}${prefix}${value.slice(end)}`;
    const cursor = start + prefix.length;
    composer.setSelectionRange(cursor, cursor);
    composer.focus();
  }

  async function sendMessage() {
    const composer = el('matrix-chat-composer');
    const body = (composer?.value || '').trim();
    if (!body || !state.activeRoomId) return;
    try {
      await apiJson(`/api/v1/matrix-chat/rooms/${encodeURIComponent(state.activeRoomId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (composer) composer.value = '';
      await loadMessages(state.activeRoomId);
      await loadRooms();
    } catch (error) {
      setStatus(`Send failed: ${error.message}`, 'error');
    }
  }

  async function poll() {
    if (!isActive() || state.loading || !state.nextBatch) return;
    try {
      const data = await apiJson(`/api/v1/matrix-chat/sync?since=${encodeURIComponent(state.nextBatch)}&timeout_ms=0`);
      state.nextBatch = data.next_batch || state.nextBatch;
      if (Array.isArray(data.joined) && data.joined.length) {
        const byId = new Map(state.joined.map(room => [room.room_id, room]));
        data.joined.forEach(room => byId.set(room.room_id, mergeRoomSummary(byId.get(room.room_id), room)));
        state.joined = Array.from(byId.values()).sort((a, b) => (b.last_event_ts || 0) - (a.last_event_ts || 0));
        renderRooms();
      }
      if (Array.isArray(data.invites) && data.invites.length) {
        state.invites = data.invites;
        renderRooms();
      }
      (data.room_updates || []).forEach(update => mergeMessages(update.room_id, update.messages));
      renderMessages();
    } catch (_) {
      // Keep the page calm; explicit refresh will surface detailed errors.
    }
  }

  function scheduleViewportFit() {
    if (window.BodyShade?.scheduleSizeFillTable) {
      window.BodyShade.scheduleSizeFillTable();
    }
  }

  function isMobileLayout() {
    return window.matchMedia?.('(max-width: 820px)').matches;
  }

  function setRailOpen(open) {
    const shell = el('matrix-chat-shell');
    const toggle = el('matrix-chat-mobile-rail-toggle');
    if (!shell) return;
    shell.classList.toggle('rail-open', Boolean(open));
    shell.classList.toggle('rail-collapsed', !open);
    if (toggle) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? 'Close' : 'Rooms';
    }
  }

  function closeRailOnMobile() {
    if (isMobileLayout()) setRailOpen(false);
  }

  function syncRailForViewport() {
    setRailOpen(!isMobileLayout());
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    let lastRailPointerToggle = 0;
    const toggleRail = event => {
      if (event?.type === 'click' && Date.now() - lastRailPointerToggle < 500) return;
      if (event?.type === 'pointerup' || event?.type === 'touchend') lastRailPointerToggle = Date.now();
      event?.preventDefault?.();
      const shell = el('matrix-chat-shell');
      setRailOpen(!shell?.classList.contains('rail-open'));
    };
    const closeRail = event => {
      event?.preventDefault?.();
      setRailOpen(false);
    };
    el('matrix-chat-refresh')?.addEventListener('click', refreshAll);
    el('matrix-chat-rail-close')?.addEventListener('pointerup', closeRail);
    el('matrix-chat-rail-close')?.addEventListener('touchend', closeRail);
    el('matrix-chat-rail-close')?.addEventListener('click', closeRail);
    el('matrix-chat-mobile-rail-toggle')?.addEventListener('pointerup', toggleRail);
    el('matrix-chat-mobile-rail-toggle')?.addEventListener('touchend', toggleRail);
    el('matrix-chat-mobile-rail-toggle')?.addEventListener('click', toggleRail);
    el('matrix-chat-create')?.addEventListener('click', createRoom);
    el('matrix-chat-join')?.addEventListener('click', () => joinRoom());
    el('matrix-chat-invite')?.addEventListener('click', inviteUser);
    el('matrix-chat-mention-hermes')?.addEventListener('click', insertHermesMention);
    el('matrix-chat-send')?.addEventListener('click', sendMessage);
    el('matrix-chat-composer')?.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        sendMessage();
      }
    });
    window.addEventListener('resize', syncRailForViewport);
    syncRailForViewport();
  }

  async function loadTab() {
    bind();
    await refreshAll();
    if (!state.pollTimer) state.pollTimer = window.setInterval(poll, 8000);
  }

  return {
    loadTab,
    refresh: refreshAll,
    sendMessage,
    insertHermesMention,
  };
})();

function _matrixChatLoadTab() {
  MatrixChat.loadTab();
}

window._matrixChatLoadTab = _matrixChatLoadTab;
window.MatrixChat = MatrixChat;
