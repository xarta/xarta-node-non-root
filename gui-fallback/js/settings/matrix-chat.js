/* Matrix Chat - Blueprints-native narrow Synapse client */

'use strict';

const MATRIX_CHAT_STORAGE_KEY = 'blueprintsMatrixChatActiveRoom';
const MATRIX_CHAT_HERMES_PREFIX = 'hermes: ';
const MATRIX_CHAT_INITIAL_MESSAGE_LIMIT = 60;
const MATRIX_CHAT_OLDER_MESSAGE_LIMIT = 60;
const MATRIX_CHAT_MAX_MESSAGES_PER_ROOM = 600;

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
    historyByRoom: new Map(),
    inviteCandidates: [],
    inviteCandidateIndex: -1,
    inviteCandidateTimer: null,
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

  function isMarkdownBlockStart(line, nextLine = '') {
    return /^```/.test(line)
      || /^#{1,6}\s+/.test(line)
      || /^\s*[-*+]\s+/.test(line)
      || /^\s*\d+\.\s+/.test(line)
      || /^>\s?/.test(line)
      || isTableStart(line, nextLine);
  }

  function isTableRow(line) {
    return /^\s*\|.*\|\s*$/.test(line || '');
  }

  function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line || '');
  }

  function isTableStart(line, nextLine) {
    return isTableRow(line) && isTableSeparator(nextLine || '');
  }

  function tableCells(line) {
    return String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
  }

  function safeLinkTarget(href) {
    const raw = String(href || '').trim();
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return '';
    if (!/^(https?:\/\/|mailto:)/i.test(raw)) return '';
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') return raw;
    } catch (_) {}
    return '';
  }

  function appendInlineMarkdown(parent, source) {
    const text = String(source || '');
    let i = 0;

    const appendTextUntil = end => {
      if (end > i) parent.appendChild(document.createTextNode(text.slice(i, end)));
      i = end;
    };

    while (i < text.length) {
      if (text[i] === '`') {
        const end = text.indexOf('`', i + 1);
        if (end > i + 1) {
          const code = document.createElement('code');
          code.textContent = text.slice(i + 1, end);
          parent.appendChild(code);
          i = end + 1;
          continue;
        }
      }

      if (text.startsWith('**', i)) {
        const end = text.indexOf('**', i + 2);
        if (end > i + 2) {
          const strong = document.createElement('strong');
          appendInlineMarkdown(strong, text.slice(i + 2, end));
          parent.appendChild(strong);
          i = end + 2;
          continue;
        }
      }

      if (text.startsWith('__', i)) {
        const end = text.indexOf('__', i + 2);
        if (end > i + 2) {
          const strong = document.createElement('strong');
          appendInlineMarkdown(strong, text.slice(i + 2, end));
          parent.appendChild(strong);
          i = end + 2;
          continue;
        }
      }

      if (text.startsWith('~~', i)) {
        const end = text.indexOf('~~', i + 2);
        if (end > i + 2) {
          const del = document.createElement('del');
          appendInlineMarkdown(del, text.slice(i + 2, end));
          parent.appendChild(del);
          i = end + 2;
          continue;
        }
      }

      if (text[i] === '*') {
        const end = text.indexOf('*', i + 1);
        if (end > i + 1) {
          const em = document.createElement('em');
          appendInlineMarkdown(em, text.slice(i + 1, end));
          parent.appendChild(em);
          i = end + 1;
          continue;
        }
      }

      if (text[i] === '[') {
        const labelEnd = text.indexOf(']', i + 1);
        const targetStart = labelEnd >= 0 ? text.indexOf('(', labelEnd) : -1;
        const targetEnd = targetStart >= 0 ? text.indexOf(')', targetStart) : -1;
        if (labelEnd > i + 1 && targetStart === labelEnd + 1 && targetEnd > targetStart + 1) {
          const label = text.slice(i + 1, labelEnd);
          const target = text.slice(targetStart + 1, targetEnd);
          const safe = safeLinkTarget(target);
          if (safe) {
            const anchor = document.createElement('a');
            anchor.href = safe;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            appendInlineMarkdown(anchor, label);
            parent.appendChild(anchor);
          } else {
            parent.appendChild(document.createTextNode(label));
          }
          i = targetEnd + 1;
          continue;
        }
      }

      const nextSpecials = ['`', '**', '__', '~~', '*', '[']
        .map(token => text.indexOf(token, i + 1))
        .filter(index => index !== -1);
      appendTextUntil(nextSpecials.length ? Math.min(...nextSpecials) : text.length);
    }
  }

  function appendParagraph(parent, lines) {
    const p = document.createElement('p');
    lines.forEach((line, index) => {
      if (index) p.appendChild(document.createElement('br'));
      appendInlineMarkdown(p, line);
    });
    parent.appendChild(p);
  }

  function renderMarkdownBody(markdown) {
    const fragment = document.createDocumentFragment();
    const text = String(markdown || '');
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        const spacer = document.createElement('div');
        spacer.className = 'matrix-chat-markdown-spacer';
        fragment.appendChild(spacer);
        i += 1;
        continue;
      }

      if (/^```/.test(line)) {
        const codeLines = [];
        i += 1;
        while (i < lines.length && !/^```/.test(lines[i])) {
          codeLines.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = codeLines.join('\n');
        pre.appendChild(code);
        fragment.appendChild(pre);
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = Math.min(6, Math.max(3, heading[1].length + 2));
        const h = document.createElement(`h${level}`);
        appendInlineMarkdown(h, heading[2]);
        fragment.appendChild(h);
        i += 1;
        continue;
      }

      if (isTableStart(line, lines[i + 1])) {
        const headerCells = tableCells(line);
        i += 2;
        const wrap = document.createElement('div');
        wrap.className = 'matrix-chat-table-wrap';
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        headerCells.forEach(cell => {
          const th = document.createElement('th');
          appendInlineMarkdown(th, cell);
          headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        while (i < lines.length && isTableRow(lines[i])) {
          const tr = document.createElement('tr');
          const rowCells = tableCells(lines[i]);
          headerCells.forEach((_, cellIndex) => {
            const td = document.createElement('td');
            appendInlineMarkdown(td, rowCells[cellIndex] || '');
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
          i += 1;
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
        fragment.appendChild(wrap);
        continue;
      }

      const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
      if (unordered) {
        const ul = document.createElement('ul');
        while (i < lines.length) {
          const match = lines[i].match(/^\s*[-*+]\s+(.*)$/);
          if (!match) break;
          const li = document.createElement('li');
          appendInlineMarkdown(li, match[1]);
          ul.appendChild(li);
          i += 1;
        }
        fragment.appendChild(ul);
        continue;
      }

      const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
      if (ordered) {
        const ol = document.createElement('ol');
        while (i < lines.length) {
          const match = lines[i].match(/^\s*\d+\.\s+(.*)$/);
          if (!match) break;
          const li = document.createElement('li');
          appendInlineMarkdown(li, match[1]);
          ol.appendChild(li);
          i += 1;
        }
        fragment.appendChild(ol);
        continue;
      }

      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        const blockquote = document.createElement('blockquote');
        while (i < lines.length) {
          const match = lines[i].match(/^>\s?(.*)$/);
          if (!match) break;
          if (blockquote.childNodes.length) blockquote.appendChild(document.createElement('br'));
          appendInlineMarkdown(blockquote, match[1]);
          i += 1;
        }
        fragment.appendChild(blockquote);
        continue;
      }

      const paragraphLines = [line];
      i += 1;
      while (i < lines.length && lines[i].trim() && !isMarkdownBlockStart(lines[i], lines[i + 1])) {
        paragraphLines.push(lines[i]);
        i += 1;
      }
      appendParagraph(fragment, paragraphLines);
    }

    if (!fragment.childNodes.length) fragment.appendChild(document.createTextNode(text));
    return fragment;
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
    if (existing.encrypted && !incoming.encrypted) {
      merged.encrypted = true;
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
    const encryptedToggle = el('matrix-chat-create-encrypted');
    if (user) user.textContent = state.status?.user_id || 'Not configured';
    if (home) home.textContent = state.status?.homeserver_url || 'Matrix';
    if (features) {
      const e2ee = state.status?.features?.e2ee ? 'server E2EE on' : 'server E2EE off';
      const encrypted = activeRoom()?.encrypted ? 'room encrypted' : 'room unencrypted';
      const hermesPatch = state.status?.hermes_matrix_patch;
      const patch = hermesPatch?.available
        ? (hermesPatch.ok ? 'Hermes guard ok' : 'Hermes guard warning')
        : 'Hermes guard pending';
      features.textContent = `${e2ee} - ${encrypted} - ${patch}`;
    }
    if (encryptedToggle) {
      encryptedToggle.disabled = !state.status?.features?.e2ee;
      encryptedToggle.title = encryptedToggle.disabled
        ? 'Server-side Matrix E2EE is not available'
        : 'Create this room with Matrix end-to-end encryption';
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
        btn.classList.toggle('is-encrypted', Boolean(room.encrypted));
        btn.classList.toggle('is-unencrypted', !room.encrypted);
        btn.dataset.roomId = room.room_id;
        btn.title = room.room_id;

        const name = document.createElement('span');
        name.className = 'matrix-chat-room-name';
        name.textContent = `${room.encrypted ? '[E2EE] ' : ''}${roomTitle(room)}`;
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

  function historyState(roomId) {
    if (!roomId) return {};
    if (!state.historyByRoom.has(roomId)) {
      state.historyByRoom.set(roomId, { end: '', exhausted: false, loading: false });
    }
    return state.historyByRoom.get(roomId);
  }

  function setHistoryState(roomId, patch) {
    if (!roomId) return;
    state.historyByRoom.set(roomId, { ...historyState(roomId), ...patch });
  }

  function renderMessages(options = {}) {
    const { scrollToBottom = true } = options;
    const timeline = el('matrix-chat-timeline');
    const title = el('matrix-chat-room-title');
    const roomId = el('matrix-chat-room-id');
    const mobileTitle = el('matrix-chat-mobile-room-title');
    const mobileRoomId = el('matrix-chat-mobile-room-id');
    const active = activeRoom();
    const titleText = active ? roomTitle(active) : 'No room selected';
    const roomIdText = active?.room_id || '';
    if (title) title.textContent = titleText;
    if (mobileTitle) mobileTitle.textContent = titleText;
    if (roomId) roomId.textContent = roomIdText;
    if (mobileRoomId) mobileRoomId.textContent = roomIdText;
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
    const history = historyState(active.room_id);
    if (history.end && !history.exhausted) {
      const older = document.createElement('button');
      older.id = 'matrix-chat-load-older';
      older.type = 'button';
      older.className = 'matrix-chat-load-older';
      older.textContent = history.loading ? 'Loading older...' : 'Load older';
      older.disabled = Boolean(history.loading);
      older.addEventListener('click', loadOlderMessages);
      timeline.appendChild(older);
    } else if (history.exhausted && messages.length) {
      const marker = document.createElement('div');
      marker.className = 'matrix-chat-history-marker';
      marker.textContent = 'Start of available history';
      timeline.appendChild(marker);
    }
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
      body.appendChild(renderMarkdownBody(message.body || ''));
      item.append(meta, body);
      timeline.appendChild(item);
    });
    if (scrollToBottom) timeline.scrollTop = timeline.scrollHeight;
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
    state.messagesByRoom.set(roomId, merged.slice(-MATRIX_CHAT_MAX_MESSAGES_PER_ROOM));
  }

  function prependMessages(roomId, messages) {
    if (!roomId || !Array.isArray(messages) || !messages.length) return;
    const existing = state.messagesByRoom.get(roomId) || [];
    const seen = new Set(existing.map(message => message.event_id).filter(Boolean));
    const fresh = [];
    messages.forEach(message => {
      if (!message) return;
      if (message.event_id && seen.has(message.event_id)) return;
      if (message.event_id) seen.add(message.event_id);
      fresh.push(message);
    });
    const merged = fresh.concat(existing);
    merged.sort((a, b) => (a.origin_server_ts || 0) - (b.origin_server_ts || 0));
    state.messagesByRoom.set(roomId, merged.slice(0, MATRIX_CHAT_MAX_MESSAGES_PER_ROOM));
  }

  async function loadStatus() {
    state.status = await apiJson('/api/v1/matrix-chat/status');
    if (!state.status.configured) {
      setStatus('Matrix chat credentials are not configured on the Blueprints server.', 'warn');
    } else if (!state.status.reachable) {
      setStatus('Matrix homeserver is not reachable from Blueprints.', 'warn');
    } else if (state.status.hermes_matrix_patch?.available && !state.status.hermes_matrix_patch.ok) {
      const failed = state.status.hermes_matrix_patch.failed_checks || [];
      const detail = failed.slice(0, 3).map(item => item.id).filter(Boolean).join(', ');
      setStatus(`Hermes Matrix platform guard failed${detail ? `: ${detail}` : ''}.`, 'warn');
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
    const data = await apiJson(`/api/v1/matrix-chat/rooms/${encodeURIComponent(roomId)}/messages?limit=${MATRIX_CHAT_INITIAL_MESSAGE_LIMIT}`);
    state.messagesByRoom.set(roomId, Array.isArray(data.messages) ? data.messages : []);
    setHistoryState(roomId, {
      end: data.end || '',
      exhausted: !data.end || !Array.isArray(data.messages) || data.messages.length === 0,
      loading: false,
    });
    renderMessages();
  }

  async function loadOlderMessages() {
    const roomId = state.activeRoomId;
    const timeline = el('matrix-chat-timeline');
    const history = historyState(roomId);
    if (!roomId || !history.end || history.exhausted || history.loading) return;
    const priorHeight = timeline?.scrollHeight || 0;
    const priorTop = timeline?.scrollTop || 0;
    setHistoryState(roomId, { loading: true });
    renderMessages({ scrollToBottom: false });
    try {
      const data = await apiJson(
        `/api/v1/matrix-chat/rooms/${encodeURIComponent(roomId)}/messages?limit=${MATRIX_CHAT_OLDER_MESSAGE_LIMIT}&from=${encodeURIComponent(history.end)}`
      );
      const messages = Array.isArray(data.messages) ? data.messages : [];
      prependMessages(roomId, messages);
      setHistoryState(roomId, {
        end: data.end || '',
        exhausted: !data.end || messages.length === 0,
        loading: false,
      });
      renderMessages({ scrollToBottom: false });
      if (timeline) {
        const delta = timeline.scrollHeight - priorHeight;
        timeline.scrollTop = Math.max(0, priorTop + delta);
      }
    } catch (error) {
      setHistoryState(roomId, { loading: false });
      renderMessages({ scrollToBottom: false });
      setStatus(`Load older failed: ${error.message}`, 'error');
    }
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
    hideInviteSuggestions();
    closeRailOnMobile();
    renderRooms();
    renderMessages();
    await loadMessages(roomId);
  }

  async function createRoom() {
    const input = el('matrix-chat-create-name');
    const encrypted = Boolean(el('matrix-chat-create-encrypted')?.checked);
    const name = (input?.value || '').trim();
    if (!name) return;
    try {
      const data = await apiJson('/api/v1/matrix-chat/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, encrypted }),
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
      if (input) input.value = '';
      hideInviteSuggestions();
      await loadRooms();
    } catch (error) {
      setStatus(`Invite failed: ${error.message}`, 'error');
    }
  }

  function hideInviteSuggestions() {
    const node = el('matrix-chat-invite-suggestions');
    state.inviteCandidates = [];
    state.inviteCandidateIndex = -1;
    if (!node) return;
    node.innerHTML = '';
    node.hidden = true;
  }

  function inviteCandidateLabel(user) {
    return user?.display_name || user?.user_id || 'Matrix user';
  }

  function selectInviteCandidate(user) {
    const input = el('matrix-chat-invite-user');
    if (!input || !user?.user_id) return;
    input.value = user.user_id;
    hideInviteSuggestions();
    input.focus();
  }

  function updateInviteSuggestionActive() {
    const node = el('matrix-chat-invite-suggestions');
    if (!node) return;
    Array.from(node.querySelectorAll('.matrix-chat-invite-option')).forEach((btn, index) => {
      const active = index === state.inviteCandidateIndex;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) btn.scrollIntoView({ block: 'nearest' });
    });
  }

  function renderInviteSuggestions(users, emptyText = '') {
    const node = el('matrix-chat-invite-suggestions');
    if (!node) return;
    state.inviteCandidates = Array.isArray(users) ? users : [];
    state.inviteCandidateIndex = state.inviteCandidates.length ? 0 : -1;
    node.innerHTML = '';

    if (!state.inviteCandidates.length) {
      if (!emptyText) {
        hideInviteSuggestions();
        return;
      }
      const empty = document.createElement('div');
      empty.className = 'matrix-chat-invite-empty';
      empty.textContent = emptyText;
      node.appendChild(empty);
      node.hidden = false;
      return;
    }

    state.inviteCandidates.forEach((user, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'matrix-chat-invite-option';
      btn.classList.toggle('active', index === state.inviteCandidateIndex);
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', index === state.inviteCandidateIndex ? 'true' : 'false');
      const label = document.createElement('strong');
      label.textContent = inviteCandidateLabel(user);
      const id = document.createElement('span');
      id.textContent = user.user_id || '';
      btn.append(label, id);
      btn.addEventListener('mouseenter', () => {
        state.inviteCandidateIndex = index;
        updateInviteSuggestionActive();
      });
      btn.addEventListener('click', () => selectInviteCandidate(user));
      node.appendChild(btn);
    });
    node.hidden = false;
  }

  async function loadInviteCandidates() {
    const input = el('matrix-chat-invite-user');
    const query = (input?.value || '').trim();
    if (!state.activeRoomId || !query.includes('@')) {
      hideInviteSuggestions();
      return;
    }
    try {
      const data = await apiJson(
        `/api/v1/matrix-chat/rooms/${encodeURIComponent(state.activeRoomId)}/invite-candidates?q=${encodeURIComponent(query)}`
      );
      const users = Array.isArray(data.users) ? data.users : [];
      renderInviteSuggestions(users, users.length ? '' : 'No available users');
    } catch (_) {
      renderInviteSuggestions([], 'Unable to load users');
    }
  }

  function scheduleInviteCandidates() {
    window.clearTimeout(state.inviteCandidateTimer);
    state.inviteCandidateTimer = window.setTimeout(loadInviteCandidates, 180);
  }

  function handleInviteKeydown(event) {
    const node = el('matrix-chat-invite-suggestions');
    const open = node && !node.hidden && state.inviteCandidates.length;
    if (!open) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      state.inviteCandidateIndex = Math.min(
        state.inviteCandidates.length - 1,
        state.inviteCandidateIndex + 1
      );
      updateInviteSuggestionActive();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      state.inviteCandidateIndex = Math.max(0, state.inviteCandidateIndex - 1);
      updateInviteSuggestionActive();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      selectInviteCandidate(state.inviteCandidates[state.inviteCandidateIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      hideInviteSuggestions();
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
    composer.value = `${MATRIX_CHAT_HERMES_PREFIX}${value.trimStart()}`;
    const cursor = MATRIX_CHAT_HERMES_PREFIX.length;
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
    const toggles = [el('matrix-chat-mobile-rail-toggle')].filter(Boolean);
    if (!shell) return;
    shell.classList.toggle('rail-open', Boolean(open));
    shell.classList.toggle('rail-collapsed', !open);
    toggles.forEach(toggle => {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? 'Close' : 'Rooms';
    });
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
    const toggleRail = event => {
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
    el('matrix-chat-mobile-rail-toggle')?.addEventListener('click', toggleRail);
    el('matrix-chat-create')?.addEventListener('click', createRoom);
    el('matrix-chat-join')?.addEventListener('click', () => joinRoom());
    el('matrix-chat-invite')?.addEventListener('click', inviteUser);
    el('matrix-chat-invite-user')?.addEventListener('input', scheduleInviteCandidates);
    el('matrix-chat-invite-user')?.addEventListener('focus', scheduleInviteCandidates);
    el('matrix-chat-invite-user')?.addEventListener('keydown', handleInviteKeydown);
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
