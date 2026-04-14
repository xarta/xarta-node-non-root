/* ── Settings ─────────────────────────────────────────────────────────── */
const _SETTING_COLS = ['key', 'value', 'description', 'updated_at', '_actions'];
const _SETTING_FIELD_META = {
  key: { label: 'Key', sortKey: 'key' },
  value: { label: 'Value', sortKey: 'value' },
  description: { label: 'Description', sortKey: 'description' },
  updated_at: { label: 'Updated', sortKey: 'updated_at' },
  _actions: { label: 'Actions' },
};

const _SETTING_ACTION_INLINE_WIDTH = 62;
const _SETTING_ACTION_COMPACT_WIDTH = 48;
const _SETTING_RICH_VALUE_KEYS = new Set([
  'embedding_rare_domains',
  'embedding_excluded_tags',
]);

const _TTS_SETTING_META = {
  'tts.default_voice': {
    description: 'Default voice ID for Blueprints TTS wrapper endpoint',
  },
  'tts.default_message': {
    description: 'Default speech text used when callers omit text',
  },
  'tts.volume': {
    description: 'Default playback volume for streamed TTS audio (0-1)',
  },
  'tts.fallback.volume': {
    description: 'Fallback sound effect volume for wrapper fallback path (0-1)',
  },
  'tts.fallback.positive_sound_path': {
    description: 'Asset path for positive fallback sound when TTS unavailable',
  },
  'tts.fallback.negative_sound_path': {
    description: 'Asset path for negative fallback sound when TTS unavailable',
  },
  'tts.fallback.neutral_sound_path': {
    description: 'Asset path for neutral fallback sound when TTS unavailable (short acknowledgement)',
  },
};

let _settingsTableView = null;

function _setUiRefreshStatus(message, tone = '') {
  document.querySelectorAll('[id="ui-refresh-assets-status"]').forEach(el => {
    el.textContent = message;
    el.style.color = tone === 'warn' ? 'var(--warn)' : 'var(--text-dim)';
  });
}

function _ensureSettingsTableView() {
  if (_settingsTableView || typeof TableView === 'undefined') return _settingsTableView;
  _settingsTableView = TableView.create({
    storageKey: 'settings-table-prefs',
    columns: _SETTING_COLS,
    meta: _SETTING_FIELD_META,
    getTable: () => document.getElementById('settings-table'),
    fallbackColumn: 'key',
    minWidth: 40,
    getDefaultWidth: col => {
      if (col === '_actions') return _settingsActionCellWidth();
      if (col === 'updated_at') return 154;
      return null;
    },
    sort: {
      storageKey: 'settings-table-sort',
      defaultKey: 'key',
      defaultDir: 1,
    },
    onSortChange: () => {
      renderSettings();
      _ensureSettingsLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensureSettingsLayoutController()?.scheduleLayoutSave();
    },
  });
  return _settingsTableView;
}

let _settingsLayoutController = null;

function _settingsColumnSeed(col) {
  const types = { key: 'TEXT', value: 'TEXT', description: 'TEXT', updated_at: 'TEXT' };
  const lengths = { key: 48, value: 120, description: 120, updated_at: 19 };
  return {
    sqlite_column: col.startsWith('_') ? null : col,
    data_type: types[col] || null,
    sample_max_length: lengths[col] || null,
    min_width_px: col === '_actions' ? _SETTING_ACTION_COMPACT_WIDTH : 40,
    max_width_px: col === '_actions' ? _SETTING_ACTION_INLINE_WIDTH : 900,
    width_px: _ensureSettingsTableView()?.prefs?.getWidth(col) || null,
  };
}

