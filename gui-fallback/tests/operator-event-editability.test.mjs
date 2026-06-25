import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const diaryPageJs = fs.readFileSync(path.resolve(here, '../js/dave/diary-page.js'), 'utf8');
const calendarPageJs = fs.readFileSync(path.resolve(here, '../js/dave/calendar-page.js'), 'utf8');

assert.match(
  diaryPageJs,
  /return \{ editable: true, route: 'diary', reason: '' \};/,
  'Diary editability must allow operator edits for non-calendar event rows.',
);
assert.doesNotMatch(
  diaryPageJs,
  /Source-owned entry[\s\S]*cannot be edited|open the source detail to edit upstream/,
  'Diary must not block source-owned rows before the operator edit API can handle them.',
);
assert.match(
  calendarPageJs,
  /return \{ editable: true, reason: '' \};/,
  'Calendar editability must allow operator edits for source-owned event rows.',
);
assert.doesNotMatch(
  calendarPageJs,
  /sourceType\(event\) !== 'manual-calendar'|Source-owned event[\s\S]*cannot be edited/,
  'Calendar must not restrict Edit Event to manual-calendar rows only.',
);
