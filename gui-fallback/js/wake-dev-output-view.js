// wake-dev-output-view.js - display-only Wake Dev diagnostics view.

(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BlueprintsWakeDevOutputView = api;
  if (root.document) {
    const mount = () => api.mountDocument(root.document);
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function (root) {
  'use strict';

  const WINDOW_MS = 10000;
  const SCALE_MIN_DB = -80;
  const SCALE_MAX_DB = 0;
  const DB_TICKS = [0, -20, -40, -60];
  const CANVAS_LABEL_FONT = '11px system-ui, sans-serif';
  const CANVAS_SMALL_FONT = '10px system-ui, sans-serif';
  const DEFAULT_STATE_LABELS = [
    'DISABLED',
    'SELECTED_INACTIVE',
    'BLOCKED',
    'PERMISSION_PENDING',
    'ARMED_IDLE',
    'WAKE_CANDIDATE',
    'WAKE_CONFIRMED_WAITING_SPEECH',
    'CAPTURING',
    'COMMAND_CANDIDATE',
    'PAUSED',
    'EXECUTING',
    'SENT_FEEDBACK',
    'ERROR_FEEDBACK',
  ];

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function text(value, fallback = '--') {
    const clean = String(value ?? '').trim();
    return clean || fallback;
  }

  function emptySnapshot(paused = false) {
    return {
      metrics: [
        { label: 'FSM', value: '--' },
        { label: 'Session', value: '--' },
        { label: 'Instance', value: '--' },
        { label: 'Frames', value: '--' },
        { label: 'Debug age', value: '--' },
        { label: 'Level', value: '--' },
      ],
      source: 'No output snapshot loaded.',
      activeState: '',
      states: DEFAULT_STATE_LABELS,
      timeline: {
        nowMs: 0,
        startMs: -WINDOW_MS,
        endMs: 0,
        samples: [],
        markers: [],
        text: [],
        transcriptSpan: null,
        bands: [
          { y: 0.25, color: 'rgba(251,191,36,0.22)' },
          { y: 0.72, color: 'rgba(148,168,179,0.18)' },
        ],
        statuses: [],
        startLabel: '10s',
        endLabel: paused ? 'paused' : 'now',
        emptyLabel: '',
      },
    };
  }

  function normalizeMetric(item) {
    return {
      label: text(item?.label, ''),
      value: text(item?.value),
    };
  }

  function normalizeSnapshot(snapshot, paused = false) {
    if (!snapshot) return emptySnapshot(paused);
    const fallback = emptySnapshot(paused);
    return {
      metrics: Array.isArray(snapshot.metrics) && snapshot.metrics.length
        ? snapshot.metrics.map(normalizeMetric)
        : fallback.metrics,
      source: text(snapshot.source, fallback.source),
      activeState: text(snapshot.activeState ?? snapshot.active_state, ''),
      states: Array.isArray(snapshot.states) && snapshot.states.length
        ? snapshot.states.map(item => text(item, '')).filter(Boolean)
        : fallback.states,
      timeline: {
        ...fallback.timeline,
        ...(snapshot.timeline || {}),
        endLabel: paused ? 'paused' : text(snapshot.timeline?.endLabel ?? snapshot.timeline?.end_label, fallback.timeline.endLabel),
      },
    };
  }

  function renderMetrics(node, metrics) {
    if (!node) return;
    node.innerHTML = metrics.map(item => (
      `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`
    )).join('');
  }

  function renderStates(node, states, activeState) {
    if (!node) return;
    node.innerHTML = states.map(state => (
      `<span class="wake-dev-state${state === activeState ? ' is-active' : ''}">${escapeHtml(state)}</span>`
    )).join('');
  }

  function numberOr(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function atMs(item) {
    return numberOr(item?.atMs ?? item?.at_ms ?? item?.at, 0);
  }

  function sampleDb(sample) {
    const explicit = Number(sample?.db ?? sample?.dbValue ?? sample?.levelDb);
    if (Number.isFinite(explicit)) return clamp(explicit, SCALE_MIN_DB, SCALE_MAX_DB);
    const level = Math.max(0.0001, numberOr(sample?.rms ?? sample?.level, 0.0001));
    return clamp(20 * Math.log10(level), SCALE_MIN_DB, SCALE_MAX_DB);
  }

  function clipCanvasText(ctx, value, maxWidth) {
    const clean = text(value, '');
    if (!clean || ctx.measureText(clean).width <= maxWidth) return clean;
    let clipped = clean;
    while (clipped.length > 1 && ctx.measureText(`${clipped}...`).width > maxWidth) {
      clipped = clipped.slice(0, -1);
    }
    return `${clipped.trim()}...`;
  }

  function drawPill(ctx, label, x, y, options = {}) {
    const clean = clipCanvasText(ctx, label, numberOr(options.maxWidth, 220));
    if (!clean) return;
    const padX = 7;
    const height = options.height || 18;
    const width = Math.min(numberOr(options.maxWidth, 220) + (padX * 2), ctx.measureText(clean).width + (padX * 2));
    const left = Math.max(4, Math.min(numberOr(options.canvasWidth, 640) - width - 4, x));
    ctx.fillStyle = options.background || 'rgba(16, 24, 38, 0.9)';
    ctx.strokeStyle = options.border || 'rgba(91,156,246,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(left, y, width, height, 6);
    else ctx.rect(left, y, width, height);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = options.color || '#dce8ed';
    ctx.fillText(clean, left + padX, y + 13);
  }

  function drawSpanPill(ctx, label, startX, endX, y, options = {}) {
    const clean = text(label, '');
    if (!clean) return;
    const canvasWidth = numberOr(options.canvasWidth, 640);
    const left = clamp(Math.min(startX, endX), 8, Math.max(8, canvasWidth - 38));
    const right = clamp(Math.max(startX, endX), left + 30, canvasWidth - 8);
    const width = Math.max(30, right - left);
    const height = numberOr(options.height, 22);
    const padX = 8;
    ctx.fillStyle = options.background || 'rgba(7,24,39,0.97)';
    ctx.strokeStyle = options.border || 'rgba(56,189,248,0.78)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(left, y, width, height, 6);
    else ctx.rect(left, y, width, height);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = options.color || '#f1f7fa';
    ctx.fillText(clipCanvasText(ctx, clean, Math.max(1, width - (padX * 2))), left + padX, y + 15);
  }

  function prepareCanvas(canvas, options = {}) {
    if (!canvas?.getContext) return null;
    const rect = typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect()
      : null;
    const cssWidth = rect ? Number(rect.width) : Number(canvas.clientWidth || canvas.width || 1200);
    const cssHeight = rect ? Number(rect.height) : Number(canvas.clientHeight || canvas.height || 260);
    if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight) || cssWidth < 1 || cssHeight < 1) return null;
    const dpr = Number(options.devicePixelRatio || root.devicePixelRatio || 1) || 1;
    const width = Math.max(320, Math.round(cssWidth * dpr));
    const height = Math.max(180, Math.round(cssHeight * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = 'alphabetic';
    return { ctx, width: width / dpr, height: height / dpr };
  }

  function drawTimeline(canvas, snapshot, options = {}) {
    const prepared = prepareCanvas(canvas, options);
    if (!prepared) return null;
    const { ctx, width, height } = prepared;
    const timeline = snapshot.timeline || {};
    const graphTop = 0;
    const graphBottom = Math.max(graphTop + 120, height - 104);
    const graphHeight = graphBottom - graphTop;
    const labelX = 8;
    const gridLeft = 0;
    const graphWidth = width;
    const endMs = numberOr(timeline.endMs ?? timeline.end_ms, 0);
    const startMs = numberOr(timeline.startMs ?? timeline.start_ms, endMs - WINDOW_MS);
    const windowMs = Math.max(1, endMs - startMs || WINDOW_MS);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(91,156,246,0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i += 1) {
      const x = gridLeft + ((graphWidth * i) / 10);
      ctx.beginPath();
      ctx.moveTo(x, graphTop);
      ctx.lineTo(x, graphBottom);
      ctx.stroke();
    }

    ctx.font = CANVAS_LABEL_FONT;
    DB_TICKS.forEach(db => {
      const y = graphTop + (((SCALE_MAX_DB - db) / (SCALE_MAX_DB - SCALE_MIN_DB)) * graphHeight);
      ctx.strokeStyle = db === -20 ? 'rgba(251,191,36,0.22)' : 'rgba(255,255,255,0.09)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(174,191,202,0.78)';
      ctx.fillText(`${db} dB`, labelX, Math.max(12, y - 4));
    });

    const statuses = Array.isArray(timeline.statuses) ? timeline.statuses : [];
    statuses.slice(0, 4).forEach((status, index) => {
      const maxWidth = numberOr(status?.maxWidth ?? status?.max_width, 300);
      ctx.font = CANVAS_LABEL_FONT;
      drawPill(ctx, status?.label ?? status?.text, width - maxWidth - 12, graphTop + 8 + (index * 24), {
        canvasWidth: width,
        maxWidth,
        background: status?.background,
        border: status?.border,
        color: status?.color,
      });
    });

    const xFor = at => gridLeft + (((at - startMs) / windowMs) * graphWidth);
    const yFor = db => graphTop + (((SCALE_MAX_DB - db) / (SCALE_MAX_DB - SCALE_MIN_DB)) * graphHeight);
    const samples = Array.isArray(timeline.samples) ? timeline.samples : [];
    if (samples.length) {
      const visible = samples.filter(sample => {
        const at = atMs(sample);
        return at >= startMs && at <= endMs;
      });
      if (visible.length) {
        ctx.strokeStyle = '#5b9cf6';
        ctx.lineWidth = 2;
        ctx.beginPath();
        visible.forEach((sample, index) => {
          const x = xFor(atMs(sample));
          const y = yFor(sampleDb(sample));
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.fillStyle = 'rgba(91,156,246,0.12)';
        ctx.lineTo(xFor(atMs(visible[visible.length - 1])), graphBottom);
        ctx.lineTo(xFor(atMs(visible[0])), graphBottom);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.moveTo(0, graphBottom + 0.5);
    ctx.lineTo(width, graphBottom + 0.5);
    ctx.stroke();

    ctx.fillStyle = 'rgba(174,191,202,0.72)';
    ctx.font = CANVAS_SMALL_FONT;
    ctx.fillText('STT payloads', 6, graphBottom + 24);
    const span = timeline.transcriptSpan ?? timeline.transcript_span;
    if (span) {
      const spanStart = atMs(span);
      const spanEnd = numberOr(span.endMs ?? span.end_ms ?? span.untilMs ?? span.until_ms, endMs);
      if (spanEnd >= startMs && spanStart <= endMs) {
        const color = span.color || (span.status === 'final'
          ? '#22c55e'
          : (span.status === 'timeout' ? '#f87171' : '#38bdf8'));
        ctx.font = CANVAS_LABEL_FONT;
        drawSpanPill(ctx, span.text ?? span.label, xFor(Math.max(spanStart, startMs)), xFor(Math.min(spanEnd, endMs)), graphBottom + 36, {
          canvasWidth: width,
          background: span.background || (span.status === 'final'
            ? 'rgba(5,46,22,0.97)'
            : (span.status === 'timeout' ? 'rgba(69,10,10,0.97)' : 'rgba(7,24,39,0.97)')),
          border: span.border || color,
          color: span.textColor ?? span.text_color ?? '#f1f7fa',
          height: 22,
        });
      }
    }
    (Array.isArray(timeline.markers) ? timeline.markers : []).forEach((marker, index) => {
      const x = xFor(atMs(marker));
      if (x < gridLeft || x > width) return;
      const lane = clamp(Math.round(numberOr(marker?.lane, index % 2)), 0, 4);
      const y = graphBottom + 14 + (lane * 18);
      ctx.strokeStyle = marker?.color || '#aebfca';
      ctx.fillStyle = marker?.color || '#aebfca';
      ctx.beginPath();
      ctx.moveTo(x, graphBottom + 5);
      ctx.lineTo(x, y + 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, graphBottom + 8, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#dce8ed';
      ctx.font = CANVAS_LABEL_FONT;
      ctx.fillText(clipCanvasText(ctx, marker?.label ?? marker?.type, 130), Math.min(width - 140, x + 4), y + 14);
    });

    (Array.isArray(timeline.text) ? timeline.text : []).forEach((item, index) => {
      const x = xFor(atMs(item));
      if (x < gridLeft || x > width) return;
      const label = `${text(item?.prefix, '')}${text(item?.text ?? item?.label, '')}`;
      ctx.font = CANVAS_LABEL_FONT;
      drawPill(ctx, label, x + 4, graphBottom + 36 + (index % 2) * 24, {
        canvasWidth: width,
        maxWidth: numberOr(item?.maxWidth, 260),
        background: item?.background,
        border: item?.border,
        color: item?.color,
      });
    });

    ctx.fillStyle = 'rgba(174,191,202,0.78)';
    ctx.font = CANVAS_LABEL_FONT;
    ctx.fillText(timeline.startLabel || '10s', 6, height - 8);
    const endLabel = timeline.endLabel || 'now';
    ctx.fillText(endLabel, Math.max(6, width - ctx.measureText(endLabel).width - 8), height - 8);
    return { width, height, graphHeight };
  }

  function build(container) {
    container.innerHTML = [
      '<div class="wake-dev-metrics" data-output-metrics></div>',
      '<div class="wake-dev-card wake-dev-wave">',
      '  <div class="wake-dev-card__head">',
      '    <span class="wake-dev-card__title">Input Level and FSM Events</span>',
      '    <div class="wake-dev-wave__tools">',
      '      <span class="wake-dev-meta" data-output-source></span>',
      '      <button class="wake-dev-icon-btn" type="button" data-output-pause aria-pressed="false" title="Pause output">Pause</button>',
      '    </div>',
      '  </div>',
      '  <canvas width="1200" height="260" aria-label="Display-only wake-to-talk output timeline" data-output-timeline></canvas>',
      '</div>',
      '<div class="wake-dev-states" aria-label="Display-only wake-to-talk FSM state list" data-output-states></div>',
    ].join('');
    return {
      metrics: container.querySelector('[data-output-metrics]'),
      source: container.querySelector('[data-output-source]'),
      pause: container.querySelector('[data-output-pause]'),
      canvas: container.querySelector('[data-output-timeline]'),
      states: container.querySelector('[data-output-states]'),
    };
  }

  function createOutputView(container, options = {}) {
    const refs = build(container);
    let pendingRenderFrame = 0;
    const state = {
      paused: false,
      snapshot: null,
      pendingSnapshot: null,
    };

    function activeSnapshot() {
      return normalizeSnapshot(state.snapshot, state.paused);
    }

    function render() {
      const snapshot = activeSnapshot();
      renderMetrics(refs.metrics, snapshot.metrics);
      if (refs.source) refs.source.textContent = snapshot.source;
      drawTimeline(refs.canvas, snapshot, options);
      renderStates(refs.states, snapshot.states, snapshot.activeState);
      return snapshot;
    }

    function scheduleRender() {
      if (pendingRenderFrame) return;
      const requestFrame = root.requestAnimationFrame || (callback => root.setTimeout(callback, 16));
      pendingRenderFrame = requestFrame(() => {
        pendingRenderFrame = 0;
        render();
      });
    }

    function setPaused(next) {
      state.paused = next === true;
      if (!state.paused && state.pendingSnapshot) {
        state.snapshot = state.pendingSnapshot;
        state.pendingSnapshot = null;
      }
      if (refs.pause) {
        refs.pause.setAttribute('aria-pressed', state.paused ? 'true' : 'false');
        refs.pause.textContent = state.paused ? 'Resume' : 'Pause';
        refs.pause.title = state.paused ? 'Resume output' : 'Pause output';
      }
      return render();
    }

    refs.pause?.addEventListener('click', () => setPaused(!state.paused));
    const resizeObserver = typeof root.ResizeObserver === 'function'
      ? new root.ResizeObserver(scheduleRender)
      : null;
    resizeObserver?.observe(refs.canvas);
    root.addEventListener?.('resize', scheduleRender);
    container.ownerDocument?.addEventListener?.('change', event => {
      if (event.target?.id === 'wake-dev-debug-view-new' && event.target.checked) scheduleRender();
    });

    const api = {
      render,
      setSnapshot(nextSnapshot) {
        const normalized = nextSnapshot ? normalizeSnapshot(nextSnapshot, false) : null;
        if (state.paused) state.pendingSnapshot = normalized;
        else state.snapshot = normalized;
        return render();
      },
      clear() {
        state.snapshot = null;
        state.pendingSnapshot = null;
        return render();
      },
      pause() {
        return setPaused(true);
      },
      resume() {
        return setPaused(false);
      },
      isPaused() {
        return state.paused;
      },
      snapshot() {
        return state.snapshot;
      },
    };
    render();
    return api;
  }

  function mountDocument(documentRef = root.document, options = {}) {
    const container = documentRef?.getElementById?.('wake-dev-output-view');
    if (!container) return null;
    if (container.__blueprintsWakeDevOutputView) return container.__blueprintsWakeDevOutputView;
    const view = createOutputView(container, options);
    container.__blueprintsWakeDevOutputView = view;
    return view;
  }

  return {
    createOutputView,
    emptySnapshot,
    mountDocument,
    normalizeSnapshot,
  };
});
