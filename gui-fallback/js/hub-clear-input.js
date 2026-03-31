(function () {
  'use strict';

  function syncButtonState(inputEl, buttonEl) {
    if (!inputEl || !buttonEl) return;
    buttonEl.hidden = !inputEl.value;
  }

  function wrapInput(inputEl) {
    if (!inputEl || inputEl.dataset.clearInputBound === '1' || !inputEl.parentNode) return;

    var wrapper = document.createElement('div');
    wrapper.className = 'hub-clear-input';
    inputEl.parentNode.insertBefore(wrapper, inputEl);
    wrapper.appendChild(inputEl);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hub-clear-input-btn';
    btn.setAttribute('aria-label', 'Clear search');
    btn.setAttribute('title', 'Clear');
    btn.innerHTML = '&times;';
    wrapper.appendChild(btn);

    function refresh() {
      syncButtonState(inputEl, btn);
    }

    btn.addEventListener('click', function () {
      if (!inputEl.value) return;
      inputEl.value = '';
      refresh();
      inputEl.focus();
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    });

    inputEl.addEventListener('input', refresh);
    inputEl.addEventListener('change', refresh);
    inputEl.dataset.clearInputBound = '1';
    refresh();
  }

  function initAll(root) {
    (root || document).querySelectorAll('input[type="text"][data-clearable-input]').forEach(wrapInput);
  }

  document.addEventListener('DOMContentLoaded', function () {
    initAll(document);
  });

  window.HubClearInput = {
    initAll: initAll,
  };
}());