/* Matrix Chat Admin - read-only Synapse operations page */

'use strict';

const MatrixChatAdmin = (() => {
  const state = {
    bound: false,
    loading: false,
    activeView: 'users',
    status: null,
    users: [],
    rooms: [],
    selectedUserId: '',
    selectedRoomId: '',
    roomDetail: null,
    roomMembers: [],
    lastRefresh: '',
    lastRefreshCompact: '',
  };

  function el(id) {
    return document.getElementById(id);
  }

  function isActive() {
    return el('tab-matrix-chat-admin')?.classList.contains('active');
  }

  async function apiJson(url, options = {}) {
    const response = await apiFetch(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function setStatus(message, tone = '') {
    const node = el('matrix-chat-admin-message');
    if (!node) return;
    node.textContent = message || '';
    node.dataset.tone = tone || '';
    node.hidden = !message;
  }

  function fmtBool(value) {
    return value ? 'Yes' : 'No';
  }

  function fmtMaybe(value) {
    if (value === null || value === undefined || value === '') return '-';
    return String(value);
  }

  function fmtDate(ts) {
    if (!Number.isFinite(ts)) return '-';
    try {
      return new Intl.DateTimeFormat(undefined, {
        year: '2-digit',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(ts));
    } catch (_) {
      return '-';
    }
  }

  function setText(id, value) {
    const node = el(id);
    if (node) node.textContent = fmtMaybe(value);
  }

  function matrixLocalpart(userId) {
    const raw = String(userId || '');
    if (raw.startsWith('@') && raw.includes(':')) return raw.slice(1).split(':')[0];
    return raw;
  }

  function shortRoomId(roomId) {
    const raw = String(roomId || '');
    if (!raw.includes(':')) return raw;
    const [local, server] = raw.split(':');
    if (local.length <= 12) return raw;
    return `${local.slice(0, 8)}...${local.slice(-4)}:${server}`;
  }

  function isActiveUser(user) {
    return !Boolean(user?.deactivated);
  }

  function userKind(user) {
    if (!isActiveUser(user)) return '';
    const haystack = `${user?.user_id || ''} ${user?.display_name || ''}`.toLowerCase();
    if (user?.is_admin) return 'admin';
    if (haystack.includes('hermes')) return 'hermes';
    if (haystack.includes('operator') || haystack.includes('human')) return 'operator';
    return '';
  }

  function roomMemberCount(room) {
    const joined = Number(room?.joined_members);
    const local = Number(room?.joined_local_members);
    return Math.max(
      Number.isFinite(joined) ? joined : 0,
      Number.isFinite(local) ? local : 0,
    );
  }

  function isActiveRoom(room) {
    return roomMemberCount(room) > 0;
  }

  function button(label, title, onClick, className = 'matrix-chat-admin-icon-btn') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.addEventListener('click', onClick);
    return btn;
  }

  function copyText(value, label) {
    const text = String(value || '');
    if (!text) return;
    navigator.clipboard?.writeText(text)
      .then(() => setStatus(`${label} copied`, 'ok'))
      .catch(() => setStatus(`Could not copy ${label}`, 'warn'));
  }

  function renderStatusStrip() {
    const status = state.status || {};
    setText('matrix-chat-admin-homeserver', status.homeserver_url || '-');
    setText('matrix-chat-admin-mobile-homeserver', status.homeserver_url || '-');
    setText('matrix-chat-admin-admin-configured', fmtBool(Boolean(status.admin_configured)));
    setText('matrix-chat-admin-mobile-admin-configured', fmtBool(Boolean(status.admin_configured)));
    setText('matrix-chat-admin-reachable', fmtBool(Boolean(status.reachable)));
    setText('matrix-chat-admin-mobile-reachable', fmtBool(Boolean(status.reachable)));
    setText('matrix-chat-admin-last-refresh', state.lastRefresh || '-');
    setText('matrix-chat-admin-mobile-last-refresh', state.lastRefreshCompact || state.lastRefresh || '-');
  }

  function renderViewButtons() {
    const usersBtn = el('matrix-chat-admin-view-users');
    const roomsBtn = el('matrix-chat-admin-view-rooms');
    if (usersBtn) usersBtn.classList.toggle('active', state.activeView === 'users');
    if (roomsBtn) roomsBtn.classList.toggle('active', state.activeView === 'rooms');
  }

  function renderUsers() {
    const body = el('matrix-chat-admin-users-body');
    if (!body) return;
    clearNode(body);
    state.users.forEach(user => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'matrix-chat-admin-row matrix-chat-admin-user-row';
      row.classList.toggle('active', user.user_id === state.selectedUserId);
      row.classList.toggle('is-subdued', !isActiveUser(user));
      const kind = userKind(user);
      if (kind) row.classList.add(`is-${kind}-active`);
      row.dataset.userId = user.user_id;

      [
        user.user_id,
        user.display_name || matrixLocalpart(user.user_id),
        fmtBool(Boolean(user.is_admin)),
        user.deactivated ? 'No' : 'Yes',
        fmtBool(Boolean(user.is_guest)),
        fmtDate(user.creation_ts),
      ].forEach(value => {
        const cell = document.createElement('span');
        cell.textContent = value;
        row.appendChild(cell);
      });
      row.addEventListener('click', () => selectUser(user.user_id));
      body.appendChild(row);
    });
  }

  function renderRooms() {
    const body = el('matrix-chat-admin-rooms-body');
    if (!body) return;
    clearNode(body);
    state.rooms.forEach(room => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'matrix-chat-admin-row matrix-chat-admin-room-row';
      row.classList.toggle('active', room.room_id === state.selectedRoomId);
      row.classList.toggle('is-subdued', !isActiveRoom(room));
      if (isActiveRoom(room)) {
        row.classList.add(room.encrypted ? 'is-room-encrypted-active' : 'is-room-unencrypted-active');
      }
      row.dataset.roomId = room.room_id;

      [
        room.name || shortRoomId(room.room_id),
        fmtMaybe(room.joined_members),
        room.encrypted ? 'Enc' : 'Plain',
        fmtBool(Boolean(room.federatable)),
        room.room_id,
      ].forEach(value => {
        const cell = document.createElement('span');
        cell.textContent = value;
        row.appendChild(cell);
      });
      row.addEventListener('click', () => selectRoom(room.room_id));
      body.appendChild(row);
    });
  }

  function detailRow(parent, label, value, copyValue = '') {
    const row = document.createElement('div');
    row.className = 'matrix-chat-admin-detail-row';
    const key = document.createElement('span');
    key.textContent = label;
    const val = document.createElement('strong');
    val.textContent = fmtMaybe(value);
    row.appendChild(key);
    row.appendChild(val);
    if (copyValue) row.appendChild(button('C', `Copy ${label}`, () => copyText(copyValue, label)));
    parent.appendChild(row);
  }

  function renderUserDetail(user) {
    const detail = el('matrix-chat-admin-detail');
    if (!detail) return;
    clearNode(detail);
    if (!user) {
      const empty = document.createElement('p');
      empty.className = 'matrix-chat-admin-empty';
      empty.textContent = 'Select a user or room';
      detail.appendChild(empty);
      return;
    }
    const title = document.createElement('h3');
    title.textContent = user.display_name || matrixLocalpart(user.user_id);
    detail.appendChild(title);
    detailRow(detail, 'Matrix ID', user.user_id, user.user_id);
    detailRow(detail, 'Admin', fmtBool(Boolean(user.is_admin)));
    detailRow(detail, 'Active', user.deactivated ? 'No' : 'Yes');
    detailRow(detail, 'Guest', fmtBool(Boolean(user.is_guest)));
    detailRow(detail, 'Created', fmtDate(user.creation_ts));
  }

  function renderRoomMembers(parent) {
    const wrap = document.createElement('div');
    wrap.className = 'matrix-chat-admin-members';
    const heading = document.createElement('h4');
    heading.textContent = 'Members';
    wrap.appendChild(heading);
    if (!state.roomMembers.length) {
      const empty = document.createElement('p');
      empty.className = 'matrix-chat-admin-empty';
      empty.textContent = 'No member rows returned';
      wrap.appendChild(empty);
    } else {
      state.roomMembers.forEach(member => {
        const row = document.createElement('div');
        row.className = 'matrix-chat-admin-member-row';
        const name = document.createElement('strong');
        name.textContent = member.display_name || matrixLocalpart(member.user_id);
        const meta = document.createElement('span');
        meta.textContent = `${member.membership || 'join'} | PL ${fmtMaybe(member.power_level)}`;
        row.appendChild(name);
        row.appendChild(meta);
        row.appendChild(button('C', 'Copy Matrix ID', () => copyText(member.user_id, 'Matrix ID')));
        wrap.appendChild(row);
      });
    }
    parent.appendChild(wrap);
  }

  function renderPowerLevels(parent, levels) {
    if (!levels || !Object.keys(levels).length) return;
    const wrap = document.createElement('div');
    wrap.className = 'matrix-chat-admin-power';
    const heading = document.createElement('h4');
    heading.textContent = 'Power levels';
    wrap.appendChild(heading);
    Object.entries(levels).forEach(([key, value]) => detailRow(wrap, key, fmtMaybe(value)));
    parent.appendChild(wrap);
  }

  function renderRoomDetail(room) {
    const detail = el('matrix-chat-admin-detail');
    if (!detail) return;
    clearNode(detail);
    if (!room) {
      renderUserDetail(null);
      return;
    }
    const resolved = state.roomDetail || room;
    const title = document.createElement('h3');
    title.textContent = resolved.name || shortRoomId(resolved.room_id);
    detail.appendChild(title);
    detailRow(detail, 'Room ID', resolved.room_id, resolved.room_id);
    detailRow(detail, 'Alias', resolved.canonical_alias || '-', resolved.canonical_alias || '');
    detailRow(detail, 'Members', resolved.joined_members);
    detailRow(detail, 'Local members', resolved.joined_local_members);
    detailRow(detail, 'Encrypted', fmtBool(Boolean(resolved.encrypted)));
    detailRow(detail, 'Algorithm', resolved.encryption_algorithm || '-');
    detailRow(detail, 'Version', resolved.version);
    detailRow(detail, 'Public', fmtBool(Boolean(resolved.public)));
    detailRow(detail, 'Federatable', fmtBool(Boolean(resolved.federatable)));
    renderPowerLevels(detail, resolved.power_levels);
    renderRoomMembers(detail);
  }

  function renderPanels() {
    const usersPanel = el('matrix-chat-admin-users-panel');
    const roomsPanel = el('matrix-chat-admin-rooms-panel');
    if (usersPanel) usersPanel.hidden = state.activeView !== 'users';
    if (roomsPanel) roomsPanel.hidden = state.activeView !== 'rooms';
    renderViewButtons();
    renderUsers();
    renderRooms();
    if (state.activeView === 'users') {
      renderUserDetail(state.users.find(user => user.user_id === state.selectedUserId));
    } else {
      renderRoomDetail(state.rooms.find(room => room.room_id === state.selectedRoomId));
    }
  }

  async function loadRoomDetail(roomId) {
    if (!roomId) return;
    const [detail, members] = await Promise.all([
      apiJson(`/api/v1/matrix-chat/admin/rooms/${encodeURIComponent(roomId)}`),
      apiJson(`/api/v1/matrix-chat/admin/rooms/${encodeURIComponent(roomId)}/members`),
    ]);
    state.roomDetail = detail;
    state.roomMembers = Array.isArray(members.members) ? members.members : [];
  }

  async function selectRoom(roomId) {
    state.selectedRoomId = roomId;
    state.activeView = 'rooms';
    state.roomDetail = null;
    state.roomMembers = [];
    renderPanels();
    try {
      await loadRoomDetail(roomId);
      renderPanels();
      setStatus('');
    } catch (error) {
      setStatus(`Room detail failed: ${error.message}`, 'warn');
    }
  }

  function selectUser(userId) {
    state.selectedUserId = userId;
    state.activeView = 'users';
    renderPanels();
  }

  async function setView(view) {
    state.activeView = view === 'rooms' ? 'rooms' : 'users';
    renderPanels();
    if (state.activeView === 'rooms' && state.selectedRoomId && !state.roomDetail) {
      try {
        await loadRoomDetail(state.selectedRoomId);
        renderPanels();
        setStatus('');
      } catch (error) {
        setStatus(`Room detail failed: ${error.message}`, 'warn');
      }
    }
  }

  async function refreshAll() {
    if (state.loading) return;
    state.loading = true;
    setStatus('Refreshing Chat Admin...', '');
    try {
      const [status, users, rooms] = await Promise.all([
        apiJson('/api/v1/matrix-chat/admin/status'),
        apiJson('/api/v1/matrix-chat/admin/users'),
        apiJson('/api/v1/matrix-chat/admin/rooms'),
      ]);
      state.status = status;
      state.users = Array.isArray(users.users) ? users.users : [];
      state.rooms = Array.isArray(rooms.rooms) ? rooms.rooms : [];
      state.lastRefresh = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date());
      state.lastRefreshCompact = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date());
      if (!state.selectedUserId && state.users[0]) state.selectedUserId = state.users[0].user_id;
      if (!state.selectedRoomId && state.rooms[0]) state.selectedRoomId = state.rooms[0].room_id;
      if (state.activeView === 'rooms' && state.selectedRoomId) await loadRoomDetail(state.selectedRoomId);
      renderStatusStrip();
      renderPanels();
      setStatus('', '');
    } catch (error) {
      setStatus(`Chat Admin refresh failed: ${error.message}`, 'err');
      renderStatusStrip();
      renderPanels();
    } finally {
      state.loading = false;
    }
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    el('matrix-chat-admin-refresh')?.addEventListener('click', refreshAll);
    el('matrix-chat-admin-view-users')?.addEventListener('click', () => setView('users'));
    el('matrix-chat-admin-view-rooms')?.addEventListener('click', () => setView('rooms'));
  }

  async function loadTab() {
    bind();
    if (!isActive()) return;
    await refreshAll();
  }

  return {
    loadTab,
    refresh: refreshAll,
  };
})();

function _matrixChatAdminLoadTab() {
  MatrixChatAdmin.loadTab();
}

window._matrixChatAdminLoadTab = _matrixChatAdminLoadTab;
window.MatrixChatAdmin = MatrixChatAdmin;
