import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../js/dave/imports-dashboard.js', import.meta.url),
  'utf8',
);
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../css/dave-imports.css', import.meta.url), 'utf8');

assert.match(html, /id="imports-wiki-category"/);
assert.match(html, /id="imports-wiki-catalog"/);
assert.match(html, /id="imports-wiki-question"/);
assert.match(html, /id="imports-wiki-answer"/);
assert.match(html, /Ask local LLM/);

assert.match(source, /\/api\/v1\/personal\/interests-wiki\/catalog/);
assert.match(source, /\/api\/v1\/personal\/interests-wiki\/page/);
assert.match(source, /\/api\/v1\/personal\/interests-wiki\/ask/);
assert.match(source, /method:\s*'POST'/);
assert.match(source, /file_answer:\s*true/);
assert.match(source, /BlueprintsMarkdown\?\.render/);
assert.match(source, /window\.BlueprintsImportsWiki\s*=\s*\{/);
assert.doesNotMatch(source, /--model|base_url|api_key/i);
assert.match(css, /\.imports-wiki-answer__meta code\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.imports-wiki-answer__meta\s*\{[\s\S]*flex-direction:\s*column/);

console.log('imports wiki workspace guard: ok');
