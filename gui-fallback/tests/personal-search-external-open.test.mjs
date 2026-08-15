import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../js/dave/personal-search.js', import.meta.url),
  'utf8',
);

assert.match(
  source,
  /function\s+safeExternalResultUrl\(result\)[\s\S]*page_ref\?\.external_url[\s\S]*url\.protocol !== 'http:'[\s\S]*url\.protocol !== 'https:'/,
  'Personal Search must accept only HTTP(S) external result targets.',
);
assert.match(
  source,
  /function\s+resultOpenControl\(result, identity\)[\s\S]*interests-ingestion'[\s\S]*'Source'[\s\S]*href="\$\{escHtml\(externalUrl\)\}"[\s\S]*target="_blank"[\s\S]*rel="noopener noreferrer"/,
  'External Personal Search results must render a safe new-tab link.',
);
assert.match(
  source,
  /function\s+resultWikiControls\(result, identity\)[\s\S]*page_ref\?\.wiki_path[\s\S]*data-personal-wiki-open[\s\S]*data-personal-wiki-ask/,
  'Interests results must expose separate Wiki and Ask controls when their contracts are available.',
);
assert.match(
  source,
  /function\s+resultHtml\(result, index\)[\s\S]*\$\{resultWikiControls\(result, identity\)\}[\s\S]*\$\{resultOpenControl\(result, identity\)\}/,
  'Personal Search rows must use the result-aware Open control.',
);

console.log('personal-search external Open guard: ok');