function _ensureSettingsLayoutController() {
  if (_settingsLayoutController || typeof TableBucketLayouts === 'undefined') return _settingsLayoutController;
  _settingsLayoutController = TableBucketLayouts.create({
    getTable: () => document.getElementById('settings-table'),
    getView: () => _ensureSettingsTableView(),
    getColumns: () => _SETTING_COLS,
    getMeta: col => _SETTING_FIELD_META[col],
    getDefaultWidth: col => {
      if (col === '_actions') return _settingsActionCellWidth();
      if (col === 'updated_at') return 154;
      return null;
    },
    getColumnSeed: col => _settingsColumnSeed(col),
    render: () => renderSettings(),
    surfaceLabel: 'App Config',
    layoutContextTitle: 'App Config Layout Context',
  });
  return _settingsLayoutController;
}

async function toggleSettingsHorizontalScroll() {
  const controller = _ensureSettingsLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openSettingsLayoutContextModal() {
  const controller = _ensureSettingsLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

function _settingsVisibleCols() {
  return _ensureSettingsTableView()?.getVisibleCols() || ['key'];
}

function _settingsSortValue(setting, sortKey) {
  switch (sortKey) {
    case 'key': return setting.key || '';
    case 'value': return setting.value || '';
    case 'description': return setting.description || '';
    case 'updated_at': return setting.updated_at || '';
    default: return '';
  }
}

function _settingsCompactRowActions() {
  const view = _ensureSettingsTableView();
  return typeof TableRowActions !== 'undefined' && TableRowActions.shouldCollapse({
    view,
    getTable: () => document.getElementById('settings-table'),
    columnKey: '_actions',
    requiredWidth: _SETTING_ACTION_INLINE_WIDTH,
    defaultWidth: _SETTING_ACTION_INLINE_WIDTH,
  });
}

function _settingsActionCellWidth() {
  return _settingsCompactRowActions() ? _SETTING_ACTION_COMPACT_WIDTH : _SETTING_ACTION_INLINE_WIDTH;
}

function _settingsKeyCell(setting) {
  return `<td><span class="table-cell-clip"><span class="table-cell-clip__text"><code style="font-size:12px">${esc(setting.key || '—')}</code></span></span></td>`;
}

function _settingsValueCell(setting) {
  const value = setting.value || '';
  const denseClass = _settingsNeedsOverflowHint(setting.key, value) ? ' settings-cell--dense' : '';
  const hint = _settingsNeedsOverflowHint(setting.key, value) ? ' title="Long value truncated in table; open Edit for formatted view"' : '';
  return `<td><span class="table-cell-clamp settings-cell${denseClass}"${hint}>${esc(value) || '—'}</span></td>`;
}

function _settingsDescriptionCell(setting) {
  const description = setting.description || '';
  const denseClass = _settingsNeedsOverflowHint('description', description) ? ' settings-cell--dense' : '';
  const hint = _settingsNeedsOverflowHint('description', description) ? ' title="Long description truncated in table; open Edit for full text"' : '';
  return `<td style="color:var(--text-dim)"><span class="table-cell-clamp settings-cell${denseClass}"${hint}>${esc(description) || '—'}</span></td>`;
}

function _settingsUpdatedCell(setting) {
  const updated = (setting.updated_at || '').replace('T', ' ').slice(0, 19) || '—';
  return `<td style="white-space:nowrap;color:var(--text-dim)">${esc(updated)}</td>`;
}

function _settingsActionButtons(setting) {
  const key = esc(setting.key || '');
  return `<button class="secondary table-icon-btn table-icon-btn--edit" type="button" title="Edit setting" aria-label="Edit setting" data-setting-action="edit" data-setting-key="${key}"></button>
    <button class="secondary table-icon-btn table-icon-btn--delete" type="button" title="Delete setting" aria-label="Delete setting" data-setting-action="delete" data-setting-key="${key}"></button>`;
}

function _settingsActionsCell(setting) {
  const key = esc(setting.key || '');
  if (_settingsCompactRowActions()) {
    return `<td class="table-action-cell table-action-cell--compact" style="width:${_settingsActionCellWidth()}px">
      <button class="table-row-action-trigger secondary" type="button" title="Setting actions" data-setting-actions="${key}">&#8942;</button>
    </td>`;
  }
  return `<td class="table-action-cell" style="white-space:nowrap"><div class="table-inline-actions">${_settingsActionButtons(setting)}</div></td>`;
}

function openSettingsColsModal() {
  const view = _ensureSettingsTableView();
  if (!view) return;
  view.openColumns(
    document.getElementById('settings-cols-modal-list'),
    document.getElementById('settings-cols-modal'),
    col => _SETTING_FIELD_META[col].label
  );
}

function _applySettingsColsModal() {
  const view = _ensureSettingsTableView();
  if (!view) return;
  view.applyColumns(document.getElementById('settings-cols-modal'), () => {
    renderSettings();
    HubModal.close(document.getElementById('settings-cols-modal'));
    _ensureSettingsLayoutController()?.scheduleLayoutSave();
  });
}

function _openSettingRowActions(key) {
  if (typeof TableRowActions === 'undefined') return;
  const setting = _settings.find(item => String(item.key) === String(key));
  if (!setting) return;
  TableRowActions.open({
    title: setting.key || 'Setting actions',
    subtitle: 'App Config',
    actions: [
      {
        label: 'Edit setting',
        detail: 'Open the App Config editor modal for this key',
        onClick: () => editSetting(setting.key || '', setting.value || '', setting.description || ''),
      },
      {
        label: 'Delete setting',
        detail: 'Remove this setting from Blueprints',
        tone: 'danger',
        onClick: () => deleteSetting(setting.key || ''),
      },
    ],
  });
}

function _settingsNeedsOverflowHint(key, value) {
  const text = String(value || '').trim();
  if (!text) return false;
  const commaCount = (text.match(/,/g) || []).length;
  if (_SETTING_RICH_VALUE_KEYS.has(String(key || ''))) return true;
  return text.length > 120 || commaCount >= 5 || /\r?\n/.test(text);
}

function _settingsLooksStructuredValue(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  const commaCount = (text.match(/,/g) || []).length;
  return text.length > 120 && commaCount >= 5;
}

function _settingsUsesRichValueEditor(key, value) {
  return _SETTING_RICH_VALUE_KEYS.has(String(key || '').trim()) || _settingsLooksStructuredValue(value);
}

function _settingsFormatStructuredValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const wrappers = {
    '[': ']',
    '{': '}',
    '(': ')',
  };
  const open = raw.charAt(0);
  const close = wrappers[open];
  const hasWrapper = close && raw.endsWith(close);
  const inner = hasWrapper ? raw.slice(1, -1).trim() : raw;
  const parts = inner
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);

  if (!parts.length) return raw;
  if (hasWrapper) {
    return `${open}\n${parts.map(part => `  ${part},`).join('\n')}\n${close}`;
  }
  return parts.join('\n');
}

function _settingsNormalizeStructuredValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const wrappers = {
    '[': ']',
    '{': '}',
    '(': ')',
  };
  const open = raw.charAt(0);
  const close = wrappers[open];
  const hasWrapper = close && raw.endsWith(close);

  if (hasWrapper) {
    const inner = raw
      .slice(1, -1)
      .split(/\r?\n/)
      .map(line => line.trim().replace(/,$/, ''))
      .filter(Boolean);
    return `${open}${inner.join(', ')}${close}`;
  }

  const parts = raw
    .split(/\r?\n/)
    .map(line => line.trim().replace(/,$/, ''))
    .filter(Boolean);
  return parts.join(', ');
}

function _settingModalEls() {
  return {
    key: document.getElementById('setting-key'),
    value: document.getElementById('setting-val'),
    valueRich: document.getElementById('setting-val-rich'),
    helper: document.getElementById('setting-val-helper'),
    desc: document.getElementById('setting-desc'),
  };
}

function _syncSettingValueEditor() {
  const { key, value, valueRich, helper } = _settingModalEls();
  if (!key || !value || !valueRich || !helper) return;

  const currentlyRich = !valueRich.hidden;
  const richValue = currentlyRich ? _settingsNormalizeStructuredValue(valueRich.value) : '';
  const rawValue = richValue || value.value;
  const useRich = _settingsUsesRichValueEditor(key.value, rawValue);

  value.hidden = useRich;
  valueRich.hidden = !useRich;
  helper.style.display = useRich ? 'block' : 'none';

  if (useRich) {
    valueRich.value = _settingsFormatStructuredValue(rawValue);
  } else {
    value.value = rawValue;
  }
}

