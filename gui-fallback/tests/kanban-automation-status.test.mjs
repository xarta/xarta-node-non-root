import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const indexHtml = readFileSync(`${root}/index.html`, 'utf8');
const kanbanJs = readFileSync(`${root}/js/kanban/kanban-board.js`, 'utf8');
const activeBrowserObserverJs = readFileSync(`${root}/js/active-browser-observer.js`, 'utf8');
const kanbanMenuJs = readFileSync(`${root}/js/kanban/kanban-menu.js`, 'utf8');
const kanbanCss = readFileSync(`${root}/css/kanban-board.css`, 'utf8');

assert.match(
  indexHtml,
  /data-kanban-action="automation-status"/,
  'Kanban toolbar must expose the Automation status action.',
);

assert.match(
  indexHtml,
  /data-personal-filter-extra-tabs="[^"]*postgres[^"]*automation[^"]*prompts[^"]*provenance/,
  'Kanban adaptive panel must register the Automation tab beside Postgres, Prompts, and Provenance.',
);

assert.match(
  kanbanJs,
  /CONTENT_VIEW_IDS\s*=\s*\[[^\]]*'automation'/,
  'Kanban content view registry must include the automation surface.',
);

assert.match(
  kanbanJs,
  /function\s+embeddedAutomationStatusHtml\(\)[\s\S]*\/api\/v1\/personal\/kanban\/automation\/status/,
  'Automation panel must load the Review Processor status endpoint.',
);

assert.match(
  kanbanJs,
  /function\s+embeddedAutomationStatusHtml\(\)[\s\S]*commit_link_health[\s\S]*Recent Decisions/,
  'Automation panel must render commit-link health and recent decisions.',
);

assert.match(
  kanbanJs,
  /data-kanban-automation-action="scan-reviews"[\s\S]*data-kanban-automation-action="run-idle-tick"[\s\S]*data-kanban-automation-action="requeue-timeouts"/,
  'Automation panel must expose Review scan, due-work, and timeout requeue controls.',
);

assert.match(
  kanbanJs,
  /function\s+automationReviewMarkers\(\)[\s\S]*recent_markers[\s\S]*function\s+automationFailureAggregates\(\)[\s\S]*failure_aggregates[\s\S]*function\s+automationReviewMarkersHtml\(\)[\s\S]*Review queued[\s\S]*Preprocess queued[\s\S]*timeout_count[\s\S]*retry_waiting_count[\s\S]*retry_due_count[\s\S]*superseded_count/,
  'Automation panel must render retry state and review/preprocessing queue lifecycle counts.',
);

assert.match(
  kanbanJs,
  /function\s+automationReviewMarkersHtml\(\)[\s\S]*marker\.attempt_count/,
  'Automation panel must render marker attempt counts.',
);

assert.match(
  kanbanJs,
  /function\s+runAutomationStatusControl\(action\)[\s\S]*review-processor\/idle-scan[\s\S]*review-processor\/requeue-timeouts[\s\S]*automation\/idle-worker\/tick/,
  'Automation controls must call the Review Processor scan, idle tick, and timeout endpoints.',
);

assert.match(
  kanbanJs,
  /function\s+automationFailureAggregatesHtml\(\)[\s\S]*Historical groups[\s\S]*retry-waiting[\s\S]*Retry Failure History[\s\S]*Last Error/,
  'Automation panel must render retry failure history with retry state, historical grouping, and last error.',
);

assert.match(
  kanbanJs,
  /Active Retries[\s\S]*retryWaitingCount[\s\S]*history \$\{failureCount\} events/,
  'Automation panel must headline active retry waits separately from historical failure events.',
);

assert.match(
  kanbanJs,
  /Queue Work[\s\S]*totalQueueLength[\s\S]*review \$\{queueLength\}[\s\S]*preprocessing \$\{preprocessingQueueLength\}/,
  'Automation panel Queue Work metric must count review and preprocessing queues together.',
);

