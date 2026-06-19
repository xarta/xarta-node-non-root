// active-browser-observer.js - app-wide Active Browser automation and view reports.

'use strict';

const BlueprintsActiveBrowserObserver = (() => {
  const REPORT_URL = '/api/v1/voice-mode/browser-view';
  const ACTIVE_BROWSER_COMMAND_EVENT = 'blueprints.active_browser.command';
  const REPORT_DEBOUNCE_MS = 300;
  const MODAL_COMMAND_SETTLE_MS = 650;
  const REPORT_HEARTBEAT_MS = 10000;
  const PAGE_READY_QUIET_MS = 350;
  const LS_HANDLED_COMMANDS = 'blueprints.active_browser.handled_commands';
  const HANDLED_COMMAND_TTL_MS = 5 * 60 * 1000;
  const DIAGNOSTIC_REPORT_TTL_MS = 5000;
  const DIAGNOSTIC_SOURCES = new Set(['gpu_activity_sound', 'personal_search']);

  let _reportTimer = null;
  let _heartbeatTimer = null;
  let _lastReportKey = '';
  let _lastReportAt = 0;
  let _serviceWorkerVersion = null;
  let _serviceWorkerRequestPending = false;
  let _commandListenerInstalled = false;
  let _handledCommands = {};
  let _pageReadyTimer = null;
  let _lastCommandResult = null;
  let _pendingDiagnostics = null;

  function _voiceMode() {
    return window.BlueprintsVoiceMode || null;
  }

  function _browserId() {
    return String(_voiceMode()?.getBrowserId?.() || '').trim();
  }

  function _browserLabel() {
    const label = _voiceMode()?.getBrowserLabel?.();
    if (label) return String(label);
    const platform = navigator.platform || 'browser';
    const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    return `${standalone ? 'PWA' : 'Browser'} on ${platform}`;
  }

  function _tabId() {
    return String(_voiceMode()?.getTabId?.() || '').trim();
  }

  function _cleanText(value) {
    return String(value || '').trim();
  }

  function _normalizeAction(value) {
    const action = _cleanText(value).toLowerCase().replace(/[-\s]+/g, '_');
    if (action === 'refresh' || action === 'reload' || action === 'app_refresh' || action === 'refresh_app') return 'hard_refresh';
    if (action === 'chat') return 'open_chat';
    if (action === 'vad_dev') return 'open_vad_dev';
    if (action === 'close_vad' || action === 'vad_close') return 'close_vad_dev';
    if (action === 'modal_close') return 'close_modal';
    if (action === 'page' || action === 'open_tab' || action === 'tab') return 'open_page';
    if (action === 'matrix_chat_room' || action === 'chat_room' || action === 'open_chat_room') return 'open_matrix_chat_room';
    if (action === 'modal') return 'open_modal';
    if (action === 'doc' || action === 'document') return 'open_doc';
    if (action === 'fn' || action === 'function' || action === 'menu_fn') return 'menu_function';
    if (action === 'synthesis') return 'open_synthesis';
    if (action === 'probes') return 'open_probes';
    if (action === 'settings') return 'open_settings';
    if (action === 'dave') return 'open_dave';
    if (action === 'kanban') return 'open_kanban';
    if (action === 'selector') return 'selector_action';
    if (action === 'body_shade' || action === 'shade' || action === 'shade_up') return 'set_body_shade';
    if (
      action === 'diagnostic'
      || action === 'diagnostics'
      || action === 'diagnostic_snapshot'
      || action === 'diagnostics_snapshot'
      || action === 'request_diagnostics'
      || action === 'runtime_snapshot'
      || action === 'debug_snapshot'
    ) return 'diagnostic_snapshot';
    return action;
  }

  function _objectFromCommandValue(value) {
    if (!value) return null;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      } catch (_) {
        return null;
      }
    }
    return typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function _looksLikeCommandPayload(value) {
    const item = _objectFromCommandValue(value);
    if (!item) return false;
    if (item.schema === 'xarta.active_browser.command.v1') return true;
    return !!(item.action || item.command_id || item.target_browser_id || item.active_browser_id);
  }

  function _extractCommandPayload(eventDetail) {
    const detail = _objectFromCommandValue(eventDetail);
    if (!detail) return null;
    const candidates = [
      detail.payload && _objectFromCommandValue(detail.payload)?.payload,
      detail.payload,
      detail,
    ];
    for (const candidate of candidates) {
      const payload = _objectFromCommandValue(candidate);
      if (_looksLikeCommandPayload(payload)) return payload;
    }
    return null;
  }

  function _normalizeBodyShade(value) {
    const state = _cleanText(value || 'up').toLowerCase().replace(/[-\s]+/g, '_');
    if (state === 'down' || state === 'lower' || state === 'lowered' || state === 'closed' || state === 'off' || state === 'false' || state === '0') return 'down';
    if (state === 'toggle' || state === 'flip') return 'toggle';
    return 'up';
  }

  function _normalizeEventKind(value) {
    const eventKind = _cleanText(value || 'click').toLowerCase().replace(/[-\s]+/g, '_');
    if (eventKind === 'tap' || eventKind === 'single' || eventKind === 'single_click') return 'click';
    if (eventKind === 'dblclick' || eventKind === 'double' || eventKind === 'double_tap') return 'double_click';
    if (eventKind === 'long' || eventKind === 'hold' || eventKind === 'long_tap') return 'long_press';
    if (eventKind === 'double_click' || eventKind === 'long_press') return eventKind;
    return 'click';
  }

  function _normalizeSelectorAction(value) {
    return _cleanText(value).toLowerCase().replace(/[\s_]+/g, '-');
  }

  function _normalizeDiagnosticSource(value) {
    const source = _cleanText(value).toLowerCase().replace(/[-\s]+/g, '_');
    if (source === 'gpu' || source === 'gpu_activity' || source === 'gpu_sfx') return 'gpu_activity_sound';
    if (source === 'search' || source === 'shared_search' || source === 'personal_shared_search') return 'personal_search';
    return DIAGNOSTIC_SOURCES.has(source) ? source : '';
  }

  function _diagnosticSourcesFromPayload(payload) {
    const raw = payload?.diagnostics
      || payload?.diagnostic_sources
      || payload?.include
      || ['gpu_activity_sound'];
    const values = Array.isArray(raw) ? raw : String(raw || '').split(/[,\s]+/);
    const sources = [];
    values.forEach(value => {
      const source = _normalizeDiagnosticSource(value);
      if (source && !sources.includes(source)) sources.push(source);
    });
    return sources.length ? sources : ['gpu_activity_sound'];
  }

  function _normalizeGroup(value) {
    return _cleanText(value).toLowerCase().replace(/[\s_]+/g, '-');
  }

  function _commandIsFresh(payload) {
    const createdAt = Number(payload?.created_at || 0);
    const maxAgeSeconds = Math.max(1, Number(payload?.max_age_seconds || 60));
    if (!Number.isFinite(createdAt) || createdAt <= 0) return true;
    return ((Date.now() / 1000) - createdAt) <= maxAgeSeconds;
  }

  function _commandTargetsThisTab(payload) {
    const targetBrowserId = _cleanText(payload?.target_browser_id || payload?.active_browser_id);
    const browserId = _browserId();
    if (targetBrowserId && browserId && targetBrowserId !== browserId) return false;
    if (!targetBrowserId && _voiceMode()?.isActiveOwner?.() !== true) return false;

    const targetTabId = _cleanText(payload?.target_tab_id);
    const tabId = _tabId();
    if (targetTabId && tabId && targetTabId !== tabId) return false;
    return _commandIsFresh(payload);
  }

  function _loadHandledCommands() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LS_HANDLED_COMMANDS) || '{}');
      _handledCommands = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      _handledCommands = {};
    }
  }

  function _saveHandledCommands() {
    try {
      localStorage.setItem(LS_HANDLED_COMMANDS, JSON.stringify(_handledCommands));
    } catch (_) {}
  }

  function _rememberCommand(payload) {
    const commandId = _cleanText(payload?.command_id);
    if (!commandId) return true;
    const now = Date.now();
    Object.entries(_handledCommands).forEach(([id, handledAt]) => {
      if ((now - Number(handledAt || 0)) > HANDLED_COMMAND_TTL_MS) delete _handledCommands[id];
    });
    if (_handledCommands[commandId]) return false;
    _handledCommands[commandId] = now;
    _saveHandledCommands();
    return true;
  }

  function _openChatPage() {
    if (typeof window.switchTab === 'function') {
      window.switchTab('matrix-chat');
      return true;
    }
    const panel = document.getElementById('tab-matrix-chat');
    if (!panel) return false;
    document.querySelectorAll('.tab-panel').forEach(node => node.classList.remove('active'));
    panel.classList.add('active');
    return true;
  }

  function _switchGroup(group) {
    const cleanGroup = _cleanText(group).toLowerCase();
    if (!cleanGroup) return false;
    if (typeof window.BlueprintsHubMenuBridge?.switchGroup === 'function') {
      window.BlueprintsHubMenuBridge.switchGroup(cleanGroup);
      return true;
    }
    if (typeof window.switchGroup === 'function') {
      window.switchGroup(cleanGroup);
      return true;
    }
    return false;
  }

  function _findSelectorButton(action) {
    return Array.from(document.querySelectorAll('.bp-ns-action-btn[data-action]'))
      .find(button => button.dataset.action === action) || null;
  }

  function _runSelectorAction(action, eventKind = 'click') {
    const selectorAction = _normalizeSelectorAction(action);
    if (!selectorAction) return false;
    const kind = _normalizeEventKind(eventKind);
    if (typeof window.BlueprintsNodeSelectorActions?.run === 'function') {
      const result = window.BlueprintsNodeSelectorActions.run(selectorAction, {
        event_kind: kind,
        source: 'active-browser-command',
      });
      return result?.ok !== false;
    }
    if (kind === 'click') {
      const button = _findSelectorButton(selectorAction);
      if (button) {
        button.click();
        return true;
      }
      if (selectorAction === 'synthesis' || selectorAction === 'probes' || selectorAction === 'settings' || selectorAction === 'dave' || selectorAction === 'kanban') {
        return _switchGroup(selectorAction);
      }
    }
    return false;
  }

  function _openPage(payload) {
    if (typeof window.BlueprintsHubMenuBridge?.openPage !== 'function') return false;
    const result = window.BlueprintsHubMenuBridge.openPage({
      group: _normalizeGroup(payload?.group || payload?.menu_group),
      page_id: _cleanText(payload?.page_id || payload?.tab || payload?.menu_item_id),
      menu_item_id: _cleanText(payload?.menu_item_id),
    });
    return result?.ok !== false;
  }

  function _runMenuFunction(payload) {
    if (typeof window.BlueprintsHubMenuBridge?.invokeMenuFunction !== 'function') return false;
    const result = window.BlueprintsHubMenuBridge.invokeMenuFunction({
      group: _normalizeGroup(payload?.group || payload?.menu_group),
      page_id: _cleanText(payload?.page_id || payload?.tab),
      menu_item_id: _cleanText(payload?.menu_item_id || payload?.menu_id),
      fn: _cleanText(payload?.fn),
    });
    return result?.ok !== false;
  }

  function _openKnownModal(modalId) {
    const cleanId = _cleanText(modalId);
    const openers = {
      'voice-mode-modal': () => typeof window.BlueprintsVoiceMode?.open === 'function' ? window.BlueprintsVoiceMode.open() : false,
      'stt-noise-tests-modal': () => typeof window.SttNoiseTests?.open === 'function' ? window.SttNoiseTests.open() : false,
      'vad-dev-modal': () => typeof window.VadDevModal?.open === 'function' ? window.VadDevModal.open() : false,
      'wake-dev-modal': () => typeof window.WakeDevModal?.open === 'function' ? window.WakeDevModal.open() : false,
      'alarm-settings-modal': () => typeof window.BlueprintsAlarmClock?.openSettings === 'function' ? window.BlueprintsAlarmClock.openSettings({ source: 'active-browser' }) : false,
      'matrix-chat-notifier-dnd-modal': () => typeof window.MatrixChat?.openNotifierDnd === 'function' ? window.MatrixChat.openNotifierDnd() : false,
      'matrix-chat-notifier-tests-modal': () => typeof window.MatrixChat?.openNotifierTests === 'function' ? window.MatrixChat.openNotifierTests() : false,
    };
    const opener = openers[cleanId];
    if (typeof opener === 'function') {
      const result = opener();
      return result !== false;
    }
    const dialog = document.getElementById(cleanId);
    if (!_isDialog(dialog)) return false;
    if (typeof window.HubModal?.open === 'function') {
      window.HubModal.open(dialog);
    } else if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    }
    return true;
  }

  function _recordCommandResult(payload, ok, error) {
    _lastCommandResult = {
      command_id: _cleanText(payload?.command_id),
      action: _normalizeAction(payload?.action),
      modal_id: _cleanText(payload?.modal_id),
      group: _normalizeGroup(payload?.group || payload?.menu_group),
      page_id: _cleanText(payload?.page_id || payload?.tab),
      server_id: _cleanText(payload?.server_id || payload?.matrix_server),
      room_id: _cleanText(payload?.room_id),
      room_hint: _cleanText(payload?.room_hint),
      fn: _cleanText(payload?.fn),
      ok: !!ok,
      error: error ? _cleanText(error).slice(0, 180) : '',
      recorded_at_ms: Date.now(),
    };
  }

  function _requestDiagnosticSnapshot(payload) {
    _pendingDiagnostics = {
      command_id: _cleanText(payload?.command_id),
      requested_at_ms: Date.now(),
      expires_at_ms: Date.now() + DIAGNOSTIC_REPORT_TTL_MS,
      sources: _diagnosticSourcesFromPayload(payload),
    };
    return true;
  }

  function _openModal(payload) {
    if (payload?.fn || payload?.menu_item_id || payload?.menu_id) {
      return _runMenuFunction(payload);
    }
    return _openKnownModal(payload?.modal_id);
  }

  async function _openDoc(payload) {
    const docId = _cleanText(payload?.doc_id);
    const docPath = _cleanText(payload?.path || payload?.doc_path);
    const highlightTerms = Array.isArray(payload?.highlight_terms)
      ? payload.highlight_terms.map(term => _cleanText(term)).filter(Boolean).slice(0, 8)
      : [];
    _openPage({ group: 'settings', page_id: 'docs' });
    if (docId && typeof window.BlueprintsDocsViewer?.openDoc === 'function') {
      return await window.BlueprintsDocsViewer.openDoc(docId, { highlightTerms });
    }
    if (docPath && typeof window.docsOpenByPath === 'function') {
      window.docsOpenByPath(docPath);
      if (highlightTerms.length && typeof window.docsHighlightTerms === 'function') {
        window.setTimeout(() => window.docsHighlightTerms(highlightTerms), 80);
      }
      return true;
    }
    return false;
  }

  async function _openMatrixChatRoom(payload) {
    const opened = _openPage({ group: 'settings', page_id: 'matrix-chat' });
    if (opened === false) throw new Error('Matrix Chat page is unavailable.');
    const matrixChat = window.MatrixChat || window.BlueprintsMatrixChat || null;
    if (!matrixChat || typeof matrixChat.openRoom !== 'function') {
      throw new Error('Matrix Chat automation is unavailable.');
    }
    const result = await matrixChat.openRoom({
      server_id: _cleanText(payload?.server_id || payload?.matrix_server),
      room_id: _cleanText(payload?.room_id),
      room_hint: _cleanText(payload?.room_hint),
    });
    if (result?.ok === false) throw new Error(result.detail || 'Matrix Chat room was not found.');
    return true;
  }

  function _setBodyShade(payload) {
    const bodyShade = window.BodyShade || null;
    if (!bodyShade) return false;
    const requested = _normalizeBodyShade(payload?.body_shade || payload?.shade);
    const isUp = !!(document.body && document.body.classList.contains('shade-is-up'));
    const target = requested === 'toggle' ? (isUp ? 'down' : 'up') : requested;
    const instant = !!payload?.instant;
    if (typeof bodyShade.syncActiveHandle === 'function') {
      bodyShade.syncActiveHandle({ reset: false });
    }
    if (target === 'down') {
      if (typeof bodyShade.snapDown !== 'function') return false;
      bodyShade.snapDown({ instant });
      return true;
    }
    if (typeof bodyShade.snapUp !== 'function') return false;
    return bodyShade.snapUp({ instant }) !== false;
  }

  function _closeDialog(dialogId) {
    let dialog = null;
    const cleanId = _cleanText(dialogId);
    if (cleanId) {
      const matches = Array.from(document.querySelectorAll('dialog[id]'))
        .filter(node => node.id === cleanId);
      dialog = matches.find(node => _dialogLooksOpen(node))
        || matches[0]
        || document.getElementById(cleanId);
    } else {
      const openDialogs = Array.from(document.querySelectorAll('dialog[id]'))
        .filter(node => _dialogLooksOpen(node));
      dialog = openDialogs.length ? openDialogs[openDialogs.length - 1] : null;
    }
    if (!_isDialog(dialog) || !_dialogLooksOpen(dialog)) return false;
    if (typeof window.HubModal?.close === 'function') {
      window.HubModal.close(dialog);
    } else if (typeof dialog.close === 'function' && dialog.open) {
      dialog.close();
    }
    return true;
  }

  async function _executeCommand(payload) {
    const action = _normalizeAction(payload?.action);
    if (action === 'open_chat') {
      _openChatPage();
      scheduleReport('command-open-chat');
      return;
    }
    if (action === 'hard_refresh') {
      if (typeof window.BlueprintsHardRefresh?.run === 'function') {
        scheduleReport('command-hard-refresh-before');
        await window.BlueprintsHardRefresh.run();
      } else {
        throw new Error('Embedded hard refresh action is unavailable.');
      }
      return;
    }
    if (action === 'open_vad_dev') {
      if (typeof window.VadDevModal?.open === 'function') {
        window.VadDevModal.open();
      }
      scheduleReport('command-open-vad-dev');
      return;
    }
    if (action === 'close_vad_dev') {
      const ok = _closeDialog('vad-dev-modal');
      scheduleReport('command-close-vad-dev', MODAL_COMMAND_SETTLE_MS);
      return ok;
    }
    if (action === 'close_modal') {
      const ok = _closeDialog(payload?.modal_id);
      scheduleReport('command-close-modal', MODAL_COMMAND_SETTLE_MS);
      return ok;
    }
    if (action === 'open_page') {
      _openPage(payload);
      scheduleReport('command-open-page');
      return;
    }
    if (action === 'open_matrix_chat_room') {
      await _openMatrixChatRoom(payload);
      scheduleReport('command-open-matrix-chat-room');
      return true;
    }
    if (action === 'open_modal') {
      const ok = _openModal(payload);
      scheduleReport('command-open-modal', MODAL_COMMAND_SETTLE_MS);
      return ok;
    }
    if (action === 'open_doc') {
      await _openDoc(payload);
      scheduleReport('command-open-doc');
      return;
    }
    if (action === 'set_body_shade') {
      _setBodyShade(payload);
      scheduleReport('command-set-body-shade');
      return;
    }
    if (action === 'menu_function') {
      _runMenuFunction(payload);
      scheduleReport('command-menu-function');
      return;
    }
    if (action === 'open_synthesis' || action === 'open_probes' || action === 'open_settings' || action === 'open_dave' || action === 'open_kanban') {
      _runSelectorAction(action.replace(/^open_/, ''), payload?.event_kind || 'click');
      scheduleReport(`command-${action}`);
      return;
    }
    if (action === 'selector_action') {
      _runSelectorAction(payload?.selector_action, payload?.event_kind || 'click');
      scheduleReport('command-selector-action');
      return;
    }
    if (action === 'diagnostic_snapshot') {
      return _requestDiagnosticSnapshot(payload);
    }
  }

  function _handleCommandEvent(eventDetail) {
    const payload = _extractCommandPayload(eventDetail);
    if (!payload) return;
    if (payload?.schema && payload.schema !== 'xarta.active_browser.command.v1') return;
    if (!_commandTargetsThisTab(payload)) return;
    if (!_rememberCommand(payload)) return;
    _executeCommand(payload).catch(error => {
      _recordCommandResult(payload, false, error?.message || error);
      scheduleReport('command-error');
      console.warn('[active-browser] command failed', error);
    }).then(result => {
      if (result !== undefined) {
        _recordCommandResult(payload, result !== false, result === false ? 'Command returned false.' : '');
        const action = _normalizeAction(payload?.action);
        const delay = action === 'open_modal' || action === 'close_modal'
          ? MODAL_COMMAND_SETTLE_MS
          : REPORT_DEBOUNCE_MS;
        scheduleReport('command-result', delay);
      }
    });
  }

  function _currentPage() {
    const readiness = _pageReadiness();
    let page = null;
    if (typeof window.BlueprintsPageState?.current === 'function') {
      page = window.BlueprintsPageState.current() || {};
      return { ...page, ...readiness };
    }
    const activePanel = document.querySelector('.tab-panel.active[id^="tab-"]');
    return {
      group: '',
      tab: activePanel ? activePanel.id.replace(/^tab-/, '') : '',
      ...readiness,
    };
  }

  function _pageReadiness() {
    const activity = typeof window.BlueprintsApiActivity?.snapshot === 'function'
      ? window.BlueprintsApiActivity.snapshot()
      : null;
    if (!activity) {
      return {
        loading: false,
        ready: true,
        api_in_flight: 0,
        api_quiet_for_ms: 0,
      };
    }
    const inFlight = Math.max(0, Number(activity.in_flight || 0));
    const quietForMs = Math.max(0, Math.floor(Number(activity.quiet_for_ms || 0)));
    return {
      loading: inFlight > 0 || quietForMs < PAGE_READY_QUIET_MS,
      ready: inFlight === 0 && quietForMs >= PAGE_READY_QUIET_MS,
      api_in_flight: inFlight,
      api_quiet_for_ms: quietForMs,
      api_sequence: Math.max(0, Number(activity.sequence || 0)),
    };
  }

  function _openModals() {
    return Array.from(document.querySelectorAll('dialog[id]'))
      .filter(dialog => _dialogLooksOpen(dialog))
      .slice(0, 24)
      .map(dialog => {
        const title = dialog.querySelector('.hub-dialog-title-text, .hub-modal-title');
        let modalState = false;
        try {
          modalState = typeof dialog.matches === 'function' && dialog.matches(':modal');
        } catch (_) {}
        return {
          id: dialog.id,
          label: title ? title.textContent.trim() : '',
          open: true,
          native_open: !!dialog.open,
          modal: !!modalState,
          visible: _elementLooksVisible(dialog),
        };
      });
  }

  function _isDialog(node) {
    return typeof HTMLDialogElement !== 'undefined' && node instanceof HTMLDialogElement;
  }

  function _elementLooksVisible(node) {
    if (!node || node.hidden) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    const rect = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
    return !!(rect && rect.width > 0 && rect.height > 0);
  }

  function _dialogLooksOpen(dialog) {
    if (!_isDialog(dialog)) return false;
    if (dialog.open) return true;
    try {
      if (typeof dialog.matches === 'function' && dialog.matches(':modal')) return true;
    } catch (_) {}
    if (dialog.getAttribute('aria-hidden') === 'false' && _elementLooksVisible(dialog)) return true;
    if (dialog.classList.contains('is-open') && _elementLooksVisible(dialog)) return true;
    return false;
  }

  function _frontendVersion() {
    const configured = window.BLUEPRINTS_FRONTEND_VERSION || {};
    const controller = navigator.serviceWorker?.controller || null;
    return {
      app: configured.app || 'fallback-ui',
      asset_version: configured.asset_version || '',
      cache_mode: configured.cache_mode || '',
      service_worker_cache_version: _serviceWorkerVersion?.cache_version || '',
      service_worker_controller: !!controller,
      service_worker_state: controller?.state || '',
    };
  }

  function _media(query) {
    try {
      return !!(window.matchMedia && window.matchMedia(query).matches);
    } catch (_) {
      return false;
    }
  }

  function _viewportInfo() {
    const vv = window.visualViewport || null;
    const screenObj = window.screen || {};
    const orientation = screenObj.orientation || {};
    const maxTouchPoints = Number(navigator.maxTouchPoints || 0);
    return {
      innerWidth: Math.round(Number(window.innerWidth || 0)),
      innerHeight: Math.round(Number(window.innerHeight || 0)),
      devicePixelRatio: Number(window.devicePixelRatio || 1),
      screen: {
        width: Math.round(Number(screenObj.width || 0)),
        height: Math.round(Number(screenObj.height || 0)),
        availWidth: Math.round(Number(screenObj.availWidth || 0)),
        availHeight: Math.round(Number(screenObj.availHeight || 0)),
      },
      orientation: {
        type: orientation.type || '',
        angle: Number(orientation.angle || window.orientation || 0),
      },
      visualViewport: vv ? {
        width: Number(vv.width || 0),
        height: Number(vv.height || 0),
        scale: Number(vv.scale || 1),
        offsetLeft: Number(vv.offsetLeft || 0),
        offsetTop: Number(vv.offsetTop || 0),
        pageLeft: Number(vv.pageLeft || 0),
        pageTop: Number(vv.pageTop || 0),
      } : {},
      pointer: {
        primary: _media('(pointer: coarse)') ? 'coarse' : (_media('(pointer: fine)') ? 'fine' : 'none'),
        any: _media('(any-pointer: coarse)') ? 'coarse' : (_media('(any-pointer: fine)') ? 'fine' : 'none'),
        hover: _media('(hover: hover)') ? 'hover' : (_media('(hover: none)') ? 'none' : ''),
        anyHover: _media('(any-hover: hover)') ? 'hover' : (_media('(any-hover: none)') ? 'none' : ''),
        coarse: _media('(pointer: coarse)') || _media('(any-pointer: coarse)'),
        fine: _media('(pointer: fine)') || _media('(any-pointer: fine)'),
        touch: maxTouchPoints > 0 || ('ontouchstart' in window),
        maxTouchPoints,
      },
    };
  }

  function _voiceState() {
    const local = _voiceMode()?.getLocalState?.();
    return {
      stt_enabled: !!local?.stt_enabled,
      stt_mode: _cleanText(local?.stt_mode),
      tts_enabled: !!local?.tts_enabled,
    };
  }

  function _ttsRuntimeState() {
    const client = window.BlueprintsTtsClient || null;
    const announcer = (typeof BlueprintsModelChangeAnnouncer !== 'undefined')
      ? BlueprintsModelChangeAnnouncer
      : (window.BlueprintsModelChangeAnnouncer || null);
    return {
      client_available: !!client,
      client: typeof client?.getPlaybackState === 'function' ? client.getPlaybackState() : null,
      announcer_available: !!announcer,
      announcer: typeof announcer?.getRuntimeState === 'function' ? announcer.getRuntimeState() : null,
    };
  }

  function _gpuActivitySoundDiagnostic() {
    const gpuActivitySound = (typeof GpuActivitySound !== 'undefined')
      ? GpuActivitySound
      : (window.GpuActivitySound || null);
    if (!gpuActivitySound || typeof gpuActivitySound.getSnapshot !== 'function') {
      return { available: false };
    }
    try {
      return {
        available: true,
        snapshot: gpuActivitySound.getSnapshot(),
      };
    } catch (error) {
      return {
        available: true,
        error: _cleanText(error?.message || error).slice(0, 180),
      };
    }
  }

  function _personalSearchDiagnostic() {
    const personalSearch = (typeof BlueprintsPersonalSearch !== 'undefined')
      ? BlueprintsPersonalSearch
      : (window.BlueprintsPersonalSearch || null);
    if (!personalSearch || typeof personalSearch.snapshot !== 'function') {
      return { available: false };
    }
    try {
      return {
        available: true,
        snapshot: personalSearch.snapshot(),
      };
    } catch (error) {
      return {
        available: true,
        error: _cleanText(error?.message || error).slice(0, 180),
      };
    }
  }

  function _consumeDiagnostics() {
    const request = _pendingDiagnostics;
    if (!request) return null;
    _pendingDiagnostics = null;
    if (Date.now() > Number(request.expires_at_ms || 0)) return null;
    const diagnostics = {
      schema: 'xarta.active_browser.diagnostics.v1',
      command_id: request.command_id,
      requested_at_ms: request.requested_at_ms,
      captured_at_ms: Date.now(),
      sources: request.sources.slice(),
    };
    if (request.sources.includes('gpu_activity_sound')) {
      diagnostics.gpu_activity_sound = _gpuActivitySoundDiagnostic();
    }
    if (request.sources.includes('personal_search')) {
      diagnostics.personal_search = _personalSearchDiagnostic();
    }
    return diagnostics;
  }

  function _automationState() {
    const state = typeof window.BlueprintsHubMenuBridge?.getAutomationState === 'function'
      ? (window.BlueprintsHubMenuBridge.getAutomationState() || {})
      : {};
    const surfaces = state.surfaces && typeof state.surfaces === 'object'
      ? { ...state.surfaces }
      : {};
    const calendarSnapshot = typeof window.BlueprintsCalendarPage?.snapshot === 'function'
      ? window.BlueprintsCalendarPage.snapshot()
      : null;
    const todoSnapshot = typeof window.BlueprintsTodoPage?.snapshot === 'function'
      ? window.BlueprintsTodoPage.snapshot()
      : null;
    const kanbanSnapshot = typeof window.BlueprintsKanbanBoardPage?.snapshot === 'function'
      ? window.BlueprintsKanbanBoardPage.snapshot()
      : null;
    const personalSearchSnapshot = typeof window.BlueprintsPersonalSearch?.snapshot === 'function'
      ? window.BlueprintsPersonalSearch.snapshot()
      : null;
    if (calendarSnapshot && typeof calendarSnapshot === 'object') {
      surfaces.calendar = calendarSnapshot;
    } else if (!surfaces.calendar || typeof surfaces.calendar !== 'object') {
      surfaces.calendar = {};
    }
    if (todoSnapshot && typeof todoSnapshot === 'object') {
      surfaces.todo = todoSnapshot;
    } else if (!surfaces.todo || typeof surfaces.todo !== 'object') {
      surfaces.todo = {};
    }
    if (kanbanSnapshot && typeof kanbanSnapshot === 'object') {
      surfaces.kanban = kanbanSnapshot;
    } else if (!surfaces.kanban || typeof surfaces.kanban !== 'object') {
      surfaces.kanban = {};
    }
    if (personalSearchSnapshot && typeof personalSearchSnapshot === 'object') {
      surfaces.personal_search = personalSearchSnapshot;
    } else if (!surfaces.personal_search || typeof surfaces.personal_search !== 'object') {
      surfaces.personal_search = {};
    }
    const normalizedState = { ...state, surfaces };
    if (_lastCommandResult) {
      return { ...normalizedState, last_command: _lastCommandResult };
    }
    return normalizedState;
  }

  function _docsState() {
    if (typeof window.BlueprintsDocsViewer?.activeState === 'function') {
      return window.BlueprintsDocsViewer.activeState() || {};
    }
    return {};
  }

  function _bodyShadeState() {
    const activePanel = document.querySelector('#body-shade .tab-panel.active[id]');
    return {
      available: !!window.BodyShade,
      is_up: !!(document.body && document.body.classList.contains('shade-is-up')),
      state: document.body && document.body.classList.contains('shade-is-up') ? 'up' : 'down',
      active_panel_id: activePanel ? activePanel.id : '',
      handle_present: !!(activePanel && activePanel.querySelector('.body-shade-handle')),
    };
  }

  function _roundPx(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function _rectState(node) {
    if (!node || typeof node.getBoundingClientRect !== 'function') return null;
    const rect = node.getBoundingClientRect();
    return {
      left: _roundPx(rect.left),
      top: _roundPx(rect.top),
      right: _roundPx(rect.right),
      bottom: _roundPx(rect.bottom),
      width: _roundPx(rect.width),
      height: _roundPx(rect.height),
    };
  }

  function _layoutState() {
    const html = document.documentElement;
    const body = document.body;
    const scrolling = document.scrollingElement || html;
    const activePanel = document.querySelector('#body-shade .tab-panel.active[id]');
    const menuNav = document.getElementById('menu-zone-nav');
    const main = document.querySelector('main');
    const shell = activePanel ? activePanel.querySelector('.tab-scroll-shell') : null;
    const handle = activePanel ? activePanel.querySelector('.body-shade-handle') : null;
    const htmlStyle = html ? window.getComputedStyle(html) : null;
    const bodyStyle = body ? window.getComputedStyle(body) : null;
    const shellStyle = shell ? window.getComputedStyle(shell) : null;
    const panelRect = _rectState(activePanel);
    const menuRect = _rectState(menuNav);
    return {
      active_panel_id: activePanel ? activePanel.id : '',
      root: {
        scroll_element: scrolling ? scrolling.tagName : '',
        html_overflow_y: htmlStyle ? htmlStyle.overflowY : '',
        body_overflow_y: bodyStyle ? bodyStyle.overflowY : '',
        html_has_managed_scroll_tab: !!(html && html.classList.contains('has-managed-scroll-tab')),
        body_has_managed_scroll_tab: !!(body && body.classList.contains('has-managed-scroll-tab')),
        window_scroll_y: _roundPx(window.scrollY || 0),
        scroll_height: scrolling ? Math.round(scrolling.scrollHeight || 0) : 0,
        client_height: scrolling ? Math.round(scrolling.clientHeight || 0) : 0,
        body_scroll_height: body ? Math.round(body.scrollHeight || 0) : 0,
        html_scroll_height: html ? Math.round(html.scrollHeight || 0) : 0,
      },
      rects: {
        main: _rectState(main),
        menu_nav: menuRect,
        panel: panelRect,
        handle: _rectState(handle),
        shell: _rectState(shell),
      },
      shell: shell ? {
        overflow_y: shellStyle ? shellStyle.overflowY : '',
        client_height: Math.round(shell.clientHeight || 0),
        scroll_height: Math.round(shell.scrollHeight || 0),
        scrollbar_active: (shell.scrollHeight || 0) > (shell.clientHeight || 0) + 1,
      } : null,
      alignment: {
        panel_left_delta_from_menu: panelRect && menuRect ? _roundPx(panelRect.left - menuRect.left) : null,
        panel_right_delta_from_menu: panelRect && menuRect ? _roundPx(panelRect.right - menuRect.right) : null,
      },
    };
  }

  function _payload(options = {}) {
    const payload = {
      browser_id: _browserId(),
      browser_label: _browserLabel(),
      tab_id: _tabId(),
      page: _currentPage(),
      modals: _openModals(),
      viewport: _viewportInfo(),
      voice: _voiceState(),
      tts: _ttsRuntimeState(),
      visibility_state: document.visibilityState || 'unknown',
      has_focus: document.hasFocus ? document.hasFocus() : false,
      url_path: window.location.pathname || '',
      url_search: window.location.search || '',
      url_hash: window.location.hash || '',
      frontend: _frontendVersion(),
      automation: _automationState(),
      docs: _docsState(),
      body_shade: _bodyShadeState(),
      layout: _layoutState(),
      client_now_ms: Date.now(),
    };
    if (options.includeDiagnostics) {
      const diagnostics = _consumeDiagnostics();
      if (diagnostics) payload.diagnostics = diagnostics;
    }
    return payload;
  }

  async function _postReport(reason) {
    const payload = _payload({ includeDiagnostics: true });
    if (!payload.browser_id) return;
    const key = JSON.stringify({
      page: payload.page,
      modals: payload.modals,
      automation: payload.automation,
      docs: payload.docs,
      body_shade: payload.body_shade,
      layout: payload.layout,
      tts: payload.tts,
      viewport: payload.viewport,
      voice: payload.voice,
      visibility_state: payload.visibility_state,
      has_focus: payload.has_focus,
      frontend: payload.frontend,
      diagnostics: payload.diagnostics || null,
    });
    const now = Date.now();
    if (key === _lastReportKey && (now - _lastReportAt) < REPORT_HEARTBEAT_MS) return;

    _lastReportKey = key;
    _lastReportAt = now;
    try {
      const response = await apiFetch(REPORT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        deferDuringColumnResize: false,
        trackActivity: false,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      console.debug('[active-browser] view report failed', reason || '', error);
    }
  }

  function scheduleReport(reason = 'change', delayMs = REPORT_DEBOUNCE_MS) {
    if (_reportTimer) window.clearTimeout(_reportTimer);
    _reportTimer = window.setTimeout(() => {
      _reportTimer = null;
      _postReport(reason);
    }, Math.max(0, Number(delayMs || 0)));
  }

  function _schedulePageReadyReport() {
    if (_pageReadyTimer) window.clearTimeout(_pageReadyTimer);
    _pageReadyTimer = window.setTimeout(() => {
      _pageReadyTimer = null;
      scheduleReport('api-ready');
    }, PAGE_READY_QUIET_MS + REPORT_DEBOUNCE_MS + 50);
  }

  function _requestServiceWorkerVersion() {
    const controller = navigator.serviceWorker?.controller;
    if (!controller || typeof MessageChannel === 'undefined' || _serviceWorkerRequestPending) return;
    _serviceWorkerRequestPending = true;
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      _serviceWorkerRequestPending = false;
      channel.port1.close();
    }, 1200);
    channel.port1.onmessage = event => {
      window.clearTimeout(timeout);
      _serviceWorkerRequestPending = false;
      _serviceWorkerVersion = event.data || null;
      scheduleReport('service-worker-version');
      channel.port1.close();
    };
    try {
      controller.postMessage({ type: 'BP_SW_VERSION' }, [channel.port2]);
    } catch (_) {
      _serviceWorkerRequestPending = false;
      window.clearTimeout(timeout);
    }
  }

  function _wire() {
    document.addEventListener('blueprints:page-state-changed', event => {
      scheduleReport(event.detail?.reason || 'page-state');
      _schedulePageReadyReport();
    });
    document.addEventListener('blueprints:api-activity', event => {
      scheduleReport(event.detail?.reason ? `api-${event.detail.reason}` : 'api-activity');
      _schedulePageReadyReport();
    });
    document.addEventListener('close', event => {
      if (_isDialog(event.target)) scheduleReport('dialog-close');
    }, true);
    document.addEventListener('cancel', event => {
      if (_isDialog(event.target)) scheduleReport('dialog-cancel');
    }, true);
    if (typeof MutationObserver !== 'undefined' && document.body) {
      const dialogObserver = new MutationObserver(records => {
        if (records.some(record => _isDialog(record.target))) {
          scheduleReport('dialog-open-change');
        }
      });
      dialogObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['open'],
        subtree: true,
      });
    }
    document.addEventListener('visibilitychange', () => scheduleReport('visibility'));
    document.addEventListener('blueprints:tts-playback', () => scheduleReport('tts-playback'));
    document.addEventListener('blueprints:notification-speech-state', () => scheduleReport('tts-speech-state'));
    document.addEventListener('blueprints:notification-speech-suppressed', () => scheduleReport('tts-suppressed'));
    document.addEventListener('bodyshadechange', () => scheduleReport('body-shade'));
    window.addEventListener('focus', () => scheduleReport('focus'));
    window.addEventListener('blur', () => scheduleReport('blur'));
    window.addEventListener('resize', () => scheduleReport('viewport-resize'), { passive: true });
    window.addEventListener('orientationchange', () => scheduleReport('viewport-orientation'), { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => scheduleReport('visual-viewport-resize'), { passive: true });
      window.visualViewport.addEventListener('scroll', () => scheduleReport('visual-viewport-scroll'), { passive: true });
    }
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        _requestServiceWorkerVersion();
        scheduleReport('service-worker-controller');
      });
      navigator.serviceWorker.ready.then(() => {
        _requestServiceWorkerVersion();
        scheduleReport('service-worker-ready');
      }).catch(() => {});
    }
    _heartbeatTimer = window.setInterval(() => scheduleReport('heartbeat'), REPORT_HEARTBEAT_MS);
    _requestServiceWorkerVersion();
    scheduleReport('init');
  }

  function _wireCommandListener() {
    if (_commandListenerInstalled) return;
    _commandListenerInstalled = true;
    document.addEventListener('blueprints:event', event => {
      if (
        event.detail?.event_type === ACTIVE_BROWSER_COMMAND_EVENT
        || _looksLikeCommandPayload(event.detail)
        || _looksLikeCommandPayload(event.detail?.payload)
      ) {
        _handleCommandEvent(event.detail);
      }
    });
  }

  _wireCommandListener();
  _loadHandledCommands();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wire, { once: true });
  } else {
    _wire();
  }

  return Object.freeze({
    scheduleReport,
    reportNow: _postReport,
    currentPayload: () => _payload(),
  });
})();

window.BlueprintsActiveBrowserObserver = BlueprintsActiveBrowserObserver;
