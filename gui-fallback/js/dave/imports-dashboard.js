// Dave Imports dashboard - Hermes interests ingestion and git activity status.

'use strict';

const ImportsDashboard = (() => {
  const state = {
    loaded: false,
    loading: false,
    data: null,
    error: '',
    lastLoadedAt: '',
    sourceFilter: 'all',
    selection: null,
  };

  const escHtml = typeof esc === 'function'
    ? esc
    : value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[ch]));

  function el(id) {
    return document.getElementById(id);
  }

  function statusTone(status) {
    const clean = String(status || '').toLowerCase();
    if (clean === 'ok' || clean === 'done' || clean === 'completed' || clean === 'processed' || clean === 'ready') return 'ok';
    if (clean === 'needs_review' || clean === 'warning' || clean === 'source_scan_only') return 'warn';
    if (clean === 'source_unavailable' || clean === 'error' || clean === 'blocked') return 'err';
    return 'unknown';
  }

  function setPill(id, status) {
    const pill = el(id);
    if (!pill) return;
    const tone = statusTone(status);
    pill.className = `imports-pill imports-pill--${tone}`;
    pill.textContent = String(status || 'unknown').replace(/_/g, ' ');
  }

  function metric(value, label) {
    return `<div class="imports-metric"><div class="imports-metric__value">${escHtml(value)}</div><div class="imports-metric__label">${escHtml(label)}</div></div>`;
  }

  function summaryItem(value, label) {
    return `<div class="imports-summary-item"><strong>${escHtml(value)}</strong><span>${escHtml(label)}</span></div>`;
  }

  function compactDigest(value) {
    const text = String(value || '');
    if (!text.startsWith('sha256:') || text.length <= 30) return text;
    return `${text.slice(0, 18)}...${text.slice(-6)}`;
  }

  function compactDateTime(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return text;
    return parsed.toLocaleString([], {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function selectionKey(type, index) {
    return `${type}:${index}`;
  }

  function isSelected(type, index) {
    return state.selection?.key === selectionKey(type, index);
  }

  function selectionAttrs(type, index) {
    if (!type && type !== 0) return '';
    const attrs = `data-imports-select-type="${escHtml(type)}" data-imports-select-index="${escHtml(index)}" tabindex="0"`;
    return isSelected(type, index) ? `${attrs} data-imports-selected="true"` : attrs;
  }

  function table(rows, columns, emptyText, options = {}) {
    if (!Array.isArray(rows) || !rows.length) {
      return `<div class="imports-empty">${escHtml(emptyText)}</div>`;
    }
    const head = columns.map(col => `<th>${escHtml(col.label)}</th>`).join('');
    const body = rows.map((row, index) => {
      const cells = columns.map(col => `<td>${escHtml(row[col.key] ?? '')}</td>`).join('');
      const attrs = options.selectType ? ` ${selectionAttrs(options.selectType, index)}` : '';
      return `<tr${attrs}>${cells}</tr>`;
    }).join('');
    return `<table class="imports-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function filterLabel(value) {
    if (value === 'interests') return 'Hermes Interests Ingestion';
    if (value === 'git') return 'Git Activity';
    return 'all sources';
  }

  function applyFilter() {
    const root = document.querySelector('[data-imports-dashboard]');
    if (!root) return;
    root.dataset.sourceFilter = state.sourceFilter;
    const strip = el('imports-filter-strip');
    if (strip) {
      const selected = state.selection ? ` - selected ${state.selection.label}` : '';
      strip.textContent = `Filter: ${filterLabel(state.sourceFilter)}${selected}`;
    }
    root.querySelectorAll('.imports-band--interests').forEach(node => {
      node.hidden = state.sourceFilter === 'git';
    });
    root.querySelectorAll('.imports-band--git').forEach(node => {
      node.hidden = state.sourceFilter === 'interests';
    });
  }

  function applySelectionStyles() {
    document.querySelectorAll('[data-imports-selected="true"]').forEach(node => {
      node.removeAttribute('data-imports-selected');
    });
    if (!state.selection) {
      applyFilter();
      return;
    }
    document.querySelectorAll('[data-imports-select-type]').forEach(node => {
      if (selectionKey(node.dataset.importsSelectType, node.dataset.importsSelectIndex) === state.selection.key) {
        node.setAttribute('data-imports-selected', 'true');
      }
    });
    applyFilter();
  }

  function renderStatus(data) {
    const strip = el('imports-status-strip');
    if (!strip) return;
    const tone = statusTone(data.status);
    const digest = data.source_digest || '';
    strip.innerHTML = `
      <span class="imports-status-dot imports-status-dot--${tone}" aria-hidden="true"></span>
      <span>${escHtml(String(data.status || 'unknown').replace(/_/g, ' '))}</span>
      <span style="color:var(--text-dim);overflow-wrap:anywhere">${escHtml(digest)}</span>
    `;
  }

  function renderMeta(data) {
    const meta = el('imports-dashboard-meta');
    if (!meta) return;
    meta.textContent = `Refreshed ${data.generated_at || state.lastLoadedAt || ''} - ${data.source_digest || ''}`;
  }

  function renderMetrics(data) {
    const metrics = el('imports-metrics');
    if (!metrics) return;
    const interests = data.interests || {};
    const git = data.git_activity || {};
    const openclaw = data.openclaw_coverage || {};
    const domainGaps = (openclaw.ai_development_domains || [])
      .filter(row => row.status === 'needs_review').length;
    metrics.innerHTML = [
      metric(interests.pending_review ?? 0, 'pending interests review'),
      metric(interests.actionable_backlog ?? 0, 'actionable interests backlog'),
      metric(domainGaps, 'OpenClaw AI URL gaps'),
      metric((git.watched_repos || []).length, 'watched git repos'),
      metric(git.daily_summary?.commit_count ?? 0, 'git commits today'),
    ].join('');
  }

  function renderInterests(data) {
    const interests = data.interests || {};
    setPill('imports-interests-pill', interests.status);
    const summary = el('imports-interests-summary');
    if (summary) {
      summary.innerHTML = [
        summaryItem(interests.snapshot_at || 'unknown', 'snapshot'),
        summaryItem(compactDigest(interests.source_digest) || 'none', 'source digest'),
        summaryItem(interests.rerun_status || 'tracked', 'rerun status'),
      ].join('');
    }
    const categories = el('imports-interests-categories');
    if (categories) {
      categories.innerHTML = table(
        interests.category_summary || [],
        [
          { key: 'Category', label: 'Category' },
          { key: 'Raw', label: 'Raw' },
          { key: 'Results', label: 'Results' },
          { key: 'Completed', label: 'Completed' },
          { key: 'Pending', label: 'Pending' },
        ],
        'No category rows reported.',
        { selectType: 'category' }
      );
    }
    const health = el('imports-input-health');
    if (health) {
      health.innerHTML = table(
        interests.input_health || [],
        [
          { key: 'Input', label: 'Input' },
          { key: 'State', label: 'State' },
          { key: 'Note', label: 'Note' },
        ],
        'No input-health rows reported.',
        { selectType: 'input' }
      );
    }
    const unavailable = el('imports-source-unavailable');
    if (unavailable) {
      unavailable.innerHTML = table(
        interests.source_unavailable || [],
        [
          { key: 'When', label: 'When' },
          { key: 'Category', label: 'Category' },
          { key: 'Work type', label: 'Work type' },
          { key: 'Artifact', label: 'Artifact' },
        ],
        'No source-unavailable rows reported.',
        { selectType: 'source_unavailable' }
      );
    }
  }

  function flattenArtifacts(item) {
    const artifacts = item?.artifacts || {};
    const groups = [];
    Object.keys(artifacts).forEach(kind => {
      (Array.isArray(artifacts[kind]) ? artifacts[kind] : []).forEach(artifact => {
        if (!artifact?.path) return;
        groups.push({
          kind,
          label: artifact.label || kind,
          path: artifact.path,
        });
      });
    });
    return groups;
  }

  function submissionHtml(item, index) {
    const tone = statusTone(item.status);
    const artifactCount = flattenArtifacts(item).length;
    const submitted = compactDateTime(item.submitted_at) || item.submitted_at || '';
    const completed = compactDateTime(item.completed_at) || item.completed_at || '';
    const meta = [
      submitted ? `submitted ${submitted}` : '',
      item.category || '',
      item.detected_as ? `detected ${item.detected_as}` : '',
      completed ? `processed ${completed}` : '',
    ].filter(Boolean).join(' - ');
    return `
      <article class="imports-submission" ${selectionAttrs('recent_submission', index)}>
        <div class="imports-submission__main">
          <div class="imports-submission__top">
            <div class="imports-submission__title">${escHtml(item.title || 'Submission')}</div>
            <span class="imports-pill imports-pill--${tone}">${escHtml(String(item.status || 'unknown').replace(/_/g, ' '))}</span>
          </div>
          <div class="imports-submission__outcome">${escHtml(item.outcome || 'Processed')}</div>
          <div class="imports-submission__meta">${escHtml(meta)}</div>
        </div>
        <div class="imports-submission__actions">
          <button type="button" class="imports-mini-btn" data-imports-action="show-submission" data-imports-select-index="${escHtml(index)}">Details</button>
          <span class="imports-submission__artifact-count">${escHtml(artifactCount)} artifacts</span>
        </div>
      </article>
    `;
  }

  function renderSubmissions(data) {
    const target = el('imports-recent-submissions');
    if (!target) return;
    const rows = data.interests?.recent_submissions || [];
    target.innerHTML = rows.length
      ? rows.map(submissionHtml).join('')
      : '<div class="imports-empty">No recent traceable submissions reported.</div>';
  }

  function openclawAuditHtml(item) {
    const tone = statusTone(item.status);
    const examples = (item.examples || []).slice(0, 4);
    const exampleHtml = examples.length ? `
      <ul class="imports-openclaw-examples">
        ${examples.map(example => `
          <li>
            <span>${escHtml(example.state || 'needs_review')}</span>
            <code>${escHtml(example.url || '')}</code>
            <small>${escHtml((example.categories || []).join(', ') || 'not in interests')}</small>
          </li>
        `).join('')}
      </ul>
    ` : '';
    return `
      <article class="imports-openclaw-row">
        <div class="imports-openclaw-row__head">
          <strong>${escHtml(item.domain || 'domain')}</strong>
          <span class="imports-pill imports-pill--${tone}">${escHtml(String(item.status || 'unknown').replace(/_/g, ' '))}</span>
        </div>
        <div class="imports-openclaw-row__counts">
          ${metric(item.unique_url_count ?? 0, 'unique URLs')}
          ${metric(item.in_ai_developments ?? 0, 'in ai-developments')}
          ${metric(item.in_other_category ?? 0, 'other category')}
          ${metric(item.missing_from_interests ?? 0, 'missing')}
        </div>
        <div class="imports-openclaw-note">${escHtml(item.note || '')}</div>
        ${exampleHtml}
      </article>
    `;
  }

  function renderOpenClaw(data) {
    const audit = data.openclaw_coverage || {};
    setPill('imports-openclaw-pill', audit.status);
    const target = el('imports-openclaw-audit');
    if (!target) return;
    const rows = audit.ai_development_domains || [];
    target.innerHTML = rows.length
      ? rows.map(openclawAuditHtml).join('')
      : '<div class="imports-empty">No OpenClaw AI-domain audit rows reported.</div>';
  }

  function repoHtml(repo, index) {
    const tone = statusTone(repo.status);
    const clean = repo.dirty_count === 0 ? 'clean' : `${repo.dirty_count} changed`;
    const commits = repo.daily_commit_count === 1 ? '1 commit today' : `${repo.daily_commit_count || 0} commits today`;
    return `
      <div class="imports-repo" data-imports-repo="${escHtml(repo.repo_id || '')}" ${selectionAttrs('repo', index)}>
        <div class="imports-repo-head">
          <div class="imports-repo-title" title="${escHtml(repo.path || '')}">${escHtml(repo.label || repo.repo_id || 'repo')}</div>
          <div class="imports-repo-status imports-pill imports-pill--${tone}">${escHtml(String(repo.status || 'unknown').replace(/_/g, ' '))}</div>
        </div>
        <div class="imports-repo-meta">${escHtml(repo.branch || 'branch unknown')} @ ${escHtml(repo.head || 'no head')} - ${escHtml(clean)} - ${escHtml(commits)}</div>
        <div class="imports-repo-meta">${escHtml(repo.head_subject || repo.error || repo.path || '')}</div>
      </div>
    `;
  }

  function renderGit(data) {
    const git = data.git_activity || {};
    setPill('imports-git-pill', git.status);
    const summary = el('imports-git-summary');
    if (summary) {
      summary.innerHTML = [
        summaryItem(git.import_status || 'unknown', 'import status'),
        summaryItem(git.index_status || 'unknown', 'index status'),
        summaryItem(git.daily_summary?.status || 'unknown', 'daily summary'),
      ].join('');
    }
    const repos = el('imports-git-repos');
    if (repos) {
      const items = Array.isArray(git.watched_repos) ? git.watched_repos : [];
      repos.innerHTML = items.length
        ? items.map(repoHtml).join('')
        : '<div class="imports-empty">No watched git repos reported.</div>';
    }
  }

  function renderRecent(data) {
    const target = el('imports-recent-work');
    if (!target) return;
    const gitRows = (data.recent_work?.git || []).map((item, index) => ({
      type: 'recent_git',
      index,
      title: item.subject || item.short_sha || 'commit',
      meta: `${item.repo_label || item.repo_id || 'repo'} - ${item.short_sha || ''} - ${item.author_date || ''}`,
    }));
    const interestRows = (data.recent_work?.interests || []).map((item, index) => ({
      type: 'recent_interest',
      index,
      title: `${item.Category || 'category'} ${item['Work type'] || 'work'}`,
      meta: `${item.When || ''} - ${item.Status || ''} - ${item.Artifact || ''}`,
      path: item.Artifact_path || '',
    }));
    const rows = [...gitRows, ...interestRows].slice(0, 12);
    target.innerHTML = rows.length ? rows.map(row => `
      <div class="imports-work-row" ${selectionAttrs(row.type, row.index)}>
        <div class="imports-work-main">
          <div class="imports-work-title">${escHtml(row.title)}</div>
          <div class="imports-work-meta">${escHtml(row.meta)}</div>
        </div>
      </div>
    `).join('') : '<div class="imports-empty">No recent work rows reported.</div>';
  }

  function renderBlockers(data) {
    const target = el('imports-blockers');
    if (!target) return;
    const blockers = Array.isArray(data.blockers) ? data.blockers : [];
    if (!blockers.length) {
      target.innerHTML = '<div class="imports-empty">No blockers reported.</div>';
      return;
    }
    target.innerHTML = blockers.map((blocker, index) => `
      <div class="imports-blocker-row" ${selectionAttrs('blocker', index)}>
        <div class="imports-blocker-main">
          <div class="imports-blocker-title">${escHtml(blocker.source || 'source')}</div>
          <div class="imports-blocker-meta">${escHtml(JSON.stringify(blocker.items || []))}</div>
        </div>
      </div>
    `).join('');
  }

  function renderProofLinks(data) {
    const target = el('imports-proof-links');
    if (!target) return;
    const links = Array.isArray(data.proof_links) ? data.proof_links : [];
    target.innerHTML = links.length ? links.map((link, index) => `
      <button class="imports-proof-row" type="button" data-imports-action="open-doc-path" data-doc-path="${escHtml(link.path || '')}" ${selectionAttrs('proof', index)}>
        <span class="imports-proof-main">
          <span class="imports-proof-title">${escHtml(link.label || link.path || 'Proof link')}</span>
          <span class="imports-proof-meta">${escHtml(link.path || '')}</span>
        </span>
      </button>
    `).join('') : '<div class="imports-empty">No proof links reported.</div>';
  }

  function render(data) {
    renderStatus(data);
    renderMeta(data);
    renderMetrics(data);
    renderSubmissions(data);
    renderOpenClaw(data);
    renderInterests(data);
    renderGit(data);
    renderRecent(data);
    renderBlockers(data);
    renderProofLinks(data);
    applyFilter();
    applySelectionStyles();
    if (window.BodyShade && typeof window.BodyShade.scheduleSizeFillTable === 'function') {
      window.BodyShade.scheduleSizeFillTable();
    }
  }

  function renderError(message) {
    const strip = el('imports-status-strip');
    if (strip) {
      strip.innerHTML = `
        <span class="imports-status-dot imports-status-dot--err" aria-hidden="true"></span>
        <span>${escHtml(message)}</span>
      `;
    }
    const meta = el('imports-dashboard-meta');
    if (meta) meta.textContent = 'Imports refresh failed';
  }

  async function load(options = {}) {
    if (state.loading) return state.data;
    if (state.loaded && !options.force) return state.data;
    state.loading = true;
    state.error = '';
    try {
      const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
      const resp = await fetcher('/api/v1/personal/imports-dashboard');
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.detail || `HTTP ${resp.status}`);
      state.data = data;
      state.loaded = true;
      state.lastLoadedAt = new Date().toISOString();
      render(data);
      return data;
    } catch (error) {
      state.error = error.message || String(error);
      renderError(state.error);
      return null;
    } finally {
      state.loading = false;
    }
  }

  async function openDocPath(docPath) {
    try {
      if (typeof switchGroup === 'function') switchGroup('settings');
      if (typeof switchTab === 'function') switchTab('docs');
      if (typeof loadDocs === 'function' && (!Array.isArray(_docsAll) || !_docsAll.length)) {
        await loadDocs();
      }
      const clean = String(docPath).replace(/^docs\//, '').toLowerCase();
      const doc = Array.isArray(_docsAll)
        ? _docsAll.find(item => String(item.path || '').replace(/^docs\//, '').toLowerCase() === clean)
        : null;
      if (doc && window.BlueprintsDocsViewer) {
        await window.BlueprintsDocsViewer.openDoc(doc.doc_id);
        return true;
      }
      renderError(`Docs record not found: ${docPath}`);
    } catch (error) {
      renderError(error.message || String(error));
    }
    return false;
  }

  async function openInterestsDoc() {
    const docPath = state.data?.interests?.doc_path || 'docs/interests/HERMES-INTERESTS-INGESTION-DASHBOARD.md';
    return openDocPath(docPath);
  }

  function rowsForType(type) {
    const data = state.data || {};
    const interests = data.interests || {};
    const git = data.git_activity || {};
    if (type === 'category') return interests.category_summary || [];
    if (type === 'input') return interests.input_health || [];
    if (type === 'source_unavailable') return interests.source_unavailable || [];
    if (type === 'recent_submission') return interests.recent_submissions || [];
    if (type === 'repo') return git.watched_repos || [];
    if (type === 'recent_git') return data.recent_work?.git || [];
    if (type === 'recent_interest') return data.recent_work?.interests || [];
    if (type === 'blocker') return data.blockers || [];
    if (type === 'proof') return data.proof_links || [];
    return [];
  }

  function rowLabel(type, row) {
    if (type === 'repo') return row.label || row.repo_id || 'git repo';
    if (type === 'category') return row.Category || 'interests category';
    if (type === 'input') return row.Input || 'input health row';
    if (type === 'source_unavailable') return `${row.Category || 'source'} ${row['Work type'] || ''}`.trim();
    if (type === 'recent_submission') return row.title || row.outcome || 'recent submission';
    if (type === 'recent_git') return row.subject || row.short_sha || 'git commit';
    if (type === 'recent_interest') return `${row.Category || 'interests'} ${row['Work type'] || ''}`.trim();
    if (type === 'blocker') return row.source || 'blocker';
    if (type === 'proof') return row.label || row.path || 'proof link';
    return 'dashboard row';
  }

  function firstPath(row) {
    if (!row || typeof row !== 'object') return '';
    if (row.path) return row.path;
    if (row.trace_path) return row.trace_path;
    const key = Object.keys(row).find(name => name.endsWith('_path') && row[name]);
    return key ? row[key] : '';
  }

  function setSelection(type, index) {
    const rows = rowsForType(type);
    const idx = Number(index);
    const row = rows[idx];
    if (!row) return;
    state.selection = {
      key: selectionKey(type, idx),
      type,
      index: idx,
      label: rowLabel(type, row),
      row,
    };
    applySelectionStyles();
  }

  function setSourceFilter(filter) {
    state.sourceFilter = ['all', 'interests', 'git'].includes(filter) ? filter : 'all';
    applyFilter();
    return state.sourceFilter;
  }

  function closeActionModal() {
    const modal = el('imports-action-modal');
    if (!modal) return;
    if (typeof HubModal !== 'undefined') HubModal.close(modal);
    else if (typeof modal.close === 'function') modal.close();
  }

  function showActionModal(title, html, status = '') {
    const modal = el('imports-action-modal');
    const titleEl = el('imports-action-modal-title');
    const body = el('imports-action-modal-body');
    const statusEl = el('imports-action-modal-status');
    if (!modal || !body) return false;
    if (titleEl) titleEl.textContent = title;
    body.innerHTML = html;
    if (statusEl) statusEl.textContent = status;
    if (typeof HubModal !== 'undefined') HubModal.open(modal);
    else if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
    return true;
  }

  function kvHtml(items) {
    return `<dl class="imports-action-kv">${items.map(([key, value]) => `
      <dt>${escHtml(key)}</dt><dd>${escHtml(value ?? '')}</dd>
    `).join('')}</dl>`;
  }

  function artifactOpenButton(path) {
    if (!path) return '';
    return `<button type="button" class="imports-mini-btn imports-mini-btn--inline" data-imports-action="open-artifact-path" data-artifact-path="${escHtml(path)}">Open</button>`;
  }

  async function openArtifactPath(path) {
    const clean = String(path || '').trim();
    if (!clean) return false;
    showActionModal('Opening Artifact', `<p>${escHtml(clean)}</p>`, 'Loading...');
    try {
      const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
      const resp = await fetcher(`/api/v1/personal/imports-artifact?path=${encodeURIComponent(clean)}`);
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || payload.ok === false) {
        const detail = payload.detail || payload.error || `HTTP ${resp.status}`;
        showActionModal('Artifact Unavailable', `${kvHtml([['Path', clean], ['Error', detail]])}`);
        return false;
      }
      const truncated = payload.truncated ? '<p class="imports-action-note">Preview truncated to the first 256 KiB.</p>' : '';
      return showActionModal(
        payload.name || clean,
        `${kvHtml([
          ['Path', payload.path || clean],
          ['Size', `${payload.size_bytes ?? 0} bytes`],
          ['SHA-256', payload.sha256 || 'unknown'],
        ])}${truncated}<pre class="imports-artifact-preview">${escHtml(payload.preview || '')}</pre>`
      );
    } catch (error) {
      showActionModal('Artifact Unavailable', `${kvHtml([['Path', clean], ['Error', error.message || String(error)]])}`);
      return false;
    }
  }

  function artifactItems() {
    const data = state.data || {};
    const interests = data.interests || {};
    const items = [];
    function push(label, path, source) {
      if (!path) return;
      items.push({ label: label || path, path, source });
    }
    (interests.category_summary || []).forEach(row => push(row['Latest proof artifact'], row['Latest proof artifact_path'], row.Category || 'category'));
    (interests.input_health || []).forEach(row => push(row.Evidence, row.Evidence_path, row.Input || 'input'));
    (interests.source_unavailable || []).forEach(row => push(row.Artifact, row.Artifact_path, row.Category || 'source-unavailable'));
    (data.recent_work?.interests || []).forEach(row => push(row.Artifact, row.Artifact_path, row.Category || 'recent interests'));
    (data.proof_links || []).forEach(row => push(row.label, row.path, 'proof'));
    return items;
  }

  function showArtifacts() {
    const items = artifactItems().slice(0, 24);
    const selectedPath = firstPath(state.selection?.row);
    const selected = selectedPath ? `<p>Selected row artifact: ${escHtml(selectedPath)}</p>` : '';
    const list = items.length ? `<ul class="imports-action-list">${items.map(item => `
      <li><strong>${escHtml(item.label)}</strong> <span>${escHtml(item.source)}</span> ${artifactOpenButton(item.path)}<br><code>${escHtml(item.path)}</code></li>
    `).join('')}</ul>` : '<p>No artifact links reported by the current dashboard state.</p>';
    return showActionModal('Imports Artifacts', `${selected}${list}`);
  }

  function showSubmission(index) {
    const rows = rowsForType('recent_submission');
    const row = rows[Number(index)];
    if (!row) return false;
    state.selection = {
      key: selectionKey('recent_submission', Number(index)),
      type: 'recent_submission',
      index: Number(index),
      label: rowLabel('recent_submission', row),
      row,
    };
    applySelectionStyles();
    const artifacts = flattenArtifacts(row);
    const artifactList = artifacts.length ? `<ul class="imports-action-list">${artifacts.map(item => `
      <li><strong>${escHtml(item.label)}</strong> <span>${escHtml(item.kind)}</span> ${artifactOpenButton(item.path)}<br><code>${escHtml(item.path)}</code></li>
    `).join('')}</ul>` : '<p>No artifact paths were reported for this submission.</p>';
    const details = Array.isArray(row.details) && row.details.length
      ? `<ul class="imports-action-list">${row.details.map(item => `<li>${escHtml(item)}</li>`).join('')}</ul>`
      : '';
    return showActionModal(
      row.title || 'Submission',
      `${kvHtml([
        ['Status', row.status || 'unknown'],
        ['Submitted', compactDateTime(row.submitted_at) || row.submitted_at || 'unknown'],
        ['Processed', compactDateTime(row.completed_at) || row.completed_at || 'unknown'],
        ['Category', row.category || 'unknown'],
        ['Detected as', row.detected_as || 'unknown'],
        ['Outcome', row.outcome || 'unknown'],
        ['Trace', row.trace_path || 'none'],
        ['Event', (row.matrix_event_ids || []).join(', ') || 'none'],
        ['URL', row.url || 'none'],
      ])}${details}${artifactList}`
    );
  }

  async function openLatestProof() {
    const links = state.data?.proof_links || [];
    const link = links.find(item => /step 8/i.test(item.label || ''))
      || links.find(item => /final acceptance|proof/i.test(item.label || ''))
      || links[0];
    if (!link?.path) {
      showActionModal('Latest Proof', '<p>No proof link is available in the current dashboard state.</p>');
      return false;
    }
    return openDocPath(link.path);
  }

  function showBlockers() {
    const data = state.data || {};
    const interests = data.interests || {};
    const git = data.git_activity || {};
    const dirty = (git.watched_repos || []).filter(repo => repo.dirty_count || repo.actions?.length || repo.error);
    const rows = [
      ['Overall status', data.status || 'unknown'],
      ['Pending interests review', interests.pending_review ?? 0],
      ['Actionable interests backlog', interests.actionable_backlog ?? 0],
      ['Dashboard blockers', (data.blockers || []).length],
      ['Git actionable repos', dirty.length],
    ];
    const blockerList = (data.blockers || []).length
      ? `<ul class="imports-action-list">${data.blockers.map(blocker => `<li>${escHtml(blocker.source || 'source')}: ${escHtml(JSON.stringify(blocker.items || []))}</li>`).join('')}</ul>`
      : '<p>No blockers or actionable rows are reported by the current dashboard state.</p>';
    const blockers = el('imports-blockers');
    if (blockers) blockers.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return showActionModal('Imports Blockers', `${kvHtml(rows)}${blockerList}`);
  }

  function explainStatus() {
    const data = state.data || {};
    if (state.selection?.row) {
      return showActionModal(
        `Selected ${state.selection.label}`,
        `${kvHtml([
          ['Type', state.selection.type],
          ['Status', state.selection.row.status || state.selection.row.State || data.status || 'unknown'],
          ['Path', firstPath(state.selection.row) || 'none'],
        ])}<pre style="white-space:pre-wrap;overflow-wrap:anywhere;margin:0">${escHtml(JSON.stringify(state.selection.row, null, 2))}</pre>`
      );
    }
    return showActionModal(
      'Imports Status',
      kvHtml([
        ['Overall', data.status || 'unknown'],
        ['Source digest', data.source_digest || 'none'],
        ['Interests', data.interests?.status || 'unknown'],
        ['Git', data.git_activity?.status || 'unknown'],
        ['Watched repos', data.git_activity?.watched_repos?.length || 0],
        ['Blockers', data.blockers?.length || 0],
      ])
    );
  }

  async function runSafeChecks() {
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const first = await fetcher('/api/v1/personal/imports-dashboard').then(resp => resp.json());
    const second = await fetcher('/api/v1/personal/imports-dashboard').then(resp => resp.json());
    state.data = second;
    state.loaded = true;
    render(second);
    const dirty = (second.git_activity?.watched_repos || []).reduce((sum, repo) => sum + Number(repo.dirty_count || 0), 0);
    return showActionModal(
      'Safe Status Checks',
      kvHtml([
        ['Read-only route', '/api/v1/personal/imports-dashboard'],
        ['Status', second.status || 'unknown'],
        ['Same digest', first.source_digest === second.source_digest ? 'yes' : 'no'],
        ['Source digest', second.source_digest || 'none'],
        ['Dirty rows', dirty],
        ['Blockers', second.blockers?.length || 0],
      ]),
      'No ingestion mutation command was run.'
    );
  }

  function bind() {
    const root = document.querySelector('[data-imports-dashboard]');
    if (!root || root.dataset.importsBound === '1') return;
    root.dataset.importsBound = '1';
    function handleAction(action, btn) {
      if (action === 'refresh') load({ force: true });
      if (action === 'open-interests-doc') openInterestsDoc();
      if (action === 'open-doc-path') openDocPath(btn.dataset.docPath || '');
      if (action === 'show-submission') showSubmission(btn.dataset.importsSelectIndex || '0');
      if (action === 'open-artifact-path') openArtifactPath(btn.dataset.artifactPath || '');
    }
    root.addEventListener('click', event => {
      const selectable = event.target.closest('[data-imports-select-type]');
      if (selectable) {
        setSelection(selectable.dataset.importsSelectType, selectable.dataset.importsSelectIndex);
      }
      const btn = event.target.closest('[data-imports-action]');
      if (!btn) return;
      handleAction(btn.dataset.importsAction, btn);
    });
    const modal = el('imports-action-modal');
    if (modal) {
      modal.addEventListener('click', event => {
        const btn = event.target.closest('[data-imports-action]');
        if (!btn) return;
        handleAction(btn.dataset.importsAction, btn);
      });
    }
    root.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const selectable = event.target.closest('[data-imports-select-type]');
      if (!selectable) return;
      event.preventDefault();
      setSelection(selectable.dataset.importsSelectType, selectable.dataset.importsSelectIndex);
    });
    ['imports-action-modal-close', 'imports-action-modal-footer-close'].forEach(id => {
      const btn = el(id);
      if (btn) btn.addEventListener('click', closeActionModal);
    });
  }

  function snapshot() {
    const recentSubmissions = state.data?.interests?.recent_submissions || [];
    return {
      loaded: state.loaded,
      loading: state.loading,
      status: state.data?.status || '',
      source_digest: state.data?.source_digest || '',
      interests_status: state.data?.interests?.status || '',
      recent_submission_count: recentSubmissions.length,
      first_recent_submission_label: recentSubmissions[0]?.title || '',
      git_status: state.data?.git_activity?.status || '',
      watched_repo_count: state.data?.git_activity?.watched_repos?.length || 0,
      blocker_count: state.data?.blockers?.length || 0,
      source_filter: state.sourceFilter,
      selection_type: state.selection?.type || '',
      selection_label: state.selection?.label || '',
      error: state.error,
    };
  }

  bind();

  return {
    load,
    refresh: () => load({ force: true }),
    openInterestsDoc,
    openDocPath,
    openLatestProof,
    showArtifacts,
    showBlockers,
    filterAll: () => setSourceFilter('all'),
    filterInterests: () => setSourceFilter('interests'),
    filterGit: () => setSourceFilter('git'),
    runSafeChecks,
    explainStatus,
    snapshot,
  };
})();

window.BlueprintsImportsDashboard = ImportsDashboard;

if (typeof DaveMenuConfig !== 'undefined') {
DaveMenuConfig.registerFunctions({
    'imports.refresh': () => ImportsDashboard.refresh(),
    'imports.openInterestsDoc': () => ImportsDashboard.openInterestsDoc(),
    'imports.openLatestProof': () => ImportsDashboard.openLatestProof(),
    'imports.openArtifacts': () => ImportsDashboard.showArtifacts(),
    'imports.showBlockers': () => ImportsDashboard.showBlockers(),
    'imports.filterAll': () => ImportsDashboard.filterAll(),
    'imports.filterInterests': () => ImportsDashboard.filterInterests(),
    'imports.filterGit': () => ImportsDashboard.filterGit(),
    'imports.safeChecks': () => ImportsDashboard.runSafeChecks(),
    'imports.explainStatus': () => ImportsDashboard.explainStatus(),
  });
}