function _readSettingModalValue() {
  const { value, valueRich } = _settingModalEls();
  if (!value || !valueRich) return '';
  if (!valueRich.hidden) return _settingsNormalizeStructuredValue(valueRich.value).trim();
  return value.value.trim();
}

function _setUiRefreshButtonsDisabled(disabled) {
  document.querySelectorAll('#ui-refresh-assets-btn, #ui-refresh-assets-header-btn').forEach(btn => {
    btn.disabled = disabled;
  });
}

async function loadSettings() {
  await loadSettingsCidr();
  const err = document.getElementById('settings-error');
  err.hidden = true;
  try {
    const r = await apiFetch('/api/v1/settings');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _settings = await r.json();
    initTtsSettingsPanel();
    renderSettings();
  } catch (e) {
    err.textContent = `Failed to load settings: ${e.message}`;
    err.hidden = false;
  }
}

function renderSettings() {
  const tbody = document.getElementById('settings-tbody');
  const view = _ensureSettingsTableView();
  if (!tbody || !view) return;
  if (!_settings.length) {
    view.render(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, _settingsVisibleCols().length)}">No settings yet — add one above.</td></tr>`;
    });
    return;
  }
  const rows = view.sorter ? view.sorter.sortRows(_settings, _settingsSortValue) : _settings;
  view.render(() => {
    tbody.innerHTML = rows.map(setting => `<tr>${_settingsVisibleCols().map(col => {
      switch (col) {
        case 'key': return _settingsKeyCell(setting);
        case 'value': return _settingsValueCell(setting);
        case 'description': return _settingsDescriptionCell(setting);
        case 'updated_at': return _settingsUpdatedCell(setting);
        case '_actions': return _settingsActionsCell(setting);
        default: return '<td>—</td>';
      }
    }).join('')}</tr>`).join('');
  });
}

function openAddSettingModal() {
  ['setting-key','setting-val','setting-val-rich','setting-desc'].forEach(id => {
    document.getElementById(id).value = '';
  });
  const badge = document.getElementById('setting-modal-badge');
  if (badge) badge.textContent = 'ADD';
  document.getElementById('setting-modal-title').textContent = 'Add setting';
  document.getElementById('setting-key').readOnly = false;
  document.getElementById('setting-error').textContent = '';
  document.getElementById('setting-modal-save-btn').disabled = false;
  _syncSettingValueEditor();
  HubModal.open(document.getElementById('setting-modal'));
}

function editSetting(key, value, description) {
  document.getElementById('setting-key').value  = key;
  document.getElementById('setting-val').value  = value;
  document.getElementById('setting-val-rich').value = '';
  document.getElementById('setting-desc').value = description;
  const badge = document.getElementById('setting-modal-badge');
  if (badge) badge.textContent = 'EDIT';
  document.getElementById('setting-modal-title').textContent = 'Edit setting';
  document.getElementById('setting-key').readOnly = true;
  document.getElementById('setting-error').textContent = '';
  document.getElementById('setting-modal-save-btn').disabled = false;
  _syncSettingValueEditor();
  HubModal.open(document.getElementById('setting-modal'));
}

