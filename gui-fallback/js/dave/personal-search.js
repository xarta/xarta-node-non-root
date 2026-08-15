// Shared Personal Time Activity search strip.

'use strict';

const BlueprintsPersonalSearch = (() => {
  const state = {
    adapters: {},
    surfaces: {},
    graph: {
      open: false,
      sourceRef: '',
      title: '',
      loading: false,
      error: '',
      links: [],
      sync: null,
    },
    scheduler: {
      payload: null,
      error: '',
      inFlight: null,
      runNowInFlight: null,
      timer: null,
      lastRequestedAt: 0,
      clockOffsetMs: 0,
      liveMessage: '',
      lastLiveKey: '',
      visibilityWired: false,
    },
  };

  const schedulerStatusSchema = 'xarta.personal.search.scheduler-status.v1';
  const schedulerStatusUrl = '/api/v1/personal/search/scheduler/status';
  const schedulerRunNowUrl = '/api/v1/personal/search/scheduler/run-now';
  const schedulerPollMs = 15000;

  const surfaceDefaults = {
    diary: { restrictToRange: false },
    calendar: { restrictToRange: false },
    todo: { restrictToRange: false },
    imports: { restrictToRange: false },
    kanban: { restrictToRange: false },
  };

  const escHtml = typeof esc === 'function'
    ? esc
    : value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[ch]));

  function schedulerHosts() {
    return Array.from(document.querySelectorAll('[data-personal-search-sync-status]'));
  }

  function finiteNumber(value) {
    if (value == null || value === '' || typeof value === 'boolean') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function timestampMs(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function schedulerNowMs() {
    return Date.now() + state.scheduler.clockOffsetMs;
  }

  function timestampAgeSeconds(value) {
    const parsed = timestampMs(value);
    if (parsed == null) return null;
    return Math.max(0, Math.floor((schedulerNowMs() - parsed) / 1000));
  }

  function formatAge(seconds) {
    if (!Number.isFinite(seconds)) return 'unknown';
    const clean = Math.max(0, Math.floor(seconds));
    if (clean < 5) return 'now';
    if (clean < 60) return `${clean}s ago`;
    if (clean < 3600) return `${Math.floor(clean / 60)}m ago`;
    if (clean < 86400) return `${Math.floor(clean / 3600)}h ago`;
    return `${Math.floor(clean / 86400)}d ago`;
  }

  function formatUntil(value) {
    const parsed = timestampMs(value);
    if (parsed == null) return 'not scheduled';
    const seconds = Math.ceil((parsed - schedulerNowMs()) / 1000);
    if (seconds <= 0) return 'due now';
    if (seconds < 60) return `in ${seconds}s`;
    if (seconds < 3600) return `in ${Math.ceil(seconds / 60)}m`;
    return `in ${Math.ceil(seconds / 3600)}h`;
  }

  function exactTime(value) {
    const parsed = timestampMs(value);
    if (parsed == null) return 'No timestamp reported';
    return new Date(parsed).toLocaleString();
  }

  function newerFailure(provider) {
    const failureAt = timestampMs(provider?.latest_failure?.finished_at);
    if (failureAt == null) return false;
    const successAt = timestampMs(provider?.latest_success?.finished_at);
    return successAt == null || failureAt > successAt;
  }

  function latestIndexTimestamp(provider) {
    const success = provider?.latest_success;
    if (!success) return '';
    return Object.prototype.hasOwnProperty.call(success.result || {}, 'index_updated_at')
      ? success.result.index_updated_at
      : success.finished_at;
  }

  function schedulerViewModel(payload) {
    const scheduler = payload?.scheduler;
    const provider = payload?.provider;
    const schedule = payload?.schedule;
    const thresholds = payload?.thresholds;
    const heartbeatThreshold = finiteNumber(thresholds?.heartbeat_stale_seconds);
    const successThreshold = finiteNumber(thresholds?.success_stale_seconds);
    const heartbeatAge = timestampAgeSeconds(provider?.last_seen_at);
    const successAge = timestampAgeSeconds(provider?.latest_success?.finished_at);
    const indexAge = timestampAgeSeconds(latestIndexTimestamp(provider));
    const failureAge = timestampAgeSeconds(provider?.latest_failure?.finished_at);
    const queued = finiteNumber(provider?.queued_runs);
    const running = finiteNumber(provider?.running_runs);
    const queueCount = queued == null ? 0 : Math.max(0, Math.floor(queued));
    const runningCount = running == null ? 0 : Math.max(0, Math.floor(running));
    const busy = queueCount > 0 || runningCount > 0;
    let tone = 'fault';
    let label = 'Sync status unavailable';
    let detail = 'No scheduler status has been received.';

    if (!payload) {
      tone = state.scheduler.error ? 'fault' : 'checking';
      label = state.scheduler.error ? 'Sync status unavailable' : 'Checking search sync';
      detail = state.scheduler.error
        ? 'The status request failed. Search may be out of date.'
        : 'Waiting for the scheduler status endpoint.';
    } else if (payload.schema !== schedulerStatusSchema) {
      label = 'Unknown status format';
      detail = 'The scheduler status response is not the supported v1 contract.';
    } else if (state.scheduler.error) {
      label = 'Sync status check failed';
      detail = 'The latest status request failed. The measurements shown are from the last response.';
    } else if (!scheduler || scheduler.available !== true) {
      label = 'Scheduler unavailable';
      detail = 'The application cannot reach xarta-scheduler.';
    } else if (!scheduler.health || scheduler.health.ok !== true) {
      label = 'Scheduler unhealthy';
      detail = 'xarta-scheduler reported an unhealthy service state.';
    } else if (!schedule || !schedule.schedule_id) {
      label = 'Search sync not scheduled';
      detail = 'No scheduler-owned Personal Search schedule was found.';
    } else if (schedule.target_key !== 'blueprints_personal_search_sync_v1') {
      label = 'Wrong search sync schedule';
      detail = 'The reported schedule is not the typed Personal Search target.';
    } else if (schedule.enabled !== true) {
      label = 'Search sync disabled';
      detail = 'The Personal Search schedule exists but is disabled.';
    } else if (!provider || provider.available !== true) {
      label = 'Search sync worker unavailable';
      detail = 'The typed Personal Search provider is not available.';
    } else if (provider.provider_id !== 'blueprints-personal-search') {
      label = 'Wrong search sync provider';
      detail = 'The reported provider is not the typed Personal Search provider.';
    } else if (provider.source_of_truth !== 'xarta-scheduler-postgresql') {
      label = 'Search sync provenance missing';
      detail = 'The provider status is not identified as scheduler-owned PostgreSQL state.';
    } else if (!String(provider.state || '').trim()) {
      label = 'Search sync worker state missing';
      detail = 'The typed provider did not report a worker state.';
    } else if (queued == null || running == null || queued < 0 || running < 0) {
      label = 'Scheduler work state missing';
      detail = 'The provider did not report usable queued and running run counts.';
    } else if (!heartbeatThreshold || heartbeatAge == null) {
      label = 'Worker heartbeat missing';
      detail = 'A usable worker heartbeat and staleness threshold were not reported.';
    } else if (heartbeatAge > heartbeatThreshold) {
      label = 'Worker heartbeat stale';
      detail = `The worker last reported ${formatAge(heartbeatAge)}; the limit is ${heartbeatThreshold}s.`;
    } else if (String(provider.state || '').toLowerCase() === 'degraded') {
      label = 'Search sync degraded';
      detail = 'The Personal Search provider reported a degraded state.';
    } else if (newerFailure(provider)) {
      label = busy ? 'Latest sync failed; retry pending' : 'Latest search sync failed';
      detail = busy
        ? 'The latest terminal run failed and scheduler work is now queued or running.'
        : 'The latest terminal run failed after the last successful sync.';
    } else if (!provider.latest_success) {
      tone = busy ? 'busy' : 'fault';
      label = runningCount > 0 ? 'First search sync running' : (queueCount > 0 ? 'First search sync queued' : 'No successful search sync');
      detail = busy
        ? 'The index has no completed sync yet; scheduler work is genuinely queued or running.'
        : 'The index has no successful sync and no scheduler work is reported.';
    } else if (!successThreshold || successAge == null) {
      label = 'Index freshness unknown';
      detail = 'A usable successful-sync timestamp and staleness threshold were not reported.';
    } else if (successAge > successThreshold) {
      label = busy ? 'Search index stale; catching up' : 'Search index stale';
      detail = `The index was last verified current ${formatAge(successAge)}; the limit is ${successThreshold}s.`;
    } else {
      tone = busy ? 'busy' : 'ok';
      label = runningCount > 0 ? 'Search sync running' : (queueCount > 0 ? 'Search sync queued' : 'Search index current');
      detail = busy
        ? 'The current index is within its freshness limit while more scheduler work is queued or running.'
        : 'Scheduler, provider heartbeat, and successful index sync are within their reported limits.';
    }

    return {
      tone, label, detail, scheduler, provider, schedule,
      heartbeatThreshold, successThreshold, heartbeatAge, successAge, indexAge, failureAge,
      queueCount, runningCount,
    };
  }

  function schedulerMetric(label, value, title, kind) {
    return `
      <div class="personal-search-sync__metric" data-kind="${escHtml(kind)}" title="${escHtml(title)}">
        <span class="personal-search-sync__metric-label">${escHtml(label)}</span>
        <strong>${escHtml(value)}</strong>
      </div>
    `;
  }

  function schedulerStatusHtml() {
    const model = schedulerViewModel(state.scheduler.payload);
    const scheduler = model.scheduler || {};
    const provider = model.provider || {};
    const schedule = model.schedule || {};
    const version = scheduler.version ? `v${scheduler.version}` : '';
    const schedulerValue = scheduler.available === true
      ? (scheduler.health?.ok === true ? `Online${version ? ` ${version}` : ''}` : 'Unhealthy')
      : 'Unavailable';
    const heartbeatValue = model.heartbeatAge == null ? 'No heartbeat' : `Seen ${formatAge(model.heartbeatAge)}`;
    const skipped = provider.latest_success?.result?.skipped === true;
    const successValue = model.successAge == null
      ? 'No completed sync'
      : (skipped
        ? `Verified ${formatAge(model.successAge)} · updated ${formatAge(model.indexAge)}`
        : `Updated ${formatAge(model.indexAge ?? model.successAge)}`);
    const workParts = [];
    if (model.runningCount) workParts.push(`${model.runningCount} running`);
    if (model.queueCount) workParts.push(`${model.queueCount} queued`);
    const workValue = workParts.length
      ? workParts.join(' · ')
      : (newerFailure(provider) ? `Failed ${formatAge(model.failureAge)}` : `Next ${formatUntil(schedule.next_run_at)}`);
    const heartbeatTitle = model.heartbeatAge == null
      ? 'Provider supplied no usable last_seen_at timestamp.'
      : `Provider ${provider.provider_id || 'blueprints-personal-search'} last reported ${exactTime(provider.last_seen_at)}; browser-computed age ${model.heartbeatAge}s; stale after ${model.heartbeatThreshold ?? 'unknown'}s.`;
    const indexTimestamp = latestIndexTimestamp(provider);
    const successTitle = model.successAge == null
      ? 'Provider supplied no successful run.'
      : `Index last verified current ${exactTime(provider.latest_success?.finished_at)}; browser-computed verification age ${model.successAge}s; stale after ${model.successThreshold ?? 'unknown'}s. Index physically updated ${exactTime(indexTimestamp)}.${skipped ? ' The latest successful run truthfully skipped rewriting because the source signature was unchanged.' : ''} Latest successful scheduler run ${provider.latest_success?.run_id || ''}.`;
    const workTitleParts = [
      `Schedule ${schedule.schedule_id || 'missing'}; ${schedule.enabled === true ? 'enabled' : 'not enabled'}.`,
      schedule.schedule_definition?.seconds != null ? `Interval ${schedule.schedule_definition.seconds}s.` : '',
      schedule.next_run_at ? `Next run ${exactTime(schedule.next_run_at)}.` : 'No next run reported.',
      `${model.runningCount} running; ${model.queueCount} queued.`,
      provider.oldest_queue_lag_seconds != null ? `Oldest queue lag ${provider.oldest_queue_lag_seconds}s.` : '',
      newerFailure(provider) ? `Latest failure finished ${exactTime(provider.latest_failure?.finished_at)}.` : '',
    ].filter(Boolean);
    const runLabel = state.scheduler.runNowInFlight ? 'Queueing…' : 'Run now';
    const liveText = state.scheduler.liveMessage || '';
    return `
      <div class="personal-search-sync__header">
        <div class="personal-search-sync__summary" title="${escHtml(model.detail)}">
          <span class="personal-search-sync__lamp" aria-hidden="true"></span>
          <span><strong>Search sync</strong><span>${escHtml(model.label)}</span></span>
        </div>
        <div class="personal-search-sync__actions">
          <button class="personal-search-sync__run" type="button" data-personal-search-sync-run${state.scheduler.runNowInFlight ? ' disabled' : ''} title="Queue one scheduler-owned Personal Search sync">${escHtml(runLabel)}</button>
          <button class="personal-search-sync__help" type="button" data-personal-search-sync-help aria-label="How search sync works" title="How search sync works">?</button>
        </div>
      </div>
      <div class="personal-search-sync__flow" aria-label="Search sync pipeline status">
        ${schedulerMetric('Scheduler', schedulerValue, scheduler.available === true ? `xarta-scheduler ${version || 'version not reported'}; health ${scheduler.health?.ok === true ? 'ok' : 'not ok'}.` : 'xarta-scheduler is unavailable.', 'scheduler')}
        ${schedulerMetric('Provider', heartbeatValue, heartbeatTitle, 'provider')}
        ${schedulerMetric('Index', successValue, successTitle, 'index')}
        ${schedulerMetric('Work', workValue, workTitleParts.join(' '), 'work')}
      </div>
      <span class="personal-search-sync__sr" role="status" aria-live="polite" aria-atomic="true">${escHtml(liveText)}</span>
    `;
  }

  function renderSchedulerStatus() {
    const tone = schedulerViewModel(state.scheduler.payload).tone;
    schedulerHosts().forEach((host, index) => {
      host.dataset.tone = tone;
      const liveMessage = state.scheduler.liveMessage;
      if (index > 0) state.scheduler.liveMessage = '';
      host.innerHTML = schedulerStatusHtml();
      state.scheduler.liveMessage = liveMessage;
    });
    state.scheduler.liveMessage = '';
  }

  function updateSchedulerLiveMessage() {
    const model = schedulerViewModel(state.scheduler.payload);
    const key = `${model.tone}:${model.label}`;
    if (key !== state.scheduler.lastLiveKey) {
      state.scheduler.lastLiveKey = key;
      state.scheduler.liveMessage = `Search sync: ${model.label}.`;
    }
  }

  function clearSchedulerTimer() {
    if (state.scheduler.timer) window.clearTimeout(state.scheduler.timer);
    state.scheduler.timer = null;
  }

  function scheduleSchedulerPoll() {
    clearSchedulerTimer();
    if (!schedulerHosts().length || document.visibilityState === 'hidden') return;
    state.scheduler.timer = window.setTimeout(() => {
      state.scheduler.timer = null;
      void refreshSchedulerStatus({ force: true });
    }, schedulerPollMs);
  }

  async function refreshSchedulerStatus(options = {}) {
    if (state.scheduler.inFlight) return state.scheduler.inFlight;
    if (!schedulerHosts().length) return null;
    const recentlyRequested = Date.now() - state.scheduler.lastRequestedAt < 2000;
    if (!options.force && recentlyRequested && state.scheduler.payload) {
      renderSchedulerStatus();
      scheduleSchedulerPoll();
      return state.scheduler.payload;
    }
    state.scheduler.lastRequestedAt = Date.now();
    const request = (async () => {
      try {
        const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
        const response = await fetcher(schedulerStatusUrl);
        if (!response.ok) throw new Error('scheduler status request failed');
        const payload = await response.json();
        const checkedAt = timestampMs(payload?.checked_at);
        if (checkedAt != null) state.scheduler.clockOffsetMs = checkedAt - Date.now();
        state.scheduler.payload = payload;
        state.scheduler.error = '';
      } catch (error) {
        state.scheduler.error = 'status-request-failed';
      } finally {
        state.scheduler.inFlight = null;
        updateSchedulerLiveMessage();
        renderSchedulerStatus();
        scheduleSchedulerPoll();
      }
      return state.scheduler.payload;
    })();
    state.scheduler.inFlight = request;
    renderSchedulerStatus();
    return request;
  }

  async function runSchedulerNow() {
    if (state.scheduler.runNowInFlight) return state.scheduler.runNowInFlight;
    state.scheduler.liveMessage = 'Queueing a Personal Search sync.';
    const request = (async () => {
      try {
        renderSchedulerStatus();
        const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
        const response = await fetcher(schedulerRunNowUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (!response.ok) throw new Error('scheduler run-now request failed');
        const payload = await response.json();
        const status = String(payload?.run?.status || '').toLowerCase();
        state.scheduler.liveMessage = status === 'running'
          ? 'Personal Search sync is running.'
          : 'Personal Search sync queued.';
      } catch (error) {
        state.scheduler.liveMessage = 'Could not queue the Personal Search sync.';
      } finally {
        state.scheduler.runNowInFlight = null;
        renderSchedulerStatus();
        await refreshSchedulerStatus({ force: true });
      }
    })();
    state.scheduler.runNowInFlight = request;
    renderSchedulerStatus();
    return request;
  }

  function ensureSchedulerHelpDialog() {
    let dialog = document.getElementById('personal-search-sync-help-modal');
    if (dialog) return dialog;
    const host = document.createElement('div');
    host.innerHTML = `
      <dialog id="personal-search-sync-help-modal" class="hub-modal hub-dialog personal-search-sync-help-modal" data-tone="info">
        <div class="hub-modal-header">
          <h2 class="hub-modal-title">
            <span class="hub-dialog-badge">HELP</span>
            <span class="hub-dialog-title-text">How Search stays current</span>
          </h2>
          <button class="hub-modal-close hub-dialog-close" type="button" aria-label="Close">&#10005;</button>
        </div>
        <div class="hub-modal-body">
          <p class="personal-search-sync-help__intro">Search reads a separate index. xarta-scheduler keeps that index aligned with the records owned by Diary, Calendar, ToDo, Imports, and Kanban.</p>
          <div class="personal-search-sync-help__flow" aria-label="Search indexing pipeline">
            <div><strong>Source records</strong><span>Apps remain authoritative</span></div>
            <span aria-hidden="true">→</span>
            <div><strong>Occurrence</strong><span>Scheduler queues work</span></div>
            <span aria-hidden="true">→</span>
            <div><strong>Typed provider</strong><span>Worker performs sync</span></div>
            <span aria-hidden="true">→</span>
            <div><strong>Search index</strong><span>Search reads here</span></div>
          </div>
          <section class="personal-search-sync-help__card">
            <h3>What the indicator means</h3>
            <p><strong>Current</strong> means the scheduler is healthy, the provider heartbeat is recent, and a successful sync has recently verified that the index matches its sources. An unchanged source signature can safely skip rewriting the index; in that case the indicator shows the fresh verification separately and retains the genuine earlier index-update time instead of pretending the index changed. <strong>Queued</strong> or <strong>running</strong> is scheduler-owned work in progress. A fault means a required component, heartbeat, or successful verification is absent, stale, disabled, degraded, or failed.</p>
          </section>
          <section class="personal-search-sync-help__card">
            <h3>Run now</h3>
            <p><strong>Run now</strong> asks xarta-scheduler to queue one sync. It does not run work in the browser and it does not claim success; the indicator changes only when the backend reports genuine queue, run, heartbeat, and completion state.</p>
          </section>
          <p class="personal-search-sync-help__note">A Search can return no results when its index is behind even though source records are visible on a page. The status strip makes that condition observable without changing the source data.</p>
        </div>
      </dialog>
    `.trim();
    dialog = host.firstElementChild;
    document.body.appendChild(dialog);
    if (typeof HubModal !== 'undefined') HubModal.init(document.body);
    return dialog;
  }

  function openSchedulerHelp() {
    const dialog = ensureSchedulerHelpDialog();
    if (typeof HubModal !== 'undefined') HubModal.open(dialog);
    else if (typeof dialog.showModal === 'function') dialog.showModal();
  }

  function schedulerStatusSurfaceHtml() {
    return '<section class="personal-search-sync" data-personal-search-sync-status role="status" aria-live="off" aria-label="Search sync status"></section>';
  }

  function ensureSchedulerStatus() {
    renderSchedulerStatus();
    if (!state.scheduler.visibilityWired) {
      state.scheduler.visibilityWired = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          clearSchedulerTimer();
          return;
        }
        void refreshSchedulerStatus({ force: true });
      });
    }
    void refreshSchedulerStatus();
  }

  function adapterFor(surface) {
    return state.adapters[surface] || {};
  }

  function filterSurfaceFor(surface) {
    return adapterFor(surface).filterSurface || `${surface}-search`;
  }

  function selectedTags(surface) {
    if (!window.PersonalFilters?.getSelectedIds) return [];
    return window.PersonalFilters.getSelectedIds(filterSurfaceFor(surface)) || [];
  }

  function surfaceState(surface) {
    const defaults = surfaceDefaults[surface] || { restrictToRange: false };
    if (!state.surfaces[surface]) {
      state.surfaces[surface] = {
        query: '',
        restrictToRange: Boolean(defaults.restrictToRange),
        rangeStart: '',
        rangeEnd: '',
        timeStart: '',
        timeEnd: '',
        allDay: true,
        rangeUserSet: false,
        loading: false,
        loadingEnhanced: false,
        error: '',
        results: [],
        subsystems: {},
        requestId: 0,
      };
    }
    return state.surfaces[surface];
  }

  function setStatus(surface, text, tone = '') {
    document.querySelectorAll(`[data-personal-search-status="${surface}"]`).forEach(node => {
      node.textContent = text;
      node.dataset.tone = tone;
    });
  }

  function fallbackRange(surface) {
    if (surface === 'calendar' && window.BlueprintsCalendarPage?.snapshot) {
      const snapshot = window.BlueprintsCalendarPage.snapshot();
      return {
        start: snapshot.range_start || '',
        end: snapshot.range_end || snapshot.range_start || '',
        label: snapshot.range_label || '',
      };
    }
    if (surface === 'diary') {
      const date = document.getElementById('diary-date-input')?.value || '';
      return { start: date, end: date, label: date };
    }
    return { start: '', end: '', label: '' };
  }

  function rangeFor(surface) {
    const adapter = adapterFor(surface);
    if (typeof adapter.getRange === 'function') {
      const range = adapter.getRange() || {};
      return {
        start: range.start || range.date_start || '',
        end: range.end || range.date_end || range.start || range.date_start || '',
        label: range.label || '',
      };
    }
    return fallbackRange(surface);
  }

  function rangeControlsFor(surface) {
    return Boolean(adapterFor(surface).rangeControls);
  }

  function cleanDate(value) {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  }

  function parseDate(value) {
    const clean = cleanDate(value);
    if (!clean) return null;
    const [year, month, day] = clean.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  function dateIso(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function addMonthsClamped(date, months) {
    const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(date.getDate(), lastDay));
    return target;
  }

  function orderedRange(start, end) {
    const cleanStart = cleanDate(start);
    const cleanEnd = cleanDate(end || start);
    if (!cleanStart && !cleanEnd) return { start: '', end: '' };
    if (!cleanStart) return { start: cleanEnd, end: cleanEnd };
    if (!cleanEnd) return { start: cleanStart, end: cleanStart };
    return cleanStart <= cleanEnd
      ? { start: cleanStart, end: cleanEnd }
      : { start: cleanEnd, end: cleanStart };
  }

  function fallbackPresetRange(surface, preset) {
    const data = surfaceState(surface);
    const anchor = parseDate(data.rangeStart || rangeFor(surface).start || dateIso(new Date())) || new Date();
    if (preset === 'month') {
      return orderedRange(
        dateIso(new Date(anchor.getFullYear(), anchor.getMonth(), 1)),
        dateIso(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0))
      );
    }
    return orderedRange(
      dateIso(new Date(anchor.getFullYear(), 0, 1)),
      dateIso(new Date(anchor.getFullYear(), 11, 31))
    );
  }

  function presetRangeFor(surface, preset) {
    const adapter = adapterFor(surface);
    if (typeof adapter.getPresetRange === 'function') {
      const range = adapter.getPresetRange(preset) || {};
      const ordered = orderedRange(range.start || range.date_start, range.end || range.date_end);
      if (ordered.start || ordered.end) return ordered;
    }
    return fallbackPresetRange(surface, preset);
  }

  function applyRangePreset(surface, preset) {
    if (!rangeControlsFor(surface)) return;
    const data = surfaceState(surface);
    const range = presetRangeFor(surface, preset);
    data.rangeStart = range.start;
    data.rangeEnd = range.end || range.start;
    data.rangeUserSet = true;
    syncRangeInputs(surface);
    run(surface);
  }

  function applyEndOffset(surface, months) {
    if (!rangeControlsFor(surface)) return;
    const data = surfaceState(surface);
    if (!data.rangeStart) syncRangeFromAdapter(surface);
    const start = parseDate(data.rangeStart);
    if (!start) return;
    data.rangeEnd = dateIso(addMonthsClamped(start, months));
    data.rangeUserSet = true;
    syncRangeInputs(surface);
    run(surface);
  }

  function syncQueryInputs(surface) {
    const data = surfaceState(surface);
    document.querySelectorAll(`[data-personal-search-query="${surface}"]`).forEach(input => {
      input.value = data.query || '';
    });
  }

  function hasUserSearchState(surface, data = surfaceState(surface)) {
    return Boolean(
      data.query
      || data.rangeUserSet
      || selectedTags(surface).length
      || data.results.length
      || data.error
    );
  }

  function snapshotSearchState(surface) {
    const data = surfaceState(surface);
    return {
      query: data.query,
      restrictToRange: data.restrictToRange,
      rangeStart: data.rangeStart,
      rangeEnd: data.rangeEnd,
      timeStart: data.timeStart,
      timeEnd: data.timeEnd,
      allDay: data.allDay,
      rangeUserSet: data.rangeUserSet,
      results: data.results,
      subsystems: data.subsystems,
      error: data.error,
    };
  }

  function restoreSearchState(surface, saved) {
    if (!saved) return;
    const data = surfaceState(surface);
    data.query = saved.query;
    data.restrictToRange = saved.restrictToRange;
    data.rangeStart = saved.rangeStart;
    data.rangeEnd = saved.rangeEnd;
    data.timeStart = saved.timeStart;
    data.timeEnd = saved.timeEnd;
    data.allDay = saved.allDay;
    data.rangeUserSet = saved.rangeUserSet;
    data.results = saved.results;
    data.subsystems = saved.subsystems;
    data.error = saved.error;
    syncQueryInputs(surface);
    syncRangeInputs(surface);
    renderResults(surface);
    renderFilterSummaries(surface);
  }

  function syncRangeInputs(surface) {
    if (!rangeControlsFor(surface)) return;
    const data = surfaceState(surface);
    document.querySelectorAll(`[data-personal-search-surface="${surface}"]`).forEach(root => {
      const start = root.querySelector('[data-personal-search-start-date]');
      const end = root.querySelector('[data-personal-search-end-date]');
      const startTime = root.querySelector('[data-personal-search-start-time]');
      const endTime = root.querySelector('[data-personal-search-end-time]');
      const allDay = root.querySelector('[data-personal-search-all-day]');
      if (start) start.value = data.rangeStart || '';
      if (end) end.value = data.rangeEnd || data.rangeStart || '';
      if (startTime) {
        startTime.value = data.timeStart || '';
        startTime.disabled = data.allDay;
      }
      if (endTime) {
        endTime.value = data.timeEnd || '';
        endTime.disabled = data.allDay;
      }
      if (allDay) allDay.checked = data.allDay !== false;
    });
  }

  function syncRangeFromAdapter(surface, options = {}) {
    if (!rangeControlsFor(surface)) return null;
    const data = surfaceState(surface);
    const force = Boolean(options.force) && !hasUserSearchState(surface, data);
    const range = rangeFor(surface);
    const next = orderedRange(range.start, range.end);
    if (force || !data.rangeStart) data.rangeStart = next.start;
    if (force || !data.rangeEnd) data.rangeEnd = next.end || next.start;
    const ordered = orderedRange(data.rangeStart, data.rangeEnd);
    data.rangeStart = ordered.start;
    data.rangeEnd = ordered.end;
    syncRangeInputs(surface);
    return ordered;
  }

  function effectiveRange(surface, data) {
    if (rangeControlsFor(surface)) {
      return orderedRange(data.rangeStart, data.rangeEnd);
    }
    if (!data.restrictToRange) return { start: '', end: '' };
    const range = rangeFor(surface);
    return orderedRange(range.start, range.end);
  }

  function hasEffectiveRange(surface, data) {
    const range = effectiveRange(surface, data);
    return Boolean(range.start || range.end);
  }

  function shouldRunEnhancedSearch(surface, data) {
    return Boolean(data.query.trim());
  }

  function apiUrl(surface, data, options = {}) {
    const url = new URL('/api/v1/personal/search', window.location.origin);
    if (data.query) url.searchParams.set('q', data.query);
    if (options.tag) url.searchParams.set('tag', options.tag);
    const range = effectiveRange(surface, data);
    if (range.start) url.searchParams.set('date_start', range.start);
    if (range.end) url.searchParams.set('date_end', range.end);
    url.searchParams.set('limit', '40');
    url.searchParams.set('include_vector', options.includeVector === false ? 'false' : 'true');
    url.searchParams.set('rerank_results', options.rerankResults === false ? 'false' : 'true');
    url.searchParams.set('sync', options.sync === true ? 'true' : 'false');
    return `${url.pathname}${url.search}`;
  }

  function searchLabel(surface) {
    const tags = selectedTags(surface);
    if (tags.length) return `${tags.length} filter${tags.length === 1 ? '' : 's'}`;
    if (rangeControlsFor(surface)) {
      const range = effectiveRange(surface, surfaceState(surface));
      if (range.start && range.end && range.start !== range.end) return `${range.start} to ${range.end}`;
      if (range.start) return range.start;
    }
    if (surfaceState(surface).restrictToRange) return 'shown period';
    return 'Ready';
  }

  function filterSummaryHtml(surface) {
    const filterSurface = filterSurfaceFor(surface);
    if (window.PersonalFilters?.summaryHtml) {
      return window.PersonalFilters.summaryHtml(filterSurface, { prefix: 'Filter:', emptyLabel: 'all entries' });
    }
    return '<span class="personal-filter-summary"><span class="personal-filter-summary__label">Filter:</span><span class="personal-filter-summary__empty">all entries</span></span>';
  }

  function renderFilterSummaries(surface) {
    document.querySelectorAll(`[data-personal-search-tags-strip="${surface}"]`).forEach(strip => {
      strip.innerHTML = filterSummaryHtml(surface);
      strip.dataset.personalFilterOpen = filterSurfaceFor(surface);
      strip.dataset.personalFilterTab = 'filters';
    });
  }

  function scoreChips(result) {
    const score = result.score || {};
    const components = score.components || {};
    const chips = [];
    for (const source of score.score_sources || []) {
      chips.push(source.replace(/_/g, ' '));
    }
    if (components.vector?.cosine_distance != null) {
      chips.push(`vec ${Number(components.vector.cosine_distance).toFixed(2)}`);
    }
    if (score.reranker_rank) chips.push(`rank ${score.reranker_rank}`);
    return chips.map(label => `<span class="personal-search-chip">${escHtml(label)}</span>`).join('');
  }

  function graphEls() {
    return {
      dialog: document.getElementById('personal-graph-modal'),
      title: document.getElementById('personal-graph-title'),
      source: document.getElementById('personal-graph-source'),
      status: document.getElementById('personal-graph-status'),
      list: document.getElementById('personal-graph-list'),
    };
  }

  function graphLabel(value) {
    return String(value || '').replace(/_/g, ' ');
  }

  function graphUrl(sourceRef) {
    const url = new URL('/api/v1/personal/graph/links', window.location.origin);
    url.searchParams.set('source_ref', sourceRef);
    url.searchParams.set('sync', 'true');
    url.searchParams.set('limit', '80');
    return `${url.pathname}${url.search}`;
  }

  function graphStatusText() {
    const graph = state.graph;
    if (graph.loading) return 'Loading';
    if (graph.error) return graph.error;
    const count = graph.links.length;
    return `${count} link${count === 1 ? '' : 's'}`;
  }

  function graphLinkHtml(link) {
    const source = link.source_ref || '';
    const target = link.target_ref || '';
    const provenance = link.provenance || {};
    const metaParts = [
      graphLabel(link.link_type),
      graphLabel(link.link_state),
      graphLabel(link.risk_level),
    ].filter(Boolean);
    const detailParts = [
      link.title,
      provenance.source_hash ? `hash ${provenance.source_hash}` : '',
      provenance.db_ref ? `db ${provenance.db_ref}` : '',
      provenance.source_ref ? `source ${provenance.source_ref}` : '',
    ].filter(Boolean);
    return `
      <article class="personal-graph-row">
        <div class="personal-graph-row__refs">
          <span>${escHtml(source)}</span>
          <span aria-hidden="true">-&gt;</span>
          <span>${escHtml(target)}</span>
        </div>
        <div class="personal-graph-row__meta">${escHtml(metaParts.join(' / '))}</div>
        <div class="personal-graph-row__detail">${escHtml(detailParts.join(' - '))}</div>
      </article>
    `;
  }

  function renderGraphModal() {
    const graph = state.graph;
    const els = graphEls();
    if (!els.dialog || !els.list) return;
    if (els.title) els.title.textContent = graph.title || 'Graph Links';
    if (els.source) els.source.textContent = graph.sourceRef || '';
    if (els.status) {
      els.status.textContent = graphStatusText();
      els.status.dataset.tone = graph.error ? 'error' : '';
    }
    els.list.innerHTML = graph.links.length
      ? graph.links.map(graphLinkHtml).join('')
      : '<div class="personal-graph-empty">No graph links for this source.</div>';
  }

  function openGraphModal() {
    const { dialog } = graphEls();
    if (!dialog) return false;
    state.graph.open = true;
    renderGraphModal();
    if (typeof HubModal !== 'undefined' && typeof HubModal.open === 'function') {
      HubModal.open(dialog, {
        onClose: () => {
          state.graph.open = false;
        },
      });
      return true;
    }
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
      return true;
    }
    dialog.setAttribute('open', 'open');
    return true;
  }

  async function openGraphLinks(surface, index) {
    const result = surfaceState(surface).results[Number(index)];
    if (!result) return;
    const sourceRef = result.document_id || (result.source_refs || [])[0] || '';
    if (!sourceRef) return;
    state.graph = {
      open: true,
      sourceRef,
      title: result.title || sourceRef,
      loading: true,
      error: '',
      links: [],
      sync: null,
    };
    openGraphModal();
    try {
      const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
      const response = await fetcher(graphUrl(sourceRef));
      if (!response.ok) throw new Error(response.statusText || 'graph links failed');
      const payload = await response.json();
      state.graph.links = Array.isArray(payload.links) ? payload.links : [];
      state.graph.sync = payload.sync || null;
    } catch (error) {
      state.graph.error = error.message || String(error);
      state.graph.links = [];
    } finally {
      state.graph.loading = false;
      renderGraphModal();
    }
  }

  function dateSpanLabel(result) {
    const span = result?.date_span || {};
    const start = cleanDate(span.start || result?.local_date || result?.page_ref?.date || '');
    const end = cleanDate(span.end || result?.provenance?.calendar?.local_end_date || start);
    if (!start && !end) return '';
    if (!start) return end;
    if (!end || end === start) return start;
    return start < end ? `${start} to ${end}` : `${end} to ${start}`;
  }

  function resultPageLabel(result, dateLabel) {
    const page = result.page_ref || {};
    const anchor = page.item_id || (!dateLabel ? page.date : '');
    return [page.group, page.tab, anchor].filter(Boolean).join(' / ');
  }

  function resultIdentity(result, index = 0) {
    return String(result?.document_id || result?.record_id || result?.source?.ref || index);
  }

  function safeExternalResultUrl(result) {
    const value = String(result?.page_ref?.external_url || '').trim();
    if (!value) return '';
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function resultOpenControl(result, identity) {
    const externalUrl = safeExternalResultUrl(result);
    if (externalUrl) {
      return `<a class="personal-search-open" href="${escHtml(externalUrl)}" target="_blank" rel="noopener noreferrer">Open</a>`;
    }
    return `<button class="personal-search-open" type="button" data-personal-search-open="${escHtml(identity)}">Open</button>`;
  }

  function resultHtml(result, index) {
    const source = result.source || {};
    const dateLabel = dateSpanLabel(result);
    const pageLabel = resultPageLabel(result, dateLabel);
    const meta = [result.record_type || '', source.type || '', dateLabel, pageLabel || result.document_id].filter(Boolean).join(' - ');
    const identity = resultIdentity(result, index);
    return `
      <article class="personal-search-row" data-personal-search-result="${index}">
        <div>
          <div class="personal-search-title">${escHtml(result.title || result.document_id)}</div>
          <div class="personal-search-meta">${escHtml(meta)}</div>
          <div class="personal-search-body">${escHtml(result.body_excerpt || '')}</div>
        </div>
        <div class="personal-search-score">
          ${scoreChips(result)}
          ${resultOpenControl(result, identity)}
          <button class="personal-search-open" type="button" data-personal-graph-open="${index}">Links</button>
        </div>
      </article>
    `;
  }

  function renderResults(surface) {
    const data = surfaceState(surface);
    document.querySelectorAll(`[data-personal-search-surface="${surface}"]`).forEach(root => {
      const results = root.querySelector(`[data-personal-search-results="${surface}"]`);
      if (!results) return;
      root.dataset.searchEmpty = data.results.length ? 'false' : 'true';
      results.innerHTML = data.results.map(resultHtml).join('');
    });
  }

  function mergeSearchPayloads(payloads) {
    const byId = new Map();
    payloads.forEach(payload => {
      (Array.isArray(payload.results) ? payload.results : []).forEach(result => {
        const id = result.document_id || result.record_id || '';
        if (!id || byId.has(id)) return;
        byId.set(id, result);
      });
    });
    return {
      count: byId.size,
      results: Array.from(byId.values()),
      subsystems: {
        ...(payloads[0]?.subsystems || {}),
        tag_pool: {
          status: 'ok',
          candidate_count: byId.size,
          request_count: payloads.length,
        },
      },
    };
  }

  async function fetchSearchPayload(surface, data, options = {}) {
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const response = await fetcher(apiUrl(surface, data, options));
    if (!response.ok) throw new Error(response.statusText || 'search failed');
    return response.json();
  }

  async function fetchSearch(surface, data, options = {}) {
    const tags = selectedTags(surface);
    if (tags.length <= 1) {
      return fetchSearchPayload(surface, data, { ...options, tag: tags[0] || '' });
    }
    const payloads = await Promise.all(tags.map(tag => fetchSearchPayload(surface, data, { ...options, tag })));
    return mergeSearchPayloads(payloads);
  }

  async function runEnhancedSearch(surface, requestId, fastPayload) {
    const data = surfaceState(surface);
    if (!shouldRunEnhancedSearch(surface, data)) return;
    data.loadingEnhanced = true;
    try {
      const enhanced = await fetchSearch(surface, data, {
        includeVector: true,
        rerankResults: true,
        sync: false,
      });
      if (requestId !== data.requestId) return;
      const merged = mergeSearchPayloads([fastPayload, enhanced]);
      data.results = Array.isArray(merged.results) ? merged.results : [];
      data.subsystems = {
        ...(merged.subsystems || {}),
        enhanced: enhanced.subsystems || {},
      };
      setStatus(surface, `${merged.count || 0} result${merged.count === 1 ? '' : 's'}`);
      renderResults(surface);
    } catch (error) {
      if (requestId !== data.requestId) return;
      data.subsystems = {
        ...(data.subsystems || {}),
        enhanced: { status: 'error', error: error.message || String(error) },
      };
    } finally {
      if (requestId === data.requestId) {
        data.loadingEnhanced = false;
        if (window.BodyShade && typeof window.BodyShade.scheduleSizeFillTable === 'function') {
          window.BodyShade.scheduleSizeFillTable();
        }
      }
    }
  }

  async function run(surface) {
    const data = surfaceState(surface);
    const requestId = ++data.requestId;
    if (!data.query && !data.restrictToRange && !selectedTags(surface).length && !hasEffectiveRange(surface, data)) {
      data.results = [];
      data.error = '';
      data.loading = false;
      data.loadingEnhanced = false;
      setStatus(surface, 'Ready');
      renderResults(surface);
      return;
    }
    data.loading = true;
    data.error = '';
    setStatus(surface, 'Searching');
    try {
      const payload = await fetchSearch(surface, data, {
        includeVector: false,
        rerankResults: false,
        sync: false,
      });
      if (requestId !== data.requestId) return;
      data.results = Array.isArray(payload.results) ? payload.results : [];
      data.subsystems = payload.subsystems || {};
      setStatus(surface, `${payload.count || 0} result${payload.count === 1 ? '' : 's'}`);
      renderResults(surface);
      renderFilterSummaries(surface);
      void runEnhancedSearch(surface, requestId, payload);
    } catch (error) {
      if (requestId !== data.requestId) return;
      data.results = [];
      data.error = error.message || String(error);
      setStatus(surface, data.error, 'error');
    } finally {
      if (requestId === data.requestId) {
        data.loading = false;
        renderResults(surface);
        renderFilterSummaries(surface);
        if (window.BodyShade && typeof window.BodyShade.scheduleSizeFillTable === 'function') {
          window.BodyShade.scheduleSizeFillTable();
        }
      }
    }
  }

  function calendarRangeFormHtml(surface, data, instance) {
    syncRangeFromAdapter(surface);
    const safeSurface = escHtml(surface);
    const prefix = String(instance || `${surface}-search`).replace(/[^a-zA-Z0-9_-]/g, '-');
    const allDay = data.allDay !== false;
    const disabled = allDay ? ' disabled' : '';
    return `
      ${schedulerStatusSurfaceHtml()}
      <form class="personal-search-form personal-search-form--calendar-range calendar-event-form-grid" data-personal-search-form="${safeSurface}">
        <label class="calendar-field calendar-field--wide" for="${escHtml(prefix)}-query">
          <span>Search</span>
          <input id="${escHtml(prefix)}-query" class="personal-search-query-input" type="search" data-personal-search-query="${safeSurface}" value="${escHtml(data.query)}" autocomplete="off" spellcheck="false" aria-label="Search personal records" />
        </label>
        <label class="calendar-field" for="${escHtml(prefix)}-start-date">
          <span class="calendar-field__label-row personal-search-date-label-row">
            <span>Start date</span>
            <span class="personal-search-date-actions">
              <button class="personal-search-date-action" type="button" data-personal-search-range-preset="${safeSurface}" data-personal-search-preset="year">YEAR</button>
              <button class="personal-search-date-action" type="button" data-personal-search-range-preset="${safeSurface}" data-personal-search-preset="month">MONTH</button>
            </span>
          </span>
          <input id="${escHtml(prefix)}-start-date" type="date" data-personal-search-start-date="${safeSurface}" value="${escHtml(data.rangeStart)}" />
        </label>
        <label class="calendar-field" for="${escHtml(prefix)}-end-date">
          <span class="calendar-field__label-row personal-search-date-label-row">
            <span>End date</span>
            <span class="personal-search-date-actions">
              <button class="personal-search-date-action" type="button" data-personal-search-end-offset="${safeSurface}" data-personal-search-offset-months="12">+YEAR</button>
              <button class="personal-search-date-action" type="button" data-personal-search-end-offset="${safeSurface}" data-personal-search-offset-months="1">+MONTH</button>
            </span>
          </span>
          <input id="${escHtml(prefix)}-end-date" type="date" data-personal-search-end-date="${safeSurface}" value="${escHtml(data.rangeEnd || data.rangeStart)}" />
        </label>
        <label class="calendar-field" for="${escHtml(prefix)}-start-time">
          <span>Start</span>
          <input id="${escHtml(prefix)}-start-time" type="time" data-personal-search-start-time="${safeSurface}" value="${escHtml(data.timeStart)}"${disabled} />
        </label>
        <label class="calendar-field" for="${escHtml(prefix)}-end-time">
          <span>End</span>
          <input id="${escHtml(prefix)}-end-time" type="time" data-personal-search-end-time="${safeSurface}" value="${escHtml(data.timeEnd)}"${disabled} />
        </label>
        <div class="calendar-event-options-row personal-search-options-row">
          <label class="calendar-check hub-checkbox" for="${escHtml(prefix)}-all-day">
            <input id="${escHtml(prefix)}-all-day" class="hub-checkbox__input" type="checkbox" data-personal-search-all-day="${safeSurface}"${allDay ? ' checked' : ''} />
            <span class="hub-checkbox__box" aria-hidden="true"></span>
            <span class="hub-checkbox__label">All day</span>
          </label>
          <div class="calendar-filter-strip calendar-event-tags-strip personal-search-filter-strip personal-search-filter-strip--calendar-range" role="button" tabindex="0" data-personal-search-tags-strip="${safeSurface}" data-personal-filter-open="${escHtml(filterSurfaceFor(surface))}" data-personal-filter-tab="filters">
            ${filterSummaryHtml(surface)}
          </div>
        </div>
        <div class="calendar-quick-event__footer personal-search-form-footer">
          <span class="personal-search-status" data-personal-search-status="${safeSurface}">${escHtml(searchLabel(surface))}</span>
          <button class="calendar-command-btn personal-search-command-btn" type="submit">Search</button>
        </div>
      </form>
      <div class="personal-search-results" data-personal-search-results="${safeSurface}"></div>
    `;
  }

  function findResult(surface, key) {
    const data = surfaceState(surface);
    const clean = String(key || '').trim();
    const matched = data.results.find(result => {
      const source = result.source || {};
      return [
        result.document_id,
        result.record_id,
        source.ref,
        ...(Array.isArray(result.source_refs) ? result.source_refs : []),
      ].some(value => String(value || '') === clean);
    });
    if (matched) return matched;
    return data.results[Number(clean)];
  }

  function activatePage(group, tab) {
    if (typeof switchGroup === 'function') switchGroup(group);
    if (typeof switchTab === 'function') switchTab(tab);
    if (group === 'dave' && window.DaveMenuConfig?.updateActiveTab) {
      window.DaveMenuConfig.updateActiveTab(tab);
    }
    if (group === 'kanban' && window.KanbanMenuConfig?.updateActiveTab) {
      window.KanbanMenuConfig.updateActiveTab(tab);
    }
  }

  async function openPersonalEventResult(result) {
    const eventId = String(result.record_id || '').trim();
    if (!eventId || !window.BlueprintsDiaryPage?.editEntryById) return false;
    const targetDate = cleanDate(result.date_span?.start || result.local_date || result.page_ref?.date || '');
    activatePage('dave', 'diary');
    return window.BlueprintsDiaryPage.editEntryById(eventId, targetDate);
  }

  async function openTaskResult(result) {
    const taskRef = String(result.record_id || result.source?.ref || '').trim();
    if (!taskRef || !window.BlueprintsTodoPage?.openTask) return false;
    return window.BlueprintsTodoPage.openTask(taskRef);
  }

  async function openResult(surface, key) {
    const result = findResult(surface, key);
    if (!result) return;
    const savedSearchState = snapshotSearchState(surface);
    const adapter = adapterFor(surface);
    let openError = '';
    try {
      if (typeof adapter.openResult === 'function') {
        const handled = await adapter.openResult(result, {
          surface,
          key: String(key || ''),
        });
        if (handled !== false) return;
      }
      if (result.record_table === 'personal_events' && await openPersonalEventResult(result)) return;
      if (result.record_table === 'personal_time_tasks' && await openTaskResult(result)) return;
      const page = result.page_ref || {};
      const group = page.group || (result.mode === 'work' ? 'kanban' : 'dave');
      const tab = page.tab || (group === 'kanban' ? 'kanban' : 'diary');
      activatePage(group, tab);
    } catch (error) {
      openError = error.message || String(error);
    } finally {
      restoreSearchState(surface, savedSearchState);
      if (openError) {
        const data = surfaceState(surface);
        data.error = openError;
        setStatus(surface, openError, 'error');
      }
    }
  }

  function renderSurface(root) {
    const surface = root.dataset.personalSearchSurface;
    const data = surfaceState(surface);
    root.dataset.searchEmpty = 'true';
    if (rangeControlsFor(surface)) {
      root.innerHTML = calendarRangeFormHtml(surface, data, root.dataset.personalSearchInstance);
    } else {
      root.innerHTML = `
      ${schedulerStatusSurfaceHtml()}
      <form class="personal-search-form" data-personal-search-form="${escHtml(surface)}">
        <input type="search" data-personal-search-query="${escHtml(surface)}" value="${escHtml(data.query)}" autocomplete="off" spellcheck="false" aria-label="Search personal records" />
        <div class="personal-search-filter-strip" role="button" tabindex="0" data-personal-search-tags-strip="${escHtml(surface)}" data-personal-filter-open="${escHtml(filterSurfaceFor(surface))}" data-personal-filter-tab="filters">
          ${filterSummaryHtml(surface)}
        </div>
        <label class="personal-search-range hub-checkbox">
          <input class="hub-checkbox__input" type="checkbox" data-personal-search-range="${escHtml(surface)}" ${data.restrictToRange ? 'checked' : ''} />
          <span class="hub-checkbox__box" aria-hidden="true"></span>
          <span class="hub-checkbox__label">Shown period</span>
        </label>
        <button class="personal-search-btn" type="submit" title="Search" aria-label="Search"></button>
      </form>
      <div class="personal-search-status" data-personal-search-status="${escHtml(surface)}">${escHtml(searchLabel(surface))}</div>
      <div class="personal-search-results" data-personal-search-results="${escHtml(surface)}"></div>
      `;
    }
    if (root.dataset.personalSearchWired === '1') {
      renderResults(surface);
      syncRangeInputs(surface);
      ensureSchedulerStatus();
      return;
    }
    root.dataset.personalSearchWired = '1';
    root.addEventListener('submit', event => {
      event.preventDefault();
      run(surface);
    });
    root.addEventListener('change', event => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.matches('[data-personal-search-range]')) {
        data.restrictToRange = Boolean(target.checked);
        run(surface);
        return;
      }
      if (target.matches('[data-personal-search-start-date]')) {
        data.rangeStart = cleanDate(target.value);
        if (!data.rangeEnd || data.rangeEnd < data.rangeStart) data.rangeEnd = data.rangeStart;
        data.rangeUserSet = true;
        syncRangeInputs(surface);
        run(surface);
        return;
      }
      if (target.matches('[data-personal-search-end-date]')) {
        data.rangeEnd = cleanDate(target.value);
        if (!data.rangeStart || data.rangeEnd < data.rangeStart) data.rangeStart = data.rangeEnd;
        data.rangeUserSet = true;
        syncRangeInputs(surface);
        run(surface);
        return;
      }
      if (target.matches('[data-personal-search-start-time]')) {
        data.timeStart = target.value || '';
        return;
      }
      if (target.matches('[data-personal-search-end-time]')) {
        data.timeEnd = target.value || '';
        return;
      }
      if (target.matches('[data-personal-search-all-day]')) {
        data.allDay = Boolean(target.checked);
        syncRangeInputs(surface);
        run(surface);
      }
    });
    root.addEventListener('input', event => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches('[data-personal-search-query]')) return;
      data.query = target.value.trim();
      window.clearTimeout(data.timer);
      data.timer = window.setTimeout(() => run(surface), 450);
    });
    root.addEventListener('click', event => {
      const presetButton = event.target.closest?.('[data-personal-search-range-preset]');
      if (presetButton) {
        event.preventDefault();
        event.stopPropagation();
        applyRangePreset(surface, presetButton.dataset.personalSearchPreset || 'year');
        return;
      }
      const endOffsetButton = event.target.closest?.('[data-personal-search-end-offset]');
      if (endOffsetButton) {
        event.preventDefault();
        event.stopPropagation();
        applyEndOffset(surface, Number(endOffsetButton.dataset.personalSearchOffsetMonths || 0));
        return;
      }
      const openButton = event.target.closest?.('[data-personal-search-open]');
      if (openButton) {
        openResult(surface, openButton.dataset.personalSearchOpen);
        return;
      }
      const graphButton = event.target.closest?.('[data-personal-graph-open]');
      if (graphButton) {
        openGraphLinks(surface, graphButton.dataset.personalGraphOpen);
        return;
      }
      const runNowButton = event.target.closest?.('[data-personal-search-sync-run]');
      if (runNowButton) {
        event.preventDefault();
        void runSchedulerNow();
        return;
      }
      const helpButton = event.target.closest?.('[data-personal-search-sync-help]');
      if (helpButton) {
        event.preventDefault();
        openSchedulerHelp();
      }
    });
    renderResults(surface);
    syncRangeInputs(surface);
    ensureSchedulerStatus();
  }

  function init() {
    document.querySelectorAll('[data-personal-search-surface]').forEach(renderSurface);
  }

  function registerSurface(surface, adapter = {}) {
    state.adapters[surface] = adapter;
    syncRangeFromAdapter(surface);
    document.querySelectorAll(`[data-personal-search-surface="${surface}"]`).forEach(renderSurface);
    renderFilterSummaries(surface);
  }

  function surfaceForFilterSurface(filterSurface) {
    const found = Object.entries(state.adapters)
      .find(([, adapter]) => (adapter.filterSurface || '') === filterSurface);
    if (found) return found[0];
    return String(filterSurface || '').endsWith('-search')
      ? String(filterSurface).slice(0, -'-search'.length)
      : '';
  }

  function handlePersonalFilterChange(event) {
    const surface = surfaceForFilterSurface(event.detail?.surface || '');
    if (!surface) return;
    renderFilterSummaries(surface);
    const data = surfaceState(surface);
    if (data.query || data.restrictToRange || selectedTags(surface).length || hasEffectiveRange(surface, data)) run(surface);
    else renderResults(surface);
  }

  function snapshot() {
    const surfaces = {};
    for (const [key, value] of Object.entries(state.surfaces)) {
      surfaces[key] = {
        query: value.query,
        restrict_to_range: value.restrictToRange,
        range_start: value.rangeStart,
        range_end: value.rangeEnd,
        time_start: value.timeStart,
        time_end: value.timeEnd,
        all_day: value.allDay !== false,
        range_controls: rangeControlsFor(key),
        filter_surface: filterSurfaceFor(key),
        selected_tags: selectedTags(key),
        loading: value.loading,
        loading_enhanced: value.loadingEnhanced,
        error: value.error,
        result_count: value.results.length,
        first_result: value.results[0]?.document_id || '',
        subsystems: value.subsystems,
      };
    }
    return {
      surfaces,
      graph: {
        open: state.graph.open,
        source_ref: state.graph.sourceRef,
        title: state.graph.title,
        loading: state.graph.loading,
        error: state.graph.error,
        link_count: state.graph.links.length,
        first_link: state.graph.links[0]?.target_ref || '',
        sync: state.graph.sync,
      },
      scheduler: {
        schema: state.scheduler.payload?.schema || '',
        checked_at: state.scheduler.payload?.checked_at || '',
        tone: schedulerViewModel(state.scheduler.payload).tone,
        label: schedulerViewModel(state.scheduler.payload).label,
        error: state.scheduler.error,
        run_now_pending: Boolean(state.scheduler.runNowInFlight),
      },
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
  window.addEventListener('personal-filters:change', handlePersonalFilterChange);

  return {
    init,
    registerSurface,
    syncRange: syncRangeFromAdapter,
    run,
    openGraphLinks,
    snapshot,
  };
})();

window.BlueprintsPersonalSearch = BlueprintsPersonalSearch;
window.BlueprintsPersonalGraphLinks = {
  snapshot: () => (window.BlueprintsPersonalSearch?.snapshot?.().graph || {}),
};
