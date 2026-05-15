// splash-screens.js — Synthesis splash screen registry and responsive ASCII fitting.
// xarta-node Blueprints GUI

'use strict';

const BlueprintsSplashScreens = (() => {
  const DEFAULT_KEY = 'blueprintsDefaultSplashScreen';
  const FALLBACK_ID = 'splash-dont-panic';
  const ASCII_FONT_FAMILY = '"Cascadia Mono", "Fira Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace';
  const ART = {
    wide: {
      dont: [
        '██████╗  ██████╗ ███╗   ██╗╻████████╗',
        '██╔══██╗██╔═══██╗████╗  ██║║╚══██╔══╝',
        '██║  ██║██║   ██║██╔██╗ ██║║   ██║   ',
        '██║  ██║██║   ██║██║╚██╗██║    ██║   ',
        '██████╔╝╚██████╔╝██║ ╚████║    ██║   ',
        '╚═════╝  ╚═════╝ ╚═╝  ╚═══╝    ╚═╝   ',
      ],
      panic: [
        '██████╗  █████╗ ███╗   ██╗██╗ ██████╗',
        '██╔══██╗██╔══██╗████╗  ██║██║██╔════╝',
        '██████╔╝███████║██╔██╗ ██║██║██║     ',
        '██╔═══╝ ██╔══██║██║╚██╗██║██║██║     ',
        '██║     ██║  ██║██║ ╚████║██║╚██████╗',
        '╚═╝     ╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝ ╚═════╝',
      ],
    },
    compact: {
      dont: [
        '████▄  ▄████  █▄  █ ╻▀█▀',
        '██  ██ ██  ██ ███▄█ ║ █ ',
        '██  ██ ██  ██ ██▀██ ║ █ ',
        '████▀  ▀████  █  ██   █ ',
        '▀▀▀     ▀▀▀   ▀  ▀▀   ▀ ',
      ],
      panic: [
        '████▄  ▄███▄  █▄  █ █ ▄████',
        '██  ██ ██ ██ ███▄█ █ ██    ',
        '████▀  █████ ██▀██ █ ██ ▀█ ',
        '██     ██ ██ █  ██ █ ▀████ ',
        '▀      ▀  ▀▀ ▀  ▀▀ ▀  ▀▀▀▀ ',
      ],
    },
  };

  let _resizeObserver = null;
  let _renderMode = '';

  function getDefault() {
    return localStorage.getItem(DEFAULT_KEY) || FALLBACK_ID;
  }

  function labelFor(id) {
    if (id === 'splash-dont-panic') return "Don't Panic";
    return 'Splash Screen';
  }

  function updateDefaultBadges() {
    const activeDefault = getDefault();
    document.querySelectorAll('[data-splash-default-for]').forEach((el) => {
      const isDefault = el.getAttribute('data-splash-default-for') === activeDefault;
      el.hidden = !isDefault;
    });
  }

  function setDefault(id) {
    const nextId = id || FALLBACK_ID;
    localStorage.setItem(DEFAULT_KEY, nextId);
    updateDefaultBadges();
    if (typeof HubDialogs !== 'undefined') {
      HubDialogs.alert({
        title: 'Default Splash Screen',
        message: `${labelFor(nextId)} is now the first screen for Synthesis.`,
        tone: 'success',
        badge: 'Splash',
      });
    }
    return nextId;
  }

  function activeSplashId() {
    const panel = document.querySelector('.tab-panel.active[id^="tab-splash-"]');
    return panel ? panel.id.replace(/^tab-/, '') : getDefault();
  }

  function setActiveAsDefault() {
    return setDefault(activeSplashId());
  }

  function lineCellWidth(lines, mode) {
    const glyphCellEm = mode === 'compact' ? 0.88 : 1.05;
    return lines.reduce((max, line) => Math.max(max, line.length), 0) * glyphCellEm;
  }

  function fitDontPanic() {
    const shell = document.getElementById('dont-panic-fit-shell');
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const mobileStack = window.matchMedia && window.matchMedia('(max-width: 680px)').matches;
    const mode = mobileStack ? 'compact' : 'wide';
    renderDontPanic(mode);
    const lineHeight = 0.92;
    const gapEm = mobileStack ? 0.62 : 1.55;
    const maxDont = lineCellWidth(ART[mode].dont, mode);
    const maxPanic = lineCellWidth(ART[mode].panic, mode);
    const widthUnits = mobileStack ? Math.max(maxDont, maxPanic) : maxDont + maxPanic + gapEm;
    const lineCount = mobileStack
      ? ART[mode].dont.length + ART[mode].panic.length
      : Math.max(ART[mode].dont.length, ART[mode].panic.length);
    const heightUnits = (lineCount * lineHeight) + gapEm;
    const widthFit = (rect.width * 0.92) / widthUnits;
    const heightFit = (rect.height * 0.86) / heightUnits;
    const next = Math.max(7, Math.min(86, Math.floor(Math.min(widthFit, heightFit))));
    shell.style.setProperty('--dp-font-size', `${next}px`);
  }

  function renderWord(root, key, mode) {
    if (!root) return;
    const text = ART[mode][key].join('\n');
    root.innerHTML = `
      <pre class="dp-ascii dp-ascii--shadow" aria-hidden="true"></pre>
      <pre class="dp-ascii dp-ascii--fill"></pre>
    `;
    root.querySelectorAll('.dp-ascii').forEach(pre => { pre.textContent = text; });
  }

  function renderDontPanic(mode) {
    if (_renderMode === mode) return;
    renderWord(document.querySelector('[data-dp-word="dont"]'), 'dont', mode);
    renderWord(document.querySelector('[data-dp-word="panic"]'), 'panic', mode);
    _renderMode = mode;
  }

  function initDontPanic() {
    const mobileStack = window.matchMedia && window.matchMedia('(max-width: 680px)').matches;
    renderDontPanic(mobileStack ? 'compact' : 'wide');
    updateDefaultBadges();
    fitDontPanic();
    const shell = document.getElementById('dont-panic-fit-shell');
    if (shell && typeof ResizeObserver !== 'undefined' && !_resizeObserver) {
      _resizeObserver = new ResizeObserver(fitDontPanic);
      _resizeObserver.observe(shell);
    }
  }

  function init() {
    initDontPanic();
    window.addEventListener('resize', fitDontPanic, { passive: true });
    window.addEventListener('orientationchange', fitDontPanic, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', fitDontPanic, { passive: true });
    }
  }

  return {
    getDefault,
    setDefault,
    setActiveAsDefault,
    init,
    initDontPanic,
    fitDontPanic,
  };
})();
