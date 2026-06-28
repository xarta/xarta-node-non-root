// Shared allowlisted prompt editor for Personal/Kanban LLM workflows.

'use strict';

const PersonalPrompts = (() => {
  const API_ROOT = '/api/v1/personal/prompts';

  const state = {
    prompts: null,
    listPromise: null,
    listError: '',
    docs: new Map(),
    selectedBySurface: new Map(),
    statusByKey: new Map(),
  };

  function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function keyFor(surface, promptId) {
    return `${surface || 'kanban'}:${promptId || ''}`;
  }

  function setStatus(surface, promptId, tone, text) {
    state.statusByKey.set(keyFor(surface, promptId), { tone, text });
  }

  function clearStatus(surface, promptId) {
    state.statusByKey.delete(keyFor(surface, promptId));
  }

  function scheduleRender() {
    window.PersonalFilters?.renderAll?.();
  }

  async function promptApi(path, options = {}) {
    const requestOptions = { ...options };
    requestOptions.headers = {
      'Content-Type': 'application/json',
      ...(requestOptions.headers || {}),
    };
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher(path, requestOptions);
    if (!resp.ok) {
      let detail = '';
      try {
        const data = await resp.clone().json();
        detail = data?.detail || data?.error || '';
      } catch (_) {}
      throw new Error(detail || `Prompt API failed with HTTP ${resp.status}`);
    }
    return resp.json();
  }

  async function loadList() {
    if (state.listPromise) return state.listPromise;
    state.listError = '';
    state.listPromise = promptApi(API_ROOT)
      .then(data => {
        state.prompts = Array.isArray(data?.prompts) ? data.prompts : [];
        return state.prompts;
      })
      .catch(err => {
        state.prompts = [];
        state.listError = err?.message || String(err || 'Prompt catalog failed to load.');
        throw err;
      })
      .finally(() => {
        state.listPromise = null;
        scheduleRender();
      });
    return state.listPromise;
  }

  function promptsForSurface(surface) {
    const prompts = Array.isArray(state.prompts) ? state.prompts : [];
    const exact = prompts.filter(prompt => {
      const promptSurface = String(prompt?.surface || '').trim();
      return !promptSurface || promptSurface === surface || promptSurface === 'shared';
    });
    return exact.length ? exact : prompts;
  }

  function selectedIdForSurface(surface) {
    const prompts = promptsForSurface(surface);
    const current = state.selectedBySurface.get(surface);
    if (current && prompts.some(prompt => prompt.id === current)) return current;
    const fallback = prompts[0]?.id || '';
    if (fallback) state.selectedBySurface.set(surface, fallback);
    return fallback;
  }

  function docFor(promptId) {
    if (!state.docs.has(promptId)) state.docs.set(promptId, {});
    return state.docs.get(promptId);
  }

  function formatDate(seconds) {
    if (!Number.isFinite(Number(seconds))) return '';
    try {
      return new Date(Number(seconds) * 1000).toLocaleString();
    } catch (_) {
      return '';
    }
  }

  function promptMetaHtml(prompt) {
    if (!prompt) return '';
    const pieces = [
      prompt.group,
      prompt.restart_label,
      formatDate(prompt.updated_at),
      prompt.path,
    ].filter(Boolean);
    return `<div class="personal-prompts__meta">${pieces.map(piece => `<span>${escHtml(piece)}</span>`).join('')}</div>`;
  }

  function actionSummary(actions) {
    const actionList = Array.isArray(actions) ? actions : [];
    if (!actionList.length) return 'APPLY complete.';
    const failed = actionList.find(action => !action?.ok);
    if (!failed) return 'APPLY complete.';
    return failed.stderr_preview || failed.error || 'APPLY action failed.';
  }

  async function getPrompt(surface, promptId, options = {}) {
    if (!promptId) {
      try {
        await loadList();
      } catch (_) {}
      return;
    }
    const doc = docFor(promptId);
    if (doc.loading && !options.force) return;
    doc.loading = true;
    doc.error = '';
    setStatus(surface, promptId, 'loading', 'GET in progress...');
    scheduleRender();
    try {
      const data = await promptApi(`${API_ROOT}/${encodeURIComponent(promptId)}`);
      const prompt = data?.prompt || {};
      state.docs.set(promptId, {
        content: String(prompt.content ?? ''),
        draft: String(prompt.content ?? ''),
        sha256: prompt.sha256 || '',
        loadedAt: Date.now(),
        dirty: false,
        loading: false,
        applying: false,
      });
      setStatus(surface, promptId, 'ok', 'GET complete.');
    } catch (err) {
      doc.loading = false;
      doc.error = err?.message || String(err || 'GET failed.');
      setStatus(surface, promptId, 'error', doc.error);
    }
    scheduleRender();
  }

  async function applyPrompt(surface, promptId, content) {
    if (!promptId) return;
    const doc = docFor(promptId);
    doc.applying = true;
    doc.error = '';
    setStatus(surface, promptId, 'loading', 'APPLY in progress...');
    scheduleRender();
    try {
      const data = await promptApi(`${API_ROOT}/${encodeURIComponent(promptId)}/apply`, {
        method: 'POST',
        body: JSON.stringify({
          content: String(content ?? ''),
          actor: 'blueprints-ui',
          source_surface: `personal-prompts:${surface || 'shared'}`,
          restart: true,
        }),
      });
      const prompt = data?.prompt || {};
      const next = String(prompt.content ?? content ?? '');
      state.docs.set(promptId, {
        content: next,
        draft: next,
        sha256: prompt.sha256 || '',
        loadedAt: Date.now(),
        dirty: false,
        loading: false,
        applying: false,
      });
      setStatus(surface, promptId, data?.ok ? 'ok' : 'error', actionSummary(data?.actions));
    } catch (err) {
      doc.applying = false;
      doc.error = err?.message || String(err || 'APPLY failed.');
      setStatus(surface, promptId, 'error', doc.error);
    }
    scheduleRender();
  }

  function renderTab(surface = 'kanban') {
    const cleanSurface = surface || 'kanban';
    if (!state.prompts && !state.listPromise) {
      window.setTimeout(() => loadList().catch(() => {}), 0);
    }
    if (state.listPromise && !state.prompts) {
      return `<div class="personal-prompts personal-prompts--empty" data-personal-prompts-surface="${escHtml(cleanSurface)}">
        <div class="personal-filter-empty">Loading prompt catalog...</div>
      </div>`;
    }
    if (state.listError && !state.prompts?.length) {
      return `<div class="personal-prompts personal-prompts--empty" data-personal-prompts-surface="${escHtml(cleanSurface)}">
        <div class="personal-filter-empty">${escHtml(state.listError)}</div>
        <button class="personal-filter-command" type="button" data-personal-prompts-action="reload-list">GET</button>
      </div>`;
    }

    const prompts = promptsForSurface(cleanSurface);
    const selectedId = selectedIdForSurface(cleanSurface);
    const prompt = prompts.find(item => item.id === selectedId) || prompts[0] || null;
    const doc = selectedId ? docFor(selectedId) : {};
    const draft = doc.draft ?? '';
    const loaded = Object.prototype.hasOwnProperty.call(doc, 'draft');
    const status = state.statusByKey.get(keyFor(cleanSurface, selectedId));
    const canApply = loaded && !doc.loading && !doc.applying;
    const dirty = loaded && doc.content !== doc.draft;
    if (!prompts.length) {
      return `<div class="personal-prompts personal-prompts--empty" data-personal-prompts-surface="${escHtml(cleanSurface)}">
        <div class="personal-filter-empty">No prompt sources available.</div>
      </div>`;
    }

    return `<div class="personal-prompts" data-personal-prompts-surface="${escHtml(cleanSurface)}" data-personal-prompts-id="${escHtml(selectedId)}">
      <div class="personal-prompts__toolbar">
        <label class="personal-filter-field personal-prompts__source">
          <span>Prompt</span>
          <select data-personal-prompt-select aria-label="Prompt source">
            ${prompts.map(item => `<option value="${escHtml(item.id)}"${item.id === selectedId ? ' selected' : ''}>${escHtml(item.label || item.id)}</option>`).join('')}
          </select>
        </label>
        <button class="personal-filter-command" type="button" data-personal-prompts-action="get"${doc.loading ? ' disabled' : ''}>GET</button>
        <button class="personal-filter-command personal-prompts__apply" type="button" data-personal-prompts-action="apply"${canApply ? '' : ' disabled'}>APPLY</button>
      </div>
      ${promptMetaHtml(prompt)}
      <textarea class="personal-prompts__editor" data-personal-prompt-editor spellcheck="false" ${loaded ? '' : 'readonly'} placeholder="GET loads current prompt">${escHtml(draft)}</textarea>
      <div class="personal-prompts__foot">
        <span class="personal-prompts__dirty"${dirty ? '' : ' hidden'}>Unsaved draft</span>
        <span class="personal-prompts__status${status?.tone ? ` is-${escHtml(status.tone)}` : ''}" role="status">${escHtml(status?.text || (loaded ? 'Loaded.' : 'Ready.'))}</span>
      </div>
    </div>`;
  }

  function bind(host) {
    const root = host?.querySelector?.('.personal-prompts');
    if (!root) return;
    const surface = root.dataset.personalPromptsSurface || host?.dataset?.personalFilterSurface || 'kanban';
    const promptId = root.dataset.personalPromptsId || selectedIdForSurface(surface);
    const reload = root.querySelector('[data-personal-prompts-action="reload-list"]');
    if (reload && reload.dataset.personalPromptsBound !== '1') {
      reload.dataset.personalPromptsBound = '1';
      reload.addEventListener('click', event => {
        event.preventDefault();
        state.prompts = null;
        state.listError = '';
        loadList().catch(() => {});
        scheduleRender();
      });
    }
    const select = root.querySelector('[data-personal-prompt-select]');
    if (select && select.dataset.personalPromptsBound !== '1') {
      select.dataset.personalPromptsBound = '1';
      select.addEventListener('change', event => {
        state.selectedBySurface.set(surface, event.currentTarget.value);
        clearStatus(surface, event.currentTarget.value);
        scheduleRender();
      });
    }
    const getButton = root.querySelector('[data-personal-prompts-action="get"]');
    if (getButton && getButton.dataset.personalPromptsBound !== '1') {
      getButton.dataset.personalPromptsBound = '1';
      getButton.addEventListener('click', event => {
        event.preventDefault();
        getPrompt(surface, promptId, { force: true });
      });
    }
    const applyButton = root.querySelector('[data-personal-prompts-action="apply"]');
    if (applyButton && applyButton.dataset.personalPromptsBound !== '1') {
      applyButton.dataset.personalPromptsBound = '1';
      applyButton.addEventListener('click', event => {
        event.preventDefault();
        const editor = root.querySelector('[data-personal-prompt-editor]');
        applyPrompt(surface, promptId, editor?.value || '');
      });
    }
    const editor = root.querySelector('[data-personal-prompt-editor]');
    if (editor && editor.dataset.personalPromptsBound !== '1') {
      editor.dataset.personalPromptsBound = '1';
      editor.addEventListener('input', event => {
        const doc = docFor(promptId);
        doc.draft = event.currentTarget.value;
        doc.dirty = doc.content !== doc.draft;
        const dirtyFlag = root.querySelector('.personal-prompts__dirty');
        if (dirtyFlag) dirtyFlag.hidden = !doc.dirty;
      });
    }
  }

  return {
    renderTab,
    bind,
    loadList,
  };
})();

window.PersonalPrompts = PersonalPrompts;
