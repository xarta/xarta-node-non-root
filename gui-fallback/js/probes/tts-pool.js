/* ── TTS Pool Test Page ──────────────────────────────────────────────────────
 *
 * Handles the tts-pool tab: context selection, status check, synthesis proxy,
 * and voice samples.
 * Entry point: _ttsPoolLoadTab() — called lazily from app.js switchTab().
 *
 * All API calls go through apiFetch() (auth-wrapped) to the Blueprints
 * backend at /api/v1/tts-pool/*. The backend resolves the active TTS pool
 * context from the database and proxies to that active selection.
 * ─────────────────────────────────────────────────────────────────────────── */

'use strict';

// ── Module state ──────────────────────────────────────────────────────────────

let _ttsPoolLoaded    = false;
let _ttsPoolGenerating = false;
let _ttsPoolAudioBlob  = null;
let _ttsPoolVoiceListData = [];
let _ttsPoolContexts = [];
let _ttsPoolActiveContextKey = '';
let _ttsPoolPendingContextKey = '';
let _ttsPoolLatestStatus = null;

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _el(id) { return document.getElementById(id); }

function _ttsPoolGetContextByKey(key) {
  if (!key) return null;
  return _ttsPoolContexts.find(ctx => ctx.key === key) || null;
}

function _ttsPoolGetActiveContext() {
  return _ttsPoolGetContextByKey(_ttsPoolActiveContextKey) || _ttsPoolContexts[0] || null;
}

function _ttsPoolGetContextDisplayName(context) {
  if (!context) return '';
  return context.menu_label || context.label || context.key || '';
}

function _ttsPoolContextSummary(context) {
  if (!context) return 'No TTS pool contexts are configured yet.';
  const parts = [];
  if (context.description) parts.push(context.description);
  if (context.provider_alias) parts.push(`Promotes ${context.provider_alias}`);
  if (context.supports_streaming) parts.push('Streaming capable');
  if (context.supports_voice_cloning) parts.push('Voice cloning available');
  return parts.join(' · ') || 'No additional context details available.';
}

