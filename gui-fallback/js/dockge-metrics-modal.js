/* Shared Dockge resource metrics modal. */

'use strict';

const DockgeMetricsModal = (() => {
  const SEGMENTS = 24;
  let current = null;

  function html(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch]);
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, number(value)));
  }

  function formatPercent(value) {
    const pct = clampPercent(value);
    if (pct >= 10) return `${pct.toFixed(1)}%`;
    if (pct >= 1) return `${pct.toFixed(2)}%`;
    return `${pct.toFixed(3)}%`;
  }

  function formatBytes(value) {
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let size = Math.max(0, number(value));
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    const places = size >= 10 || unit === 0 ? 0 : 1;
    return `${size.toFixed(places)} ${units[unit]}`;
  }

  function formatRate(value) {
    return `${formatBytes(value)}/s`;
  }

  function formatCores(value) {
    const cores = Math.max(0, number(value));
    if (cores >= 10) return `${cores.toFixed(1)} cores`;
    if (cores >= 1) return `${cores.toFixed(2)} cores`;
    if (cores >= 0.01) return `${cores.toFixed(3)} cores`;
    return `${cores.toFixed(4)} cores`;
  }

  function average(samples, key) {
    const values = (samples || []).map(sample => Number(sample[key])).filter(Number.isFinite);
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function findStackMetric(data, stackName) {
    const target = String(stackName || '').toLowerCase();
    return (data?.stacks || []).find(item => String(item.stack_name || '').toLowerCase() === target) || null;
  }

  function aggregateStacks(data) {
    return (data?.stacks || []).reduce((acc, item) => {
      acc.cpuDockerPercent += Math.max(0, number(item.cpu_docker_percent));
      acc.memoryBytes += Math.max(0, number(item.memory_bytes));
      return acc;
    }, { cpuDockerPercent: 0, memoryBytes: 0 });
  }

  function segmentHtml(percent) {
    const pct = clampPercent(percent);
    const segmentSize = 100 / SEGMENTS;
    const parts = [];
    for (let index = 0; index < SEGMENTS; index += 1) {
      const start = index * segmentSize;
      const fill = Math.max(0, Math.min(1, (pct - start) / segmentSize));
      const cls = fill > 0 ? 'dockge-metrics-meter__segment is-filled' : 'dockge-metrics-meter__segment';
      parts.push(`<span class="${cls}" style="--fill-pct:${(fill * 100).toFixed(1)}%"></span>`);
    }
    return `<div class="dockge-metrics-meter__segments" style="--dockge-metrics-segments:${SEGMENTS}">${parts.join('')}</div>`;
  }

  function meterHtml({ label, value, percent, scale, detail }) {
    return `<div class="dockge-metrics-meter">
      <div class="dockge-metrics-meter__head">
        <span class="dockge-metrics-meter__label">${html(label)}</span>
        <span class="dockge-metrics-meter__value">${html(value)}</span>
      </div>
      ${segmentHtml(percent)}
      <div class="dockge-metrics-meter__scale">
        <span>${html(scale?.[0] || '0')}</span>
        <span>${html(scale?.[1] || '')}</span>
        <span>${html(scale?.[2] || '100%')}</span>
      </div>
      ${detail ? `<div class="dockge-metrics-meter__detail">${html(detail)}</div>` : ''}
    </div>`;
  }

  function ledHtml(label, value, meta) {
    return `<div class="dockge-metrics-led">
      <span class="dockge-metrics-led__label">${html(label)}</span>
      <div class="dockge-metrics-led__display">${html(value)}</div>
      <p class="dockge-metrics-led__meta">${html(meta)}</p>
    </div>`;
  }

  function hostMeters(context) {
    const data = context.data || {};
    const host = data.host || {};
    const capacity = data.capacity || {};
    const cpuUnits = Math.max(0, number(capacity.cpu_units));
    const hostCpuPercent = clampPercent(host.cpu_percent);
    const hostCpuUsed = cpuUnits ? (hostCpuPercent / 100) * cpuUnits : 0;
    const hostMemoryTotal = Math.max(0, number(host.memory_total_bytes || capacity.memory_bytes));
    const hostMemoryUsed = Math.max(0, number(host.memory_used_bytes));
    const hostMemoryPercent = hostMemoryTotal ? (hostMemoryUsed / hostMemoryTotal) * 100 : clampPercent(host.memory_percent);
    const networkRx = Math.max(0, number(host.network_external_rx_bytes_per_second));
    const networkTx = Math.max(0, number(host.network_external_tx_bytes_per_second));
    const networkTotal = networkRx + networkTx;
    const networkCapacity = Math.max(0, number(host.network_external_capacity_bytes_per_second));
    const networkPercent = networkCapacity ? (networkTotal / networkCapacity) * 100 : 0;
    const networkScale = networkCapacity
      ? ['0', formatRate(networkCapacity / 2), formatRate(networkCapacity)]
      : ['0', 'live', 'capacity unavailable'];

    return `<section class="dockge-metrics-panel">
      <h3 class="dockge-metrics-panel__title">Host Activity</h3>
      ${meterHtml({
        label: 'CPU',
        value: `${formatPercent(hostCpuPercent)} host`,
        percent: hostCpuPercent,
        scale: ['0', cpuUnits ? formatCores(cpuUnits / 2) : '50%', cpuUnits ? formatCores(cpuUnits) : '100%'],
        detail: cpuUnits ? `${formatCores(hostCpuUsed)} active of ${formatCores(cpuUnits)} available` : '',
      })}
      ${meterHtml({
        label: 'RAM',
        value: `${formatPercent(hostMemoryPercent)} host`,
        percent: hostMemoryPercent,
        scale: ['0', hostMemoryTotal ? formatBytes(hostMemoryTotal / 2) : '50%', hostMemoryTotal ? formatBytes(hostMemoryTotal) : '100%'],
        detail: hostMemoryTotal ? `${formatBytes(hostMemoryUsed)} used of ${formatBytes(hostMemoryTotal)}` : '',
      })}
      ${meterHtml({
        label: 'Network',
        value: formatRate(networkTotal),
        percent: networkPercent,
        scale: networkScale,
        detail: `RX ${formatRate(networkRx)} / TX ${formatRate(networkTx)}`,
      })}
    </section>`;
  }

  function aggregateMeters(context) {
    const data = context.data || {};
    const capacity = data.capacity || {};
    const aggregate = aggregateStacks(data);
    const cpuUnits = Math.max(0, number(capacity.cpu_units));
    const memoryTotal = Math.max(0, number(data.host?.memory_total_bytes || capacity.memory_bytes));
    const cpuCores = aggregate.cpuDockerPercent / 100;
    const cpuPercent = cpuUnits ? (cpuCores / cpuUnits) * 100 : 0;
    const memoryPercent = memoryTotal ? (aggregate.memoryBytes / memoryTotal) * 100 : 0;

    return `<section class="dockge-metrics-panel">
      <h3 class="dockge-metrics-panel__title">Dockge Aggregate</h3>
      ${meterHtml({
        label: 'CPU',
        value: `${formatPercent(cpuPercent)} host`,
        percent: cpuPercent,
        scale: ['0', cpuUnits ? formatCores(cpuUnits / 2) : '50%', cpuUnits ? formatCores(cpuUnits) : '100%'],
        detail: `${formatCores(cpuCores)} across Dockge stacks`,
      })}
      ${meterHtml({
        label: 'RAM',
        value: `${formatPercent(memoryPercent)} host`,
        percent: memoryPercent,
        scale: ['0', memoryTotal ? formatBytes(memoryTotal / 2) : '50%', memoryTotal ? formatBytes(memoryTotal) : '100%'],
        detail: `${formatBytes(aggregate.memoryBytes)} across Dockge stacks`,
      })}
    </section>`;
  }

  function stackReadout(context) {
    const samples = context.state?.samples || [];
    const stackMetric = context.state?.metric || findStackMetric(context.data, context.stackName) || {};
    const trace = context.state?.trace || null;
    const sampleCount = samples.length;
    const cpuCores = sampleCount ? average(samples, 'cpu_cores') : number(stackMetric.cpu_docker_percent) / 100;
    const memoryBytes = sampleCount ? average(samples, 'memory_bytes') : number(stackMetric.memory_bytes);
    const cpuScale = Math.max(0.01, number(context.scale?.cpuCores, 2));
    const memoryScale = Math.max(1, number(context.scale?.memoryBytes, 8 * 1000 * 1000 * 1000));
    const cpuPercent = (cpuCores / cpuScale) * 100;
    const memoryPercent = (memoryBytes / memoryScale) * 100;
    const windowText = sampleCount
      ? `${sampleCount}s rolling average${sampleCount >= 10 ? '' : ' so far'}`
      : 'waiting for rolling sample';
    const cpuTrace = trace ? `; transient ${formatCores(trace.cpu_cores)}` : '';
    const memoryTrace = trace ? `; transient ${formatBytes(trace.memory_bytes)}` : '';

    return `<section class="dockge-metrics-panel dockge-metrics-panel--wide">
      <h3 class="dockge-metrics-panel__title">${html(context.stackName || 'Stack')}</h3>
      <div class="dockge-metrics-led-grid">
        ${ledHtml('CPU', sampleCount ? formatCores(cpuCores).toUpperCase() : 'WAIT', `${formatPercent(cpuPercent)} of 2-core instrument, ${windowText}${cpuTrace}`)}
        ${ledHtml('RAM', sampleCount ? formatBytes(memoryBytes).toUpperCase() : 'WAIT', `${formatPercent(memoryPercent)} of 8 GB instrument, ${windowText}${memoryTrace}`)}
      </div>
    </section>`;
  }

  function render(context) {
    const dialog = document.getElementById('dockge-metrics-modal');
    const badge = document.getElementById('dockge-metrics-modal-badge');
    const title = document.getElementById('dockge-metrics-modal-title');
    const body = document.getElementById('dockge-metrics-modal-body');
    if (!dialog || !body) return;

    if (badge) badge.textContent = context.surfaceLabel || 'METRICS';
    if (title) title.textContent = `${context.stackName || 'Dockge'} Resources`;

    const source = context.data?.source ? `source ${context.data.source}` : 'metrics stream';
    const age = Number.isFinite(Number(context.data?.stream_age_ms))
      ? `, ${Number(context.data.stream_age_ms).toFixed(1)} ms stream age`
      : '';
    const host = context.hostLabel || 'Dockge host';
    body.innerHTML = `<p class="dockge-metrics-modal__status">${html(host)} · ${html(source)}${html(age)}</p>
      <div class="dockge-metrics-modal__grid">
        ${hostMeters(context)}
        ${aggregateMeters(context)}
        ${stackReadout(context)}
      </div>`;
  }

  function open(context) {
    const dialog = document.getElementById('dockge-metrics-modal');
    if (!dialog) return;
    current = {
      surface: context.surface || '',
      stackName: context.stackName || '',
    };
    render(context);
    if (typeof HubModal !== 'undefined') {
      HubModal.open(dialog, { onClose: () => { current = null; } });
    } else if (typeof dialog.showModal === 'function' && !dialog.open) {
      dialog.showModal();
    }
  }

  function refresh(context) {
    const dialog = document.getElementById('dockge-metrics-modal');
    if (!dialog?.open || !current) return;
    if (current.surface !== (context.surface || '') || current.stackName !== (context.stackName || '')) return;
    render(context);
  }

  function getCurrent() {
    const dialog = document.getElementById('dockge-metrics-modal');
    if (!dialog?.open || !current) return null;
    return { ...current };
  }

  return { open, refresh, current: getCurrent };
})();
