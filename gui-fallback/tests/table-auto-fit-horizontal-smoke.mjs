import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const requireFromHere = createRequire(import.meta.url);
const requireFromCwd = createRequire(path.resolve(process.cwd(), 'package.json'));
let chromium;
try {
  ({ chromium } = requireFromHere('playwright'));
} catch (_) {
  ({ chromium } = requireFromCwd('playwright'));
}

const here = path.dirname(fileURLToPath(import.meta.url));
const tableUiSource = fs.readFileSync(path.resolve(here, '../js/table-ui.js'), 'utf8');
const tableCss = fs.readFileSync(path.resolve(here, '../css/tables.css'), 'utf8');
const servicesSource = fs.readFileSync(path.resolve(here, '../js/synthesis/services.js'), 'utf8');
const proxmoxConfigSource = fs.readFileSync(path.resolve(here, '../js/probes/proxmox-config.js'), 'utf8');

assert.match(servicesSource, /links:[\s\S]*?defaultWidth:\s*76/, 'Services Links default width should stay compact');
assert.match(servicesSource, /case 'links':\s*return \{[^}]*min_width_px:\s*50/, 'Services Links seed min width should stay compact');
assert.match(proxmoxConfigSource, /autoFitMode:\s*'grouped'/, 'Proxmox Config should use grouped auto-fit');
assert.match(proxmoxConfigSource, /prepareGroupedAutoFitMeasurement:\s*_preparePveConfigGroupedAutoFitMeasurement/, 'Proxmox Config should prepare nested rows for grouped auto-fit');
assert.match(proxmoxConfigSource, /_pveConfigRenderNetMeasurementRows/, 'Proxmox Config should expose network detail measurement rows during auto-fit');