function _ttsPoolShortenLabel(label, maxLen) {
  const text = String(label || '').trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function _ttsPoolMaybeHuggingFaceUrl(modelName) {
  const value = String(modelName || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) return '';
  return `https://huggingface.co/${value}`;
}

function _ttsPoolFormatEndpointStatus(endpoint, okText, missingText) {
  if (!endpoint) return 'Unknown';
  if (endpoint.ok) return okText;
  if (endpoint.status === 404) return missingText;
  if (endpoint.error) return endpoint.error;
  if (endpoint.status === 'timeout') return 'Timed out';
  if (endpoint.status === 'error') return 'Probe error';
  if (endpoint.status != null) return `HTTP ${endpoint.status}`;
  return 'Unavailable';
}

function _ttsPoolBuildEngineField(label, valueHtml) {
  return `<div class="tts-pool-engine-card__item">
    <div class="tts-pool-engine-card__item-label">${_escHtml(label)}</div>
    <div class="tts-pool-engine-card__item-value">${valueHtml || '—'}</div>
  </div>`;
}

function _ttsPoolRenderEngineCard() {
  const titleEl = _el('tts-pool-engine-title');
  const summaryEl = _el('tts-pool-engine-summary');
  const gridEl = _el('tts-pool-engine-detail-grid');
  const chipsEl = _el('tts-pool-engine-capabilities');
  const linksEl = _el('tts-pool-engine-links');

  const statusData = _ttsPoolLatestStatus || {};
  const active = statusData.active_context || _ttsPoolGetActiveContext();
  const stack = statusData.stack || {};
  const healthBody = stack && typeof stack.body === 'object' ? stack.body : {};
  const endpoints = stack && typeof stack.endpoints === 'object' ? stack.endpoints : {};
  const modelsEndpoint = endpoints.models || null;
  const voicesEndpoint = endpoints.voices || null;
  const modelIds = Array.isArray(stack.model_ids) ? stack.model_ids.filter(Boolean) : [];
  const voiceIds = Array.isArray(stack.voice_ids) ? stack.voice_ids.filter(Boolean) : [];
  const localVoiceCount = Array.isArray(_ttsPoolVoiceListData) ? _ttsPoolVoiceListData.length : 0;
  const pushedVoiceCount = Array.isArray(_ttsPoolVoiceListData)
    ? _ttsPoolVoiceListData.filter(sample => sample && sample.on_stack).length
    : 0;
  const serviceRoot = String(active?.base_url || '').trim();
  const speechPath = serviceRoot ? `${serviceRoot.replace(/\/$/, '')}/v1/audio/speech` : '';
  const modelName = String(healthBody.model || healthBody.model_name || '').trim();
  const modelRepoUrl = String(active?.model_url || '').trim() || _ttsPoolMaybeHuggingFaceUrl(modelName);

  if (titleEl) {
    titleEl.textContent = active ? (_ttsPoolGetContextDisplayName(active) || active.key || 'TTS Pool') : 'TTS Pool';
  }
  if (summaryEl) {
    summaryEl.textContent = _ttsPoolContextSummary(active);
  }

  if (gridEl) {
    const aliases = [active?.provider_alias, active?.private_alias].filter(Boolean).map(_escHtml).join('<br>') || '—';
    const apiBase = serviceRoot
      ? `<a href="${_escAttr(serviceRoot)}" target="_blank" rel="noreferrer">${_escHtml(serviceRoot)}</a>`
      : '—';
    const sshTarget = active?.ssh_host ? `<code>root@${_escHtml(active.ssh_host)}</code>` : '—';
    const voicesPath = active?.voices_path ? `<code>${_escHtml(active.voices_path)}</code>` : '—';
    const speechPathHtml = speechPath ? `<code>${_escHtml(speechPath)}</code>` : '—';
    const modelsSummary = _ttsPoolFormatEndpointStatus(
      modelsEndpoint,
      `${modelIds.length || 'Published'} model${modelIds.length === 1 ? '' : 's'} exposed`,
      'No /v1/models endpoint'
    );
    const voiceCatalogSummary = _ttsPoolFormatEndpointStatus(
      voicesEndpoint,
      `${voiceIds.length || 'Built-in'} voice${voiceIds.length === 1 ? '' : 's'} listed`,
      'No /v1/voices endpoint'
    );

    gridEl.innerHTML = [
      _ttsPoolBuildEngineField('Aliases', aliases),
      _ttsPoolBuildEngineField('API Base', apiBase),
      _ttsPoolBuildEngineField('Stack Host', sshTarget),
      _ttsPoolBuildEngineField('Speech Path', speechPathHtml),
      _ttsPoolBuildEngineField('Voices Path', voicesPath),
      _ttsPoolBuildEngineField('Model Registry', _escHtml(modelsSummary)),
      _ttsPoolBuildEngineField('Voice Catalog', _escHtml(voiceCatalogSummary)),
    ].join('');
  }

  if (chipsEl) {
    const chips = [];
    chips.push(serviceRoot
      ? '<span class="tts-pool-engine-card__chip tts-pool-engine-card__chip--ok">OpenAI speech path</span>'
      : '<span class="tts-pool-engine-card__chip tts-pool-engine-card__chip--warn">No active service base URL</span>');
    chips.push(active?.supports_voice_cloning
      ? '<span class="tts-pool-engine-card__chip tts-pool-engine-card__chip--ok">Voice cloning</span>'
      : '<span class="tts-pool-engine-card__chip tts-pool-engine-card__chip--warn">No voice cloning</span>');
    chips.push(active?.supports_streaming
      ? '<span class="tts-pool-engine-card__chip tts-pool-engine-card__chip--ok">Streaming capable</span>'
      : '<span class="tts-pool-engine-card__chip tts-pool-engine-card__chip--warn">Single-shot generation</span>');
    if (healthBody.device) {
      chips.push(`<span class="tts-pool-engine-card__chip">${_escHtml(String(healthBody.device))}</span>`);
    }
    if (localVoiceCount || pushedVoiceCount) {
      chips.push(`<span class="tts-pool-engine-card__chip">${pushedVoiceCount}/${localVoiceCount} stack-ready voices</span>`);
    }
    if (voicesEndpoint && voicesEndpoint.status === 404) {
      chips.push('<span class="tts-pool-engine-card__chip tts-pool-engine-card__chip--warn">No direct /v1/voices catalog</span>');
    }
    chipsEl.innerHTML = chips.join('');
  }

  if (linksEl) {
    const links = [];
    if (serviceRoot) {
      links.push(`<a class="tts-pool-engine-card__link" href="${_escAttr(serviceRoot)}" target="_blank" rel="noreferrer">Open service</a>`);
      links.push(`<a class="tts-pool-engine-card__link" href="${_escAttr(serviceRoot.replace(/\/$/, '') + '/health')}" target="_blank" rel="noreferrer">Health endpoint</a>`);
    }
    if (modelRepoUrl) {
      links.push(`<a class="tts-pool-engine-card__link" href="${_escAttr(modelRepoUrl)}" target="_blank" rel="noreferrer">Model repo</a>`);
    }
    if (active?.repo_url) {
      links.push(`<a class="tts-pool-engine-card__link" href="${_escAttr(active.repo_url)}" target="_blank" rel="noreferrer">Upstream repo</a>`);
    }
    if (active?.docs_url) {
      links.push(`<a class="tts-pool-engine-card__link" href="${_escAttr(active.docs_url)}" target="_blank" rel="noreferrer">Docs</a>`);
    }
    linksEl.innerHTML = links.join('');
  }
}

function _ttsPoolUpdateContextMenuItem() {
  if (typeof ProbesMenuConfig === 'undefined' || !Array.isArray(ProbesMenuConfig.currentMenu)) return;
  const item = ProbesMenuConfig.currentMenu.find(entry => entry.id === 'tts-fn-context');
  if (!item) return;
  const nextLabel = _ttsPoolContextMenuLabel();
  if (item.label === nextLabel) return;
  item.label = nextLabel;
  if (typeof ProbesMenuConfig.updateActiveTab === 'function') {
    const activePanel = document.querySelector('.tab-panel.active');
    const activeTabId = activePanel ? activePanel.id.replace('tab-', '') : 'tts-pool';
    ProbesMenuConfig.updateActiveTab(activeTabId);
  }
}

function _ttsPoolSetStatus(dot, label, model) {
  const dotEl   = _el('tts-pool-status-dot');
  const labelEl = _el('tts-pool-status-label');
  const modelEl = _el('tts-pool-status-model');

  if (dotEl) {
    dotEl.className = 'tts-pool-status-dot';
    if (dot) dotEl.classList.add(`tts-pool-status-dot--${dot}`);
  }
  if (labelEl) labelEl.textContent = label || '';
  if (modelEl) modelEl.textContent = model || '';
}

function _ttsPoolSetContextStatus(msg, isError) {
  const el = _el('tts-pool-context-modal-status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--err)' : 'var(--text-dim)';
}

function _ttsPoolRenderContextModalDetail(context) {
  const descEl = _el('tts-pool-context-modal-detail');
  if (!descEl) return;
  descEl.textContent = _ttsPoolContextSummary(context);
}

function _ttsPoolSyncContextModalSelection() {
  const sel = _el('tts-pool-context-modal-select');
  const activateBtn = _el('tts-pool-context-modal-activate-btn');
  if (!sel) return;
  sel.innerHTML = '';
  _ttsPoolContexts.forEach(ctx => {
    const opt = document.createElement('option');
    opt.value = ctx.key;
    opt.textContent = _ttsPoolGetContextDisplayName(ctx) || ctx.key;
    sel.appendChild(opt);
  });
  if (!_ttsPoolContexts.length) {
    _ttsPoolPendingContextKey = '';
    if (activateBtn) activateBtn.disabled = true;
    _ttsPoolRenderContextModalDetail(null);
    return;
  }
  if (activateBtn) activateBtn.disabled = false;
  const selectedKey = _ttsPoolGetContextByKey(_ttsPoolPendingContextKey)
    ? _ttsPoolPendingContextKey
    : (_ttsPoolActiveContextKey || _ttsPoolContexts[0].key);
  _ttsPoolPendingContextKey = selectedKey;
  sel.value = selectedKey;
  _ttsPoolRenderContextModalDetail(_ttsPoolGetContextByKey(selectedKey));
}

function _ttsPoolRenderContexts(contexts, activeContext) {
  _ttsPoolContexts = Array.isArray(contexts) ? contexts : [];
  _ttsPoolActiveContextKey = activeContext?.key || (contexts[0]?.key || '');
  _ttsPoolPendingContextKey = _ttsPoolActiveContextKey;
  _ttsPoolSyncContextModalSelection();
  _ttsPoolUpdateContextMenuItem();
  _ttsPoolRenderEngineCard();
}

async function _ttsPoolLoadContexts() {
  _ttsPoolSetContextStatus('Loading…', false);
  try {
    const resp = await apiFetch('/api/v1/tts-pool/contexts');
    if (!resp.ok) {
      _ttsPoolSetContextStatus(`Error ${resp.status}`, true);
      return null;
    }
    const data = await resp.json();
    _ttsPoolLatestStatus = data;
    _ttsPoolRenderContexts(data.contexts || [], data.active_context || null);
    const active = data.active_context || _ttsPoolGetActiveContext();
    _ttsPoolSetContextStatus(active ? `Active: ${_ttsPoolGetContextDisplayName(active) || active.key}` : 'No active context', false);
    _ttsPoolRenderEngineCard();
    return data;
  } catch (err) {
    _ttsPoolSetContextStatus(`Context error: ${err.message || err}`, true);
    return null;
  }
}

function _ttsPoolSynthStatus(msg, isError) {
  const el    = _el('tts-pool-synth-status');
  const errEl = _el('tts-pool-synth-error');
  if (!el) return;
  if (isError) {
    el.textContent = '';
    if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
  } else {
    if (errEl) errEl.hidden = true;
    el.textContent = msg || '';
  }
}

function _ttsPoolVoicesError(msg) {
  const el = _el('tts-pool-voices-error');
  if (!el) return;
  if (msg) { el.textContent = msg; el.hidden = false; }
  else     { el.hidden = true; }
}

// ── Format helpers ────────────────────────────────────────────────────────────

function _ttsPoolFormatBytes(bytes) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Status check ──────────────────────────────────────────────────────────────

async function _ttsPoolLoadStatus() {
  _ttsPoolSetStatus(null, 'Loading\u2026', '');
  try {
    const resp = await apiFetch('/api/v1/tts-pool/status');
    if (!resp.ok) {
      _ttsPoolSetStatus('error', `Error ${resp.status}`, '');
      return null;
    }
    const data = await resp.json();
    _ttsPoolLatestStatus = data;
    if (Array.isArray(data.contexts)) {
      _ttsPoolRenderContexts(data.contexts, data.active_context || null);
    }
    if (data.active_context) {
      _ttsPoolActiveContextKey = data.active_context.key || _ttsPoolActiveContextKey;
      _ttsPoolPendingContextKey = _ttsPoolActiveContextKey;
      _ttsPoolSetContextStatus(`Active: ${_ttsPoolGetContextDisplayName(data.active_context) || data.active_context.key}`, false);
      _ttsPoolSyncContextModalSelection();
    } else {
      _ttsPoolSetContextStatus('No active context', false);
    }

    if (!data.configured || data.missing_settings?.length) {
      const count = (data.missing_settings || []).length;
      _ttsPoolSetStatus('warn', `Not configured — ${count} setting${count !== 1 ? 's' : ''} missing`, '');
      return data;
    }

    const stack = data.stack;
    if (!stack || !stack.reachable) {
      const reason = stack?.error || 'unreachable';
      _ttsPoolSetStatus('error', `Stack offline — ${reason}`, '');
      return data;
    }

    if (stack.http_status !== 200) {
      _ttsPoolSetStatus('warn', `Stack HTTP ${stack.http_status}`, '');
      return data;
    }

    // Extract model name from health body if available.
    const body = stack.body || {};
    const modelName = body.model || body.model_name || '';
    const device    = body.device || '';
    const contextLabel = _ttsPoolGetContextDisplayName(data.active_context) || '';
    const modelLabel = [contextLabel, modelName, device].filter(Boolean).join(' \u00b7 ');

    _ttsPoolSetStatus('ok', 'Stack online', modelLabel);
    _ttsPoolRenderEngineCard();
    return data;
  } catch (err) {
    _ttsPoolSetStatus('error', `Status error: ${err.message || err}`, '');
    _ttsPoolRenderEngineCard();
    return null;
  }
}

// ── Voice samples ─────────────────────────────────────────────────────────────

async function _ttsPoolLoadVoiceSamples() {
  const listEl = _el('tts-pool-voice-list');
  if (listEl) listEl.innerHTML = '<span class="spinner"></span>';
  _ttsPoolVoicesError('');

  try {
    const resp = await apiFetch('/api/v1/tts-pool/voice-samples');
    if (!resp.ok) {
      _ttsPoolVoicesError(`Failed to load voice samples (HTTP ${resp.status})`);
      if (listEl) listEl.innerHTML = '';
      return;
    }

    const data = await resp.json();
    _ttsPoolVoiceListData = data.samples || [];
    _ttsPoolRenderVoiceSamples(data.samples || [], data.stack_ssh_configured);
    _ttsPoolRebuildVoiceSelector(data.samples || []);
    _ttsPoolRenderEngineCard();
  } catch (err) {
    _ttsPoolVoicesError(`Error loading samples: ${err.message || err}`);
    if (listEl) listEl.innerHTML = '';
    _ttsPoolRenderEngineCard();
  }
}

function _ttsPoolRenderVoiceSamples(samples, sshConfigured) {
  const listEl = _el('tts-pool-voice-list');
  if (!listEl) return;

  if (!samples.length) {
    listEl.innerHTML = '<p style="font-size:12px;color:var(--text-dim)">No voice samples found in the configured directory.</p>';
    return;
  }

  const items = samples.map(s => {
    const onStack = s.on_stack;
    const stateClass = onStack ? 'tts-pool-voice-item__state--on-stack' : 'tts-pool-voice-item__state--off-stack';
    const stateText  = onStack ? '\u2713 On stack' : 'Not on stack';
    const pushBtnDisabled = onStack && !sshConfigured ? 'disabled' : '';
    const pushBtnLabel = onStack ? 'Re-push' : 'Push to stack';

    return `<div class="tts-pool-voice-item" data-filename="${_escHtml(s.filename)}">
  <div class="tts-pool-voice-item__name">${_escHtml(s.filename)}</div>
  <span class="tts-pool-voice-item__meta">${_ttsPoolFormatBytes(s.size_bytes)} &middot; ${_escHtml(s.format)}</span>
  <span class="tts-pool-voice-item__state ${stateClass}" id="tts-pool-voice-state-${_escAttr(s.filename)}">${stateText}</span>
  <div class="tts-pool-voice-item__actions">
    <button class="secondary" style="font-size:12px" data-tts-push="${_escAttr(s.filename)}" ${pushBtnDisabled}>${pushBtnLabel}</button>
  </div>
</div>`;
  });

  listEl.innerHTML = items.join('\n');
}

function _ttsPoolRebuildVoiceSelector(samples) {
  const sel = _el('tts-pool-voice-select');
  if (!sel) return;

  // Remove any previously injected user voice options
  Array.from(sel.options).forEach(opt => {
    if (opt.dataset.userVoice) opt.remove();
  });

  // Stack-present user voices go after the standard options
  const stackVoices = samples.filter(s => s.on_stack);
  if (stackVoices.length) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '\u2500\u2500 cloned voices \u2500\u2500';
    sep.dataset.userVoice = '1';
    sel.appendChild(sep);

    stackVoices.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.filename;
      opt.textContent = s.filename.replace(/\.\w+$/, '');   // strip extension for display
      opt.dataset.userVoice = '1';
      sel.appendChild(opt);
    });
  }
}

