import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const daveCalendarJs = fs.readFileSync(path.resolve(here, '../js/dave/calendar-page.js'), 'utf8');
const personalFiltersJs = fs.readFileSync(path.resolve(here, '../js/dave/personal-filters.js'), 'utf8');
const daveMenuJs = fs.readFileSync(path.resolve(here, '../js/dave/dave-menu.js'), 'utf8');

assert.match(
  personalFiltersJs,
  /github:\s*\{\s*label:\s*'GitHub activity'/,
  'Shared Personal filters must keep a single built-in GitHub activity tag/filter.',
);
assert.match(
  personalFiltersJs,
  /sourceType\(record\)\s*===\s*'git'[\s\S]*tokens\.add\('github'\)/,
  'Shared Personal filters must tokenize source_type=git records as GitHub activity.',
);
assert.match(
  daveCalendarJs,
  /\['all',\s*'calendar',\s*'tasks',\s*'kanban',\s*'imports',\s*'sources',\s*'git'\]/,
  'Calendar source filter allowlist must include Git.',
);
assert.match(
  daveCalendarJs,
  /filterGit:\s*\(\)\s*=>\s*setSourceFilter\('git'\)/,
  'Calendar must expose a GitHub activity filter action through the legacy command id.',
);
assert.match(
  daveCalendarJs,
  /'calendar\.filterGit':\s*\(\)\s*=>\s*CalendarPage\.filterGit\(\)/,
  'Calendar must register the Git filter action.',
);
assert.match(
  daveMenuJs,
  /calendar-filter-git[\s\S]*label:\s*'Filter GitHub'[\s\S]*fn:\s*'calendar\.filterGit'/,
  'Dave calendar menu must label the dedicated GitHub activity filter clearly.',
);
assert.doesNotMatch(
  personalFiltersJs,
  /isImportRecord[\s\S]*\['interests-ingestion',\s*'git'\]/,
  'Shared Personal filters must not classify GitHub activity as generic Imports.',
);
