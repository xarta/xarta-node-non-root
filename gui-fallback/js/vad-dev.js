// vad-dev.js - shell for VAD development surfaces.

'use strict';

const VadDevModal = (() => {
  const state = {
    initialized: false,
    timeline: null,
    timelinePromise: null,
  };
  const els = {};

  function el(id) {
    return document.getElementById(id);
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    els.modal = el('vad-dev-modal');
    els.timeline = el('vad-dev-timeline-module');
  }

  function mountTimeline() {
    init();
    if (state.timeline) {
      state.timeline.scheduleRender?.();
      return Promise.resolve(state.timeline);
    }
    if (state.timelinePromise) return state.timelinePromise;
    const module = window.BlueprintsVoiceTimelineModule;
    if (!els.timeline || typeof module?.create !== 'function') return Promise.resolve(null);
    state.timelinePromise = module.create(els.timeline)
      .then(view => {
        state.timeline = view;
        view?.clear?.();
        view?.scheduleRender?.();
        return view;
      })
      .finally(() => {
        state.timelinePromise = null;
      });
    return state.timelinePromise;
  }

  function open() {
    init();
    if (!els.modal) return;
    if (window.HubModal?.open) {
      HubModal.open(els.modal, { onOpen: () => { void mountTimeline(); } });
    } else if (typeof els.modal.showModal === 'function') {
      els.modal.showModal();
      void mountTimeline();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  return {
    mountTimeline,
    open,
    timeline: () => state.timeline,
  };
})();

window.VadDevModal = VadDevModal;