// ── Voice push ────────────────────────────────────────────────────────────────

async function _ttsPoolPushVoice(filename) {
  const btn = document.querySelector(`[data-tts-push="${CSS.escape(filename)}"]`);
  const stateEl = _el(`tts-pool-voice-state-${filename}`);
  const origText = btn ? btn.textContent : '';

  if (btn) { btn.disabled = true; btn.textContent = 'Pushing\u2026'; }

  try {
    const resp = await apiFetch(`/api/v1/tts-pool/push-voice/${encodeURIComponent(filename)}`, {
      method: 'POST',
    });
    const data = await resp.json();

    if (resp.ok && data.ok) {
      if (btn) { btn.textContent = 'Re-push'; btn.disabled = false; }
      if (stateEl) {
        stateEl.className = 'tts-pool-voice-item__state tts-pool-voice-item__state--on-stack';
        stateEl.textContent = '\u2713 On stack';
      }
      // Rebuild the voice selector to include the newly pushed voice
      await _ttsPoolLoadVoiceSamples();
    } else {
      if (btn) { btn.textContent = origText; btn.disabled = false; }
      _ttsPoolVoicesError(`Push failed: ${data.detail || 'unknown error'}`);
    }
  } catch (err) {
    if (btn) { btn.textContent = origText; btn.disabled = false; }
    _ttsPoolVoicesError(`Push error: ${err.message || err}`);
  }
}

