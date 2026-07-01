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
  const CLOCK_HUB_DOUBLE_TAP_MS = 260;
  const CLOCK_HUB_LONG_PRESS_MS = 250;
  const CLOCK_HUB_MOVE_TOLERANCE_PX = 8;
  const CLOCK_HUB_EDGE_GAP_PX = 10;
  const CLOCK_HUB_MIN_VISIBLE_HEIGHT_PX = 80;
  const CLOCK_HUB_WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const CLOCK_HUB_WEEKDAY_NAMES = {
    SUN: 'Sunday',
    MON: 'Monday',
    TUE: 'Tuesday',
    WED: 'Wednesday',
    THU: 'Thursday',
    FRI: 'Friday',
    SAT: 'Saturday',
  };

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

  function createDateSpacer() {
    const spacer = document.createElement('span');
    spacer.className = 'clock-hub-date-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    return spacer;
  }

  function buildDateDisplay(display) {
    if (!display) return;
    const hasDateFormat = display.dataset.format === 'date';
    const digitCount = display.querySelectorAll('.led-digit').length;
    const spacerCount = display.querySelectorAll('.clock-hub-date-spacer').length;
    if (hasDateFormat && digitCount === 8 && spacerCount === 2) return;

    display.textContent = '';
    display.dataset.format = 'date';
    [4, 'space', 2, 'space', 2].forEach((part) => {
      if (part === 'space') {
        display.appendChild(createDateSpacer());
        return;
      }
      for (let index = 0; index < part; index += 1) {
        display.appendChild(createDigit());
      }
    });
  }

  function setDigit(digit, value) {
    const active = new Set(DIGIT_SEGMENTS[value] || []);
    digit.dataset.digit = value;
    digit.querySelectorAll('.led-segment').forEach((segment) => {
      segment.classList.toggle('is-on', active.has(segment.dataset.segment));
    });
  }

  function setDateDisplay(display, now) {
    if (!display) return;
    const year = String(now.getFullYear()).padStart(4, '0');
    const month = pad2(now.getMonth() + 1);
    const day = pad2(now.getDate());
    const clean = `${year}${month}${day}`;
    buildDateDisplay(display);
    display.querySelectorAll('.led-digit').forEach((digit, index) => {
      setDigit(digit, clean[index]);
    });
    display.setAttribute('aria-label', `Date ${year} ${month} ${day}`);
  }

  function setWeekdayStrip(strip, now) {
    if (!strip) return;
    const active = CLOCK_HUB_WEEKDAYS[now.getDay()];
    const activeName = CLOCK_HUB_WEEKDAY_NAMES[active] || active;
    strip.setAttribute('aria-label', `Day of week ${activeName}`);
    strip.querySelectorAll('.clock-hub-weekday').forEach((weekday) => {
      const weekdayKey = weekday.dataset.weekday;
      const weekdayName = CLOCK_HUB_WEEKDAY_NAMES[weekdayKey] || weekdayKey || '';
      const isActive = weekdayKey === active;
      weekday.classList.toggle('is-active', isActive);
      weekday.setAttribute('aria-label', isActive ? `${weekdayName}, active` : weekdayName);
      if (isActive) weekday.setAttribute('aria-current', 'date');
      else weekday.removeAttribute('aria-current');
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

  function updateClockHubDate() {
    const now = new Date();
    setWeekdayStrip(document.getElementById('clock-hub-weekdays'), now);
    setDateDisplay(document.getElementById('clock-hub-date'), now);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function positionClockHub(anchor, modal) {
    if (!anchor || !modal) return;
    const anchorRect = anchor.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const modalRect = modal.getBoundingClientRect();
    const modalWidth = Math.min(modalRect.width || 360, Math.max(220, viewportWidth - (CLOCK_HUB_EDGE_GAP_PX * 2)));
    const idealLeft = anchorRect.left + (anchorRect.width / 2) - (modalWidth / 2);
    const idealTop = anchorRect.bottom + 6;
    const left = clamp(idealLeft, CLOCK_HUB_EDGE_GAP_PX, Math.max(CLOCK_HUB_EDGE_GAP_PX, viewportWidth - modalWidth - CLOCK_HUB_EDGE_GAP_PX));
    const top = clamp(
      idealTop,
      CLOCK_HUB_EDGE_GAP_PX,
      Math.max(CLOCK_HUB_EDGE_GAP_PX, viewportHeight - CLOCK_HUB_MIN_VISIBLE_HEIGHT_PX - CLOCK_HUB_EDGE_GAP_PX),
    );
    const maxHeight = Math.max(CLOCK_HUB_MIN_VISIBLE_HEIGHT_PX, viewportHeight - top - CLOCK_HUB_EDGE_GAP_PX);
    modal.style.setProperty('--clock-hub-left', `${Math.round(left)}px`);
    modal.style.setProperty('--clock-hub-top', `${Math.round(top)}px`);
    modal.style.setProperty('--clock-hub-max-height', `${Math.round(maxHeight)}px`);
  }

  function openClockHub(anchor) {
    const modal = document.getElementById('clock-hub-modal');
    if (!modal) return;
    updateClockHubDate();
    positionClockHub(anchor, modal);

    const activeAnchor = anchor;
    const reposition = () => {
      if (modal.open) positionClockHub(activeAnchor, modal);
    };
    const teardown = () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };

    if (modal.open) {
      window.requestAnimationFrame(reposition);
      return;
    }

    const opts = {
      onOpen() {
        window.requestAnimationFrame(reposition);
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
      },
      onClose: teardown,
    };

    if (typeof HubModal !== 'undefined') HubModal.open(modal, opts);
    else if (typeof modal.showModal === 'function') {
      modal.showModal();
      opts.onOpen();
      modal.addEventListener('close', teardown, { once: true });
    }
  }

  const ClockHubGestureMachine = (() => {
    let machineState = 'IDLE';
    let pendingTapTimer = null;
    let pendingTapContext = null;
    let longPressTimer = null;
    let pressContext = null;
    let suppressTimer = null;
    let lastDoubleAt = 0;
    const transitions = {
      IDLE: {
        pointerDown: { next: 'PRESSING', actions: ['startLongPressTimer'] },
        click: { next: 'TAP_PENDING', actions: ['startTapTimer'] },
        doubleTap: { next: 'DOUBLE_HANDLED', actions: ['clearTapTimer', 'reservedDoubleTap', 'startClickSuppressTimer'] },
      },
      TAP_PENDING: {
        pointerDown: { next: 'PRESSING', actions: ['startLongPressTimer'] },
        click: { next: 'TAP_PENDING', actions: ['startTapTimer'] },
        doubleTap: { next: 'DOUBLE_HANDLED', actions: ['clearTapTimer', 'reservedDoubleTap', 'startClickSuppressTimer'] },
        tapTimeout: { next: 'IDLE', actions: ['openHub', 'clearTapContext'] },
        longPressTimeout: { next: 'CLICK_SUPPRESSED', actions: ['markLongPress', 'clearTapTimer', 'reservedLongPress', 'startClickSuppressTimer'] },
      },
      PRESSING: {
        pointerMove: { next: 'PRESSING', actions: ['cancelLongPressIfMoved'] },
        pointerUp: { next: 'IDLE', actions: ['clearLongPressTimer'] },
        pointerCancel: { next: 'IDLE', actions: ['clearLongPressTimer'] },
        longPressTimeout: { next: 'CLICK_SUPPRESSED', actions: ['markLongPress', 'clearTapTimer', 'reservedLongPress', 'startClickSuppressTimer'] },
      },
      CLICK_SUPPRESSED: {
        click: { next: 'IDLE', actions: ['clearClickSuppressTimer'] },
        pointerUp: { next: 'CLICK_SUPPRESSED', actions: ['clearLongPressTimer'] },
        pointerCancel: { next: 'CLICK_SUPPRESSED', actions: ['clearLongPressTimer'] },
        suppressTimeout: { next: 'IDLE', actions: ['clearClickSuppressTimer'] },
      },
      DOUBLE_HANDLED: {
        click: { next: 'IDLE', actions: ['clearClickSuppressTimer'] },
        pointerDown: { next: 'PRESSING', actions: ['startLongPressTimer'] },
        suppressTimeout: { next: 'IDLE', actions: ['clearClickSuppressTimer'] },
      },
    };

    function clearTapTimer() {
      if (pendingTapTimer) window.clearTimeout(pendingTapTimer);
      pendingTapTimer = null;
    }

    function clearTapContext() {
      pendingTapContext = null;
    }

    function clearLongPressTimer() {
      if (longPressTimer) window.clearTimeout(longPressTimer);
      longPressTimer = null;
      pressContext = null;
    }

    function clearClickSuppressTimer() {
      if (suppressTimer) window.clearTimeout(suppressTimer);
      suppressTimer = null;
    }

    function eventTime(context) {
      return Number.isFinite(context?.time) ? context.time : window.performance.now();
    }

    function isSameTap(context, pending) {
      if (!context?.anchor || !pending?.anchor || context.anchor !== pending.anchor) return false;
      const elapsed = eventTime(context) - eventTime(pending);
      const moved = Math.hypot((context.x || 0) - (pending.x || 0), (context.y || 0) - (pending.y || 0));
      return elapsed <= CLOCK_HUB_DOUBLE_TAP_MS && moved <= CLOCK_HUB_MOVE_TOLERANCE_PX;
    }

    function noteDoubleTap() {
      const now = window.performance.now();
      if (now - lastDoubleAt < 80) return false;
      lastDoubleAt = now;
      return true;
    }

    function startTapTimer(context) {
      clearTapTimer();
      pendingTapContext = context;
      pendingTapTimer = window.setTimeout(() => {
        dispatch('tapTimeout', pendingTapContext);
      }, CLOCK_HUB_DOUBLE_TAP_MS);
    }

    function startLongPressTimer(context) {
      clearLongPressTimer();
      pressContext = {
        ...context,
        startX: context?.x || 0,
        startY: context?.y || 0,
      };
      longPressTimer = window.setTimeout(() => {
        dispatch('longPressTimeout', pressContext);
      }, CLOCK_HUB_LONG_PRESS_MS);
    }

    function cancelLongPressIfMoved(context) {
      if (!longPressTimer || !pressContext) return;
      const moved = Math.hypot((context?.x || 0) - pressContext.startX, (context?.y || 0) - pressContext.startY);
      if (moved > CLOCK_HUB_MOVE_TOLERANCE_PX) clearLongPressTimer();
    }

    function startClickSuppressTimer() {
      clearClickSuppressTimer();
      suppressTimer = window.setTimeout(() => {
        dispatch('suppressTimeout', { eventName: 'suppress-timeout' });
      }, 700);
    }

    function runAction(action, context) {
      if (action === 'startTapTimer') {
        startTapTimer(context);
        return;
      }
      if (action === 'clearTapTimer') {
        clearTapTimer();
        clearTapContext();
        return;
      }
      if (action === 'clearTapContext') {
        clearTapContext();
        return;
      }
      if (action === 'startLongPressTimer') {
        startLongPressTimer(context);
        return;
      }
      if (action === 'clearLongPressTimer') {
        clearLongPressTimer();
        return;
      }
      if (action === 'cancelLongPressIfMoved') {
        cancelLongPressIfMoved(context);
        return;
      }
      if (action === 'markLongPress') {
        clearLongPressTimer();
        return;
      }
      if (action === 'startClickSuppressTimer') {
        startClickSuppressTimer();
        return;
      }
      if (action === 'clearClickSuppressTimer') {
        clearClickSuppressTimer();
        return;
      }
      if (action === 'openHub') openClockHub(context?.anchor);
    }

    function dispatch(input, context = {}) {
      if (input === 'click' && (context.detail >= 2 || isSameTap(context, pendingTapContext))) input = 'doubleTap';
      if (input === 'doubleTap' && !noteDoubleTap()) return machineState;
      const transition = transitions[machineState]?.[input];
      if (!transition) return machineState;
      machineState = transition.next;
      transition.actions.forEach(action => runAction(action, context));
      return machineState;
    }

    function eventContext(anchor, event) {
      return {
        anchor,
        detail: Number(event?.detail || 0),
        eventName: event?.type || '',
        pointerId: event?.pointerId,
        time: window.performance.now(),
        x: Number.isFinite(event?.clientX) ? event.clientX : 0,
        y: Number.isFinite(event?.clientY) ? event.clientY : 0,
      };
    }

    return {
      dispatch,
      eventContext,
      getState: () => machineState,
    };
  })();

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

    root.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      ClockHubGestureMachine.dispatch('pointerDown', ClockHubGestureMachine.eventContext(root, event));
    });

    root.addEventListener('pointermove', event => {
      ClockHubGestureMachine.dispatch('pointerMove', ClockHubGestureMachine.eventContext(root, event));
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
      root.addEventListener(type, event => {
        ClockHubGestureMachine.dispatch(type === 'pointerup' ? 'pointerUp' : 'pointerCancel', ClockHubGestureMachine.eventContext(root, event));
      });
    });

    root.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      ClockHubGestureMachine.dispatch('click', ClockHubGestureMachine.eventContext(root, event));
    });

    root.addEventListener('dblclick', event => {
      event.preventDefault();
      event.stopPropagation();
      ClockHubGestureMachine.dispatch('doubleTap', ClockHubGestureMachine.eventContext(root, event));
    });

    root.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openClockHub(root);
    });

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
