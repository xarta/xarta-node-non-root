/**
 * blueprints-ribbon-fsm.js
 * Small FSM for touch ribbon interactions.
 *
 * States:
 *   IDLE -> PRESSING -> DRAGGING
 *
 * Inputs:
 *   pointerDown, pointerMove, pointerUp, pointerCancel
 *
 * Outputs:
 *   suppressClick boolean when drag occurred
 */
(function () {
  'use strict';

  function noop() {}

  function create(cfg) {
    const dragStartPx = Math.max(2, Number(cfg && cfg.dragStartPx) || 4);
    const onDragStart = (cfg && cfg.onDragStart) || noop;
    const onDragMove = (cfg && cfg.onDragMove) || noop;
    const onDragEnd = (cfg && cfg.onDragEnd) || noop;

    const state = {
      mode: 'IDLE',
      startX: 0,
      movedPx: 0,
    };

    return {
      getState() {
        return state.mode;
      },

      pointerDown(event) {
        state.mode = 'PRESSING';
        state.startX = Number(event && event.clientX) || 0;
        state.movedPx = 0;
        return { suppressClick: false };
      },

      pointerMove(event) {
        if (state.mode === 'IDLE') return { suppressClick: false };

        const x = Number(event && event.clientX) || 0;
        const deltaX = x - state.startX;
        state.movedPx = Math.max(state.movedPx, Math.abs(deltaX));

        if (state.mode === 'PRESSING' && state.movedPx >= dragStartPx) {
          state.mode = 'DRAGGING';
          onDragStart();
        }

        if (state.mode === 'DRAGGING') {
          onDragMove(deltaX);
          return { suppressClick: true };
        }

        return { suppressClick: false };
      },

      pointerUp() {
        if (state.mode === 'DRAGGING') {
          onDragEnd();
          state.mode = 'IDLE';
          return { suppressClick: true };
        }
        state.mode = 'IDLE';
        return { suppressClick: false };
      },

      pointerCancel() {
        if (state.mode === 'DRAGGING') {
          onDragEnd();
        }
        state.mode = 'IDLE';
        return { suppressClick: true };
      },
    };
  }

  window.BlueprintsRibbonFSM = {
    create,
  };
})();