async function _ttsPoolActivateContext(contextKey, btn) {
  contextKey = (contextKey || '').trim();
  if (!contextKey) {
    _ttsPoolSetContextStatus('Choose a context first.', true);
    return false;
  }
  if (btn) btn.disabled = true;
  _ttsPoolSetContextStatus('Activating…', false);
  try {
    const resp = await apiFetch('/api/v1/tts-pool/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context_key: contextKey }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      _ttsPoolSetContextStatus(data.detail || `HTTP ${resp.status}`, true);
      return false;
    }
    _ttsPoolActiveContextKey = data.active_context?.key || contextKey;
    _ttsPoolPendingContextKey = _ttsPoolActiveContextKey;
    _ttsPoolSyncContextModalSelection();
    _ttsPoolSetContextStatus(`Active: ${_ttsPoolGetContextDisplayName(data.active_context) || contextKey}`, false);
    await _ttsPoolLoadStatus();
    await _ttsPoolLoadVoiceSamples();
    if (typeof ProbesMenuConfig !== 'undefined' && typeof ProbesMenuConfig.updateActiveTab === 'function') {
      ProbesMenuConfig.updateActiveTab('tts-pool');
    }
    return true;
  } catch (err) {
    _ttsPoolSetContextStatus(`Activation error: ${err.message || err}`, true);
    return false;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function _ttsPoolRefreshAll() {
  const statusData = await _ttsPoolLoadStatus();
  if (!statusData || !Array.isArray(statusData.contexts) || !statusData.contexts.length) {
    await _ttsPoolLoadContexts();
  }
  await _ttsPoolLoadVoiceSamples();
  if (typeof ProbesMenuConfig !== 'undefined' && typeof ProbesMenuConfig.updateActiveTab === 'function') {
    ProbesMenuConfig.updateActiveTab('tts-pool');
  }
}

function _ttsPoolContextMenuLabel() {
  const active = _ttsPoolGetActiveContext();
  if (!active) return 'Switch Engine';
  return _ttsPoolShortenLabel(_ttsPoolGetContextDisplayName(active), 24);
}

async function openTtsPoolContextModal() {
  const dialog = _el('tts-pool-context-modal');
  if (!dialog) return;
  if (!_ttsPoolContexts.length) {
    await _ttsPoolLoadContexts();
  } else {
    _ttsPoolSyncContextModalSelection();
    const active = _ttsPoolGetActiveContext();
    _ttsPoolSetContextStatus(active ? `Active: ${_ttsPoolGetContextDisplayName(active) || active.key}` : 'No active context', false);
  }
  if (typeof HubModal !== 'undefined') {
    HubModal.open(dialog, {
      onOpen: () => {
        const sel = _el('tts-pool-context-modal-select');
        if (sel) sel.focus();
      },
      onClose: () => {
        _ttsPoolPendingContextKey = _ttsPoolActiveContextKey;
        _ttsPoolSetContextStatus('', false);
      },
    });
  } else if (!dialog.open) {
    dialog.showModal();
  }
}

// ── Synthesis ─────────────────────────────────────────────────────────────────

async function _ttsPoolGenerate() {
  if (_ttsPoolGenerating) return;

  const textEl   = _el('tts-pool-text-input');
  const voiceSel = _el('tts-pool-voice-select');
  const fmtSel   = _el('tts-pool-format-select');
  const btn      = _el('tts-pool-generate-btn');
  const resultEl = _el('tts-pool-audio-result');
  const audioEl  = _el('tts-pool-audio');
  const dlBtn    = _el('tts-pool-download-btn');

  const text  = (textEl?.value || '').trim();
  const voice = voiceSel?.value || 'alloy';
  const fmt   = fmtSel?.value || 'wav';

  if (!text) {
    _ttsPoolSynthStatus('Enter some text to synthesise.', true);
    return;
  }

  _ttsPoolGenerating = true;
  _ttsPoolAudioBlob = null;
  _ttsPoolSynthStatus('Generating\u2026');
  if (resultEl) resultEl.hidden = true;
  if (dlBtn)    dlBtn.hidden = true;
  if (btn)      btn.disabled = true;

  // Hide metric badges from previous run
  const ttfaBadge = _el('tts-pool-ttfa-badge');
  const rtfBadge  = _el('tts-pool-rtf-badge');
  if (ttfaBadge) ttfaBadge.hidden = true;
  if (rtfBadge)  rtfBadge.hidden = true;

  const startMs = Date.now();

  try {
    const resp = await apiFetch('/api/v1/tts-pool/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, format: fmt }),
    });

    if (!resp.ok) {
      let errMsg = `HTTP ${resp.status}`;
      try {
        const errData = await resp.json();
        if (errData.detail) errMsg = errData.detail;
      } catch (_) {}
      _ttsPoolSynthStatus(errMsg, true);
      return;
    }

    const elapsedMs = Date.now() - startMs;
    const blob = await resp.blob();

    if (!blob.size) {
      _ttsPoolSynthStatus('Empty audio response from stack.', true);
      return;
    }

    _ttsPoolAudioBlob = blob;

    // Revoke any previous object URL and set new one
    if (audioEl) {
      if (audioEl.src && audioEl.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioEl.src);
      }
      audioEl.src = URL.createObjectURL(blob);
      audioEl.load();
    }

    if (resultEl) resultEl.hidden = false;

    // Show elapsed time as TTFA proxy (server-computed X-TTFA not available
    // after buffered blob fetch, so we show client-measured round-trip)
    const ttfaHeader = resp.headers?.get?.('x-ttfa');
    const rtfHeader  = resp.headers?.get?.('x-rtf');

    if (ttfaBadge) {
      const ttfaVal = ttfaHeader ? `${parseFloat(ttfaHeader).toFixed(2)}s` : `${(elapsedMs / 1000).toFixed(2)}s`;
      _el('tts-pool-ttfa-value').textContent = ttfaVal;
      ttfaBadge.hidden = false;
    }
    if (rtfHeader && rtfBadge) {
      _el('tts-pool-rtf-value').textContent = parseFloat(rtfHeader).toFixed(3);
      rtfBadge.hidden = false;
    }

    if (dlBtn) dlBtn.hidden = false;
    _ttsPoolSynthStatus('');

  } catch (err) {
    _ttsPoolSynthStatus(`Error: ${err.message || err}`, true);
  } finally {
    _ttsPoolGenerating = false;
    if (btn) btn.disabled = false;
  }
}