async function submitSetting() {
  const key  = document.getElementById('setting-key').value.trim();
  const val  = _readSettingModalValue();
  const desc = document.getElementById('setting-desc').value.trim();
  const err  = document.getElementById('setting-error');
  const saveBtn = document.getElementById('setting-modal-save-btn');
  if (!key) { err.textContent = 'Key is required'; return; }
  saveBtn.disabled = true;
  err.textContent = '';
  try {
    const r = await apiFetch(`/api/v1/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: val, description: desc || null }),
    });
    if (!r.ok) { const t = await r.text(); throw new Error(t); }
    HubModal.close(document.getElementById('setting-modal'));
    _settings = [];
    await loadSettings();
  } catch (e) {
    err.textContent = `Error: ${e.message}`;
    saveBtn.disabled = false;
  }
}

async function deleteSetting(key) {
  const ok = await HubDialogs.confirmDelete({
    title: 'Delete setting?',
    message: `Delete setting "${key}"?`,
    detail: 'This removes the setting record from Blueprints.',
  });
  if (!ok) return;
  try {
    const r = await apiFetch(`/api/v1/settings/${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`);
    _settings = [];
    await loadSettings();
  } catch (e) {
    await HubDialogs.alertError({
      title: 'Delete failed',
      message: `Failed to delete setting: ${e.message}`,
    });
  }
}

async function loadSettingsCidr() {
  try {
    const r = await apiFetch('/api/v1/settings/mgmt_cidr');
    if (r.ok) {
      const d = await r.json();
      document.getElementById('settings-cidr').value = d.value || '';
    }
  } catch (_) {}
}

async function saveCidr() {
  const input  = document.getElementById('settings-cidr');
  const status = document.getElementById('settings-status');
  const cidr   = input.value.trim();
  if (!cidr) { status.textContent = '⚠ Enter a CIDR first'; status.hidden = false; return; }
  try {
    const r = await apiFetch('/api/v1/settings/mgmt_cidr', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: cidr, description: 'Management network CIDR for PVE host scanning' }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    status.textContent = '✓ Saved';
    status.style.color = 'var(--accent)';
    status.hidden = false;
    setTimeout(() => { status.hidden = true; }, 3000);
  } catch (e) {
    status.textContent = `✗ ${e.message}`;
    status.style.color = '#f87171';
    status.hidden = false;
  }
}

/* ── Sound volume slider (tab-local, stored in localStorage) ─────────── */
function initVolumeSlider() {
  const slider = document.getElementById('sound-volume-slider');
  const label  = document.getElementById('sound-volume-label');
  if (!slider) return;
  const stored = parseFloat(localStorage.getItem('fe.sound_volume') ?? '0.8');
  const v = isNaN(stored) ? 0.8 : Math.max(0, Math.min(1, stored));
  slider.value = Math.round(v * 100);
  if (label) label.textContent = `${Math.round(v * 100)}%`;
  if (typeof SoundManager !== 'undefined') SoundManager.setVolume(v);
}

function setSoundVolume(pct) {
  const v = Math.max(0, Math.min(100, parseInt(pct, 10))) / 100;
  localStorage.setItem('fe.sound_volume', String(v));
  if (typeof SoundManager !== 'undefined') SoundManager.setVolume(v);
  const label = document.getElementById('sound-volume-label');
  if (label) label.textContent = `${Math.round(v * 100)}%`;
}

function _settingValueOrDefault(key) {
  const row = _settings.find(item => String(item.key) === String(key));
  if (row && typeof row.value === 'string' && row.value.trim() !== '') return row.value.trim();
  return '';
}

function initTtsSettingsPanel() {
  const voiceInput = document.getElementById('tts-default-voice');
  const messageInput = document.getElementById('tts-default-message');
  const posInput = document.getElementById('tts-fallback-positive-path');
  const negInput = document.getElementById('tts-fallback-negative-path');
  const neutInput = document.getElementById('tts-fallback-neutral-path');
  const ttsSlider = document.getElementById('tts-volume-slider');
  const ttsLabel = document.getElementById('tts-volume-label');
  const sfxSlider = document.getElementById('tts-fallback-volume-slider');
  const sfxLabel = document.getElementById('tts-fallback-volume-label');
  if (!voiceInput || !messageInput || !posInput || !negInput || !ttsSlider || !sfxSlider) return;

  voiceInput.value = _settingValueOrDefault('tts.default_voice');
  messageInput.value = _settingValueOrDefault('tts.default_message');
  posInput.value = _settingValueOrDefault('tts.fallback.positive_sound_path');
  negInput.value = _settingValueOrDefault('tts.fallback.negative_sound_path');
  if (neutInput) neutInput.value = _settingValueOrDefault('tts.fallback.neutral_sound_path');

  const ttsVol = Math.max(0, Math.min(1, parseFloat(_settingValueOrDefault('tts.volume')) || 0.85));
  const sfxVol = Math.max(0, Math.min(1, parseFloat(_settingValueOrDefault('tts.fallback.volume')) || 0.70));
  ttsSlider.value = String(Math.round(ttsVol * 100));
  sfxSlider.value = String(Math.round(sfxVol * 100));

  if (typeof BlueprintsTtsClient !== 'undefined') {
    BlueprintsTtsClient.setTtsVolume(ttsVol);
    BlueprintsTtsClient.setTtsFallbackVolume(sfxVol);
  }

  if (ttsLabel) ttsLabel.textContent = `${Math.round(ttsVol * 100)}%`;
  if (sfxLabel) sfxLabel.textContent = `${Math.round(sfxVol * 100)}%`;
}

function setTtsVolume(pct) {
  const as01 = Math.max(0, Math.min(100, parseInt(pct, 10))) / 100;
  if (typeof BlueprintsTtsClient !== 'undefined') BlueprintsTtsClient.setTtsVolume(as01);
  const label = document.getElementById('tts-volume-label');
  if (label) label.textContent = `${Math.round(as01 * 100)}%`;
}

function setTtsFallbackVolume(pct) {
  const as01 = Math.max(0, Math.min(100, parseInt(pct, 10))) / 100;
  if (typeof BlueprintsTtsClient !== 'undefined') BlueprintsTtsClient.setTtsFallbackVolume(as01);
  const label = document.getElementById('tts-fallback-volume-label');
  if (label) label.textContent = `${Math.round(as01 * 100)}%`;
}

let _ttsVoiceCatalogCache = null;

function _normalizeVoiceKey(value) {
  return String(value || '').trim().toLowerCase();
}

function _preferVoiceId(a, b) {
  const ax = String(a || '').toLowerCase();
  const bx = String(b || '').toLowerCase();
  const rank = v => {
    if (v.endsWith('.wav')) return 0;
    if (v.endsWith('.mp3')) return 1;
    return 2;
  };
  return rank(ax) <= rank(bx) ? a : b;
}

async function _loadTtsVoiceCatalog() {
  if (_ttsVoiceCatalogCache) return _ttsVoiceCatalogCache;
  const r = await fetch('/tts/pockettts/v1/voices', {
    method: 'GET',
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Voice catalog unavailable (HTTP ${r.status})`);
  const cfg = await r.json();
  const voices = Array.isArray(cfg?.data) ? cfg.data : [];
  const byId = new Map();
  const byName = new Map();

  voices.forEach(v => {
    const id = String(v?.id || '').trim();
    const name = String(v?.name || '').trim();
    if (!id) return;
    byId.set(_normalizeVoiceKey(id), id);
    if (name) {
      const key = _normalizeVoiceKey(name);
      if (byName.has(key)) {
        byName.set(key, _preferVoiceId(byName.get(key), id));
      } else {
        byName.set(key, id);
      }
    }
  });

  _ttsVoiceCatalogCache = { byId, byName };
  return _ttsVoiceCatalogCache;
}

async function _resolveVoiceIdOrKeep(rawVoice) {
  const original = String(rawVoice || '').trim();
  if (!original) return { value: '', resolved: false };

  try {
    const cat = await _loadTtsVoiceCatalog();
    const key = _normalizeVoiceKey(original);
    if (cat.byId.has(key)) {
      return { value: cat.byId.get(key), resolved: false };
    }
    if (cat.byName.has(key)) {
      return { value: cat.byName.get(key), resolved: true };
    }
  } catch (_) {
    // Keep user-entered value if catalog lookup is unavailable.
  }

  return { value: original, resolved: false };
}

async function _saveOneSetting(key, value) {
  const meta = _TTS_SETTING_META[key];
  const r = await apiFetch(`/api/v1/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      value: String(value),
      description: meta ? meta.description : null,
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(txt || `HTTP ${r.status}`);
  }
}

async function saveTtsSettings() {
  const status = document.getElementById('tts-settings-status');
  const voiceInput = document.getElementById('tts-default-voice');
  const rawVoice = (voiceInput?.value || '').trim();
  const message = (document.getElementById('tts-default-message')?.value || '').trim();
  const posPath = (document.getElementById('tts-fallback-positive-path')?.value || '').trim();
  const negPath = (document.getElementById('tts-fallback-negative-path')?.value || '').trim();
  const neutPath = (document.getElementById('tts-fallback-neutral-path')?.value || '').trim();
  const ttsVol = (parseInt(document.getElementById('tts-volume-slider')?.value || '85', 10) / 100).toFixed(2);
  const sfxVol = (parseInt(document.getElementById('tts-fallback-volume-slider')?.value || '70', 10) / 100).toFixed(2);

  try {
    if (!rawVoice || !message || !posPath || !negPath) {
      throw new Error('Voice, message, and both fallback sound paths are required');
    }
    // neutPath is optional — neutral fallback silently skipped if unset
    const resolved = await _resolveVoiceIdOrKeep(rawVoice);
    const voice = resolved.value;
    if (status) status.textContent = 'Saving...';
    await _saveOneSetting('tts.default_voice', voice);
    await _saveOneSetting('tts.default_message', message);
    await _saveOneSetting('tts.fallback.positive_sound_path', posPath);
    await _saveOneSetting('tts.fallback.negative_sound_path', negPath);
    if (neutPath) await _saveOneSetting('tts.fallback.neutral_sound_path', neutPath);
    await _saveOneSetting('tts.volume', ttsVol);
    await _saveOneSetting('tts.fallback.volume', sfxVol);

    await loadSettings();
    if (voiceInput && resolved.resolved) voiceInput.value = voice;
    if (status) {
      status.textContent = resolved.resolved
        ? `Saved (voice label mapped to ${voice})`
        : 'Saved';
    }
    setTimeout(() => { if (status) status.textContent = ''; }, 2200);
  } catch (e) {
    if (status) status.textContent = `Save failed: ${e.message}`;
  }
}

async function testTtsWrapperSpeak() {
  const status = document.getElementById('tts-settings-status');
  try {
    const msg = (document.getElementById('tts-default-message')?.value || '').trim();
    const rawVoice = (document.getElementById('tts-default-voice')?.value || '').trim();
    const resolved = await _resolveVoiceIdOrKeep(rawVoice);
    const voice = resolved.value;
    if (status) status.textContent = 'Testing wrapper...';
    if (typeof BlueprintsTtsClient === 'undefined') throw new Error('TTS client unavailable');
    const result = await BlueprintsTtsClient.speak({
      text: msg || undefined,
      voice: voice || undefined,
      interrupt: true,
      mode: 'stream',
      eventKind: 'manual',
      fallbackKind: 'positive',
    });
    const engine = String(result?.engine || 'unknown');
    if (status) {
      if (engine === 'sound_fallback') {
        status.textContent = 'Wrapper test used fallback audio (sound_fallback)';
      } else {
        status.textContent = resolved.resolved
          ? `Wrapper test used ${engine} (voice mapped to ${voice})`
          : `Wrapper test used ${engine}`;
      }
    }
    setTimeout(() => { if (status) status.textContent = ''; }, 2200);
  } catch (e) {
    if (status) status.textContent = `Wrapper test failed: ${e.message}`;
  }
}

async function stopTtsWrapperSpeak() {
  const status = document.getElementById('tts-settings-status');
  try {
    if (typeof BlueprintsTtsClient !== 'undefined') {
      await BlueprintsTtsClient.stop();
    }
    if (status) status.textContent = 'Stopped';
    setTimeout(() => { if (status) status.textContent = ''; }, 1800);
  } catch (e) {
    if (status) status.textContent = `Stop failed: ${e.message}`;
  }
}

/* ── Sound enabled toggle ─────────────────────────────────────────────── */
function initSoundToggle() {
  const checkbox = document.getElementById('sound-enabled-toggle');
  if (!checkbox) return;
  const current = getFrontendSetting('sound_enabled', 'false') === 'true';
  checkbox.checked = current;
}

async function saveSoundEnabled(enabled) {
  const statusEl = document.getElementById('sound-enabled-status');
  try {
    const r = await apiFetch('/api/v1/settings/frontend-settings/sound_enabled', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: enabled ? 'true' : 'false', description: 'Enable sound effects for nav item clicks' }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    // Update localStorage cache immediately
    await loadFrontendSettings();
    // Apply to the live SoundManager
    if (typeof SoundManager !== 'undefined') SoundManager.setEnabled(enabled);
    if (statusEl) { statusEl.textContent = `✓ Sound ${enabled ? 'on' : 'off'}`; }
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
  } catch (e) {
    if (statusEl) { statusEl.textContent = `✗ ${e.message}`; }
    // Revert the checkbox
    const checkbox = document.getElementById('sound-enabled-toggle');
    if (checkbox) checkbox.checked = !enabled;
  }
}

async function forceRefreshUiAssets() {
  _setUiRefreshButtonsDisabled(true);
  _setUiRefreshStatus('Clearing app-controlled caches and reopening the page...');

  try {
    try { localStorage.removeItem('bp_fe_settings'); } catch (_) {}
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(reg => reg.unregister().catch(() => false)));
    }

    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key).catch(() => false)));
    }

    try { sessionStorage.clear(); } catch (_) {}
    _setUiRefreshStatus('Reloading the page...');
    window.location.reload();
    return;
  } catch (e) {
    _setUiRefreshStatus('Could not fully clear app caches. You can still use a private tab or clear site data from the browser settings.', 'warn');
  }

  _setUiRefreshButtonsDisabled(false);
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof ResponsiveLayout !== 'undefined') {
    ResponsiveLayout.registerTabControls('settings', 'pg-ctrl-settings');
  }

  const settingModal = document.getElementById('setting-modal');
  if (settingModal && !settingModal.dataset.backdropCloseDisabled) {
    // App Config's rich textarea uses the native resize handle; disable backdrop-close
    // for this modal so resize interactions cannot accidentally dismiss it.
    settingModal.addEventListener('click', e => {
      if (e.target === settingModal) {
        e.stopImmediatePropagation();
      }
    }, true);
    settingModal.dataset.backdropCloseDisabled = '1';
  }

  _ensureSettingsTableView();
  _ensureSettingsLayoutController()?.init();
  _settingsTableView?.onLayoutChange(() => {
    renderSettings();
  });

  // Save button
  document.getElementById('setting-modal-save-btn')?.addEventListener('click', submitSetting);
  document.getElementById('settings-cols-modal-apply')?.addEventListener('click', _applySettingsColsModal);
  document.getElementById('setting-key')?.addEventListener('input', _syncSettingValueEditor);

  // Table event delegation — Edit and Delete buttons
  document.getElementById('settings-tbody')?.addEventListener('click', e => {
    const rowActionsBtn = e.target.closest('[data-setting-actions]');
    if (rowActionsBtn) {
      _openSettingRowActions(rowActionsBtn.dataset.settingActions || '');
      return;
    }

    const actionBtn = e.target.closest('[data-setting-action]');
    if (!actionBtn) return;
    const key = actionBtn.dataset.settingKey || '';
    const setting = _settings.find(item => String(item.key) === String(key));
    if (!setting) return;

    if (actionBtn.dataset.settingAction === 'edit') {
      editSetting(setting.key || '', setting.value || '', setting.description || '');
      return;
    }
    if (actionBtn.dataset.settingAction === 'delete') {
      deleteSetting(setting.key || '');
    }
  });
});
