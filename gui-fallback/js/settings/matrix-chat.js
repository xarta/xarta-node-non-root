/* Matrix Chat - Blueprints-native narrow Synapse client */

'use strict';

const MATRIX_CHAT_SERVER_STORAGE_KEY = 'blueprintsMatrixChatServer';
const MATRIX_CHAT_STORAGE_KEY = 'blueprintsMatrixChatActiveRoom';
const MATRIX_CHAT_COMPOSER_HEIGHT_STORAGE_KEY = 'blueprintsMatrixChatComposerHeight';
const MATRIX_CHAT_INITIAL_MESSAGE_LIMIT = 60;
const MATRIX_CHAT_OLDER_MESSAGE_LIMIT = 60;
const MATRIX_CHAT_MAX_MESSAGES_PER_ROOM = 600;
const MATRIX_CHAT_DEFAULT_SERVER = 'tb1';
const MATRIX_CHAT_ROOM_TAB_DOUBLE_CLICK_MS = 240;
const MATRIX_CHAT_SYNC_TIMEOUT_MS = 25000;
const MATRIX_CHAT_SYNC_RETRY_MS = 1500;
const MATRIX_CHAT_SYNC_FALLBACK_MS = 30000;
const MATRIX_CHAT_LEVEL_RANK = Object.freeze({ debug: 0, information: 1, warning: 2, error: 3 });
const MATRIX_CHAT_STT_TRANSCRIPT_MARKER = '[voice/STT transcript, may contain recognition errors] ';

