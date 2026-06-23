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
  /git:\s*\{\s*label:\s*'Git'/,
  'Shared Personal filters must keep a built-in Git tag/filter.',
);
assert.match(
  personalFiltersJs,
  /sourceType\(record\)\s*===\s*'git'[\s\S]*tokens\.add\('git'\)/,
  'Shared Personal filters must tokenize source_type=git records.',
);
assert.match(
  daveCalendarJs,
  /\['all',\s*'calendar',\s*'tasks',\s*'work',\s*'imports',\s*'sources',\s*'git'\]/,
  'Calendar source filter allowlist must include Git.',
);
assert.match(
  daveCalendarJs,
  /filterGit:\s*\(\)\s*=>\s*setSourceFilter\('git'\)/,
  'Calendar must expose a Git filter action.',
);
assert.match(
  daveCalendarJs,
  /'calendar\.filterGit':\s*\(\)\s*=>\s*CalendarPage\.filterGit\(\)/,
  'Calendar must register the Git filter action.',
);
assert.match(
  daveMenuJs,
  /calendar-filter-git[\s\S]*fn:\s*'calendar\.filterGit'/,
  'Dave calendar menu must include the Git filter action.',
);
