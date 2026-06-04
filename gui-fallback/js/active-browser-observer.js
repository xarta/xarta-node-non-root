// active-browser-observer.js - app-wide Active Browser automation and view reports.

'use strict';

const BlueprintsActiveBrowserObserver = (() => {
  const REPORT_URL = '/api/v1/voice-mode/browser-view';
  const ACTIVE_BROWSER_COMMAND_EVENT = 'blueprints.active_browser.command';
  const REPORT_DEBOUNCE_MS = 300;
  const REPORT_HEARTBEAT_MS = 10000;
  const PAGE_READY_QUIET_MS = 350;
  const LS_HANDLED_COMMANDS = 'blueprints.active_browser.handled_commands';
  const HANDLED_COMMAND_TTL_MS = 5 * 60 * 1000;

  let _reportTimer = null;
  let _heartbeatTimer = null;
  let _lastReportKey = '';
  let _lastReportAt = 0;
  let _serviceWorkerVersion = null;
  let _serviceWorkerRequestPending = false;
  let _commandListenerInstalled = false;
  let _handledCommands = {};
  let _pageReadyTimer = null;

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
    if (action === 'modal') return 'open_modal';
    if (action === 'doc' || action === 'document') return 'open_doc';
    if (action === 'fn' || action === 'function' || action === 'menu_fn') return 'menu_function';
    if (action === 'synthesis') return 'open_synthesis';
    if (action === 'probes') return 'open_probes';
    if (action === 'settings') return 'open_settings';
    if (action === 'selector') return 'selector_action';
    return action;
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
      if (selectorAction === 'synthesis' || selectorAction === 'probes' || selectorAction === 'settings') {
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

  function _closeDialog(dialogId) {
    let dialog = null;
    const cleanId = _cleanText(dialogId);
    if (cleanId) {
      dialog = document.getElementById(cleanId);
    } else {
      const openDialogs = Array.from(document.querySelectorAll('dialog[id]'))
        .filter(node => node.open);
      dialog = openDialogs.length ? openDialogs[openDialogs.length - 1] : null;
    }
    if (!_isDialog(dialog) || !dialog.open) return false;
    if (typeof window.HubModal?.close === 'function') {
      window.HubModal.close(dialog);
    } else if (typeof dialog.close === 'function') {
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
      _closeDialog('vad-dev-modal');
      scheduleReport('command-close-vad-dev');
      return;
    }
    if (action === 'close_modal') {
      _closeDialog(payload?.modal_id);
      scheduleReport('command-close-modal');
      return;
    }
    if (action === 'open_page') {
      _openPage(payload);
      scheduleReport('command-open-page');
      return;
    }
    if (action === 'open_modal') {
      _openModal(payload);
      scheduleReport('command-open-modal');
      return;
    }
    if (action === 'open_doc') {
      await _openDoc(payload);
      scheduleReport('command-open-doc');
      return;
    }
    if (action === 'menu_function') {
      _runMenuFunction(payload);
      scheduleReport('command-menu-function');
      return;
    }
    if (action === 'open_synthesis' || action === 'open_probes' || action === 'open_settings') {
      _runSelectorAction(action.replace(/^open_/, ''), payload?.event_kind || 'click');
      scheduleReport(`command-${action}`);
      return;
    }
    if (action === 'selector_action') {
      _runSelectorAction(payload?.selector_action, payload?.event_kind || 'click');
      scheduleReport('command-selector-action');
    }
  }

  function _handleCommandEvent(eventDetail) {
    const payload = eventDetail?.payload || eventDetail || {};
    if (payload?.schema && payload.schema !== 'xarta.active_browser.command.v1') return;
    if (!_commandTargetsThisTab(payload)) return;
    if (!_rememberCommand(payload)) return;
    _executeCommand(payload).catch(error => {
      console.warn('[active-browser] command failed', error);
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
      .filter(dialog => !!dialog.open)
      .slice(0, 24)
      .map(dialog => {
        const title = dialog.querySelector('.hub-dialog-title-text, .hub-modal-title');
        return {
          id: dialog.id,
          label: title ? title.textContent.trim() : '',
          open: true,
        };
      });
  }

  function _isDialog(node) {
    return typeof HTMLDialogElement !== 'undefined' && node instanceof HTMLDialogElement;
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

  function _automationState() {
    if (typeof window.BlueprintsHubMenuBridge?.getAutomationState === 'function') {
      return window.BlueprintsHubMenuBridge.getAutomationState() || {};
    }
    return {};
  }

  function _docsState() {
    if (typeof window.BlueprintsDocsViewer?.activeState === 'function') {
      return window.BlueprintsDocsViewer.activeState() || {};
    }
    return {};
  }

  function _payload() {
    return {
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
      client_now_ms: Date.now(),
    };
  }

  async function _postReport(reason) {
    const payload = _payload();
    if (!payload.browser_id) return;
    const key = JSON.stringify({
      page: payload.page,
      modals: payload.modals,
      automation: payload.automation,
      docs: payload.docs,
      tts: payload.tts,
      viewport: payload.viewport,
      voice: payload.voice,
      visibility_state: payload.visibility_state,
      has_focus: payload.has_focus,
      frontend: payload.frontend,
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

  function scheduleReport(reason = 'change') {
    if (_reportTimer) window.clearTimeout(_reportTimer);
    _reportTimer = window.setTimeout(() => {
      _reportTimer = null;
      _postReport(reason);
    }, REPORT_DEBOUNCE_MS);
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
      if (event.detail?.event_type === ACTIVE_BROWSER_COMMAND_EVENT) {
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
    currentPayload: _payload,
  });
})();

window.BlueprintsActiveBrowserObserver = BlueprintsActiveBrowserObserver;
