// Dave Imports dashboard - Hermes interests ingestion and git activity status.

'use strict';

const ImportsDashboard = (() => {
  const state = {
    loaded: false,
    loading: false,
    data: null,
    error: '',
    lastLoadedAt: '',
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
    if (clean === 'ok' || clean === 'done' || clean === 'completed' || clean === 'ready') return 'ok';
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

  function table(rows, columns, emptyText) {
    if (!Array.isArray(rows) || !rows.length) {
      return `<div class="imports-empty">${escHtml(emptyText)}</div>`;
    }
    const head = columns.map(col => `<th>${escHtml(col.label)}</th>`).join('');
    const body = rows.map(row => {
      const cells = columns.map(col => `<td>${escHtml(row[col.key] ?? '')}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table class="imports-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
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
    metrics.innerHTML = [
      metric(interests.pending_review ?? 0, 'pending interests review'),
      metric(interests.actionable_backlog ?? 0, 'actionable interests backlog'),
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
        summaryItem(interests.source_digest || 'none', 'source digest'),
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
        'No category rows reported.'
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
        'No input-health rows reported.'
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
        'No source-unavailable rows reported.'
      );
    }
  }

  function repoHtml(repo) {
    const tone = statusTone(repo.status);
    const clean = repo.dirty_count === 0 ? 'clean' : `${repo.dirty_count} changed`;
    const commits = repo.daily_commit_count === 1 ? '1 commit today' : `${repo.daily_commit_count || 0} commits today`;
    return `
      <div class="imports-repo" data-imports-repo="${escHtml(repo.repo_id || '')}">
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
    const gitRows = (data.recent_work?.git || []).map(item => ({
      title: item.subject || item.short_sha || 'commit',
      meta: `${item.repo_label || item.repo_id || 'repo'} - ${item.short_sha || ''} - ${item.author_date || ''}`,
    }));
    const interestRows = (data.recent_work?.interests || []).map(item => ({
      title: `${item.Category || 'category'} ${item['Work type'] || 'work'}`,
      meta: `${item.When || ''} - ${item.Status || ''} - ${item.Artifact || ''}`,
    }));
    const rows = [...gitRows, ...interestRows].slice(0, 12);
    target.innerHTML = rows.length ? rows.map(row => `
      <div class="imports-work-row">
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
    target.innerHTML = blockers.map(blocker => `
      <div class="imports-blocker-row">
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
    target.innerHTML = links.length ? links.map(link => `
      <button class="imports-proof-row" type="button" data-imports-action="open-doc-path" data-doc-path="${escHtml(link.path || '')}">
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
    renderInterests(data);
    renderGit(data);
    renderRecent(data);
    renderBlockers(data);
    renderProofLinks(data);
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

  function bind() {
    const root = document.querySelector('[data-imports-dashboard]');
    if (!root || root.dataset.importsBound === '1') return;
    root.dataset.importsBound = '1';
    root.addEventListener('click', event => {
      const btn = event.target.closest('[data-imports-action]');
      if (!btn) return;
      const action = btn.dataset.importsAction;
      if (action === 'refresh') load({ force: true });
      if (action === 'open-interests-doc') openInterestsDoc();
      if (action === 'open-doc-path') openDocPath(btn.dataset.docPath || '');
    });
  }

  function snapshot() {
    return {
      loaded: state.loaded,
      loading: state.loading,
      status: state.data?.status || '',
      source_digest: state.data?.source_digest || '',
      interests_status: state.data?.interests?.status || '',
      git_status: state.data?.git_activity?.status || '',
      watched_repo_count: state.data?.git_activity?.watched_repos?.length || 0,
      blocker_count: state.data?.blockers?.length || 0,
      error: state.error,
    };
  }

  bind();

  return {
    load,
    refresh: () => load({ force: true }),
    openInterestsDoc,
    openDocPath,
    snapshot,
  };
})();

window.BlueprintsImportsDashboard = ImportsDashboard;

if (typeof DaveMenuConfig !== 'undefined') {
  DaveMenuConfig.registerFunctions({
    'imports.refresh': () => ImportsDashboard.refresh(),
    'imports.openInterestsDoc': () => ImportsDashboard.openInterestsDoc(),
  });
}
