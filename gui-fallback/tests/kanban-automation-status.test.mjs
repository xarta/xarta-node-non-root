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
  /data-personal-filter-extra-tabs="[^"]*backups,automation,provenance/,
  'Kanban adaptive panel must register the Automation tab beside Backups and Provenance.',
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
  /function\s+embeddedAutomationStatusHtml\(\)[\s\S]*output_contract[\s\S]*Output Contract/,
  'Automation panel must render the Review Processor output contract.',
);

assert.match(
  kanbanJs,
  /function\s+automationOutputContractHtml\(\)[\s\S]*output_types[\s\S]*kanban-automation-contract-type/,
  'Automation panel must expose output contract types.',
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
  /automation_status_loaded:[\s\S]*automation_review_processor_status:[\s\S]*automation_commit_link_health_ok:[\s\S]*automation_output_contract_schema:[\s\S]*automation_output_contract_types:/,
  'Kanban snapshots must expose automation status proof fields.',
);

assert.match(
  kanbanMenuJs,
  /automation:[\s\S]*kanban-automation-status[\s\S]*fn:\s*'kanban\.automationStatus'/,
  'Kanban menu must expose the Automation Status command.',
);

assert.match(
  kanbanCss,
  /\.kanban-icon-btn--automation::before[\s\S]*\.kanban-automation-grid[\s\S]*\.kanban-automation-contract[\s\S]*#kanban-automation-status-modal/,
  'Automation status icon, metric grid, contract strip, and modal styles must be present.',
);

assert.match(
  kanbanCss,
  /@media\s*\(max-width:\s*760px\)[\s\S]*\.kanban-automation-grid[\s\S]*grid-template-columns:\s*1fr/,
  'Automation status panel must collapse to one column on narrow viewports.',
);