const MatrixChat = (() => {
  const state = {
    bound: false,
    loading: false,
    serverId: savedServerId(),
    status: null,
    joined: [],
    invites: [],
    activeRoomId: '',
    nextBatch: '',
    pollTimer: null,
    pollInFlight: false,
    pollGeneration: 0,
    lastBackendSyncAt: 0,
    messagesByRoom: new Map(),
    redactedEventIdsByRoom: new Map(),
    historyByRoom: new Map(),
    inviteCandidates: [],
    inviteCandidateIndex: -1,
    inviteCandidateTimer: null,
    hermesCommands: [],
    hermesCommandsLoaded: false,
    hermesCommandsRoomId: '',
    composerSuggestions: [],
    composerSuggestionIndex: -1,
    composerSuggestionMode: '',
    composerToken: null,
    composerSuggestionTimer: null,
    messageFilter: '',
    roomAdminRoomId: '',
    roomAdminSettings: null,
    roomAdminMembers: [],
    roomAdminSaving: false,
    roomAdminDeleting: false,
    roomAdminTesting: false,
    messageDeleteButtonsVisible: false,
    roomTabClickTimer: null,
    notifierDndConfig: null,
    notifierDndSaving: false,
    notifierTestEvents: new Map(),
    audioSending: false,
    audioStarting: false,
    audioRecording: false,
    audioFinalizing: false,
    audioWs: null,
    audioContext: null,
    audioSourceNode: null,
    audioProcessorNode: null,
    audioStream: null,
    audioChunks: [],
    audioBytesSent: 0,
    audioFramesSent: 0,
    audioStartedAt: 0,
    audioStopAfterStart: false,
    audioDraftActive: false,
    audioDraftPrefix: '',
    audioDraftValue: '',
  };

  const RoomTabInteractionMachine = (() => {
    const transitions = {
      IDLE: {
        tap: ['ROOM_SELECTED', ['selectRoom']],
        doubleTap: ['ADMIN_OPEN', ['selectRoom', 'openAdmin']],
        longPress: ['ADMIN_OPEN', ['selectRoom', 'openAdmin']],
      },
      ROOM_SELECTED: {
        tap: ['ROOM_SELECTED', ['selectRoom']],
        doubleTap: ['ADMIN_OPEN', ['openAdmin']],
        longPress: ['ADMIN_OPEN', ['openAdmin']],
      },
      ADMIN_OPEN: {
        tap: ['ADMIN_OPEN', []],
        doubleTap: ['ADMIN_OPEN', []],
        longPress: ['ADMIN_OPEN', []],
      },
    };
    let machineState = 'IDLE';
    let handlers = {};

    function syncState() {
      const modal = el('matrix-chat-room-admin-modal');
      if (modal?.open) machineState = 'ADMIN_OPEN';
      else if (state.activeRoomId) machineState = 'ROOM_SELECTED';
      else machineState = 'IDLE';
    }

    function execute(action, roomId) {
      if (action === 'selectRoom') handlers.onSelectRoom?.(roomId);
      if (action === 'openAdmin') handlers.onOpenAdmin?.(roomId);
    }

    return {
      configure(nextHandlers = {}) {
        handlers = nextHandlers;
      },
      dispatch(input, roomId) {
        syncState();
        const transition = transitions[machineState]?.[input];
        if (!transition) return;
        const [nextState, actions] = transition;
        machineState = nextState;
        actions.forEach(action => execute(action, roomId));
      },
      getState() {
        syncState();
        return machineState;
      },
    };
  })();

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

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  async function apiJson(url, options = {}) {
    const response = await apiFetch(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function savedServerId() {
    try {
      const stored = localStorage.getItem(MATRIX_CHAT_SERVER_STORAGE_KEY);
      if (stored === 'tb1' || stored === 'vps') return stored;
    } catch (_) {}
    return MATRIX_CHAT_DEFAULT_SERVER;
  }

  function activeRoomStorageKey() {
    return `${MATRIX_CHAT_STORAGE_KEY}:${state.serverId}`;
  }

  function matrixApi(path) {
    const url = new URL(`/api/v1/matrix-chat${path}`, window.location.origin);
    url.searchParams.set('server', state.serverId);
    return `${url.pathname}${url.search}`;
  }

  function guessAudioMime(file) {
    const explicit = (file?.type || '').trim();
    if (explicit) return explicit;
    const name = (file?.name || '').toLowerCase();
    if (name.endsWith('.mp3')) return 'audio/mpeg';
    if (name.endsWith('.wav')) return 'audio/wav';
    if (name.endsWith('.m4a')) return 'audio/mp4';
    if (name.endsWith('.aac')) return 'audio/aac';
    if (name.endsWith('.ogg') || name.endsWith('.oga')) return 'audio/ogg';
    if (name.endsWith('.webm')) return 'audio/webm';
    if (name.endsWith('.flac')) return 'audio/flac';
    return 'application/octet-stream';
  }

  function preferredRecordingMime() {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/mp4',
    ];
    return candidates.find(type => {
      try {
        return MediaRecorder.isTypeSupported(type);
      } catch (_) {
        return false;
      }
    }) || '';
  }

  function extensionForAudioMime(mimetype) {
    const clean = String(mimetype || '').split(';', 1)[0].toLowerCase();
    if (clean === 'audio/mpeg') return 'mp3';
    if (clean === 'audio/wav' || clean === 'audio/wave' || clean === 'audio/x-wav') return 'wav';
    if (clean === 'audio/mp4') return 'm4a';
    if (clean === 'audio/aac') return 'aac';
    if (clean === 'audio/ogg') return 'ogg';
    if (clean === 'audio/flac') return 'flac';
    return 'webm';
  }

  function hermesPrefix() {
    return state.serverId === 'vps' ? 'hermes-vps: ' : 'hermes: ';
  }

  function hermesAliasPattern() {
    return state.serverId === 'vps'
      ? /^\s*(?:hermes-vps|vps|hv)\s*:/i
      : /^\s*(?:hermes|h)\s*:/i;
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

  function activeRoomNeedsHermesPrefix() {
    const title = roomTitle(activeRoom()).trim().toLowerCase();
    if (state.serverId === 'vps') return title === 'shared bridge';
    return title === 'bridge';
  }

  function hasExplicitMatrixMention(value) {
    return /(^|[^\w/])@[0-9A-Za-z._=/-]+:[0-9A-Za-z.-]+(?::\d+)?/.test(value || '');
  }

  function outgoingComposerBody(raw) {
    const body = (raw || '').trim();
    if (!body || !activeRoomNeedsHermesPrefix()) return body;
    if (hermesAliasPattern().test(body) || hasExplicitMatrixMention(body)) return body;
    return `${hermesPrefix()}${body}`;
  }

  function rememberActiveRoom(roomId) {
    state.activeRoomId = roomId || '';
    try {
      if (state.activeRoomId) localStorage.setItem(activeRoomStorageKey(), state.activeRoomId);
    } catch (_) {}
  }

  function preferredRoomId() {
    try {
      const saved = localStorage.getItem(activeRoomStorageKey()) || '';
      if (saved && state.joined.some(room => room.room_id === saved)) return saved;
    } catch (_) {}
    const defaultId = state.status?.default_room_id || '';
    if (defaultId && state.joined.some(room => room.room_id === defaultId)) return defaultId;
    const smoke = state.joined.find(room => /hermes local smoke|shared bridge/i.test(room.name || ''));
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
    const label = state.status?.server_label || state.serverId.toUpperCase();
    document.querySelectorAll('[data-matrix-chat-server]').forEach(btn => {
      const active = btn.dataset.matrixChatServer === state.serverId;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (user) user.textContent = `${label}: ${state.status?.user_id || 'Not configured'}`;
    if (home) home.textContent = state.status?.homeserver_url || 'Matrix';
    if (features) {
      const e2ee = state.status?.features?.e2ee ? 'server E2EE on' : 'server E2EE off';
      const room = activeRoom();
      const encrypted = room?.encrypted ? 'room encrypted' : 'room unencrypted';
      const hermesCatalog = room?.hermes_command_catalog ? 'Hermes / on' : 'Hermes / off';
      const hermesPatch = state.status?.hermes_matrix_patch;
      const patch = hermesPatch?.available
        ? (hermesPatch.ok ? 'Hermes guard ok' : 'Hermes guard warning')
        : 'Hermes guard pending';
      features.textContent = `${e2ee} - ${encrypted} - ${hermesCatalog} - ${patch}`;
    }
    if (encryptedToggle) {
      encryptedToggle.disabled = !state.status?.features?.e2ee;
      if (state.serverId === 'vps' && state.status?.features?.e2ee) encryptedToggle.checked = true;
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
        btn.classList.toggle('has-hermes-catalog', Boolean(room.hermes_command_catalog));
        btn.dataset.roomId = room.room_id;
        btn.title = room.room_id;

        const name = document.createElement('span');
        name.className = 'matrix-chat-room-name';
        name.textContent = `${room.encrypted ? '[E2EE] ' : ''}${roomTitle(room)}`;
        const meta = document.createElement('span');
        meta.className = 'matrix-chat-room-meta';
        meta.textContent = [room.hermes_command_catalog ? 'Hermes /' : '', room.last_preview || room.room_id]
          .filter(Boolean)
          .join(' ');
        btn.append(name, meta);
        btn.addEventListener('click', event => handleRoomTabClick(event, room.room_id));
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

  function messageMatchesFilter(message, query) {
    const needle = (query || '').trim().toLowerCase();
    if (!needle) return true;
    return [
      message?.body,
      message?.sender,
      message?.event_id,
    ].some(value => String(value || '').toLowerCase().includes(needle));
  }

  function filteredMessages(messages) {
    const query = (state.messageFilter || '').trim();
    const room = activeRoom();
    const hideSystem = Boolean(room?.hide_system_messages);
    const minSystemLevel = room?.system_message_min_level || 'information';
    return messages.filter(message => {
      const system = message?.system_message;
      if (system) {
        if (hideSystem) return false;
        const level = String(system.level || 'information').toLowerCase();
        if ((MATRIX_CHAT_LEVEL_RANK[level] ?? 1) < (MATRIX_CHAT_LEVEL_RANK[minSystemLevel] ?? 1)) {
          return false;
        }
      }
      return query ? messageMatchesFilter(message, query) : true;
    });
  }

  function compactCount(value) {
    if (!Number.isFinite(value) || value < 0) return '0';
    if (value >= 1000) return `${Math.floor(value / 100) / 10}k`;
    return String(value);
  }

  function renderMobileControls(active, allMessages, history) {
    const count = el('matrix-chat-mobile-known-count');
    const older = el('matrix-chat-mobile-load-older');
    const filter = el('matrix-chat-mobile-filter');
    const filterAction = el('matrix-chat-mobile-filter-action');
    const knownCount = active ? allMessages.length : 0;
    const query = (state.messageFilter || '').trim();
    const matchingCount = query ? filteredMessages(allMessages).length : knownCount;
    if (count) {
      count.textContent = compactCount(knownCount);
      count.title = query
        ? `${matchingCount} of ${knownCount} known loaded messages match the filter`
        : `${knownCount} known loaded messages in this room`;
    }
    if (older) {
      const canLoadOlder = Boolean(active && history?.end && !history.exhausted);
      older.hidden = !canLoadOlder;
      older.disabled = Boolean(history?.loading);
      older.textContent = history?.loading ? 'Older...' : 'Older';
    }
    if (filter) {
      filter.disabled = !active;
      if (document.activeElement !== filter) filter.value = state.messageFilter || '';
    }
    if (filterAction) {
      filterAction.disabled = !active;
      filterAction.title = query ? 'Clear message filter' : 'Filter loaded messages';
      filterAction.setAttribute('aria-label', filterAction.title);
    }
  }

  function applyMessageFilter(value, options = {}) {
    state.messageFilter = value || '';
    renderMessages({
      scrollToBottom: false,
      focusTimelineFilter: Boolean(options.focusTimelineFilter),
    });
  }

  function createTimelineControls(active, allMessages, history) {
    const query = (state.messageFilter || '').trim();
    const knownCount = active ? allMessages.length : 0;
    const matchingCount = query ? filteredMessages(allMessages).length : knownCount;
    const canLoadOlder = Boolean(active && history?.end && !history.exhausted);

    const controls = document.createElement('div');
    controls.className = 'matrix-chat-history-controls';

    const count = document.createElement('span');
    count.className = 'matrix-chat-history-count';
    count.textContent = compactCount(knownCount);
    count.title = query
      ? `${matchingCount} of ${knownCount} known loaded messages match the filter`
      : `${knownCount} known loaded messages in this room`;

    const older = document.createElement('button');
    older.type = 'button';
    older.className = 'matrix-chat-history-load';
    older.textContent = history?.loading ? 'Loading older...' : 'Load older';
    older.disabled = Boolean(history?.loading);
    older.hidden = !canLoadOlder;
    older.addEventListener('click', loadOlderMessages);

    const filterWrap = document.createElement('div');
    filterWrap.className = 'matrix-chat-history-filter-wrap';

    const filter = document.createElement('input');
    filter.type = 'search';
    filter.className = 'matrix-chat-history-filter';
    filter.placeholder = 'Filter';
    filter.autocomplete = 'off';
    filter.spellcheck = false;
    filter.title = 'Filter loaded Matrix messages';
    filter.value = state.messageFilter || '';
    filter.disabled = !active;
    filter.dataset.matrixChatHistoryFilter = '1';
    filter.addEventListener('input', event => {
      applyMessageFilter(event.target?.value || '', { focusTimelineFilter: true });
    });

    const filterAction = document.createElement('button');
    filterAction.type = 'button';
    filterAction.className = 'matrix-chat-history-filter-action';
    filterAction.title = query ? 'Clear message filter' : 'Filter loaded messages';
    filterAction.setAttribute('aria-label', filterAction.title);
    filterAction.disabled = !active;
    filterAction.addEventListener('click', () => {
      if (state.messageFilter) {
        applyMessageFilter('', { focusTimelineFilter: true });
      } else {
        filter.focus();
      }
    });

    filterWrap.append(filter, filterAction);
    controls.append(count, older, filterWrap);
    return controls;
  }

  function focusTimelineFilterInput(timeline) {
    const filter = timeline?.querySelector?.('[data-matrix-chat-history-filter="1"]');
    if (!filter) return;
    filter.focus();
    const end = filter.value.length;
    try {
      filter.setSelectionRange(end, end);
    } catch (_) {}
  }

  function redactedEventIds(roomId) {
    if (!roomId) return new Set();
    let ids = state.redactedEventIdsByRoom.get(roomId);
    if (!ids) {
      ids = new Set();
      state.redactedEventIdsByRoom.set(roomId, ids);
    }
    return ids;
  }

  function rememberRedactedEventIds(roomId, eventIds) {
    const ids = new Set((eventIds || []).filter(Boolean));
    if (!roomId || !ids.size) return;
    const redacted = redactedEventIds(roomId);
    ids.forEach(eventId => redacted.add(eventId));
  }

  function removeMessagesByEventId(roomId, eventIds) {
    const ids = new Set((eventIds || []).filter(Boolean));
    if (!roomId || !ids.size) return;
    rememberRedactedEventIds(roomId, Array.from(ids));
    const existing = state.messagesByRoom.get(roomId) || [];
    state.messagesByRoom.set(roomId, existing.filter(message => !ids.has(message.event_id)));
  }

  async function redactMessages(roomId, payload) {
    return apiJson(matrixApi(`/rooms/${encodeURIComponent(roomId)}/redactions`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async function deleteMessage(message, button = null) {
    const roomId = state.activeRoomId;
    const eventId = message?.event_id || '';
    if (!roomId || !eventId) return;
    if (button) button.disabled = true;
    try {
      const result = await redactMessages(roomId, {
        mode: 'events',
        event_ids: [eventId],
        reason: 'Blueprints Matrix Chat quick delete',
      });
      const redactedIds = (result.redacted || []).map(item => item.event_id).filter(Boolean);
      removeMessagesByEventId(roomId, redactedIds.length ? redactedIds : [eventId]);
      renderMessages({ scrollToBottom: false });
      setStatus('Message deleted.', 'ok');
    } catch (error) {
      setStatus(`Delete failed: ${error.message}`, 'error');
      if (button) button.disabled = false;
    }
  }

  function renderMessages(options = {}) {
    const { scrollToBottom = true, focusTimelineFilter = false } = options;
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
    const allMessages = active ? (state.messagesByRoom.get(active.room_id) || []) : [];
    const history = active ? historyState(active.room_id) : {};
    renderMobileControls(active, allMessages, history);
    if (!timeline) return;
    timeline.innerHTML = '';

    if (!active) {
      const empty = document.createElement('div');
      empty.className = 'matrix-chat-empty matrix-chat-empty--center';
      empty.textContent = 'Join or create a Matrix room to start chatting.';
      timeline.appendChild(empty);
      return;
    }

    const messages = filteredMessages(allMessages);
    timeline.appendChild(createTimelineControls(active, allMessages, history));
    if (history.exhausted && allMessages.length) {
      const marker = document.createElement('div');
      marker.className = 'matrix-chat-history-marker';
      marker.textContent = 'Start of available history';
      timeline.appendChild(marker);
    }
    if (!messages.length) {
      const empty = document.createElement('div');
      empty.className = 'matrix-chat-empty matrix-chat-empty--center';
      empty.textContent = allMessages.length && state.messageFilter ? 'No loaded messages match.' : 'No recent messages.';
      timeline.appendChild(empty);
      if (focusTimelineFilter) focusTimelineFilterInput(timeline);
      return;
    }

    const ownUser = state.status?.user_id || '';
    messages.forEach(message => {
      const item = document.createElement('article');
      item.className = 'matrix-chat-message';
      if (message.sender === ownUser) item.classList.add('is-self');
      if (/hermes-(local|vps)/.test(message.sender || '')) item.classList.add('is-hermes');
      if (message.system_message) item.classList.add('is-system');

      const meta = document.createElement('div');
      meta.className = 'matrix-chat-message-meta';
      const sender = document.createElement('span');
      sender.textContent = message.sender || 'unknown';
      const ts = document.createElement('time');
      ts.textContent = fmtTime(message.origin_server_ts);
      meta.append(sender);
      if (message.system_message?.level) {
        const badge = document.createElement('span');
        badge.className = 'matrix-chat-message-level';
        badge.textContent = String(message.system_message.level).toUpperCase();
        meta.appendChild(badge);
      }
      meta.appendChild(ts);
      if (state.messageDeleteButtonsVisible && message.event_id) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'matrix-chat-message-delete';
        del.textContent = 'Delete';
        del.title = 'Delete this Matrix event immediately';
        del.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          void deleteMessage(message, del);
        });
        meta.appendChild(del);
      }

      const body = document.createElement('div');
      body.className = 'matrix-chat-message-body';
      body.appendChild(renderMarkdownBody(message.body || ''));
      item.append(meta, body);
      timeline.appendChild(item);
    });
    if (scrollToBottom) timeline.scrollTop = timeline.scrollHeight;
    if (focusTimelineFilter) focusTimelineFilterInput(timeline);
  }

  function mergeMessages(roomId, messages) {
    if (!roomId || !Array.isArray(messages) || !messages.length) return;
    const existing = state.messagesByRoom.get(roomId) || [];
    const redacted = redactedEventIds(roomId);
    const seen = new Set(existing.map(message => message.event_id).filter(Boolean));
    const merged = existing.slice();
    messages.forEach(message => {
      if (!message) return;
      if (message.event_id && redacted.has(message.event_id)) return;
      if (message.event_id && seen.has(message.event_id)) return;
      if (message.event_id) seen.add(message.event_id);
      merged.push(message);
    });
    merged.sort((a, b) => (a.origin_server_ts || 0) - (b.origin_server_ts || 0));
    state.messagesByRoom.set(roomId, merged.slice(-MATRIX_CHAT_MAX_MESSAGES_PER_ROOM));
  }

  function eventStreamState() {
    try {
      if (typeof BlueprintsEventStream !== 'undefined' && BlueprintsEventStream.getState) {
        return BlueprintsEventStream.getState();
      }
    } catch (_) {}
    return 'DISCONNECTED';
  }

  function eventStreamConnected() {
    return eventStreamState() === 'CONNECTED';
  }

  function applySyncPayload(data, options = {}) {
    if (!data || (data.server_id && data.server_id !== state.serverId)) return false;
    const snapshot = Boolean(data.snapshot || options.snapshot);
    let changed = false;
    state.nextBatch = data.next_batch || state.nextBatch;
    if (Array.isArray(data.joined) && (data.joined.length || snapshot)) {
      const byId = new Map((snapshot ? [] : state.joined).map(room => [room.room_id, room]));
      data.joined.forEach(room => byId.set(room.room_id, mergeRoomSummary(byId.get(room.room_id), room)));
      state.joined = Array.from(byId.values()).sort((a, b) => (b.last_event_ts || 0) - (a.last_event_ts || 0));
      chooseActiveRoom();
      changed = true;
    }
    if (Array.isArray(data.invites) && (data.invites.length || snapshot)) {
      state.invites = data.invites;
      changed = true;
    }
    if (Array.isArray(data.room_updates) && data.room_updates.length) {
      data.room_updates.forEach(update => {
        removeMessagesByEventId(update.room_id, update.redacted_event_ids || []);
        mergeMessages(update.room_id, update.messages);
      });
      changed = true;
    }
    if (changed) {
      renderRooms();
      renderMessages({ scrollToBottom: options.scrollToBottom !== false });
    }
    return changed;
  }

  function prependMessages(roomId, messages) {
    if (!roomId || !Array.isArray(messages) || !messages.length) return;
    const existing = state.messagesByRoom.get(roomId) || [];
    const redacted = redactedEventIds(roomId);
    const seen = new Set(existing.map(message => message.event_id).filter(Boolean));
    const fresh = [];
    messages.forEach(message => {
      if (!message) return;
      if (message.event_id && redacted.has(message.event_id)) return;
      if (message.event_id && seen.has(message.event_id)) return;
      if (message.event_id) seen.add(message.event_id);
      fresh.push(message);
    });
    const merged = fresh.concat(existing);
    merged.sort((a, b) => (a.origin_server_ts || 0) - (b.origin_server_ts || 0));
    state.messagesByRoom.set(roomId, merged.slice(0, MATRIX_CHAT_MAX_MESSAGES_PER_ROOM));
  }

  async function loadStatus() {
    state.status = await apiJson(matrixApi('/status'));
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
    const data = await apiJson(matrixApi('/rooms'));
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
    const data = await apiJson(matrixApi(`/rooms/${encodeURIComponent(roomId)}/messages?limit=${MATRIX_CHAT_INITIAL_MESSAGE_LIMIT}`));
    const redacted = redactedEventIds(roomId);
    const messages = Array.isArray(data.messages) ? data.messages : [];
    state.messagesByRoom.set(
      roomId,
      messages.filter(message => !message?.event_id || !redacted.has(message.event_id)),
    );
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
        matrixApi(`/rooms/${encodeURIComponent(roomId)}/messages?limit=${MATRIX_CHAT_OLDER_MESSAGE_LIMIT}&from=${encodeURIComponent(history.end)}`)
      );
      const messages = Array.isArray(data.messages) ? data.messages : [];
      prependMessages(roomId, messages);
      const exhausted = Boolean(data.at_start) || !data.end || messages.length === 0;
      setHistoryState(roomId, {
        end: data.end || '',
        exhausted,
        loading: false,
      });
      renderMessages({ scrollToBottom: false });
      if (timeline) {
        const delta = timeline.scrollHeight - priorHeight;
        timeline.scrollTop = Math.max(0, priorTop + delta);
      }
      if (exhausted && messages.length === 0) setStatus('No older messages in this room.', 'ok');
    } catch (error) {
      setHistoryState(roomId, { loading: false });
      renderMessages({ scrollToBottom: false });
      setStatus(`Load older failed: ${error.message}`, 'error');
    }
  }

  function canOpenRoomAdmin() {
    return Boolean(state.status?.features?.room_settings);
  }

  function roomAdminMemberKind(member) {
    const membership = String(member?.membership || '').toLowerCase();
    const power = Number(member?.power_level);
    if (membership && membership !== 'join') return membership;
    if (Number.isFinite(power) && power >= 100) return 'owner';
    if (Number.isFinite(power) && power >= 50) return 'admin';
    return 'member';
  }

  function memberDisplayName(member) {
    return member?.display_name || member?.user_id || 'Matrix user';
  }

  function renderRoomAdminMembers() {
    const list = el('matrix-chat-room-admin-members');
    if (!list) return;
    clearNode(list);
    if (!state.roomAdminMembers.length) {
      const empty = document.createElement('div');
      empty.className = 'matrix-chat-room-admin-empty';
      empty.textContent = 'No members loaded';
      list.appendChild(empty);
      return;
    }
    state.roomAdminMembers.forEach(member => {
      const kind = roomAdminMemberKind(member);
      const row = document.createElement('div');
      row.className = `matrix-chat-room-admin-member is-${kind}`;
      row.title = member.user_id || '';
      const name = document.createElement('span');
      name.className = 'matrix-chat-room-admin-member-name';
      name.textContent = memberDisplayName(member);
      const badge = document.createElement('span');
      badge.className = 'matrix-chat-room-admin-member-badge';
      badge.textContent = kind;
      row.append(name, badge);
      list.appendChild(row);
    });
  }

  function setRoomAdminStatus(message, tone = '') {
    const node = el('matrix-chat-room-admin-status');
    if (!node) return;
    node.textContent = message || '';
    node.dataset.tone = tone || '';
  }

  function applyRoomSettings(roomId, settings) {
    state.joined = state.joined.map(room => {
      if (room.room_id !== roomId) return room;
      return {
        ...room,
        hermes_command_catalog: Boolean(settings?.hermes_command_catalog),
        hide_system_messages: Boolean(settings?.hide_system_messages),
        system_message_min_level: settings?.system_message_min_level || 'information',
      };
    });
    if (state.hermesCommandsRoomId === roomId) {
      state.hermesCommands = [];
      state.hermesCommandsLoaded = false;
      state.hermesCommandsRoomId = '';
    }
    renderStatus();
    renderRooms();
    if (state.activeRoomId === roomId) {
      renderMessages({ scrollToBottom: false });
    }
  }

  function renderRoomAdminModal() {
    const room = state.joined.find(item => item.room_id === state.roomAdminRoomId) || null;
    const title = el('matrix-chat-room-admin-title');
    const roomId = el('matrix-chat-room-admin-room-id');
    const checkbox = el('matrix-chat-room-admin-hermes-catalogue');
    const hideSystem = el('matrix-chat-room-admin-hide-system');
    const systemLevel = el('matrix-chat-room-admin-system-level');
    const showDelete = el('matrix-chat-room-admin-show-delete');
    const deleteUndecryptable = el('matrix-chat-room-admin-delete-undecryptable');
    const deleteSystemBefore = el('matrix-chat-room-admin-delete-system-before');
    const systemBefore = el('matrix-chat-room-admin-system-before');
    const seedDecryptionTest = el('matrix-chat-room-admin-seed-decryption-test');
    const save = el('matrix-chat-room-admin-save');
    if (title) title.textContent = roomTitle(room);
    if (roomId) roomId.textContent = state.roomAdminRoomId || '';
    if (checkbox) {
      checkbox.checked = Boolean(state.roomAdminSettings?.hermes_command_catalog);
      checkbox.disabled = state.roomAdminSaving || !state.roomAdminSettings;
    }
    if (hideSystem) {
      hideSystem.checked = Boolean(state.roomAdminSettings?.hide_system_messages);
      hideSystem.disabled = state.roomAdminSaving || !state.roomAdminSettings;
    }
    if (systemLevel) {
      systemLevel.value = state.roomAdminSettings?.system_message_min_level || 'information';
      systemLevel.disabled = state.roomAdminSaving || !state.roomAdminSettings;
    }
    if (showDelete) {
      showDelete.checked = Boolean(state.messageDeleteButtonsVisible);
      showDelete.disabled = state.roomAdminDeleting;
    }
    if (deleteUndecryptable) deleteUndecryptable.disabled = state.roomAdminDeleting || !state.roomAdminRoomId;
    if (deleteSystemBefore) deleteSystemBefore.disabled = state.roomAdminDeleting || !state.roomAdminRoomId || !systemBefore?.value;
    if (seedDecryptionTest) seedDecryptionTest.disabled = state.roomAdminTesting || !state.roomAdminRoomId;
    if (save) save.disabled = state.roomAdminSaving || !state.roomAdminSettings;
    renderRoomAdminMembers();
  }

  async function openRoomAdmin(roomId = state.activeRoomId) {
    if (!roomId || !canOpenRoomAdmin()) {
      return;
    }
    const modal = el('matrix-chat-room-admin-modal');
    if (!modal) return;
    state.roomAdminRoomId = roomId;
    state.roomAdminSettings = null;
    state.roomAdminMembers = [];
    state.roomAdminDeleting = false;
    state.roomAdminTesting = false;
    state.messageDeleteButtonsVisible = false;
    state.roomAdminSaving = false;
    renderRoomAdminModal();
    setRoomAdminStatus('Loading room admin...', '');
    if (typeof HubModal !== 'undefined') HubModal.open(modal);
    else modal.showModal?.();

    try {
      const [settings, members] = await Promise.all([
        apiJson(matrixApi(`/rooms/${encodeURIComponent(roomId)}/settings`)),
        apiJson(matrixApi(`/admin/rooms/${encodeURIComponent(roomId)}/members`)).catch(error => ({
          members: [],
          error,
        })),
      ]);
      state.roomAdminSettings = settings;
      state.roomAdminMembers = Array.isArray(members.members) ? members.members : [];
      applyRoomSettings(roomId, settings);
      renderRoomAdminModal();
      setRoomAdminStatus(members.error ? `Members unavailable: ${members.error.message}` : '', members.error ? 'warn' : '');
    } catch (error) {
      setRoomAdminStatus(`Room admin failed: ${error.message}`, 'error');
      state.roomAdminSettings = null;
      renderRoomAdminModal();
    }
  }

  async function saveRoomAdminSettings() {
    const roomId = state.roomAdminRoomId;
    const checkbox = el('matrix-chat-room-admin-hermes-catalogue');
    const hideSystem = el('matrix-chat-room-admin-hide-system');
    const systemLevel = el('matrix-chat-room-admin-system-level');
    if (!roomId || !checkbox || state.roomAdminSaving) return;
    const nextSettings = {
      hermes_command_catalog: Boolean(checkbox.checked),
      hide_system_messages: Boolean(hideSystem?.checked),
      system_message_min_level: systemLevel?.value || 'information',
    };
    state.roomAdminSaving = true;
    renderRoomAdminModal();
    setRoomAdminStatus('Saving...', '');
    try {
      const settings = await apiJson(matrixApi(`/rooms/${encodeURIComponent(roomId)}/settings`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings),
      });
      state.roomAdminSettings = settings;
      applyRoomSettings(roomId, settings);
      setRoomAdminStatus('Saved', 'ok');
    } catch (error) {
      setRoomAdminStatus(`Save failed: ${error.message}`, 'error');
    } finally {
      state.roomAdminSaving = false;
      renderRoomAdminModal();
    }
  }

  async function bulkRedactRoomMessages(mode, options = {}) {
    const roomId = state.roomAdminRoomId || state.activeRoomId;
    if (!roomId || state.roomAdminDeleting) return;
    state.roomAdminDeleting = true;
    renderRoomAdminModal();
    setRoomAdminStatus('Deleting messages...', 'warn');
    try {
      const payload = {
        mode,
        reason: options.reason || 'Blueprints Matrix Chat bulk delete',
      };
      if (Array.isArray(options.eventIds)) {
        payload.event_ids = options.eventIds.filter(Boolean);
      } else {
        payload.limit = 20000;
        payload.scan_all = true;
      }
      if (Number.isFinite(options.beforeTs)) payload.before_ts = options.beforeTs;
      const result = await redactMessages(roomId, payload);
      const redactedIds = (result.redacted || []).map(item => item.event_id).filter(Boolean);
      removeMessagesByEventId(roomId, redactedIds);
      if (state.activeRoomId === roomId) {
        await loadMessages(roomId);
      }
      await loadRooms();
      renderMessages({ scrollToBottom: false });
      const failed = Array.isArray(result.errors) && result.errors.length
        ? ` (${result.errors.length} failed)`
        : '';
      const capped = result.scan_exhausted === false ? ' Scan limit reached; older history was not scanned.' : '';
      setRoomAdminStatus(`Deleted ${result.redacted_count || 0} message${(result.redacted_count || 0) === 1 ? '' : 's'}${failed}.${capped}`, result.errors?.length || capped ? 'warn' : 'ok');
    } catch (error) {
      setRoomAdminStatus(`Delete failed: ${error.message}`, 'error');
    } finally {
      state.roomAdminDeleting = false;
      renderRoomAdminModal();
    }
  }

  function deleteUndecryptableMessages() {
    const roomId = state.roomAdminRoomId || state.activeRoomId;
    const messages = state.messagesByRoom.get(roomId) || [];
    const eventIds = messages
      .filter(message => (
        message?.event_id
        && message.encrypted
        && !message.decrypted
        && /\[(unable to decrypt encrypted event|encrypted event)\]/i.test(message.body || '')
      ))
      .map(message => message.event_id);
    if (!eventIds.length) {
      setRoomAdminStatus('No loaded undecryptable messages to delete.', 'ok');
      return;
    }
    void bulkRedactRoomMessages('events', {
      eventIds,
      reason: 'Blueprints Matrix Chat delete loaded undecryptable events',
    });
  }

  function deleteSystemMessagesBefore() {
    const value = el('matrix-chat-room-admin-system-before')?.value || '';
    const timestamp = value ? new Date(value).getTime() : NaN;
    if (!Number.isFinite(timestamp)) {
      setRoomAdminStatus('Choose a valid date/time for old system-message deletion.', 'error');
      return;
    }
    void bulkRedactRoomMessages('system_before', {
      beforeTs: timestamp,
      reason: 'Blueprints Matrix Chat delete old system messages',
    });
  }

  function toggleMessageDeleteButtons() {
    state.messageDeleteButtonsVisible = Boolean(el('matrix-chat-room-admin-show-delete')?.checked);
    renderRoomAdminModal();
    renderMessages({ scrollToBottom: false });
  }

  async function seedDecryptionTestMessages() {
    const roomId = state.roomAdminRoomId || state.activeRoomId;
    if (!roomId || state.roomAdminTesting) return;
    state.roomAdminTesting = true;
    renderRoomAdminModal();
    setRoomAdminStatus('Seeding decryptable and undecryptable test messages...', 'warn');
    try {
      const result = await apiJson(matrixApi(`/rooms/${encodeURIComponent(roomId)}/test/decryption-mix`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decryptable_count: 2, undecryptable_count: 2 }),
      });
      if (state.activeRoomId === roomId) {
        await loadMessages(roomId);
      }
      await loadRooms();
      renderMessages({ scrollToBottom: true });
      const count = Array.isArray(result.events) ? result.events.length : 0;
      setRoomAdminStatus(`Seeded ${count} labelled test messages.`, 'ok');
    } catch (error) {
      setRoomAdminStatus(`Test seed failed: ${error.message}`, 'error');
    } finally {
      state.roomAdminTesting = false;
      renderRoomAdminModal();
    }
  }

  function setNotifierDndStatus(message, tone = '') {
    const node = el('matrix-chat-notifier-dnd-status');
    if (!node) return;
    node.textContent = message || '';
    node.dataset.tone = tone || '';
  }

  function renderNotifierSchedules() {
    const list = el('matrix-chat-notifier-schedules');
    if (!list) return;
    clearNode(list);
    const schedules = Array.isArray(state.notifierDndConfig?.schedules)
      ? state.notifierDndConfig.schedules
      : [];
    schedules.forEach((schedule, index) => {
      const row = document.createElement('div');
      row.className = 'matrix-chat-notifier-schedule';
      row.dataset.index = String(index);
      row.innerHTML = `
        <div class="matrix-chat-notifier-schedule-cell matrix-chat-notifier-schedule-toggle">
          <span class="matrix-chat-notifier-schedule-label">Schedule ${index + 1}</span>
          <label class="hub-checkbox matrix-chat-room-admin-toggle">
            <input class="hub-checkbox__input" type="checkbox" data-notifier-schedule-field="enabled" />
            <span class="hub-checkbox__box" aria-hidden="true"></span>
            <span class="hub-checkbox__label">Use schedule</span>
          </label>
        </div>
        <label class="matrix-chat-notifier-field">
          <span>Start</span>
          <input type="time" data-notifier-schedule-field="start" />
        </label>
        <label class="matrix-chat-notifier-field">
          <span>End</span>
          <input type="time" data-notifier-schedule-field="end" />
        </label>
      `;
      row.querySelector('[data-notifier-schedule-field="enabled"]').checked = Boolean(schedule.enabled);
      row.querySelector('[data-notifier-schedule-field="start"]').value = schedule.start || '22:00';
      row.querySelector('[data-notifier-schedule-field="end"]').value = schedule.end || '07:00';
      list.appendChild(row);
    });
  }

  function renderNotifierDndModal() {
    const cfg = state.notifierDndConfig || {};
    const mode = el('matrix-chat-notifier-mode');
    const timeout = el('matrix-chat-notifier-timeout');
    const normalVolume = el('matrix-chat-notifier-normal-volume');
    const quietVolume = el('matrix-chat-notifier-quiet-volume');
    const phoneAlwaysSpeaks = el('matrix-chat-notifier-phone-always-speaks');
    const desktopDedupe = el('matrix-chat-notifier-desktop-dedupe');
    const dangerSound = el('matrix-chat-notifier-danger-sound');
    const dangerVolume = el('matrix-chat-notifier-danger-volume');
    const dangerTest = el('matrix-chat-notifier-danger-test');
    const save = el('matrix-chat-notifier-dnd-save');
    if (mode) mode.value = cfg.mode || 'default';
    if (timeout) timeout.value = String(cfg.manual_timeout_minutes || 60);
    if (normalVolume) normalVolume.value = String(cfg.normal_volume ?? 0.85);
    if (quietVolume) quietVolume.value = String(cfg.quiet_volume ?? 0.35);
    if (phoneAlwaysSpeaks) phoneAlwaysSpeaks.checked = true;
    if (desktopDedupe) desktopDedupe.checked = cfg.listener_policy?.desktop_one_per_os_ip !== false;
    if (dangerSound) dangerSound.value = cfg.danger_policy?.alarm_sound_path || '';
    if (dangerVolume) dangerVolume.value = String(cfg.danger_policy?.danger_alarm_volume ?? 1);
    if (dangerTest) dangerTest.disabled = !cfg.danger_policy?.alarm_sound_path;
    if (save) save.disabled = state.notifierDndSaving || !state.notifierDndConfig;
    renderNotifierSchedules();
  }

  function setNotifierDangerSoundPath(assetPath) {
    if (!state.notifierDndConfig) state.notifierDndConfig = {};
    state.notifierDndConfig.danger_policy = {
      ...(state.notifierDndConfig.danger_policy || {}),
      alarm_sound_path: assetPath || null,
      alarm_sound_enabled: true,
    };
    renderNotifierDndModal();
  }

  function notifierDangerSoundUrl(path) {
    const value = String(path || '').trim();
    if (!value) return '';
    return `/fallback-ui/assets/${value}`;
  }

  function openNotifierDangerSoundPicker() {
    if (typeof AssetPicker === 'undefined') {
      setNotifierDndStatus('Sound picker unavailable.', 'error');
      return;
    }
    AssetPicker.open({
      title: 'Choose Danger2 alarm sound',
      kind: 'sound',
      browseUrl: '/api/v1/nav-items/assets?type=sounds',
      emptyMessage: 'No sound assets uploaded yet.',
      onSelect: async (assetPath) => {
        setNotifierDangerSoundPath(assetPath);
        setNotifierDndStatus('Danger2 sound selected. Save to keep it.', 'ok');
      },
    });
  }

  function testNotifierDangerSound(button) {
    const path = el('matrix-chat-notifier-danger-sound')?.value || '';
    const url = notifierDangerSoundUrl(path);
    if (!url || typeof SoundManager === 'undefined') return;
    const volume = Number(el('matrix-chat-notifier-danger-volume')?.value || 1);
    SoundManager.previewToggle(url, { button, volume });
  }

  async function showNotifierModeImpact(saved = false) {
    if (!state.notifierDndConfig || typeof BlueprintsNotifierDnd === 'undefined') return;
    const pendingConfig = collectNotifierDndConfig();
    const impact = BlueprintsNotifierDnd.describeModeImpact(state.notifierDndConfig, pendingConfig, { saved });
    setNotifierDndStatus(`Pending active speech mode: ${impact.after.label}`, 'ok');
    if (typeof HubDialogs !== 'undefined' && typeof HubDialogs.alert === 'function') {
      await HubDialogs.alert({
        title: saved ? 'Notification Mode Saved' : 'Notification Mode Preview',
        badge: 'DND',
        message: impact.message,
        detail: impact.detail,
        confirmText: 'OK',
        width: 'min(640px,95vw)',
      });
    }
  }

  async function openNotifierDndModal() {
    const modal = el('matrix-chat-notifier-dnd-modal');
    if (!modal) return;
    state.notifierDndConfig = null;
    state.notifierDndSaving = false;
    setNotifierDndStatus('Loading notification policy...', '');
    renderNotifierDndModal();
    if (typeof HubModal !== 'undefined') HubModal.open(modal);
    else modal.showModal?.();
    try {
      if (typeof BlueprintsNotifierDnd === 'undefined') throw new Error('policy client unavailable');
      state.notifierDndConfig = await BlueprintsNotifierDnd.loadConfig({ force: true });
      renderNotifierDndModal();
      const activeMode = BlueprintsNotifierDnd.activeMode(state.notifierDndConfig);
      setNotifierDndStatus(`Active speech mode: ${activeMode}`, 'ok');
    } catch (error) {
      setNotifierDndStatus(`Notification policy load failed: ${error.message}`, 'error');
    }
  }

  function openNotifierInfoModal() {
    const modal = el('matrix-chat-notifier-info-modal');
    if (!modal) return;
    if (typeof HubModal !== 'undefined') HubModal.open(modal);
    else modal.showModal?.();
  }

  function closeNotifierInfoModal() {
    const modal = el('matrix-chat-notifier-info-modal');
    if (!modal) return;
    if (typeof HubModal !== 'undefined') HubModal.close(modal);
    else modal.close?.();
  }

  function collectNotifierDndConfig() {
    const base = state.notifierDndConfig || {};
    const mode = el('matrix-chat-notifier-mode')?.value || 'default';
    const timeoutMinutes = Number(el('matrix-chat-notifier-timeout')?.value || 60);
    const manualMode = mode === 'manual_dnd_1' || mode === 'manual_dnd_2';
    const schedules = Array.from(document.querySelectorAll('.matrix-chat-notifier-schedule')).map(row => ({
      enabled: Boolean(row.querySelector('[data-notifier-schedule-field="enabled"]')?.checked),
      start: row.querySelector('[data-notifier-schedule-field="start"]')?.value || '22:00',
      end: row.querySelector('[data-notifier-schedule-field="end"]')?.value || '07:00',
      mode: Number(row.dataset.index || 0) === 1 ? 'scheduled_dnd_02' : 'scheduled_dnd_01',
    }));
    return {
      ...base,
      mode,
      manual_timeout_minutes: Math.max(5, Math.min(720, timeoutMinutes || 60)),
      manual_until: manualMode ? Date.now() / 1000 + Math.max(5, timeoutMinutes || 60) * 60 : null,
      normal_volume: Number(el('matrix-chat-notifier-normal-volume')?.value || 0.85),
      quiet_volume: Number(el('matrix-chat-notifier-quiet-volume')?.value || 0.35),
      schedules,
      listener_policy: {
        ...(base.listener_policy || {}),
        // Legacy key: true means phones always speak; phones do not suppress desktop/web.
        phone_wins: true,
        desktop_one_per_os_ip: Boolean(el('matrix-chat-notifier-desktop-dedupe')?.checked),
      },
      danger_policy: {
        ...(base.danger_policy || {}),
        alarm_sound_path: (el('matrix-chat-notifier-danger-sound')?.value || '').trim() || null,
        alarm_sound_enabled: true,
        danger_alarm_volume: Number(el('matrix-chat-notifier-danger-volume')?.value || 1),
      },
    };
  }

  async function saveNotifierDndConfig() {
    if (state.notifierDndSaving || typeof BlueprintsNotifierDnd === 'undefined') return;
    const nextConfig = collectNotifierDndConfig();
    const priorConfig = state.notifierDndConfig;
    state.notifierDndSaving = true;
    setNotifierDndStatus('Saving...', '');
    try {
      state.notifierDndConfig = await BlueprintsNotifierDnd.saveConfig(nextConfig);
      renderNotifierDndModal();
      setNotifierDndStatus(`Saved. Active speech mode: ${BlueprintsNotifierDnd.activeMode(state.notifierDndConfig)}`, 'ok');
      if ((priorConfig?.mode || 'default') !== (state.notifierDndConfig?.mode || 'default')) {
        const impact = BlueprintsNotifierDnd.describeModeImpact(priorConfig, state.notifierDndConfig, { saved: true });
        if (typeof HubDialogs !== 'undefined' && typeof HubDialogs.alert === 'function') {
          await HubDialogs.alert({
            title: 'Notification Mode Saved',
            badge: 'DND',
            message: impact.message,
            detail: impact.detail,
            confirmText: 'OK',
            width: 'min(640px,95vw)',
          });
        }
      }
    } catch (error) {
      setNotifierDndStatus(`Save failed: ${error.message}`, 'error');
    } finally {
      state.notifierDndSaving = false;
      renderNotifierDndModal();
    }
  }

  function setNotifierTestsStatus(message, tone = '') {
    const node = el('matrix-chat-notifier-tests-status');
    if (!node) return;
    node.textContent = message || '';
    node.dataset.tone = tone || '';
  }

  function appendNotifierTestLog(message, tone = '') {
    const log = el('matrix-chat-notifier-tests-log');
    if (!log) return;
    const row = document.createElement('div');
    row.dataset.tone = tone || '';
    row.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
    log.prepend(row);
    while (log.children.length > 20) log.removeChild(log.lastChild);
  }

  async function confirmDanger2Drill() {
    const message = 'Danger2 drill is intentionally noisy and loops alarm plus TTS until cancelled.';
    if (typeof HubDialogs !== 'undefined' && typeof HubDialogs.confirm === 'function') {
      return HubDialogs.confirm({
        title: 'Start Danger2 Drill?',
        badge: 'DANGER2',
        message,
        detail: 'This submits a real notifier event through system-bridge-notifier. Use Cancel Danger2 to stop every active listener.',
        confirmText: 'Start drill',
        cancelText: 'Cancel',
        tone: 'danger',
        width: 'min(560px,95vw)',
      });
    }
    return window.confirm(`${message}\n\nStart drill?`);
  }

  async function confirmNotifierFailureDrill() {
    const message = 'This temporarily stops the system-bridge-notifier Dockge stack, attempts a real notifier webhook, publishes the explicit failure-warning TTS fallback, then restarts the stack.';
    if (typeof HubDialogs !== 'undefined' && typeof HubDialogs.confirm === 'function') {
      return HubDialogs.confirm({
        title: 'Run Notifier Failure Drill?',
        badge: 'FAILURE',
        message,
        detail: 'This is intentionally noisy and briefly disrupts notifier delivery. Do not close the page until the restart status is shown.',
        confirmText: 'Stop notifier and test',
        cancelText: 'Cancel',
        tone: 'danger',
        width: 'min(620px,95vw)',
      });
    }
    return window.confirm(`${message}\n\nRun notifier failure drill?`);
  }

  async function submitNotifierTest(testId, button = null) {
    if (!testId) return;
    const confirmed = testId === 'danger2_drill' ? await confirmDanger2Drill() : false;
    if (testId === 'danger2_drill' && !confirmed) {
      setNotifierTestsStatus('Danger2 drill cancelled before submission.', 'warn');
      return;
    }
    if (button) button.disabled = true;
    setNotifierTestsStatus(`Submitting ${testId} to system-bridge-notifier...`, '');
    appendNotifierTestLog(`${testId}: submitting to notifier webhook`);
    try {
      const result = await apiJson('/api/v1/notifier-dnd/tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_id: testId, confirmed: Boolean(confirmed) }),
      });
      state.notifierTestEvents.set(result.event_id, { testId, submittedAt: Date.now() });
      setNotifierTestsStatus(`${testId}: submitted to notifier; waiting for drained Blueprints SSE event.`, 'ok');
      appendNotifierTestLog(`${testId}: submitted to notifier as ${result.event_id}`, 'ok');
      window.setTimeout(() => {
        const pending = state.notifierTestEvents.get(result.event_id);
        if (!pending) return;
        setNotifierTestsStatus(`${testId}: still waiting for drained event. Check notifier drain status if this persists.`, 'warn');
        appendNotifierTestLog(`${testId}: no drained SSE event observed yet`, 'warn');
      }, 15000);
    } catch (error) {
      setNotifierTestsStatus(`${testId}: notifier submission failed: ${error.message}`, 'error');
      appendNotifierTestLog(`${testId}: notifier submission failed: ${error.message}`, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function runNotifierFailureDrill(button = null) {
    const confirmed = await confirmNotifierFailureDrill();
    if (!confirmed) {
      setNotifierTestsStatus('Notifier failure drill cancelled before stopping the stack.', 'warn');
      return;
    }
    if (button) button.disabled = true;
    setNotifierTestsStatus('Stopping system-bridge-notifier Dockge stack for failure drill...', 'warn');
    appendNotifierTestLog('notifier_failure_warning: stopping system-bridge-notifier Dockge stack', 'warn');
    try {
      const result = await apiJson('/api/v1/notifier-dnd/tests/notifier-failure-drill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      });
      state.notifierTestEvents.set(result.event_id, {
        testId: result.test_id || 'notifier_failure_warning',
        submittedAt: Date.now(),
      });
      const restartText = result.restart_ok ? 'notifier restarted' : 'notifier restart reported a problem';
      setNotifierTestsStatus(`Notifier failure warning published; ${restartText}.`, result.restart_ok ? 'ok' : 'error');
      appendNotifierTestLog(`notifier_failure_warning: warning event ${result.event_id}; ${restartText}`, result.restart_ok ? 'ok' : 'error');
    } catch (error) {
      setNotifierTestsStatus(`Notifier failure drill failed: ${error.message}`, 'error');
      appendNotifierTestLog(`notifier_failure_warning: drill failed: ${error.message}`, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function cancelDanger2FromTests() {
    setNotifierTestsStatus('Recording Danger2 cancel state...', '');
    try {
      const result = typeof BlueprintsDanger2Alert !== 'undefined'
        ? await BlueprintsDanger2Alert.cancel('operator_tests_modal_cancel')
        : await apiJson('/api/v1/notifier-dnd/danger2-cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'operator_tests_modal_cancel', source: 'blueprints-tests-modal' }),
        });
      const suffix = result.notification_submitted === false
        ? ' Notifier cancellation notice failed.'
        : ' Cancellation notice submitted through notifier.';
      setNotifierTestsStatus(`Danger2 cancel recorded.${suffix}`, result.notification_submitted === false ? 'error' : 'ok');
      appendNotifierTestLog(`danger2 cancel recorded: ${result.cancel_id || 'ok'}`, 'ok');
    } catch (error) {
      setNotifierTestsStatus(`Danger2 cancel failed: ${error.message}`, 'error');
      appendNotifierTestLog(`danger2 cancel failed: ${error.message}`, 'error');
    }
  }

  function handleNotifierTestDrainedEvent(evt) {
    const eventId = evt?.event_id || evt?.payload?.notifier_event_id || '';
    const testId = evt?.payload?.test_id || '';
    if (!eventId && !testId) return;
    const pending = state.notifierTestEvents.get(eventId);
    if (!pending && !testId) return;
    if (pending) state.notifierTestEvents.delete(eventId);
    const label = testId || pending?.testId || 'notifier test';
    setNotifierTestsStatus(`${label}: drained event received from Blueprints SSE.`, 'ok');
    appendNotifierTestLog(`${label}: drained through Blueprints SSE`, 'ok');
  }

  function speechSuppressionLabel(reason) {
    const labels = {
      browser_tts_muted: 'browser TTS is muted',
      stale_notifier_replay: 'stale notifier replay was not spoken',
      dnd_policy_suppressed: 'DND policy suppressed speech',
      speech_claim_denied: 'another webpage on this device already spoke for this event',
      tts_client_unavailable: 'TTS client is unavailable',
      tts_speak_unavailable: 'TTS speak function is unavailable',
      tts_error: 'TTS playback failed',
    };
    return labels[reason] || reason || 'speech suppressed';
  }

  function handleNotifierSpeechSuppressed(detail) {
    const evt = detail?.event || {};
    const testId = evt?.payload?.test_id || '';
    if (!testId) return;
    const label = speechSuppressionLabel(detail.reason);
    setNotifierTestsStatus(`${testId}: ${label}.`, 'warn');
    appendNotifierTestLog(`${testId}: ${label}`, 'warn');
  }

  async function openNotifierTestsModal() {
    const modal = el('matrix-chat-notifier-tests-modal');
    if (!modal) return;
    let status = 'Ready. Live/noisy tests are marked on their buttons.';
    try {
      if (typeof BlueprintsNotifierDnd !== 'undefined') {
        const config = await BlueprintsNotifierDnd.loadConfig({ force: true });
        status = `${status} Active speech mode: ${BlueprintsNotifierDnd.activeMode(config)}.`;
      }
      if (typeof BlueprintsModelChangeAnnouncer !== 'undefined' && BlueprintsModelChangeAnnouncer.isMuted()) {
        status = `${status} Browser TTS is muted.`;
      }
    } catch (_) {}
    setNotifierTestsStatus(status, '');
    if (typeof HubModal !== 'undefined') HubModal.open(modal);
    else modal.showModal?.();
  }

  async function refreshAll() {
    if (state.loading) return;
    state.loading = true;
    state.pollGeneration += 1;
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
    const changed = roomId !== state.activeRoomId;
    rememberActiveRoom(roomId);
    if (changed) {
      state.hermesCommands = [];
      state.hermesCommandsLoaded = false;
      state.hermesCommandsRoomId = '';
      hideComposerSuggestions();
    }
    hideInviteSuggestions();
    closeRailOnMobile();
    renderRooms();
    renderMessages();
    await loadMessages(roomId);
  }

  function handleRoomTabClick(event, roomId) {
    event?.preventDefault?.();
    if (!roomId) return;
    if (event?.detail >= 2) {
      window.clearTimeout(state.roomTabClickTimer);
      state.roomTabClickTimer = null;
      RoomTabInteractionMachine.dispatch('doubleTap', roomId);
      return;
    }
    window.clearTimeout(state.roomTabClickTimer);
    state.roomTabClickTimer = window.setTimeout(() => {
      state.roomTabClickTimer = null;
      RoomTabInteractionMachine.dispatch('tap', roomId);
    }, MATRIX_CHAT_ROOM_TAB_DOUBLE_CLICK_MS);
  }

  async function createRoom() {
    const input = el('matrix-chat-create-name');
    const encrypted = Boolean(el('matrix-chat-create-encrypted')?.checked);
    const name = (input?.value || '').trim();
    if (!name) return;
    try {
      const data = await apiJson(matrixApi('/rooms'), {
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
      const data = await apiJson(matrixApi('/rooms/join'), {
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
      await apiJson(matrixApi(`/rooms/${encodeURIComponent(state.activeRoomId)}/invite`), {
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
        matrixApi(`/rooms/${encodeURIComponent(state.activeRoomId)}/invite-candidates?q=${encodeURIComponent(query)}`)
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

  function hideComposerSuggestions() {
    const node = el('matrix-chat-composer-suggestions');
    state.composerSuggestions = [];
    state.composerSuggestionIndex = -1;
    state.composerSuggestionMode = '';
    state.composerToken = null;
    if (!node) return;
    node.innerHTML = '';
    node.hidden = true;
  }

  function composerToken() {
    const composer = el('matrix-chat-composer');
    if (!composer || !state.activeRoomId) return null;
    const value = composer.value || '';
    const cursor = composer.selectionStart || 0;
    if (cursor !== (composer.selectionEnd || cursor)) return null;
    const before = value.slice(0, cursor);
    const match = /(^|\s)([@/][^\s]*)$/.exec(before);
    if (!match) return null;
    const token = match[2] || '';
    if (token.length > 80) return null;
    return {
      trigger: token[0],
      query: token.slice(1),
      start: before.length - token.length,
      end: cursor,
    };
  }

  function commandMatches(command, query) {
    const needle = String(query || '').trim().toLowerCase().replace(/^\//, '');
    if (!needle) return true;
    const aliases = Array.isArray(command.aliases) ? command.aliases.join(' ') : '';
    return [
      command.name,
      command.description,
      command.category,
      aliases,
    ].join(' ').toLowerCase().includes(needle);
  }

  async function ensureHermesCommands(roomId = state.activeRoomId) {
    if (!roomId || !activeRoom()?.hermes_command_catalog) return [];
    if (state.hermesCommandsLoaded && state.hermesCommandsRoomId === roomId) return state.hermesCommands;
    const data = await apiJson(matrixApi(`/hermes/commands?room_id=${encodeURIComponent(roomId)}`));
    state.hermesCommands = Array.isArray(data.commands) ? data.commands : [];
    state.hermesCommandsLoaded = true;
    state.hermesCommandsRoomId = roomId;
    return state.hermesCommands;
  }

  function updateComposerSuggestionActive() {
    const node = el('matrix-chat-composer-suggestions');
    if (!node) return;
    Array.from(node.querySelectorAll('.matrix-chat-composer-option')).forEach((btn, index) => {
      const active = index === state.composerSuggestionIndex;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) btn.scrollIntoView({ block: 'nearest' });
    });
  }

  function renderComposerSuggestions(items, mode, token, emptyText = '') {
    const node = el('matrix-chat-composer-suggestions');
    if (!node) return;
    state.composerSuggestions = Array.isArray(items) ? items.slice(0, 12) : [];
    state.composerSuggestionIndex = state.composerSuggestions.length ? 0 : -1;
    state.composerSuggestionMode = mode || '';
    state.composerToken = token || null;
    node.innerHTML = '';

    if (!state.composerSuggestions.length) {
      if (!emptyText) {
        hideComposerSuggestions();
        return;
      }
      const empty = document.createElement('div');
      empty.className = 'matrix-chat-composer-empty';
      empty.textContent = emptyText;
      node.appendChild(empty);
      node.hidden = false;
      return;
    }

    state.composerSuggestions.forEach((item, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'matrix-chat-composer-option';
      btn.classList.toggle('active', index === state.composerSuggestionIndex);
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', index === state.composerSuggestionIndex ? 'true' : 'false');
      const label = document.createElement('strong');
      label.textContent = mode === 'command' ? item.name : (item.display_name || item.user_id || 'Matrix user');
      const meta = document.createElement('span');
      meta.textContent = mode === 'command'
        ? [item.category, item.description].filter(Boolean).join(' - ')
        : item.user_id || '';
      btn.append(label, meta);
      btn.addEventListener('mouseenter', () => {
        state.composerSuggestionIndex = index;
        updateComposerSuggestionActive();
      });
      btn.addEventListener('mousedown', event => event.preventDefault());
      btn.addEventListener('click', () => selectComposerSuggestion(item));
      node.appendChild(btn);
    });
    node.hidden = false;
  }

  function selectComposerSuggestion(item) {
    const composer = el('matrix-chat-composer');
    const token = state.composerToken;
    if (!composer || !token || !item) return;
    const value = composer.value || '';
    const beforeToken = value.slice(0, token.start);
    const afterToken = value.slice(token.end);
    let insert = '';
    let before = beforeToken;

    if (state.composerSuggestionMode === 'command') {
      insert = item.insert || item.name || '';
      if (!insert.endsWith(' ')) insert += ' ';
      const prefix = hermesPrefix();
      if (!before.trim() && !value.trimStart().startsWith(prefix)) {
        before = prefix;
      }
    } else {
      insert = item.user_id || '';
      if (!insert.endsWith(' ')) insert += ' ';
    }

    composer.value = `${before}${insert}${afterToken.replace(/^\s+/, '')}`;
    const cursor = `${before}${insert}`.length;
    composer.setSelectionRange(cursor, cursor);
    hideComposerSuggestions();
    composer.focus();
  }

  async function loadComposerSuggestions() {
    const token = composerToken();
    if (!token) {
      hideComposerSuggestions();
      return;
    }

    if (token.trigger === '/') {
      if (!activeRoom()?.hermes_command_catalog) {
        hideComposerSuggestions();
        return;
      }
      try {
        const commands = await ensureHermesCommands(state.activeRoomId);
        const matches = commands.filter(command => commandMatches(command, token.query));
        renderComposerSuggestions(matches, 'command', token, matches.length ? '' : 'No Hermes commands');
      } catch (_) {
        renderComposerSuggestions([], 'command', token, 'Unable to load Hermes commands');
      }
      return;
    }

    if (token.trigger === '@') {
      try {
        const data = await apiJson(
          matrixApi(`/rooms/${encodeURIComponent(state.activeRoomId)}/mention-candidates?q=${encodeURIComponent(token.query)}`)
        );
        const users = Array.isArray(data.users) ? data.users : [];
        renderComposerSuggestions(users, 'mention', token, users.length ? '' : 'No room members');
      } catch (_) {
        renderComposerSuggestions([], 'mention', token, 'Unable to load room members');
      }
    }
  }

  function scheduleComposerSuggestions() {
    window.clearTimeout(state.composerSuggestionTimer);
    state.composerSuggestionTimer = window.setTimeout(loadComposerSuggestions, 140);
  }

  function handleComposerKeydown(event) {
    const node = el('matrix-chat-composer-suggestions');
    const open = node && !node.hidden && state.composerSuggestions.length;

    if (open && event.key === 'ArrowDown') {
      event.preventDefault();
      state.composerSuggestionIndex = Math.min(
        state.composerSuggestions.length - 1,
        state.composerSuggestionIndex + 1
      );
      updateComposerSuggestionActive();
      return;
    }
    if (open && event.key === 'ArrowUp') {
      event.preventDefault();
      state.composerSuggestionIndex = Math.max(0, state.composerSuggestionIndex - 1);
      updateComposerSuggestionActive();
      return;
    }
    if (open && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();
      selectComposerSuggestion(state.composerSuggestions[state.composerSuggestionIndex]);
      return;
    }
    if (open && event.key === 'Escape') {
      event.preventDefault();
      hideComposerSuggestions();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      sendMessage();
    }
  }

  function insertHermesMention() {
    const composer = el('matrix-chat-composer');
    if (!composer) return;
    const value = composer.value || '';
    const prefix = hermesPrefix();
    if (hermesAliasPattern().test(value)) {
      composer.focus();
      return;
    }
    composer.value = `${prefix}${value.trimStart()}`;
    const cursor = prefix.length;
    composer.setSelectionRange(cursor, cursor);
    hideComposerSuggestions();
    composer.focus();
  }

  async function sendMessage() {
    const composer = el('matrix-chat-composer');
    const body = outgoingComposerBody(composer?.value || '');
    if (!body || !state.activeRoomId) return;
    try {
      await apiJson(matrixApi(`/rooms/${encodeURIComponent(state.activeRoomId)}/messages`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (composer) composer.value = '';
      hideComposerSuggestions();
      await loadMessages(state.activeRoomId);
      await loadRooms();
    } catch (error) {
      setStatus(`Send failed: ${error.message}`, 'error');
    }
  }

  function audioDurationMs(file) {
    if (!file || typeof URL === 'undefined') return Promise.resolve(null);
    return new Promise(resolve => {
      const audio = document.createElement('audio');
      const url = URL.createObjectURL(file);
      let settled = false;
      const done = value => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        resolve(value);
      };
      const timer = window.setTimeout(() => done(null), 1800);
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        window.clearTimeout(timer);
        const duration = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : null;
        done(duration);
      };
      audio.onerror = () => {
        window.clearTimeout(timer);
        done(null);
      };
      audio.src = url;
    });
  }

  async function sendAudioFile(file, durationMs = null) {
    if (!file || state.audioSending) return;
    if (!state.activeRoomId) {
      setStatus('Select a Matrix room before sending audio.', 'warn');
      return;
    }
    const mimetype = guessAudioMime(file);
    if (!mimetype.startsWith('audio/')) {
      setStatus('Choose an audio file to send.', 'warn');
      return;
    }
    const button = el('matrix-chat-audio');
    state.audioSending = true;
    if (button) button.disabled = true;
    setStatus(`Uploading ${file.name || 'audio'}...`, 'warn');
    try {
      const duration = Number.isFinite(durationMs) ? durationMs : await audioDurationMs(file);
      const uploadFile = file.type ? file : new File([file], file.name || 'voice-message.webm', { type: mimetype });
      const form = new FormData();
      form.append('file', uploadFile, uploadFile.name || 'voice-message.webm');
      if (Number.isFinite(duration)) form.append('duration_ms', String(duration));
      await apiJson(matrixApi(`/rooms/${encodeURIComponent(state.activeRoomId)}/audio`), {
        method: 'POST',
        body: form,
      });
      setStatus('Audio sent.', 'ok');
      await loadMessages(state.activeRoomId);
      await loadRooms();
    } catch (error) {
      setStatus(`Audio send failed: ${error.message}`, 'error');
    } finally {
      state.audioSending = false;
      syncVoiceModeAudioState();
    }
  }

  function voicePushToTalkReady() {
    return window.BlueprintsVoiceMode?.canUsePushToTalkStt?.() === true;
  }

  function syncVoiceModeAudioState() {
    const button = el('matrix-chat-audio');
    if (!button) return;
    const busy = state.audioSending || state.audioFinalizing;
    const ready = voicePushToTalkReady();
    button.disabled = busy || !ready;
    button.setAttribute('aria-disabled', button.disabled ? 'true' : 'false');
    button.title = ready
      ? 'Hold to record audio'
      : 'Enable Voice Mode Push to talk on this browser to record audio';
    button.setAttribute('aria-label', button.title);
  }

  async function matrixSttWebSocketUrl(roomId) {
    const url = new URL(matrixApi(`/rooms/${encodeURIComponent(roomId)}/stt/ws`), window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    if (window.BlueprintsVoiceMode?.sttNoiseReductionEnabled?.()) {
      url.searchParams.set('noise_reduction', '1');
      const levelDb = window.BlueprintsVoiceMode?.sttNoiseReductionLevelDb?.();
      if (Number.isFinite(levelDb)) {
        url.searchParams.set('atten_lim_db', String(levelDb));
      }
    }
    const secret = localStorage.getItem(_LS_SECRET_KEY) || '';
    const token = typeof _computeApiToken === 'function'
      ? await _computeApiToken(secret, `${url.pathname}${url.search}`)
      : '';
    if (token) url.searchParams.set('token', token);
    return url.toString();
  }

  function waitForSocketOpen(socket) {
    return new Promise((resolve, reject) => {
      if (socket.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('STT connection timed out'));
      }, 6000);
      const cleanup = () => {
        window.clearTimeout(timer);
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('STT connection failed'));
      };
      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
    });
  }

  function downsampleFloat32(input, inputRate, outputRate = 16000) {
    if (!input?.length) return null;
    if (!Number.isFinite(inputRate) || inputRate <= 0 || inputRate === outputRate) {
      return new Float32Array(input);
    }
    const ratio = inputRate / outputRate;
    const outputLength = Math.max(1, Math.floor(input.length / ratio));
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i += 1) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      let count = 0;
      for (let j = start; j < end; j += 1) {
        sum += input[j];
        count += 1;
      }
      output[i] = count ? sum / count : input[Math.min(start, input.length - 1)] || 0;
    }
    return output;
  }

  function audioInputLevel(input) {
    if (!input?.length) return 0;
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < input.length; i += 1) {
      const value = Math.abs(input[i] || 0);
      sum += value * value;
      if (value > peak) peak = value;
    }
    const rms = Math.sqrt(sum / input.length);
    return Math.min(1, Math.max(0, (rms * 16) + (peak * 0.16)));
  }

  function updateAudioButtonLevel(level) {
    const button = el('matrix-chat-audio');
    if (!button) return;
    const next = Math.min(1, Math.max(0, Number(level) || 0));
    button.style.setProperty('--matrix-chat-audio-level', next.toFixed(3));
    button.style.setProperty('--matrix-chat-audio-glow', `${(8 + (next * 18)).toFixed(1)}px`);
    button.style.setProperty('--matrix-chat-audio-brightness', (1 + (next * 0.72)).toFixed(3));
    button.style.setProperty('--matrix-chat-audio-saturation', (1 + (next * 0.45)).toFixed(3));
    button.style.setProperty('--matrix-chat-audio-scale', (1 + (next * 0.045)).toFixed(3));
  }

  function sttComposerPrefix() {
    return `${hermesPrefix()}${MATRIX_CHAT_STT_TRANSCRIPT_MARKER}`;
  }

  function clearSttComposerDraft(options = {}) {
    const composer = el('matrix-chat-composer');
    if (options.clearValue && composer && state.audioDraftActive && composer.value === state.audioDraftValue) {
      composer.value = '';
    }
    state.audioDraftActive = false;
    state.audioDraftPrefix = '';
    state.audioDraftValue = '';
  }

  function renderSttComposerDraft(text) {
    const clean = (text || '').trim();
    const composer = el('matrix-chat-composer');
    if (!clean || !composer) return false;
    if (!state.audioDraftActive) {
      if ((composer.value || '').trim()) return false;
      state.audioDraftActive = true;
      state.audioDraftPrefix = sttComposerPrefix();
      state.audioDraftValue = '';
    } else if ((composer.value || '') !== state.audioDraftValue) {
      return false;
    }
    const value = `${state.audioDraftPrefix || sttComposerPrefix()}${clean}`;
    composer.value = value;
    state.audioDraftValue = value;
    try {
      composer.setSelectionRange(value.length, value.length);
    } catch (_) {}
    hideComposerSuggestions();
    return true;
  }

  function cleanupAudioRecording(options = {}) {
    const closeSocket = options.closeSocket !== false;
    state.audioStarting = false;
    state.audioRecording = false;
    state.audioFinalizing = false;
    if (state.audioProcessorNode) {
      try {
        state.audioProcessorNode.disconnect();
      } catch (_) {}
      state.audioProcessorNode.onaudioprocess = null;
      state.audioProcessorNode = null;
    }
    if (state.audioSourceNode) {
      try {
        state.audioSourceNode.disconnect();
      } catch (_) {}
      state.audioSourceNode = null;
    }
    if (state.audioContext) {
      try {
        void state.audioContext.close();
      } catch (_) {}
      state.audioContext = null;
    }
    if (closeSocket && state.audioWs) {
      try {
        state.audioWs.close();
      } catch (_) {}
      state.audioWs = null;
    }
    state.audioChunks = [];
    state.audioBytesSent = 0;
    state.audioFramesSent = 0;
    state.audioStartedAt = 0;
    state.audioStopAfterStart = false;
    if (state.audioStream) {
      state.audioStream.getTracks().forEach(track => track.stop());
      state.audioStream = null;
    }
    el('matrix-chat-audio')?.classList.remove('is-recording');
    updateAudioButtonLevel(0);
  }

  async function handleSttMessage(event) {
    let payload = {};
    try {
      payload = JSON.parse(event.data || '{}');
    } catch (_) {
      return;
    }
    if (payload.type === 'partial' && payload.text) {
      renderSttComposerDraft(payload.text);
      setStatus(`Transcribing: ${payload.text}`, 'warn');
      return;
    }
    if (payload.type === 'final') {
      cleanupAudioRecording();
      state.audioSending = false;
      syncVoiceModeAudioState();
      if (payload.matrix?.event_id) {
        clearSttComposerDraft({ clearValue: true });
        setStatus('Voice transcript sent.', 'ok');
        await loadMessages(state.activeRoomId);
        await loadRooms();
      } else if (payload.matrix_error) {
        renderSttComposerDraft(payload.text || '');
        setStatus(`Voice transcript send failed: ${payload.matrix_error}`, 'error');
      } else {
        clearSttComposerDraft({ clearValue: true });
        setStatus('');
      }
    } else if (payload.type === 'error') {
      cleanupAudioRecording();
      state.audioSending = false;
      syncVoiceModeAudioState();
      clearSttComposerDraft({ clearValue: true });
      setStatus(`STT failed: ${payload.detail || 'unknown error'}`, 'error');
    }
  }

  async function startAudioRecording() {
    if (state.audioSending || state.audioStarting || state.audioRecording || state.audioFinalizing || state.audioWs) return;
    if (!voicePushToTalkReady()) {
      syncVoiceModeAudioState();
      setStatus('Enable Voice Mode Push to talk on this browser before recording audio.', 'warn');
      return;
    }
    if (!state.activeRoomId) {
      setStatus('Select a Matrix room before recording audio.', 'warn');
      return;
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || typeof WebSocket === 'undefined' || !AudioContextCtor) {
      setStatus('This browser cannot stream microphone audio here.', 'warn');
      return;
    }
    const button = el('matrix-chat-audio');
    try {
      state.audioStarting = true;
      state.audioStopAfterStart = false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ws = new WebSocket(await matrixSttWebSocketUrl(state.activeRoomId));
      ws.binaryType = 'arraybuffer';
      state.audioWs = ws;
      ws.addEventListener('message', event => {
        void handleSttMessage(event);
      });
      ws.addEventListener('close', () => {
        if (state.audioRecording || state.audioFinalizing) {
          cleanupAudioRecording({ closeSocket: false });
          state.audioSending = false;
          syncVoiceModeAudioState();
          setStatus('STT connection closed before a final transcript.', 'warn');
        }
        state.audioWs = null;
      });
      await waitForSocketOpen(ws);

      const audioContext = new AudioContextCtor();
      await audioContext.resume?.();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      state.audioStream = stream;
      state.audioContext = audioContext;
      state.audioSourceNode = source;
      state.audioProcessorNode = processor;
      state.audioChunks = [];
      state.audioBytesSent = 0;
      state.audioFramesSent = 0;
      state.audioStartedAt = Date.now();
      clearSttComposerDraft({ clearValue: true });
      updateAudioButtonLevel(0);
      state.audioStarting = false;
      state.audioRecording = true;
      processor.onaudioprocess = event => {
        const output = event.outputBuffer?.getChannelData?.(0);
        if (output) output.fill(0);
        if (!state.audioRecording || state.audioWs?.readyState !== WebSocket.OPEN) return;
        const input = event.inputBuffer.getChannelData(0);
        updateAudioButtonLevel(audioInputLevel(input));
        const pcm = downsampleFloat32(input, audioContext.sampleRate, 16000);
        if (pcm?.byteLength) {
          state.audioBytesSent += pcm.byteLength;
          state.audioFramesSent += 1;
          state.audioWs.send(pcm.buffer);
        }
      };
      source.connect(processor);
      processor.connect(audioContext.destination);

      button?.classList.add('is-recording');
      const noiseEnabled = window.BlueprintsVoiceMode?.sttNoiseReductionEnabled?.();
      setStatus(noiseEnabled
        ? 'Recording voice for STT with noise reduction... release to send.'
        : 'Recording voice for STT... release to send.', 'warn');
      if (state.audioStopAfterStart) stopAudioRecording();
    } catch (error) {
      cleanupAudioRecording();
      setStatus(`Audio recording unavailable: ${error.message}`, 'error');
    }
  }

  function stopAudioRecording() {
    if (state.audioStarting) {
      state.audioStopAfterStart = true;
      return;
    }
    if (!state.audioWs) {
      cleanupAudioRecording();
      return;
    }
    state.audioRecording = false;
    state.audioFinalizing = true;
    state.audioSending = true;
    const button = el('matrix-chat-audio');
    if (button) button.disabled = true;
    button?.classList.remove('is-recording');
    updateAudioButtonLevel(0);
    if (state.audioProcessorNode) {
      try {
        state.audioProcessorNode.disconnect();
      } catch (_) {}
    }
    if (state.audioSourceNode) {
      try {
        state.audioSourceNode.disconnect();
      } catch (_) {}
    }
    if (state.audioStream) {
      state.audioStream.getTracks().forEach(track => track.stop());
      state.audioStream = null;
    }
    if (state.audioWs.readyState === WebSocket.OPEN) {
      state.audioWs.send(JSON.stringify({
        type: 'end',
        audio_bytes: state.audioBytesSent,
        audio_frames: state.audioFramesSent,
      }));
      setStatus('Finalizing voice transcript...', 'warn');
    } else {
      cleanupAudioRecording();
      state.audioSending = false;
      syncVoiceModeAudioState();
      setStatus('STT connection was not ready.', 'error');
    }
  }

  function bindAudioRecordButton() {
    const button = el('matrix-chat-audio');
    if (!button) return;
    button.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      void startAudioRecording();
    });
    button.addEventListener('pointerup', event => {
      event.preventDefault();
      stopAudioRecording();
    });
    button.addEventListener('pointercancel', event => {
      event.preventDefault();
      stopAudioRecording();
    });
    syncVoiceModeAudioState();
  }

  function handleBlueprintsEvent(domEvt) {
    const evt = domEvt?.detail;
    if (!evt || evt.event_type !== 'matrix.chat.sync') return;
    state.lastBackendSyncAt = Date.now();
    applySyncPayload(evt.payload || {}, { snapshot: Boolean(evt.payload?.snapshot) });
  }

  function handleBlueprintsStreamState(domEvt) {
    if (domEvt?.detail?.state === 'CONNECTED') {
      schedulePoll(MATRIX_CHAT_SYNC_FALLBACK_MS);
    } else if (isActive()) {
      schedulePoll(MATRIX_CHAT_SYNC_RETRY_MS);
    }
  }

  function schedulePoll(delayMs = 0) {
    window.clearTimeout(state.pollTimer);
    state.pollTimer = window.setTimeout(poll, Math.max(0, delayMs));
  }

  async function poll() {
    state.pollTimer = null;
    const backendSyncFresh = state.lastBackendSyncAt
      && Date.now() - state.lastBackendSyncAt < MATRIX_CHAT_SYNC_FALLBACK_MS;
    if (eventStreamConnected() && backendSyncFresh) {
      schedulePoll(MATRIX_CHAT_SYNC_FALLBACK_MS);
      return;
    }
    if (!isActive() || state.loading || !state.nextBatch || state.pollInFlight) {
      schedulePoll(MATRIX_CHAT_SYNC_RETRY_MS);
      return;
    }
    const pollGeneration = state.pollGeneration;
    const pollServerId = state.serverId;
    state.pollInFlight = true;
    try {
      const data = await apiJson(
        matrixApi(`/sync?since=${encodeURIComponent(state.nextBatch)}&timeout_ms=${MATRIX_CHAT_SYNC_TIMEOUT_MS}`),
        { trackActivity: false }
      );
      if (pollGeneration !== state.pollGeneration || pollServerId !== state.serverId) return;
      applySyncPayload(data);
    } catch (_) {
      // Keep the page calm; explicit refresh will surface detailed errors.
    } finally {
      state.pollInFlight = false;
      schedulePoll(isActive() && !eventStreamConnected() ? 0 : MATRIX_CHAT_SYNC_FALLBACK_MS);
    }
  }

  function scheduleViewportFit() {
    if (window.BodyShade?.scheduleSizeFillTable) {
      window.BodyShade.scheduleSizeFillTable();
    }
  }

  function composerHeightBounds() {
    const main = el('matrix-chat-main');
    const mainRect = main?.getBoundingClientRect();
    const mainHeight = mainRect?.height || window.innerHeight || 600;
    const min = isMobileLayout() ? 92 : 56;
    const max = Math.max(min, Math.min(Math.round(mainHeight * 0.62), isMobileLayout() ? 320 : 440));
    return { min, max };
  }

  function clampComposerHeight(value) {
    const { min, max } = composerHeightBounds();
    const next = Math.round(Number(value) || 0);
    return Math.min(max, Math.max(min, next));
  }

  function setComposerHeight(value, persist = true) {
    const main = el('matrix-chat-main');
    if (!main) return;
    const height = clampComposerHeight(value);
    main.style.setProperty('--matrix-chat-composer-height', `${height}px`);
    if (persist) {
      try {
        localStorage.setItem(MATRIX_CHAT_COMPOSER_HEIGHT_STORAGE_KEY, String(height));
      } catch (_) {}
    }
    scheduleViewportFit();
  }

  function restoreComposerHeight() {
    try {
      const stored = Number(localStorage.getItem(MATRIX_CHAT_COMPOSER_HEIGHT_STORAGE_KEY) || '');
      if (Number.isFinite(stored) && stored > 0) setComposerHeight(stored, false);
    } catch (_) {}
  }

  function initComposerResize() {
    const handle = el('matrix-chat-composer-resize');
    const composer = document.querySelector('.matrix-chat-composer');
    const main = el('matrix-chat-main');
    if (!handle || !composer || !main) return;

    const resizeFromClientY = clientY => {
      const rect = main.getBoundingClientRect();
      setComposerHeight(rect.bottom - clientY);
    };

    handle.addEventListener('pointerdown', event => {
      event.preventDefault();
      composer.classList.add('is-resizing');
      handle.setPointerCapture?.(event.pointerId);
      resizeFromClientY(event.clientY);
      const onMove = moveEvent => {
        moveEvent.preventDefault();
        resizeFromClientY(moveEvent.clientY);
      };
      const onEnd = () => {
        composer.classList.remove('is-resizing');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    });

    handle.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const current = parseFloat(getComputedStyle(main).getPropertyValue('--matrix-chat-composer-height')) || composer.offsetHeight;
      const { min, max } = composerHeightBounds();
      if (event.key === 'ArrowUp') setComposerHeight(current + 16);
      if (event.key === 'ArrowDown') setComposerHeight(current - 16);
      if (event.key === 'Home') setComposerHeight(min);
      if (event.key === 'End') setComposerHeight(max);
    });

    restoreComposerHeight();
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

  function resetForServer(serverId) {
    state.serverId = serverId;
    state.pollGeneration += 1;
    state.status = null;
    state.joined = [];
    state.invites = [];
    state.activeRoomId = '';
    state.nextBatch = '';
    state.messagesByRoom.clear();
    state.redactedEventIdsByRoom.clear();
    state.historyByRoom.clear();
    state.inviteCandidates = [];
    state.inviteCandidateIndex = -1;
    state.hermesCommands = [];
    state.hermesCommandsLoaded = false;
    state.hermesCommandsRoomId = '';
    state.composerSuggestions = [];
    state.composerSuggestionIndex = -1;
    state.composerSuggestionMode = '';
    state.composerToken = null;
    state.messageFilter = '';
    state.roomAdminRoomId = '';
    state.roomAdminSettings = null;
    state.roomAdminMembers = [];
    state.roomAdminSaving = false;
    state.roomAdminDeleting = false;
    state.roomAdminTesting = false;
    state.messageDeleteButtonsVisible = false;
    state.audioSending = false;
    cleanupAudioRecording();
    window.clearTimeout(state.roomTabClickTimer);
    state.roomTabClickTimer = null;
    hideInviteSuggestions();
    hideComposerSuggestions();
    const roomAdminModal = el('matrix-chat-room-admin-modal');
    if (roomAdminModal?.open) {
      if (typeof HubModal !== 'undefined') HubModal.close(roomAdminModal);
      else roomAdminModal.close?.();
    }
    el('matrix-chat-composer') && (el('matrix-chat-composer').value = '');
    el('matrix-chat-mobile-filter') && (el('matrix-chat-mobile-filter').value = '');
    try {
      localStorage.setItem(MATRIX_CHAT_SERVER_STORAGE_KEY, serverId);
    } catch (_) {}
    renderRooms();
    renderMessages();
    renderStatus();
  }

  async function switchServer(serverId) {
    if (!['tb1', 'vps'].includes(serverId) || serverId === state.serverId) return;
    resetForServer(serverId);
    setStatus(`Loading ${serverId.toUpperCase()} Matrix chat...`);
    await refreshAll();
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    if (typeof ResponsiveLayout !== 'undefined') {
      ResponsiveLayout.registerTabControls('matrix-chat', 'pg-ctrl-matrix-chat');
    }
    const toggleRail = event => {
      event?.preventDefault?.();
      const shell = el('matrix-chat-shell');
      setRailOpen(!shell?.classList.contains('rail-open'));
    };
    const closeRail = event => {
      event?.preventDefault?.();
      setRailOpen(false);
    };
    RoomTabInteractionMachine.configure({
      onSelectRoom: roomId => selectRoom(roomId),
      onOpenAdmin: roomId => openRoomAdmin(roomId),
    });
    el('matrix-chat-refresh')?.addEventListener('click', refreshAll);
    document.querySelectorAll('[data-matrix-chat-server]').forEach(btn => {
      btn.addEventListener('click', () => switchServer(btn.dataset.matrixChatServer || 'tb1'));
    });
    el('matrix-chat-rail-close')?.addEventListener('pointerup', closeRail);
    el('matrix-chat-rail-close')?.addEventListener('touchend', closeRail);
    el('matrix-chat-rail-close')?.addEventListener('click', closeRail);
    el('matrix-chat-mobile-rail-toggle')?.addEventListener('click', toggleRail);
    el('matrix-chat-mobile-load-older')?.addEventListener('click', loadOlderMessages);
    el('matrix-chat-mobile-filter')?.addEventListener('input', event => {
      applyMessageFilter(event.target?.value || '');
    });
    el('matrix-chat-mobile-filter-action')?.addEventListener('click', () => {
      const input = el('matrix-chat-mobile-filter');
      if (state.messageFilter) {
        state.messageFilter = '';
        if (input) input.value = '';
        renderMessages({ scrollToBottom: false });
      }
      input?.focus?.();
    });
    el('matrix-chat-create')?.addEventListener('click', createRoom);
    el('matrix-chat-join')?.addEventListener('click', () => joinRoom());
    el('matrix-chat-invite')?.addEventListener('click', inviteUser);
    el('matrix-chat-invite-user')?.addEventListener('input', scheduleInviteCandidates);
    el('matrix-chat-invite-user')?.addEventListener('focus', scheduleInviteCandidates);
    el('matrix-chat-invite-user')?.addEventListener('keydown', handleInviteKeydown);
    el('matrix-chat-mention-hermes')?.addEventListener('click', insertHermesMention);
    bindAudioRecordButton();
    el('matrix-chat-send')?.addEventListener('click', sendMessage);
    el('matrix-chat-room-admin-save')?.addEventListener('click', saveRoomAdminSettings);
    el('matrix-chat-room-admin-show-delete')?.addEventListener('change', toggleMessageDeleteButtons);
    el('matrix-chat-room-admin-delete-undecryptable')?.addEventListener('click', deleteUndecryptableMessages);
    el('matrix-chat-room-admin-delete-system-before')?.addEventListener('click', deleteSystemMessagesBefore);
    el('matrix-chat-room-admin-system-before')?.addEventListener('input', renderRoomAdminModal);
    el('matrix-chat-room-admin-seed-decryption-test')?.addEventListener('click', seedDecryptionTestMessages);
    el('matrix-chat-notifier-info-open')?.addEventListener('click', openNotifierInfoModal);
    el('matrix-chat-notifier-info-close')?.addEventListener('click', closeNotifierInfoModal);
    el('matrix-chat-notifier-mode')?.addEventListener('change', () => {
      void showNotifierModeImpact(false);
    });
    el('matrix-chat-notifier-dnd-save')?.addEventListener('click', saveNotifierDndConfig);
    el('matrix-chat-notifier-danger-pick')?.addEventListener('click', openNotifierDangerSoundPicker);
    el('matrix-chat-notifier-danger-test')?.addEventListener('click', event => testNotifierDangerSound(event.currentTarget));
    document.querySelectorAll('[data-notifier-test-id]').forEach(button => {
      button.addEventListener('click', () => {
        void submitNotifierTest(button.dataset.notifierTestId || '', button);
      });
    });
    el('matrix-chat-notifier-tests-cancel-danger2')?.addEventListener('click', () => {
      void cancelDanger2FromTests();
    });
    el('matrix-chat-notifier-tests-failure-drill')?.addEventListener('click', event => {
      void runNotifierFailureDrill(event.currentTarget);
    });
    document.addEventListener('blueprints:event', domEvt => {
      if (domEvt.detail) handleNotifierTestDrainedEvent(domEvt.detail);
    });
    document.addEventListener('blueprints:event', handleBlueprintsEvent);
    document.addEventListener('blueprints:stream:state', handleBlueprintsStreamState);
    document.addEventListener('blueprints:notification-speech-suppressed', domEvt => {
      if (domEvt.detail) handleNotifierSpeechSuppressed(domEvt.detail);
    });
    el('matrix-chat-composer')?.addEventListener('input', scheduleComposerSuggestions);
    el('matrix-chat-composer')?.addEventListener('focus', scheduleComposerSuggestions);
    el('matrix-chat-composer')?.addEventListener('click', scheduleComposerSuggestions);
    el('matrix-chat-composer')?.addEventListener('keyup', event => {
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(event.key)) {
        scheduleComposerSuggestions();
      }
    });
    el('matrix-chat-composer')?.addEventListener('keydown', handleComposerKeydown);
    initComposerResize();
    window.addEventListener('resize', () => {
      syncRailForViewport();
      const main = el('matrix-chat-main');
      const current = parseFloat(getComputedStyle(main || document.documentElement).getPropertyValue('--matrix-chat-composer-height'));
      if (Number.isFinite(current)) setComposerHeight(current, false);
    });
    syncRailForViewport();
  }

  async function loadTab() {
    bind();
    await refreshAll();
    schedulePoll(0);
  }

  return {
    loadTab,
    refresh: refreshAll,
    sendMessage,
    sendAudioFile,
    syncVoiceModeAudioState,
    insertHermesMention,
    openNotifierDnd: openNotifierDndModal,
    openNotifierTests: openNotifierTestsModal,
  };
})();

function _matrixChatLoadTab() {
  MatrixChat.loadTab();
}

window._matrixChatLoadTab = _matrixChatLoadTab;
window.MatrixChat = MatrixChat;