function _ttsPoolDownload() {
  if (!_ttsPoolAudioBlob) return;
  const fmtSel = _el('tts-pool-format-select');
  const fmt = fmtSel?.value || 'wav';
  const url = URL.createObjectURL(_ttsPoolAudioBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tts-pool-output.${fmt}`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Escape helpers ─────────────────────────────────────────────────────────────

function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _escAttr(str) {
  return String(str)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Event wiring ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  _el('tts-pool-context-modal-select')?.addEventListener('change', e => {
    _ttsPoolPendingContextKey = e.target.value || '';
    _ttsPoolRenderContextModalDetail(_ttsPoolGetContextByKey(_ttsPoolPendingContextKey));
  });

  _el('tts-pool-context-modal-refresh-btn')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    if (btn) btn.disabled = true;
    try {
      await _ttsPoolLoadContexts();
      await _ttsPoolLoadStatus();
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  _el('tts-pool-context-modal-activate-btn')?.addEventListener('click', async e => {
    const activated = await _ttsPoolActivateContext(_ttsPoolPendingContextKey, e.currentTarget);
    if (activated) {
      const dialog = _el('tts-pool-context-modal');
      if (dialog?.open && typeof HubModal !== 'undefined') HubModal.close(dialog);
      else if (dialog?.open) dialog.close();
    }
  });

  // Refresh status
  _el('tts-pool-refresh-btn')?.addEventListener('click', _ttsPoolRefreshAll);

  // Refresh voice samples
  _el('tts-pool-voices-refresh-btn')?.addEventListener('click', _ttsPoolLoadVoiceSamples);

  // Generate button
  _el('tts-pool-generate-btn')?.addEventListener('click', _ttsPoolGenerate);

  // Download button
  _el('tts-pool-download-btn')?.addEventListener('click', _ttsPoolDownload);

  // Preset selector fills text area
  _el('tts-pool-preset-select')?.addEventListener('change', e => {
    const val = e.target.value;
    if (!val) return;
    const textEl = _el('tts-pool-text-input');
    if (textEl) textEl.value = val;
  });

  // Push voice buttons (event delegation on the voice list)
  _el('tts-pool-voice-list')?.addEventListener('click', e => {
    const pushBtn = e.target.closest('[data-tts-push]');
    if (!pushBtn || pushBtn.disabled) return;
    const filename = pushBtn.dataset.ttsPush;
    if (filename) _ttsPoolPushVoice(filename);
  });
});

// ── Tab load entry point ───────────────────────────────────────────────────────

/**
 * Called lazily by app.js switchTab() when the tts-pool tab is first shown.
 * Subsequent tab switches skip the re-load (data is refreshed manually).
 */
function _ttsPoolLoadTab() {
  if (_ttsPoolLoaded) return;
  _ttsPoolLoaded = true;
  _ttsPoolLoadContexts();
  _ttsPoolLoadStatus();
  _ttsPoolLoadVoiceSamples();
}
