(function () {
  'use strict';

  const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const DIGIT_SEGMENTS = {
    0: ['a', 'b', 'c', 'd', 'e', 'f'],
    1: ['b', 'c'],
    2: ['a', 'b', 'd', 'e', 'g'],
    3: ['a', 'b', 'c', 'd', 'g'],
    4: ['b', 'c', 'f', 'g'],
    5: ['a', 'c', 'd', 'f', 'g'],
    6: ['a', 'c', 'd', 'e', 'f', 'g'],
    7: ['a', 'b', 'c'],
    8: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    9: ['a', 'b', 'c', 'd', 'f', 'g'],
  };

  let minuteTimer = null;

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function createDigit() {
    const digit = document.createElement('span');
    digit.className = 'led-digit';
    digit.setAttribute('aria-hidden', 'true');

    SEGMENTS.forEach((name) => {
      const segment = document.createElement('span');
      segment.className = `led-segment led-segment--${name} led-segment--${(['a', 'd', 'g'].includes(name) ? 'h' : 'v')}`;
      segment.dataset.segment = name;
      digit.appendChild(segment);
    });

    return digit;
  }

  function createColon() {
    const colon = document.createElement('span');
    colon.className = 'led-colon';
    colon.setAttribute('aria-hidden', 'true');
    return colon;
  }

  function buildDisplay(display) {
    if (!display || display.children.length) return;
    display.appendChild(createDigit());
    display.appendChild(createDigit());
    display.appendChild(createColon());
    display.appendChild(createDigit());
    display.appendChild(createDigit());
  }

  function setDigit(digit, value) {
    const active = new Set(DIGIT_SEGMENTS[value] || []);
    digit.dataset.digit = value;
    digit.querySelectorAll('.led-segment').forEach((segment) => {
      segment.classList.toggle('is-on', active.has(segment.dataset.segment));
    });
  }

  function updateClock(root) {
    const now = new Date();
    const label = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    const values = label.replace(':', '').split('');
    const digits = root.querySelectorAll('.led-digit');

    digits.forEach((digit, index) => setDigit(digit, values[index]));
    root.setAttribute('aria-label', `Local time ${label}`);
    root.title = `Local time ${label}`;
    root.classList.add('is-ready');
  }

  function schedule(root) {
    if (minuteTimer) window.clearTimeout(minuteTimer);
    updateClock(root);

    const now = new Date();
    const delay = Math.max(1000, 60000 - ((now.getSeconds() * 1000) + now.getMilliseconds()) + 60);
    minuteTimer = window.setTimeout(() => schedule(root), delay);
  }

  function initHeaderClock() {
    const root = document.getElementById('header-local-time');
    if (!root) return;

    const display = root.querySelector('.led-watch-display');
    buildDisplay(display);
    schedule(root);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) schedule(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHeaderClock, { once: true });
  } else {
    initHeaderClock();
  }
})();