assert.match(
  kanbanJs,
  /function\s+embeddedAutomationStatusHtml\(\)[\s\S]*idle_worker[\s\S]*owner \$\{idleWorker\.owner_node_id[\s\S]*Worker Node/,
  'Automation panel must render the Kanban idle worker singleton owner node state.',
);

assert.match(
  kanbanJs,
  /function\s+embeddedAutomationStatusHtml\(\)[\s\S]*output_contract[\s\S]*Output Contract/,
  'Automation panel must render the Review Processor output contract.',
);

assert.match(
  kanbanJs,
  /function\s+embeddedAutomationStatusHtml\(\)[\s\S]*processing_policy[\s\S]*automationProcessingPolicyHtml\(\)/,
  'Automation panel must render the Review Processor processing policy.',
);

assert.match(
  kanbanJs,
  /function\s+automationOutputContractHtml\(\)[\s\S]*output_types[\s\S]*kanban-automation-contract-type/,
  'Automation panel must expose output contract types.',
);

assert.match(
  kanbanJs,
  /function\s+automationProcessingPolicyHtml\(\)[\s\S]*local_processing[\s\S]*No automatic switch/,
  'Automation panel must expose the cloud-first processing policy gate.',
);

assert.match(
  kanbanJs,
  /decisionCount\s*=\s*Number\(decisions\.count\s*\?\?\s*decisions\.total/,
  'Automation panel must read the backend decision count field.',
);

assert.match(
  kanbanJs,
  /healthDecisionCount\s*=\s*Number\(health\.decision_count\s*\?\?\s*health\.decisions/,
  'Automation panel must read the backend commit health decision count field.',
);

assert.match(
  kanbanJs,
  /provider\.planned\s*\|\|\s*provider\.local_processing/,
  'Automation panel must read the backend provider planned-mode field.',
);

assert.match(
  kanbanJs,
  /id:\s*'automation',\s*label:\s*'Automation'[\s\S]*if\s*\(tab === 'automation'\)\s*return embeddedAutomationStatusHtml\(host\)/,
  'Shared Kanban panels must render the Automation tab.',
);

assert.match(
  kanbanJs,
  /function\s+openAutomationStatusModal\(\)[\s\S]*id:\s*'kanban-automation-status-modal'/,
  'Automation status must have a modal fallback.',
);

assert.match(
  kanbanJs,
  /automation_status_loaded:[\s\S]*automation_review_processor_status:[\s\S]*automation_review_queue_length:[\s\S]*automation_review_active_count:[\s\S]*automation_review_timeout_count:[\s\S]*automation_review_superseded_count:[\s\S]*automation_review_marker_count:[\s\S]*automation_failure_event_count:[\s\S]*automation_repeated_failure_count:[\s\S]*automation_retry_waiting_count:[\s\S]*automation_retry_due_count:[\s\S]*automation_failure_group_count:[\s\S]*automation_idle_worker_current_node:[\s\S]*automation_idle_worker_owner_node:[\s\S]*automation_idle_worker_runs_on_this_node:[\s\S]*automation_idle_worker_effective_enabled:[\s\S]*automation_busy_action:[\s\S]*automation_last_result:[\s\S]*automation_commit_link_health_ok:[\s\S]*automation_output_contract_schema:[\s\S]*automation_output_contract_types:[\s\S]*automation_processing_policy_schema:[\s\S]*automation_processing_policy_active_mode:[\s\S]*automation_processing_policy_local_gate:/,
  'Kanban snapshots must expose automation status, retry failures, and queue proof fields.',
);

assert.match(
  kanbanMenuJs,
  /automation:[\s\S]*kanban-automation-status[\s\S]*fn:\s*'kanban\.automationStatus'/,
  'Kanban menu must expose the Automation Status command.',
);

assert.match(
  kanbanCss,
  /\.kanban-icon-btn--automation::before[\s\S]*\.kanban-automation-controls[\s\S]*\.kanban-automation-grid[\s\S]*\.kanban-automation-contract[\s\S]*\.kanban-automation-policy[\s\S]*\.kanban-automation-markers[\s\S]*\.kanban-automation-failures[\s\S]*#kanban-automation-status-modal/,
  'Automation status icon, metric grid, controls, marker/failure rows, contract/policy strips, and modal styles must be present.',
);

const stableAutomationBlock = activeBrowserObserverJs.match(/function _stableAutomationKey\(automation\)[\s\S]*?function _stableLayoutKey/)?.[0] || '';
assert.match(
  stableAutomationBlock,
  /automation_proposal_surface_schema:[\s\S]*automation_proposal_inbox_entry_count:[\s\S]*automation_proposal_outbox_processed_count:[\s\S]*automation_proposal_response_busy:[\s\S]*automation_proposal_response_error_count:/,
  'Active Browser stable automation state must expose bounded proposal lifecycle proof.',
);
assert.doesNotMatch(
  stableAutomationBlock,
  /response_text|responseDrafts|proposal_response_text/,
  'Active Browser automation state must not expose operator response text or drafts.',
);

assert.match(
  kanbanCss,
  /@media\s*\(max-width:\s*760px\)[\s\S]*\.kanban-automation-grid[\s\S]*grid-template-columns:\s*1fr/,
  'Automation status panel must collapse to one column on narrow viewports.',
);

assert.match(
  kanbanJs,
  /data-kanban-proposal-surfaces/,
  'Automation status must expose stable proposal surface and item selectors.',
);
assert.match(kanbanJs, /data-kanban-proposal-surface="\$\{escHtml\(kind\)\}"/);
assert.match(kanbanJs, /data-kanban-proposal-item-id="\$\{escHtml\(itemId\)\}"/);

assert.match(
  kanbanJs,
  /response_endpoint_template[\s\S]*response_text:\s*cleanResponse[\s\S]*actor:\s*'operator'[\s\S]*source_surface:\s*'kanban-automation-status'/,
  'Open INBOX entries must submit an explicit operator response through the advertised endpoint.',
);

assert.match(
  kanbanCss,
  /\.kanban-proposal-surfaces__grid[\s\S]*\.kanban-proposal-response[\s\S]*\.kanban-proposal-response__error/,
  'Proposal surfaces, response forms, and failures must have maintained layout styles.',
);

function storageStub() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function proposalStatusFixture() {
  return {
    proposal_surfaces: {
      schema: 'xarta.kanban.proposal_surfaces.contract.v1',
      version: '2026-07-15',
      response_endpoint_template: '/api/v1/personal/kanban/automation/proposal-surfaces/inbox/{item_id}/responses',
      inbox: {
        item_id: 'kanban-inbox-surface',
        total_count: 2,
        open_count: 1,
        processed_count: 1,
        entries: [
          {
            item_id: 'kanban-choice-a',
            title: 'Choose the amber transit window',
            state_id: 'todo',
            status: 'active',
            entry_type: 'question',
            proposal_status: 'awaiting_operator',
            requested_operator_action: 'Select one safe operating window.',
            exact_decision_needed: 'Should this run before dawn or after lunch <local>?',
            source_item_refs: [{ item_id: 'kanban-source-a', title: 'Origin packet' }],
            implementation_refs: ['xarta-kanban:item:kanban-work-a'],
            updated_at: '2026-07-15T10:00:00Z',
          },
          {
            item_id: 'kanban-choice-b',
            title: 'Retired violet path',
            state_id: 'done',
            status: 'closed',
            entry_type: 'proposal',
            proposal_status: 'processed',
            requested_operator_action: 'No action remains.',
            exact_decision_needed: 'This lifecycle is complete.',
          },
        ],
      },
      outbox: {
        item_id: 'kanban-outbox-surface',
        total_count: 1,
        open_count: 0,
        processed_count: 1,
        retry_count: 1,
        entries: [{
          item_id: 'kanban-outcome-a',
          title: 'Recorded outcome 47',
          state_id: 'doing',
          status: 'active',
          entry_type: 'processed_outcome',
          proposal_status: 'accepted',
          retry_state: 'retry_waiting',
          source_refs: ['xarta-kanban:item:kanban-choice-a'],
          outcome_refs: [{ item_id: 'kanban-proof-a', role: 'proof' }],
        }],
      },
    },
  };
}

function createProposalHarness() {
  const document = {
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const window = {
    document,
    location: new URL('https://blueprints.example.test/ui/?group=kanban&tab=kanban'),
    history: { replaceState() {} },
    addEventListener() {},
    requestAnimationFrame(callback) { callback(); },
    CSS: { escape(value) { return String(value); } },
  };
  window.window = window;
  const requests = [];
  let latestStatus = proposalStatusFixture();
  const context = {
    console,
    document,
    window,
    localStorage: storageStub(),
    URL,
    URLSearchParams,
    setTimeout() { return 0; },
    clearTimeout() {},
    fetch: async () => { throw new Error('unexpected native fetch'); },
    apiFetch: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (options.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ status: 'accepted' }) };
      }
      return { ok: true, status: 200, json: async () => latestStatus };
    },
  };
  const marker = '\n  bind();\n\n  return {';
  assert.ok(kanbanJs.includes(marker), 'Kanban behavior harness export marker must stay available.');
  const source = kanbanJs.replace(marker, `
  window.__proposalSurfaceTest = {
    state,
    setData(value) { state.automationStatus.data = value; },
    render: automationProposalSurfacesHtml,
    submit: submitProposalResponse,
    snapshot,
  };

  bind();

  return {`);
  vm.runInNewContext(source, context, { filename: 'kanban-board.js' });
  return {
    api: window.__proposalSurfaceTest,
    requests,
    context,
    setLatestStatus(value) { latestStatus = value; },
  };
}

