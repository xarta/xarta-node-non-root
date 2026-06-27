import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = '/workspace/gui-fallback';
const kanbanJs = readFileSync(`${root}/js/kanban/kanban-board.js`, 'utf8');
const kanbanCss = readFileSync(`${root}/css/kanban-board.css`, 'utf8');

assert.match(
  kanbanJs,
  /function\s+loadItemDecisionLedger\(itemId\)[\s\S]*\/api\/v1\/personal\/kanban\/items\/\$\{encodeURIComponent\(cleanItemId\)\}\/decisions\?limit=50/,
  'Kanban item detail must hydrate card-scoped AI Decisions from the existing item decisions endpoint.',
);

assert.match(
  kanbanJs,
  /Object\.assign\(detail,\s*await\s+loadItemDecisionLedger\(item\.item_id\s*\|\|\s*itemId\)\)/,
  'Kanban detail loading must attach the AI Decisions ledger before rendering panel/modal detail.',
);

assert.match(
  kanbanJs,
  /id:\s*'ai-decisions'[\s\S]*label:\s*'AI Decisions'[\s\S]*html:\s*aiDecisionsSectionHtml\(detail\)/,
  'Item detail sections must expose an AI Decisions tab/accordion section distinct from Review.',
);

assert.match(
  kanbanJs,
  /function\s+aiDecisionsSectionHtml\(detail\)[\s\S]*AI Decisions[\s\S]*Commit Link Health[\s\S]*Link Gaps/,
  'AI Decisions UI must summarize count, commit-link health, and link gaps.',
);

assert.match(
  kanbanJs,
  /function\s+aiDecisionCardHtml\(decision\)[\s\S]*Summary[\s\S]*Rationale[\s\S]*Uncertainty[\s\S]*Affected Refs[\s\S]*Proof Refs[\s\S]*aiDecisionCommitsHtml/,
  'AI Decisions cards must render summary, rationale, uncertainty, affected refs, proof refs, and commits.',
);

assert.match(
  kanbanJs,
  /ai_decision_count:[\s\S]*ai_decision_commit_link_health_ok:[\s\S]*ai_decision_error:/,
  'Kanban browser snapshots must expose AI Decisions proof fields.',
);

assert.match(
  kanbanCss,
  /\.kanban-ai-decisions[\s\S]*\.kanban-ai-decision-summary[\s\S]*\.kanban-ai-decision-card[\s\S]*\.kanban-ai-decision-refs[\s\S]*\.kanban-ai-decision-commits/,
  'Kanban CSS must style the AI Decisions section, cards, refs, and commits.',
);

assert.match(
  kanbanCss,
  /@media\s*\(max-width:\s*760px\)[\s\S]*\.kanban-ai-decision-summary[\s\S]*grid-template-columns:\s*1fr[\s\S]*\.kanban-ai-decision-card__head/,
  'AI Decisions UI must collapse cleanly in mobile accordion layouts.',
);

assert.match(
  kanbanCss,
  /\.kanban-detail-accordion:not\(\[open\]\)\s*>\s*\.kanban-detail-accordion__body[\s\S]*display:\s*none[\s\S]*\.kanban-detail-accordion\[open\]\s*>\s*\.kanban-detail-accordion__body[\s\S]*display:\s*block/,
  'Mobile accordion rows must hide closed bodies and let the active AI Decisions body expand in normal flow.',
);
