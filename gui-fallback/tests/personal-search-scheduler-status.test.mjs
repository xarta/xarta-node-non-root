import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('/workspace/gui-fallback/js/dave/personal-search.js', 'utf8');
const css = readFileSync('/workspace/gui-fallback/css/personal-search.css', 'utf8');

assert.match(
  source,
  /schedulerStatusSchema = 'xarta\.personal\.search\.scheduler-status\.v1'/,
  'Personal Search scheduler status must bind to the explicit v1 schema.',
);
assert.match(
  source,
  /schedulerStatusUrl = '\/api\/v1\/personal\/search\/scheduler\/status'/,
  'Personal Search must read scheduler status through the Blueprints API.',
);
assert.match(
  source,
  /schedulerRunNowUrl = '\/api\/v1\/personal\/search\/scheduler\/run-now'/,
  'Personal Search must queue manual sync through the Blueprints API.',
);
assert.match(
  source,
  /scheduler:\s*\{[\s\S]*inFlight: null,[\s\S]*timer: null,[\s\S]*function schedulerHosts\(\)/,
  'All mounted Search surfaces must draw from one module-level scheduler state.',
);
assert.match(
  source,
  /function clearSchedulerTimer\(\)[\s\S]*state\.scheduler\.timer[\s\S]*function scheduleSchedulerPoll\(\)/,
  'All mounted Search surfaces must share one polling timer.',
);
assert.match(
  source,
  /if \(state\.scheduler\.inFlight\) return state\.scheduler\.inFlight/,
  'Concurrent surfaces must reuse one in-flight status request.',
);
assert.match(
  source,
  /document\.visibilityState === 'hidden'[\s\S]*visibilitychange[\s\S]*clearSchedulerTimer\(\)[\s\S]*refreshSchedulerStatus\(\{ force: true \}\)/,
  'Polling must pause while hidden and refresh immediately when visible.',
);
assert.match(
  source,
  /timestampAgeSeconds\(provider\?\.last_seen_at\)[\s\S]*heartbeatAge > heartbeatThreshold/,
  'Worker staleness must be computed in the browser from last_seen_at and the raw threshold.',
);
assert.match(
  source,
  /function latestIndexTimestamp\(provider\)[\s\S]*hasOwnProperty\.call\(success\.result \|\| \{\}, 'index_updated_at'\)[\s\S]*success\.result\.index_updated_at[\s\S]*success\.finished_at[\s\S]*successAge = timestampAgeSeconds\(provider\?\.latest_success\?\.finished_at\)[\s\S]*indexAge = timestampAgeSeconds\(latestIndexTimestamp\(provider\)\)[\s\S]*successAge > successThreshold/,
  'Freshness must use the last successful verification while retaining the genuine physical index-update timestamp separately.',
);
assert.match(
  source,
  /Verified \$\{formatAge\(model\.successAge\)\} · updated \$\{formatAge\(model\.indexAge\)\}[\s\S]*Index last verified current[\s\S]*Index physically updated/,
  'An unchanged-source skip must show verification and physical-update ages without inventing an index write.',
);
assert.doesNotMatch(
  source,
  /(?:payload|provider|scheduler)\??\.fault(?:ed)?\b/,
  'The browser must not trust a backend-computed fault boolean.',
);
assert.match(
  source,
  /function newerFailure\(provider\)[\s\S]*failureAt > successAt/,
  'A failure must dominate only when newer than the latest successful sync.',
);
assert.match(
  source,
  /schedule\.target_key !== 'blueprints_personal_search_sync_v1'[\s\S]*provider\.provider_id !== 'blueprints-personal-search'[\s\S]*provider\.source_of_truth !== 'xarta-scheduler-postgresql'/,
  'The surface must reject unrelated schedules, providers, and copied status state.',
);
assert.match(
  source,
  /First search sync running[\s\S]*First search sync queued/,
  'A first run must honestly distinguish scheduler running and queued state.',
);
assert.match(
  source,
  /fetcher\(schedulerRunNowUrl, \{[\s\S]*method: 'POST'[\s\S]*body: '\{\}'/,
  'Run now must send the exact empty JSON object contract.',
);
assert.match(
  source,
  /runNowInFlight \? 'Queueing…' : 'Run now'[\s\S]*data-personal-search-sync-run\$\{state\.scheduler\.runNowInFlight \? ' disabled' : ''\}/,
  'Every Run now control must disable while the one shared request is in flight.',
);
assert.match(
  source,
  /state\.scheduler\.liveMessage = status === 'running'[\s\S]*Personal Search sync queued\.[\s\S]*Could not queue the Personal Search sync/,
  'Run now must announce genuine queue/running acknowledgement and a bounded error.',
);
assert.match(
  source,
  /await refreshSchedulerStatus\(\{ force: true \}\)/,
  'Run now must finish by reading direct scheduler status instead of inventing success.',
);
assert.match(
  source,
  /function ensureSchedulerHelpDialog\(\)[\s\S]*document\.body\.appendChild\(dialog\)[\s\S]*HubModal\.init\(document\.body\)[\s\S]*function openSchedulerHelp\(\)[\s\S]*HubModal\.open\(dialog\)/,
  'The question-mark help must dynamically create and open a house-style HubModal.',
);
assert.match(
  source,
  /Source records[\s\S]*Occurrence[\s\S]*Typed provider[\s\S]*Search index[\s\S]*source signature[\s\S]*does not claim success/,
  'Help must explain the complete scheduler-owned indexing pipeline and Run now semantics.',
);
assert.match(
  source,
  /schedulerStatusSurfaceHtml\(\)[\s\S]*role="status" aria-live="off"[\s\S]*calendarRangeFormHtml[\s\S]*schedulerStatusSurfaceHtml\(\)[\s\S]*function renderSurface[\s\S]*schedulerStatusSurfaceHtml\(\)/,
  'Both range and standard Search forms must mount a quiet status surface.',
);
assert.match(
  source,
  /role="status" aria-live="polite" aria-atomic="true"/,
  'State changes and Run now outcomes must have a focused polite live region.',
);
assert.match(
  css,
  /\.personal-search-sync\[data-tone="ok"\][\s\S]*\.personal-search-sync\[data-tone="busy"\][\s\S]*\.personal-search-sync\[data-tone="fault"\]/,
  'The infographic must visibly distinguish current, working, and fault states.',
);
assert.match(
  css,
  /\.personal-search-sync__flow[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/,
  'The desktop infographic must expose the four-stage status flow compactly.',
);
assert.match(
  css,
  /@media \(max-width: 760px\)[\s\S]*\.personal-search-sync__flow[\s\S]*repeat\(2, minmax\(0, 1fr\)\)[\s\S]*@media \(max-width: 430px\)[\s\S]*\.personal-search-sync__flow/,
  'The status flow must remain legible on narrow Search surfaces.',
);
assert.match(
  css,
  /dialog\.hub-modal\.personal-search-sync-help-modal\[open\][\s\S]*opacity:\s*1[\s\S]*transform:\s*translateY\(0\) scale\(1\)/,
  'The dynamically-created help dialog must have a visible nested-dialog destination state.',
);