{
  const harness = createProposalHarness();
  const fixture = proposalStatusFixture();
  harness.api.setData(fixture);
  const html = harness.api.render();
  assert.match(html, /data-kanban-proposal-surfaces/);
  assert.match(html, /data-kanban-proposal-surface="inbox"/);
  assert.match(html, /data-kanban-proposal-surface="outbox"/);
  assert.match(html, /data-kanban-proposal-item-id="kanban-choice-a"/);
  assert.match(html, /Decision needed[\s\S]*after lunch &lt;local&gt;/);
  assert.match(html, /data-kanban-proposal-open-item-id="kanban-work-a"/);
  assert.equal((html.match(/data-kanban-proposal-response-for=/g) || []).length, 1, 'Only the lifecycle-open INBOX entry may accept a response.');
  assert.match(html, /retry: retry_waiting/);

  const responseText = 'Take the amber route; use your judgment for the remaining spacing.';
  const result = await harness.api.submit('kanban-choice-a', responseText);
  assert.equal(result.status, 'accepted');
  const post = harness.requests.find(request => request.options.method === 'POST');
  assert.equal(post.url, '/api/v1/personal/kanban/automation/proposal-surfaces/inbox/kanban-choice-a/responses');
  assert.deepEqual(JSON.parse(post.options.body), {
    response_text: responseText,
    actor: 'operator',
    source_surface: 'kanban-automation-status',
  });
  const snapshot = harness.api.snapshot();
  assert.equal(snapshot.automation_proposal_inbox_entry_count, 2);
  assert.equal(snapshot.automation_proposal_inbox_open_count, 1);
  assert.equal(snapshot.automation_proposal_response_busy, false);
  assert.doesNotMatch(JSON.stringify(snapshot), /amber route|remaining spacing/, 'Observable snapshots must never expose operator response text.');
}

