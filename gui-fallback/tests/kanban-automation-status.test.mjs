import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = '/workspace/gui-fallback';
const indexHtml = readFileSync(`${root}/index.html`, 'utf8');
const kanbanJs = readFileSync(`${root}/js/kanban/kanban-board.js`, 'utf8');
const kanbanMenuJs = readFileSync(`${root}/js/kanban/kanban-menu.js`, 'utf8');
const kanbanCss = readFileSync(`${root}/css/kanban-board.css`, 'utf8');

assert.match(
  indexHtml,
  /data-kanban-action="automation-status"/,
  'Kanban toolbar must expose the Automation status action.',
);

assert.match(
  indexHtml,
  /data-personal-filter-extra-tabs="[^"]*postgres,automation,prompts,provenance/,
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

assert.match(
  kanbanCss,
  /@media\s*\(max-width:\s*760px\)[\s\S]*\.kanban-automation-grid[\s\S]*grid-template-columns:\s*1fr/,
  'Automation status panel must collapse to one column on narrow viewports.',
);