const columns = ['display_name', 'addresses', 'hostnames', 'gen', 'commit', 'commit_non_root', 'commit_inner', 'pending', '_actions'];
const nodes = [
  ['Atlas One', ['https://203.0.113.18:8443', 'https://198.51.100.5:8443'], ['atlas-one.infra.example.invalid', 'atlas-one.mesh.example.invalid'], '74012'],
  ['Beacon Two', ['https://203.0.113.16:8443', 'https://198.51.100.3:8443'], ['beacon-two.infra.example.invalid', 'beacon-two.mesh.example.invalid'], '74035'],
  ['Cobalt Three', ['https://203.0.113.19:8443', 'https://198.51.100.110:8443'], ['cobalt-three.infra.example.invalid', 'cobalt-three.mesh.example.invalid'], '64558'],
  ['Delta Four', ['https://203.0.113.20:8443', 'https://198.51.100.81:8443'], ['delta-four.infra.example.invalid', 'delta-four.mesh.example.invalid'], '74083'],
  ['Echo Five', ['https://203.0.113.21:8443', 'https://198.51.100.137:8443'], ['echo-five.infra.example.invalid', 'echo-five.mesh.example.invalid'], '73975'],
  ['Fable Six', ['https://203.0.113.17:8443', 'https://198.51.100.4:8443'], ['fable-six.infra.example.invalid', 'fable-six.mesh.example.invalid'], '74055'],
];

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1030, height: 768 } });
  await page.setContent(`<!doctype html>
    <html>
      <head>
        <style>
          :root {
            --surface:#151823;
            --border:#2b3450;
            --text:#f8fbff;
            --text-dim:#8fa1c7;
            --accent:#5b9cf6;
            --badge-warn:#b45309;
          }
          body { margin: 0; background: #080b12; color: var(--text); font-family: Segoe UI, Arial, sans-serif; }
          ${tableCss}
          .table-wrap { width: 986px; max-height: none; }
        </style>
      </head>
      <body>
        <div class="table-wrap"><table id="nodes-table" class="table-shared-ui table-shared-ui--scroll-x"></table></div>
      </body>
    </html>`);
  await page.addScriptTag({ content: tableUiSource });
  const result = await page.evaluate(async ({ columns, nodes }) => {
    const widths = Object.fromEntries(columns.map((column) => [column, 300]));
    let headerLabels = {};
    let hidden = new Set();
    let scroll = true;
    let saved = null;
    const hyphenationRequests = [];

    function esc(value) {
      return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function actionCell() {
      if ((widths._actions || 0) < 172) {
        return '<td class="table-action-cell table-action-cell--compact"><button class="secondary table-icon-btn table-row-action-trigger" type="button" aria-label="Actions">:</button></td>';
      }
      return '<td class="table-action-cell" style="white-space:nowrap"><div class="table-inline-actions">'
        + '<button class="secondary table-icon-btn table-icon-btn--restart" type="button"></button>'
        + '<button class="secondary table-icon-btn table-icon-btn--pull" type="button"></button>'
        + '<button class="secondary table-icon-btn table-icon-btn--queue" type="button"></button>'
        + '<button class="secondary table-icon-btn table-icon-btn--power" type="button"></button>'
        + '<button class="secondary table-icon-btn table-icon-btn--delete" type="button"></button>'
        + '</div></td>';
    }

    function headerCell(column, labelHtml) {
      const label = headerLabels[column] || labelHtml;
      const arrow = column === 'display_name' ? '<span class="table-sort-arrow active">▲</span>' : '<span class="table-sort-arrow">⇅</span>';
      return `<th data-col="${column}"><span class="table-th-sort">${label}${arrow}</span><span class="table-col-resize"></span></th>`;
    }

    function render() {
      const table = document.getElementById('nodes-table');
      const total = columns.reduce((sum, column) => sum + (widths[column] || 80), 0);
      table.style.setProperty('--table-fit-width', total + 'px');
      table.className = scroll ? 'table-shared-ui table-shared-ui--scroll-x' : 'table-shared-ui';
      table.innerHTML = '<colgroup>' + columns.map((column) => `<col data-col="${column}" style="width:${widths[column] || 80}px">`).join('') + '</colgroup>'
        + '<thead><tr>'
        + headerCell('display_name', 'Display Name')
        + headerCell('addresses', 'Addresses')
        + headerCell('hostnames', 'Hostnames')
        + headerCell('gen', 'Gen')
        + headerCell('commit', 'Commit<br>(Outer)')
        + headerCell('commit_non_root', 'Commit<br>(Non-root)')
        + headerCell('commit_inner', 'Commit<br>(Inner)')
        + headerCell('pending', 'Pending')
        + '<th data-col="_actions">Actions<span class="table-col-resize"></span></th>'
        + '</tr></thead><tbody>'
        + nodes.map(([name, addresses, hostnames, gen]) => '<tr>'
          + `<td style="white-space:nowrap"><strong>${esc(name)}</strong></td>`
          + `<td>${addresses.map((address) => `<span class="ip-chip">${esc(address)}</span>`).join('<br>')}</td>`
          + `<td><span class="ip-chip">${esc(hostnames[0])}</span><br><span class="ip-chip" style="opacity:0.75">${esc(hostnames[1])}</span></td>`
          + `<td style="font-size:12px">${esc(gen)}</td>`
          + '<td>7e10b5e</td>'
          + '<td>3b1b64d</td>'
          + '<td>6e6399b</td>'
          + '<td><span style="color:var(--text-dim)">—</span></td>'
          + actionCell()
          + '</tr>').join('')
        + '</tbody>';
    }

    const view = {
      isHorizontalScrollEnabled: () => scroll,
      setHorizontalScrollEnabled: (enabled) => { scroll = !!enabled; },
      getHiddenSet: () => new Set(hidden),
      getSortState: () => ({ key: 'display_name', dir: 1 }),
      setSortState: () => {},
      setHeaderLabelOverrides: (overrides) => { headerLabels = { ...overrides }; },
      getHeaderLabelOverride: (column) => headerLabels[column] || null,
      prefs: {
        getWidth: (column) => widths[column] || null,
        setWidth: (column, width) => { widths[column] = width; },
        setHiddenSet: (next) => { hidden = new Set(next); },
      },
    };

    window.apiFetch = async (url, opts) => {
      if (url.includes('/hyphenate-header')) {
        const body = JSON.parse(opts.body);
        hyphenationRequests.push(body);
        const changed = body.header === 'Pending';
        return {
          ok: true,
          json: async () => ({
            header: body.header,
            header_label: changed ? 'Pend-ing' : null,
            changed,
            confidence: changed ? 0.92 : 0.2,
            reason: changed ? 'common suffix split' : 'no useful split',
            used_llm: true,
          }),
        };
      }
      if (url.includes('/resolve')) {
        return { ok: true, json: async () => ({ layout_key: '0000060A', layout_data: { version: 1, columns: columns.map((column_key, position) => ({ column_key, width_px: widths[column_key], position, hidden: false })) } }) };
      }
      saved = JSON.parse(opts.body).layout_data;
      return { ok: true, json: async () => ({ layout_key: '0000060A', layout_data: saved }) };
    };

    render();
    const controller = window.TableBucketLayouts.create({
      getTable: () => document.getElementById('nodes-table'),
      getView: () => view,
      getColumns: () => columns,
      getMeta: (column) => ({ label: column === '_actions' ? 'Actions' : column.replaceAll('_', ' '), sortKey: column }),
      getColumnSeed: (column) => ({ min_width_px: column === '_actions' ? 48 : 40, max_width_px: column === '_actions' ? 172 : 900, width_px: widths[column] }),
      tableCode: '06',
      tableName: 'fleet-nodes',
      render,
    });
    const measurement = await controller.autoFitHorizontalLayout({ ensureHorizontalScroll: true, includeAllColumns: true, percentile: 1 });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const clippedChips = Array.from(document.querySelectorAll('.ip-chip')).filter((chip) => {
      const chipRect = chip.getBoundingClientRect();
      const cellRect = chip.closest('td').getBoundingClientRect();
      return chipRect.left < cellRect.left - 1 || chipRect.right > cellRect.right + 1;
    }).map((chip) => chip.textContent);
    const clippedSortArrows = Array.from(document.querySelectorAll('th[data-col] .table-sort-arrow')).filter((arrow) => {
      const arrowRect = arrow.getBoundingClientRect();
      const headerRect = arrow.closest('th').getBoundingClientRect();
      return arrowRect.left < headerRect.left - 1 || arrowRect.right > headerRect.right + 1;
    }).map((arrow) => arrow.closest('th').dataset.col);
    const clippedHeaderLabels = Array.from(document.querySelectorAll('th[data-col] .table-th-sort')).filter((label) => {
      const labelRect = label.getBoundingClientRect();
      const headerRect = label.closest('th').getBoundingClientRect();
      return labelRect.left < headerRect.left - 1 || labelRect.right > headerRect.right + 1;
    }).map((label) => label.closest('th').dataset.col);
    const misalignedResizeHandles = Array.from(document.querySelectorAll('th[data-col] .table-col-resize')).filter((handle) => {
      const handleRect = handle.getBoundingClientRect();
      const headerRect = handle.closest('th').getBoundingClientRect();
      return Math.abs(handleRect.right - headerRect.right) > 0.75;
    }).map((handle) => handle.closest('th').dataset.col);
    const rowHeights = Array.from(document.querySelectorAll('tbody tr')).map((row) => Math.ceil(row.getBoundingClientRect().height));
    return {
      widths: { ...widths },
      measurement,
      saved,
      hyphenationRequests,
      clippedChips,
      clippedSortArrows,
      clippedHeaderLabels,
      misalignedResizeHandles,
      displayHeaderHtml: document.querySelector('th[data-col="display_name"]')?.innerHTML || '',
      pendingHeaderHtml: document.querySelector('th[data-col="pending"]')?.innerHTML || '',
      maxRowHeight: Math.max(...rowHeights),
      inlineActionRows: document.querySelectorAll('.table-inline-actions').length,
      compactActionRows: document.querySelectorAll('.table-action-cell--compact').length,
    };
  }, { columns, nodes });

  console.log(JSON.stringify({
    widths: result.widths,
    tableWidth: result.measurement.tableWidth,
    maxRowHeight: result.maxRowHeight,
    clippedChips: result.clippedChips,
    clippedSortArrows: result.clippedSortArrows,
    clippedHeaderLabels: result.clippedHeaderLabels,
    misalignedResizeHandles: result.misalignedResizeHandles,
    inlineActionRows: result.inlineActionRows,
    compactActionRows: result.compactActionRows,
    displayHeaderHtml: result.displayHeaderHtml,
    pendingHeaderHtml: result.pendingHeaderHtml,
    hyphenationRequests: result.hyphenationRequests,
  }, null, 2));

  assert.equal(result.saved.algorithm_version, 'browser-measured-horizontal-v1');
  assert.deepEqual(result.clippedChips, []);
  assert.deepEqual(result.clippedSortArrows, []);
  assert.deepEqual(result.clippedHeaderLabels, []);
  assert.deepEqual(result.misalignedResizeHandles, []);
  assert.equal(result.inlineActionRows, nodes.length);
  assert.equal(result.compactActionRows, 0);
  assert.match(result.saved.columns.find((column) => column.column_key === 'display_name')?.header_label || '', /<br>/);
  assert.match(result.displayHeaderHtml, /Display<br>Name/);
  assert.equal(result.saved.columns.find((column) => column.column_key === 'pending')?.header_label || '', 'Pend-ing');
  assert.match(result.pendingHeaderHtml, /Pend-ing/);
  assert.ok(result.hyphenationRequests.some((request) => request.header === 'Pending'), 'LLM hyphenation request should include Pending');
  assert.ok(result.hyphenationRequests.some((request) => Array.isArray(request.examples) && request.examples.some((example) => example.header_label === 'Pend-ing')), 'LLM hyphenation request should include examples');
  assert.ok(result.maxRowHeight <= 76, `row too deep: ${result.maxRowHeight}px`);
  assert.ok(result.widths.display_name >= 105, `display name too tight: ${result.widths.display_name}px`);
  assert.ok(result.widths.addresses >= 180, `addresses too narrow: ${result.widths.addresses}px`);
  assert.ok(result.widths.hostnames >= 215, `hostnames too narrow: ${result.widths.hostnames}px`);
  assert.ok(result.widths.gen >= 50, `gen too tight: ${result.widths.gen}px`);
  assert.ok(result.widths.pending >= 50, `pending too tight: ${result.widths.pending}px`);
  assert.ok(result.widths._actions >= 172, `actions too narrow: ${result.widths._actions}px`);
  assert.ok(result.widths.commit >= 72, `commit too tight: ${result.widths.commit}px`);
  assert.ok(result.widths.commit <= 82, `commit too wide: ${result.widths.commit}px`);
  assert.ok(result.widths.commit_inner >= 72, `commit inner too tight: ${result.widths.commit_inner}px`);
  assert.ok(result.widths.commit_inner <= 75, `commit inner too wide: ${result.widths.commit_inner}px`);
  assert.ok(result.widths.commit_non_root >= 72, `commit non-root too tight: ${result.widths.commit_non_root}px`);
  assert.ok(result.widths.commit_non_root <= 75, `commit non-root too wide: ${result.widths.commit_non_root}px`);
  assert.ok(result.measurement.tableWidth >= 980, `table too narrow: ${result.measurement.tableWidth}px`);
  assert.ok(result.measurement.tableWidth <= 1015, `table too wide: ${result.measurement.tableWidth}px`);

  const remotePage = await browser.newPage({ viewport: { width: 1030, height: 768 } });
  const remoteLogs = [];
  remotePage.on('console', (message) => remoteLogs.push(`${message.type()}:${message.text()}`));
  try {
    await remotePage.route('http://table-layout-remote.test/', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html>
        <html>
          <head><style>${tableCss}</style></head>
          <body>
            <table id="nodes-table" data-layout-table-name="fleet-nodes" data-layout-table-code="06">
              <thead><tr></tr></thead>
              <tbody id="nodes-tbody"></tbody>
            </table>
          </body>
        </html>`,
    }));
    await remotePage.goto('http://table-layout-remote.test/');
    await remotePage.addScriptTag({ content: tableUiSource });
    const remoteResult = await remotePage.evaluate(async ({ columns }) => {
      const meta = {
        display_name: { label: 'Display Name', sortKey: 'display_name' },
        addresses: { label: 'Addresses', sortKey: 'addresses' },
        hostnames: { label: 'Hostnames', sortKey: 'hostnames' },
        gen: { label: 'Gen', sortKey: 'gen' },
        commit: { label: 'Commit (Outer)', sortKey: 'commit' },
        commit_non_root: { label: 'Commit (Non-root)', sortKey: 'commit_non_root' },
        commit_inner: { label: 'Commit (Inner)', sortKey: 'commit_inner' },
        pending: { label: 'Pending', sortKey: 'pending' },
        _actions: { label: 'Actions' },
      };
      const widths = {
        display_name: 99,
        addresses: 184,
        hostnames: 222,
        gen: 64,
        commit: 100,
        commit_non_root: 76,
        commit_inner: 83,
        pending: 64,
        _actions: 172,
      };
      const layoutData = {
        version: 1,
        columns: columns.map((column_key, position) => ({
          column_key,
          position,
          width_px: widths[column_key],
          header_label: column_key === 'display_name'
            ? 'Display<br>Name'
            : column_key === 'pending'
              ? 'Pend-ing'
            : undefined,
        })),
      };
      const savedLayouts = [];
      let controller = null;
      const view = window.TableView.create({
        storageKey: `remote-layout-test-${Date.now()}`,
        columns,
        meta,
        getTable: () => document.getElementById('nodes-table'),
        fallbackColumn: 'display_name',
        onColumnResizeEnd: () => {
          controller?.scheduleLayoutSave();
        },
        sort: {
          storageKey: `remote-layout-sort-test-${Date.now()}`,
          defaultKey: 'display_name',
          defaultDir: 1,
        },
      });
      function renderBody() {
        document.getElementById('nodes-tbody').innerHTML = `<tr>${columns.map((column) => `<td>${column}</td>`).join('')}</tr>`;
      }
      window.apiFetch = async (url, opts = {}) => {
        if (url.includes('/resolve')) {
          return {
            ok: true,
            json: async () => ({ layout_key: '0000060A', layout_data: layoutData }),
          };
        }
        const body = JSON.parse(opts.body || '{}');
        savedLayouts.push(body.layout_data || null);
        return {
          ok: true,
          json: async () => ({ layout_key: '0000060A', layout_data: body.layout_data || layoutData }),
        };
      };
      controller = window.TableBucketLayouts.create({
        getTable: () => document.getElementById('nodes-table'),
        getView: () => view,
        getColumns: () => columns,
        getMeta: (column) => meta[column],
        getColumnSeed: (column) => ({
          min_width_px: column === '_actions' ? 48 : 40,
          max_width_px: column === '_actions' ? 172 : 900,
          width_px: view.prefs.getWidth(column) || widths[column],
        }),
        render: () => view.render(renderBody),
        surfaceLabel: 'Fleet Nodes',
      });
      const payload = await controller.resolveRemoteLayout({ rerender: true, forceApply: true });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const resizeHandle = document.querySelector('th[data-col] .table-col-resize');
      const resizeTable = document.getElementById('nodes-table');
      const resizeHandleOpacityInitial = Number(window.getComputedStyle(resizeHandle).opacity || 0);
      resizeTable.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const resizeHandleOpacityVisible = Number(window.getComputedStyle(resizeHandle).opacity || 0);
      resizeTable.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const resizeHandleOpacityFaded = Number(window.getComputedStyle(resizeHandle).opacity || 0);
      const displayHeader = document.querySelector('th[data-col="display_name"]');
      const displayHandle = displayHeader.querySelector('.table-col-resize');
      const displayRect = displayHeader.getBoundingClientRect();
      const dragStartX = displayRect.right - 2;
      const dragY = displayRect.top + displayRect.height / 2;
      displayHandle.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: dragStartX,
        clientY: dragY,
        isPrimary: true,
        pointerId: 41,
        pointerType: 'mouse',
      }));
      document.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        button: 0,
        clientX: dragStartX + 28,
        clientY: dragY,
        isPrimary: true,
        pointerId: 41,
        pointerType: 'mouse',
      }));
      document.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        button: 0,
        clientX: dragStartX + 28,
        clientY: dragY,
        isPrimary: true,
        pointerId: 41,
        pointerType: 'mouse',
      }));
      await new Promise((resolve) => setTimeout(resolve, 600));
      const savedDisplayWidth = savedLayouts.at(-1)?.columns?.find((column) => column.column_key === 'display_name')?.width_px || null;
      return {
        payloadKey: payload && payload.layout_key,
        controllerKey: controller.getLayoutKey(),
        displayHeaderHtml: document.querySelector('th[data-col="display_name"]')?.innerHTML || '',
        pendingHeaderHtml: document.querySelector('th[data-col="pending"]')?.innerHTML || '',
        resizeHandleOpacityInitial,
        resizeHandleOpacityVisible,
        resizeHandleOpacityFaded,
        savedLayoutCount: savedLayouts.length,
        savedDisplayWidth,
      };
    }, { columns });

    console.log(JSON.stringify({
      remoteLayoutApply: remoteResult,
      resizeHandleOpacity: {
        initial: remoteResult.resizeHandleOpacityInitial,
        visible: remoteResult.resizeHandleOpacityVisible,
        faded: remoteResult.resizeHandleOpacityFaded,
      },
      manualResizeSave: {
        count: remoteResult.savedLayoutCount,
        displayWidth: remoteResult.savedDisplayWidth,
      },
      remoteWarnings: remoteLogs.filter((line) => line.includes('layout resolve failed')),
    }, null, 2));
    assert.equal(remoteResult.payloadKey, '0000060A');
    assert.equal(remoteResult.controllerKey, '0000060A');
    assert.match(remoteResult.displayHeaderHtml, /Display<br>Name/);
    assert.match(remoteResult.pendingHeaderHtml, /Pend-ing/);
    assert.ok(remoteResult.resizeHandleOpacityInitial <= 0.05, `resize handles should start hidden: ${remoteResult.resizeHandleOpacityInitial}`);
    assert.ok(remoteResult.resizeHandleOpacityVisible >= 0.5, `resize handles should reveal: ${remoteResult.resizeHandleOpacityVisible}`);
    assert.ok(remoteResult.resizeHandleOpacityFaded <= 0.05, `resize handles should fade out: ${remoteResult.resizeHandleOpacityFaded}`);
    assert.ok(remoteResult.savedLayoutCount >= 1, 'manual resize should save the bucket layout');
    assert.ok(remoteResult.savedDisplayWidth > 99, `manual resize did not save wider display_name width: ${remoteResult.savedDisplayWidth}`);
    assert.deepEqual(remoteLogs.filter((line) => line.includes('layout resolve failed')), []);
  } finally {
    await remotePage.close();
  }

  const genericPage = await browser.newPage({ viewport: { width: 720, height: 420 } });
  try {
    await genericPage.setContent(`<!doctype html>
      <html>
        <head>
          <style>
            body { margin:0; font-family: Segoe UI, Arial, sans-serif; }
            ${tableCss}
            .table-wrap { width: 680px; }
          </style>
        </head>
        <body>
          <div class="table-wrap"><table id="generic-table" class="table-shared-ui"></table></div>
        </body>
      </html>`);
    await genericPage.addScriptTag({ content: tableUiSource });
    const genericResult = await genericPage.evaluate(async () => {
      const columns = ['name', 'value', 'notes'];
      const widths = { name: 160, value: 160, notes: 160 };
      let hidden = new Set(['notes']);
      let scroll = false;
      function render() {
        const visible = columns.filter((column) => !hidden.has(column));
        const table = document.getElementById('generic-table');
        table.className = scroll ? 'table-shared-ui table-shared-ui--scroll-x' : 'table-shared-ui';
        table.innerHTML = '<colgroup>' + visible.map((column) => `<col data-col="${column}" style="width:${widths[column]}px">`).join('') + '</colgroup>'
          + '<thead><tr>' + visible.map((column) => `<th data-col="${column}"><span class="table-th-sort">${column}<span class="table-sort-arrow">⇅</span></span><span class="table-col-resize"></span></th>`).join('') + '</tr></thead>'
          + '<tbody><tr><td>Alpha</td><td>Short value</td></tr></tbody>';
      }
      const view = {
        isHorizontalScrollEnabled: () => scroll,
        setHorizontalScrollEnabled: (enabled) => { scroll = !!enabled; },
        getHiddenSet: () => new Set(hidden),
        getSortState: () => ({ key: 'name', dir: 1 }),
        setSortState: () => {},
        setHeaderLabelOverrides: () => {},
        getHeaderLabelOverride: () => null,
        prefs: {
          getWidth: (column) => widths[column] || null,
          setWidth: (column, width) => { widths[column] = width; },
          setHiddenSet: (next) => { hidden = new Set(next); render(); },
        },
      };
      window.apiFetch = async (url, opts = {}) => {
        if (url.includes('/resolve')) {
          return {
            ok: true,
            json: async () => ({
              layout_key: '00009900',
              layout_data: {
                version: 1,
                columns: columns.map((column_key, position) => ({
                  column_key,
                  position,
                  hidden: hidden.has(column_key),
                  width_px: widths[column_key],
                })),
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({ layout_key: '00009900', layout_data: JSON.parse(opts.body).layout_data }),
        };
      };
      render();
      const controller = window.TableBucketLayouts.create({
        getTable: () => document.getElementById('generic-table'),
        getView: () => view,
        getColumns: () => columns,
        getMeta: (column) => ({ label: column, sortKey: column }),
        getColumnSeed: (column) => ({ min_width_px: 40, max_width_px: 400, width_px: widths[column] }),
        tableCode: '99',
        tableName: 'generic-fit-mode',
        render,
      });
      await controller.autoFitLayout({ percentile: 1 });
      return {
        scroll,
        hidden: Array.from(hidden),
        visibleHeaders: Array.from(document.querySelectorAll('th[data-col]')).map((th) => th.dataset.col),
      };
    });
    console.log(JSON.stringify({ genericAutoFit: genericResult }, null, 2));
    assert.equal(genericResult.scroll, false, 'generic auto-fit must not force horizontal scroll on');
    assert.deepEqual(genericResult.hidden, ['notes'], 'fit-mode auto-fit must preserve current hidden columns');
    assert.deepEqual(genericResult.visibleHeaders, ['name', 'value'], 'fit-mode auto-fit should only measure visible columns');
  } finally {
    await genericPage.close();
  }

  const sparsePage = await browser.newPage({ viewport: { width: 1024, height: 620 } });
  try {
    await sparsePage.setContent(`<!doctype html>
      <html>
        <head>
          <style>
            body { margin:0; background:#080b12; color:#f8fbff; font-family: Segoe UI, Arial, sans-serif; }
            ${tableCss}
            .table-wrap { width: 1000px; }
          </style>
        </head>
        <body>
          <div class="table-wrap"><table id="sparse-table" class="table-shared-ui table-shared-ui--scroll-x"></table></div>
        </body>
      </html>`);
    await sparsePage.addScriptTag({ content: tableUiSource });
    const sparseResult = await sparsePage.evaluate(async () => {
      const columns = ['vlan_id', 'cidr', 'source', 'description', '_actions'];
      const rows = [
        ['3', '192.0.2.0/24', 'inferred', '—'],
        ['20', '198.51.100.0/24', 'inferred', '—'],
        ['99', '203.0.113.0/24', 'inferred', '—'],
      ];
      const widths = { vlan_id: 160, cidr: 160, source: 160, description: 160, _actions: 56 };
      let hidden = new Set();
      let scroll = true;
      let saved = null;
      let headerLabels = {};
      const hyphenationRequests = [];
      function esc(value) {
        return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
      }
      function render() {
        const table = document.getElementById('sparse-table');
        const total = columns.reduce((sum, column) => sum + (widths[column] || 80), 0);
        table.style.setProperty('--table-fit-width', total + 'px');
        table.className = scroll ? 'table-shared-ui table-shared-ui--scroll-x' : 'table-shared-ui';
        const labels = {
          vlan_id: 'VLAN',
          cidr: 'CIDR',
          source: 'Source',
          description: 'Description',
          _actions: 'Actions',
        };
        table.innerHTML = '<colgroup>' + columns.map((column) => `<col data-col="${column}" style="width:${widths[column] || 80}px">`).join('') + '</colgroup>'
          + '<thead><tr>' + columns.map((column) => {
            const label = headerLabels[column] || labels[column];
            return `<th data-col="${column}"><span class="table-th-sort">${label}<span class="table-sort-arrow">⇅</span></span><span class="table-col-resize"></span></th>`;
          }).join('') + '</tr></thead><tbody>'
          + rows.map((row) => '<tr>'
            + `<td style="font-weight:700">${esc(row[0])}</td>`
            + `<td><code>${esc(row[1])}</code></td>`
            + `<td>${esc(row[2])}</td>`
            + `<td style="color:var(--text-dim)">${esc(row[3])}</td>`
            + '<td class="table-action-cell"><button class="secondary table-icon-btn table-icon-btn--edit" type="button"></button></td>'
            + '</tr>').join('')
          + '</tbody>';
      }
      const view = {
        isHorizontalScrollEnabled: () => scroll,
        setHorizontalScrollEnabled: (enabled) => { scroll = !!enabled; },
        getHiddenSet: () => new Set(hidden),
        getSortState: () => ({ key: 'vlan_id', dir: 1 }),
        setSortState: () => {},
        setHeaderLabelOverrides: (overrides) => { headerLabels = { ...overrides }; render(); },
        getHeaderLabelOverride: (column) => headerLabels[column] || null,
        prefs: {
          getWidth: (column) => widths[column] || null,
          setWidth: (column, width) => { widths[column] = width; },
          setHiddenSet: (next) => { hidden = new Set(next); render(); },
        },
      };
      window.apiFetch = async (url, opts = {}) => {
        if (url.includes('/hyphenate-header')) {
          const body = JSON.parse(opts.body || '{}');
          hyphenationRequests.push(body);
          return {
            ok: true,
            json: async () => ({
              header: body.header,
              header_label: body.header === 'Description' ? 'Descrip-tion' : null,
              changed: body.header === 'Description',
              confidence: body.header === 'Description' ? 0.9 : 0.1,
              reason: 'test hyphenation',
              used_llm: true,
            }),
          };
        }
        if (url.includes('/resolve')) {
          return {
            ok: true,
            json: async () => ({
              layout_key: '0000130A',
              layout_data: {
                version: 1,
                columns: columns.map((column_key, position) => ({
                  column_key,
                  position,
                  hidden: false,
                  width_px: widths[column_key],
                })),
              },
            }),
          };
        }
        saved = JSON.parse(opts.body || '{}').layout_data || null;
        return { ok: true, json: async () => ({ layout_key: '0000130A', layout_data: saved }) };
      };
      render();
      const controller = window.TableBucketLayouts.create({
        getTable: () => document.getElementById('sparse-table'),
        getView: () => view,
        getColumns: () => columns,
        getMeta: (column) => ({
          label: column === 'vlan_id' ? 'VLAN' : column === '_actions' ? 'Actions' : column,
          sortKey: column === '_actions' ? null : column,
        }),
        getColumnSeed: (column) => ({
          min_width_px: column === '_actions' ? 44 : 40,
          max_width_px: column === '_actions' ? 56 : 260,
          width_px: widths[column],
        }),
        tableCode: '13',
        tableName: 'sparse-vlans-test',
        render,
      });
      const measurement = await controller.autoFitHorizontalLayout({ ensureHorizontalScroll: true, includeAllColumns: true, percentile: 1 });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const actionTh = document.querySelector('th[data-col="_actions"]');
      const actionLabel = actionTh?.querySelector('.table-th-sort');
      const actionThRect = actionTh?.getBoundingClientRect();
      const actionLabelRect = actionLabel?.getBoundingClientRect();
      return {
        widths: { ...widths },
        measurement,
        savedDescriptionLabel: saved?.columns?.find((column) => column.column_key === 'description')?.header_label || null,
        descriptionHeader: document.querySelector('th[data-col="description"]')?.textContent || '',
        actionHeaderFits: !!(actionThRect && actionLabelRect
          && actionLabelRect.left >= actionThRect.left - 0.5
          && actionLabelRect.right <= actionThRect.right + 0.5),
        hyphenationRequests,
      };
    });
    console.log(JSON.stringify({ sparseAutoFit: sparseResult }, null, 2));
    assert.ok(sparseResult.hyphenationRequests.some((request) => request.header === 'Description'), 'sparse table should try compact hyphenation first');
    assert.equal(sparseResult.savedDescriptionLabel, null, 'sparse comfort pass should remove auto hyphenation');
    assert.doesNotMatch(sparseResult.descriptionHeader, /Descrip-tion/, 'sparse comfort pass should restore the full header');
    assert.ok(sparseResult.measurement.tableWidth < 900, `sparse table should still be comfortably below viewport: ${sparseResult.measurement.tableWidth}px`);
    assert.ok(sparseResult.widths.description >= 90, `description should get comfort width: ${sparseResult.widths.description}px`);
    assert.ok(sparseResult.actionHeaderFits, 'sparse comfort pass should back the final Actions header inside its own column');
    assert.ok(sparseResult.widths._actions > 56, `actions should grow past tiny action max for header backing: ${sparseResult.widths._actions}px`);
  } finally {
    await sparsePage.close();
  }

  const groupedPage = await browser.newPage({ viewport: { width: 1010, height: 620 } });
  try {
    await groupedPage.setContent(`<!doctype html>
      <html>
        <head>
          <style>
            :root {
              --surface:#151823;
              --border:#2b3450;
              --text:#f8fbff;
              --text-dim:#8fa1c7;
              --accent:#5b9cf6;
            }
            body { margin:0; background:#080b12; color:#f8fbff; font-family: Segoe UI, Arial, sans-serif; }
            ${tableCss}
            .table-wrap { width: 990px; }
          </style>
        </head>
        <body>
          <div class="table-wrap"><table id="grouped-table" class="table-shared-ui table-shared-ui--scroll-x"></table></div>
        </body>
      </html>`);
    await groupedPage.addScriptTag({ content: tableUiSource });
    const groupedResult = await groupedPage.evaluate(async () => {
      const columns = ['ip_address', 'fqdn', 'record_type', 'source', 'mac_address', 'active', 'last_seen'];
      const groups = [
        {
          ip: '2001:db8:13:20::10',
          records: [
            ['alpha-office-west-wing.example.invalid', 'A', 'resolver-cache', '02:00:00:00:00:10', true, '2026-04-30 10:20:30'],
            ['alpha-printer.example.invalid', 'PTR', 'static-dhcp', '02:00:00:00:00:10', true, '2026-04-30 10:21:30'],
          ],
        },
        {
          ip: '2001:db8:13:20::11',
          records: [
            ['beta-lab-long-hostname.example.invalid', 'AAAA', 'resolver-cache', '02:00:00:00:00:11', false, '2026-04-30 10:22:30'],
          ],
        },
      ];
      const labels = {
        ip_address: 'IP Address',
        fqdn: 'FQDN',
        record_type: 'Type',
        source: 'Source',
        mac_address: 'MAC',
        active: 'Active',
        last_seen: 'Last Seen',
      };
      const widths = Object.fromEntries(columns.map((column) => [column, 180]));
      let open = false;
      let hidden = new Set();
      let scroll = true;
      let saved = null;
      let prepareCalls = 0;
      let restoreCalls = 0;

      function esc(value) {
        return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
      }

      function render() {
        const table = document.getElementById('grouped-table');
        const total = columns.reduce((sum, column) => sum + (widths[column] || 80), 0);
        table.style.setProperty('--table-fit-width', total + 'px');
        table.className = scroll ? 'table-shared-ui table-shared-ui--scroll-x' : 'table-shared-ui';
        table.innerHTML = '<colgroup>' + columns.map((column) => `<col data-col="${column}" style="width:${widths[column]}px">`).join('') + '</colgroup>'
          + '<thead><tr>' + columns.map((column) => `<th data-col="${column}"><span class="table-th-sort">${esc(labels[column])}<span class="table-sort-arrow">⇅</span></span><span class="table-col-resize"></span></th>`).join('') + '</tr></thead>'
          + '<tbody>' + groups.map((group) => {
            const summary = `${group.records.length} records · MAC ${group.records[0][3]}`;
            const header = `<tr data-group-row="${esc(group.ip)}"><td data-col="ip_address"><strong class="group-ip">${esc(group.ip)}</strong></td><td colspan="${columns.length - 1}" style="color:var(--text-dim)">${esc(summary)}</td></tr>`;
            const detail = group.records.map((record) => '<tr data-detail-row style="display:' + (open ? 'table-row' : 'none') + '">'
              + '<td style="padding-left:20px;color:var(--text-dim)">↳</td>'
              + `<td><span class="table-cell-clip__text">${esc(record[0])}</span></td>`
              + `<td>${esc(record[1])}</td>`
              + `<td><span class="table-cell-clip__text">${esc(record[2])}</span></td>`
              + `<td><code>${esc(record[3])}</code></td>`
              + `<td style="text-align:center">${record[4] ? '✓' : '✗'}</td>`
              + `<td style="white-space:nowrap;color:var(--text-dim)">${esc(record[5])}</td>`
              + '</tr>').join('');
            return header + detail;
          }).join('') + '</tbody>';
      }

      const view = {
        isHorizontalScrollEnabled: () => scroll,
        setHorizontalScrollEnabled: (enabled) => { scroll = !!enabled; },
        getHiddenSet: () => new Set(hidden),
        getSortState: () => ({ key: 'ip_address', dir: 1 }),
        setSortState: () => {},
        setHeaderLabelOverrides: () => {},
        getHeaderLabelOverride: () => null,
        prefs: {
          getWidth: (column) => widths[column] || null,
          setWidth: (column, width) => { widths[column] = width; },
          setHiddenSet: (next) => { hidden = new Set(next); render(); },
        },
      };
      window.apiFetch = async (url, opts = {}) => {
        if (url.includes('/resolve')) {
          return {
            ok: true,
            json: async () => ({
              layout_key: '0000120A',
              layout_data: {
                version: 1,
                columns: columns.map((column_key, position) => ({
                  column_key,
                  position,
                  hidden: false,
                  width_px: widths[column_key],
                })),
              },
            }),
          };
        }
        const body = JSON.parse(opts.body || '{}');
        saved = body.layout_data || null;
        return { ok: true, json: async () => ({ layout_key: '0000120A', layout_data: saved }) };
      };
      render();
      const controller = window.TableBucketLayouts.create({
        getTable: () => document.getElementById('grouped-table'),
        getView: () => view,
        getColumns: () => columns,
        getMeta: (column) => ({ label: labels[column], sortKey: column }),
        getColumnSeed: (column) => ({
          min_width_px: column === 'fqdn' ? 72 : 40,
          max_width_px: column === 'fqdn' ? 420 : 260,
          width_px: widths[column],
        }),
        tableCode: '12',
        tableName: 'grouped-dns-test',
        autoFitMode: 'grouped',
        prepareGroupedAutoFitMeasurement: () => {
          prepareCalls += 1;
          const wasOpen = open;
          open = true;
          render();
          return () => {
            restoreCalls += 1;
            open = wasOpen;
            render();
          };
        },
        render,
      });
      const measurement = await controller.autoFitLayout({ percentile: 1 });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const hiddenDetailRows = Array.from(document.querySelectorAll('[data-detail-row]')).filter((row) => row.style.display === 'none').length;
      const clippedGroupIps = Array.from(document.querySelectorAll('.group-ip')).filter((el) => {
        const textRect = el.getBoundingClientRect();
        const cellRect = el.closest('td').getBoundingClientRect();
        return textRect.left < cellRect.left - 1 || textRect.right > cellRect.right + 1;
      }).map((el) => el.textContent);
      return {
        widths: { ...widths },
        saved,
        measurement,
        open,
        prepareCalls,
        restoreCalls,
        hiddenDetailRows,
        clippedGroupIps,
      };
    });
    console.log(JSON.stringify({
      groupedAutoFit: {
        widths: groupedResult.widths,
        algorithm: groupedResult.saved?.algorithm_version,
        prepareCalls: groupedResult.prepareCalls,
        restoreCalls: groupedResult.restoreCalls,
        hiddenDetailRows: groupedResult.hiddenDetailRows,
        clippedGroupIps: groupedResult.clippedGroupIps,
        rowCountMeasured: groupedResult.measurement?.rowCount,
      },
    }, null, 2));
    assert.equal(groupedResult.saved.algorithm_version, 'browser-measured-grouped-horizontal-v1');
    assert.equal(groupedResult.prepareCalls, 1, 'grouped auto-fit should prepare expanded measurement once');
    assert.equal(groupedResult.restoreCalls, 1, 'grouped auto-fit should restore expansion state once');
    assert.equal(groupedResult.open, false, 'grouped auto-fit should restore collapsed state');
    assert.equal(groupedResult.hiddenDetailRows, 3, 'detail rows should be collapsed again after measurement');
    assert.deepEqual(groupedResult.clippedGroupIps, [], 'grouped top-level IP cells should not clip after auto-fit');
    assert.ok(groupedResult.widths.ip_address >= 138, `grouped IP column should measure top-level group content: ${groupedResult.widths.ip_address}px`);
    assert.ok(groupedResult.widths.fqdn >= 190, `grouped FQDN should measure hidden detail content: ${groupedResult.widths.fqdn}px`);
    assert.ok(groupedResult.widths.record_type <= 100, `grouped Type column should remain compact: ${groupedResult.widths.record_type}px`);
    assert.ok(groupedResult.widths.source >= 112, `grouped Source column should measure detail content: ${groupedResult.widths.source}px`);
  } finally {
    await groupedPage.close();
  }

  const backupPage = await browser.newPage({ viewport: { width: 660, height: 420 } });
  try {
    await backupPage.setContent(`<!doctype html>
      <html>
        <head>
          <style>
            body { margin:0; background:#080b12; color:#f8fbff; font-family: Segoe UI, Arial, sans-serif; }
            ${tableCss}
            .table-wrap { width: 640px; }
          </style>
        </head>
        <body>
          <div class="table-wrap"><table id="backups-table" class="table-shared-ui table-shared-ui--scroll-x"></table></div>
        </body>
      </html>`);
    await backupPage.addScriptTag({ content: tableUiSource });
    const backupResult = await backupPage.evaluate(async () => {
      const columns = ['filename', 'size_bytes', 'created_at', '_actions'];
      const rows = [
        ['2026-03-10-132340-blueprints.db.tar.gz', '5.2 KB', '2026-03-10 13:23:40 UTC'],
        ['2026-04-29-192036-blueprints.db.tar.gz', '3251.8 KB', '2026-04-29 19:20:38 UTC'],
      ];
      const widths = { filename: 80, size_bytes: 72, created_at: 170, _actions: 102 };
      let hidden = new Set();
      let scroll = true;
      let saved = null;
      function esc(value) {
        return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
      }
      function filenameCell(filename) {
        return `<td><span class="table-cell-clip"><span class="table-cell-clip__text"><code style="font-size:12px">${esc(filename)}</code></span></span></td>`;
      }
      function actionsCell() {
        return '<td class="table-action-cell" style="white-space:nowrap"><div class="table-inline-actions">'
          + '<button class="secondary table-icon-btn table-icon-btn--restore" type="button"></button>'
          + '<button class="secondary table-icon-btn table-icon-btn--force-restore" type="button"></button>'
          + '<button class="secondary table-icon-btn table-icon-btn--delete" type="button"></button>'
          + '</div></td>';
      }
      function render() {
        const table = document.getElementById('backups-table');
        const total = columns.reduce((sum, column) => sum + (widths[column] || 80), 0);
        table.style.setProperty('--table-fit-width', total + 'px');
        table.className = scroll ? 'table-shared-ui table-shared-ui--scroll-x' : 'table-shared-ui';
        table.innerHTML = '<colgroup>' + columns.map((column) => `<col data-col="${column}" style="width:${widths[column] || 80}px">`).join('') + '</colgroup>'
          + '<thead><tr>'
          + '<th data-col="filename"><span class="table-th-sort">Filename<span class="table-sort-arrow active">▲</span></span><span class="table-col-resize"></span></th>'
          + '<th data-col="size_bytes"><span class="table-th-sort">Size<span class="table-sort-arrow">⇅</span></span><span class="table-col-resize"></span></th>'
          + '<th data-col="created_at"><span class="table-th-sort">Created<span class="table-sort-arrow">⇅</span></span><span class="table-col-resize"></span></th>'
          + '<th data-col="_actions">Actions<span class="table-col-resize"></span></th>'
          + '</tr></thead><tbody>'
          + rows.map((row) => '<tr>'
            + filenameCell(row[0])
            + `<td style="white-space:nowrap">${esc(row[1])}</td>`
            + `<td style="white-space:nowrap;color:var(--text-dim)">${esc(row[2])}</td>`
            + actionsCell()
            + '</tr>').join('')
          + '</tbody>';
      }
      const view = {
        isHorizontalScrollEnabled: () => scroll,
        setHorizontalScrollEnabled: (enabled) => { scroll = !!enabled; },
        getHiddenSet: () => new Set(hidden),
        getSortState: () => ({ key: 'filename', dir: 1 }),
        setSortState: () => {},
        setHeaderLabelOverrides: () => {},
        getHeaderLabelOverride: () => null,
        prefs: {
          getWidth: (column) => widths[column] || null,
          setWidth: (column, width) => { widths[column] = width; },
          setHiddenSet: (next) => { hidden = new Set(next); render(); },
        },
      };
      window.apiFetch = async (url, opts = {}) => {
        if (url.includes('/resolve')) {
          return {
            ok: true,
            json: async () => ({
              layout_key: '0000070A',
              layout_data: {
                version: 1,
                columns: columns.map((column_key, position) => ({
                  column_key,
                  position,
                  hidden: false,
                  width_px: widths[column_key],
                })),
              },
            }),
          };
        }
        const body = JSON.parse(opts.body || '{}');
        saved = body.layout_data || null;
        return { ok: true, json: async () => ({ layout_key: '0000070A', layout_data: saved }) };
      };
      render();
      const controller = window.TableBucketLayouts.create({
        getTable: () => document.getElementById('backups-table'),
        getView: () => view,
        getColumns: () => columns,
        getMeta: (column) => ({
          label: column === 'filename' ? 'Filename' : column === 'size_bytes' ? 'Size' : column === 'created_at' ? 'Created' : 'Actions',
          sortKey: column === '_actions' ? null : column,
        }),
        getColumnSeed: (column) => ({
          min_width_px: column === '_actions' ? 48 : 40,
          max_width_px: column === '_actions' ? 102 : 900,
          width_px: widths[column],
        }),
        tableCode: '07',
        tableName: 'node-backups',
        render,
      });
      const measurement = await controller.autoFitHorizontalLayout({ ensureHorizontalScroll: true, includeAllColumns: true, percentile: 1 });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const clippedFilenames = Array.from(document.querySelectorAll('.table-cell-clip__text')).filter((el) => {
        return el.scrollWidth > el.clientWidth + 1;
      }).map((el) => el.textContent);
      return {
        widths: { ...widths },
        measurement,
        savedFilenameWidth: saved?.columns?.find((column) => column.column_key === 'filename')?.width_px || null,
        clippedFilenames,
      };
    });
    console.log(JSON.stringify({ backupAutoFit: backupResult }, null, 2));
    assert.deepEqual(backupResult.clippedFilenames, [], 'backup filenames should not be clipped after auto-fit');
    assert.ok(backupResult.savedFilenameWidth >= 220, `backup filename column too narrow: ${backupResult.savedFilenameWidth}px`);
    assert.ok(backupResult.widths.filename > backupResult.widths.created_at, 'filename data should dominate header-sized columns when filenames are longer');
  } finally {
    await backupPage.close();
  }

  const servicesPage = await browser.newPage({ viewport: { width: 980, height: 620 } });
  try {
    await servicesPage.setContent(`<!doctype html>
      <html>
        <head>
          <style>
            body { margin:0; background:#080b12; color:#f8fbff; font-family: Segoe UI, Arial, sans-serif; }
            ${tableCss}
            .table-wrap { width: 964px; }
          </style>
        </head>
        <body>
          <div class="table-wrap"><table id="services-table" class="table-shared-ui table-shared-ui--scroll-x"></table></div>
        </body>
      </html>`);
    await servicesPage.addScriptTag({ content: tableUiSource });
    const servicesResult = await servicesPage.evaluate(async () => {
      const columns = ['host_machine', 'project_status', 'tags', 'links', 'description'];
      const rows = [
        ['lab-host / demo-841', 'deployed', ['agent', 'ai', 'docker', 'demo841'], null, 'General-purpose AI agent framework'],
        ['internet / none', 'deployed', [], [{ label: 'Open', url: 'https://example.invalid/test' }], 'Test url'],
        ['none / internet', 'deployed', [], [{ label: 'Open', url: 'https://example.invalid/another' }], 'Just another test'],
        ['lab-host / demo-841', 'deployed', ['tts', 'audiobook', 'gradio', 'gpu', 'docker', 'demo841'], null, 'Gradio UI for converting eBooks'],
      ];
      const widths = { host_machine: 260, project_status: 150, tags: 260, links: 220, description: 420 };
      let hidden = new Set();
      let scroll = true;
      let saved = null;
      function esc(value) {
        return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
      }
      function render() {
        const table = document.getElementById('services-table');
        const total = columns.reduce((sum, column) => sum + (widths[column] || 80), 0);
        table.style.setProperty('--table-fit-width', total + 'px');
        table.className = scroll ? 'table-shared-ui table-shared-ui--scroll-x' : 'table-shared-ui';
        table.innerHTML = '<colgroup>' + columns.map((column) => `<col data-col="${column}" style="width:${widths[column] || 80}px">`).join('') + '</colgroup>'
          + '<thead><tr>'
          + '<th data-col="host_machine"><span class="table-th-sort">Host / LXC<span class="table-sort-arrow">⇅</span></span><span class="table-col-resize"></span></th>'
          + '<th data-col="project_status"><span class="table-th-sort">Status<span class="table-sort-arrow">⇅</span></span><span class="table-col-resize"></span></th>'
          + '<th data-col="tags"><span class="table-th-sort">Tags<span class="table-sort-arrow">⇅</span></span><span class="table-col-resize"></span></th>'
          + '<th data-col="links"><span class="table-th-sort">Links<span class="table-sort-arrow">⇅</span></span><span class="table-col-resize"></span></th>'
          + '<th data-col="description"><span class="table-th-sort">Description<span class="table-sort-arrow">⇅</span></span><span class="table-col-resize"></span></th>'
          + '</tr></thead><tbody>'
          + rows.map((row) => '<tr>'
            + `<td>${esc(row[0])}</td>`
            + `<td><span class="status-deployed">${esc(row[1])}</span></td>`
            + `<td>${row[2].map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}</td>`
            + `<td>${row[3] ? row[3].map((link) => `<a class="link-badge" href="${esc(link.url)}">${esc(link.label)}</a>`).join('') : '<span style="color:var(--text-dim)">—</span>'}</td>`
            + `<td style="color:var(--text-dim);font-size:13px">${esc(row[4])}</td>`
            + '</tr>').join('')
          + '</tbody>';
      }
      const view = {
        isHorizontalScrollEnabled: () => scroll,
        setHorizontalScrollEnabled: (enabled) => { scroll = !!enabled; },
        getHiddenSet: () => new Set(hidden),
        getSortState: () => ({ key: 'host_machine', dir: 1 }),
        setSortState: () => {},
        setHeaderLabelOverrides: () => {},
        getHeaderLabelOverride: () => null,
        prefs: {
          getWidth: (column) => widths[column] || null,
          setWidth: (column, width) => { widths[column] = width; },
          setHiddenSet: (next) => { hidden = new Set(next); render(); },
        },
      };
      window.apiFetch = async (url, opts = {}) => {
        if (url.includes('/resolve')) {
          return {
            ok: true,
            json: async () => ({
              layout_key: '0000040A',
              layout_data: {
                version: 1,
                columns: columns.map((column_key, position) => ({
                  column_key,
                  position,
                  hidden: false,
                  width_px: widths[column_key],
                })),
              },
            }),
          };
        }
        const body = JSON.parse(opts.body || '{}');
        saved = body.layout_data || null;
        return { ok: true, json: async () => ({ layout_key: '0000040A', layout_data: saved }) };
      };
      render();
      const controller = window.TableBucketLayouts.create({
        getTable: () => document.getElementById('services-table'),
        getView: () => view,
        getColumns: () => columns,
        getMeta: (column) => ({
          label: column === 'host_machine' ? 'Host / LXC' : column === 'project_status' ? 'Status' : column === 'links' ? 'Links' : column,
          sortKey: column,
        }),
        getColumnSeed: (column) => {
          if (column === 'links') return { min_width_px: 50, max_width_px: 360, width_px: widths[column] };
          if (column === 'project_status') return { min_width_px: 96, max_width_px: 220, width_px: widths[column] };
          if (column === 'tags') return { min_width_px: 120, max_width_px: 520, width_px: widths[column] };
          if (column === 'description') return { min_width_px: 160, max_width_px: 1400, width_px: widths[column] };
          return { min_width_px: 120, max_width_px: 420, width_px: widths[column] };
        },
        tableCode: '04',
        tableName: 'services',
        render,
      });
      const measurement = await controller.autoFitHorizontalLayout({ ensureHorizontalScroll: true, includeAllColumns: true, percentile: 1 });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        widths: { ...widths },
        savedLinksWidth: saved?.columns?.find((column) => column.column_key === 'links')?.width_px || null,
        clippedBadges: Array.from(document.querySelectorAll('.link-badge')).filter((badge) => badge.scrollWidth > badge.clientWidth + 1).map((badge) => badge.textContent),
        tableWidth: measurement.tableWidth,
      };
    });
    console.log(JSON.stringify({ servicesAutoFit: servicesResult }, null, 2));
    assert.deepEqual(servicesResult.clippedBadges, [], 'Services links badges should not clip after auto-fit');
    assert.ok(servicesResult.savedLinksWidth <= 90, `Services links column should stay compact for Open badges: ${servicesResult.savedLinksWidth}px`);
  } finally {
    await servicesPage.close();
  }
} finally {
  await browser.close();
}