{
  const harness = createProposalHarness();
  const fixture = proposalStatusFixture();
  fixture.proposal_surfaces.inbox.entries = [];
  fixture.proposal_surfaces.inbox.total_count = 0;
  fixture.proposal_surfaces.inbox.open_count = 0;
  fixture.proposal_surfaces.inbox.processed_count = 0;
  harness.api.setData(fixture);
  assert.match(harness.api.render(), /No INBOX entries\./, 'An empty surface must render a truthful zero state.');
  harness.api.setData(proposalStatusFixture());

  harness.context.apiFetch = async (url, options = {}) => {
    harness.requests.push({ url: String(url), options });
    return { ok: false, status: 503, statusText: 'Unavailable', json: async () => ({ detail: 'Classifier is warming; retry is available.' }) };
  };
  const failedText = 'Wait for the blue window and revisit the bounded choice.';
  const result = await harness.api.submit('kanban-choice-a', failedText);
  assert.equal(result, null);
  const failedHtml = harness.api.render();
  assert.match(failedHtml, /Classifier is warming; retry is available\./);
  assert.match(failedHtml, /Wait for the blue window/);
  assert.equal(harness.api.snapshot().automation_proposal_response_error_count, 1);
  assert.doesNotMatch(JSON.stringify(harness.api.snapshot()), /blue window|bounded choice/, 'Failure snapshots must keep response drafts private.');
}
