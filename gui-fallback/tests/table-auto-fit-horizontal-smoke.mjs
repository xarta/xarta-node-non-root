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
        + headerCell('display_name', 'Display<br>Name')
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

    const rowHeights = Array.from(document.querySelectorAll('tbody tr')).map((row) => Math.ceil(row.getBoundingClientRect().height));
    return {
      widths: { ...widths },
      measurement,
      saved,
      clippedChips,
      clippedSortArrows,
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
    inlineActionRows: result.inlineActionRows,
    compactActionRows: result.compactActionRows,
    pendingHeaderHtml: result.pendingHeaderHtml,
  }, null, 2));

  assert.equal(result.saved.algorithm_version, 'browser-measured-horizontal-v1');
  assert.deepEqual(result.clippedChips, []);
  assert.deepEqual(result.clippedSortArrows, []);
  assert.equal(result.inlineActionRows, nodes.length);
  assert.equal(result.compactActionRows, 0);
  assert.match(result.saved.columns.find((column) => column.column_key === 'pending')?.header_label || '', /&shy;/);
  assert.match(result.pendingHeaderHtml, /Pend/);
  assert.ok(result.maxRowHeight <= 76, `row too deep: ${result.maxRowHeight}px`);
  assert.ok(result.widths.addresses >= 180, `addresses too narrow: ${result.widths.addresses}px`);
  assert.ok(result.widths.hostnames >= 215, `hostnames too narrow: ${result.widths.hostnames}px`);
  assert.ok(result.widths._actions >= 172, `actions too narrow: ${result.widths._actions}px`);
  assert.ok(result.widths.commit <= 95, `commit too wide: ${result.widths.commit}px`);
  assert.ok(result.widths.commit_inner <= 100, `commit inner too wide: ${result.widths.commit_inner}px`);
  assert.ok(result.widths.commit_non_root <= 135, `commit non-root too wide: ${result.widths.commit_non_root}px`);
  assert.ok(result.measurement.tableWidth >= 970, `table too narrow: ${result.measurement.tableWidth}px`);
  assert.ok(result.measurement.tableWidth <= 1230, `table too wide: ${result.measurement.tableWidth}px`);
} finally {
  await browser.close();
}
