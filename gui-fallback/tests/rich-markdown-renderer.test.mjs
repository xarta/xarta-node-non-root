import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const RICH_MARKDOWN_JS = new URL('../js/rich-markdown-editor.js', import.meta.url);

async function createHarness() {
  const source = await readFile(RICH_MARKDOWN_JS, 'utf8');
  const documentStub = {
    readyState: 'complete',
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const context = {
    console,
    document: documentStub,
    setTimeout,
    clearTimeout,
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: RICH_MARKDOWN_JS.pathname });
  return context.window.BlueprintsMarkdown;
}

test('rich Markdown renderer preserves linked social image anchors', async () => {
  const renderer = await createHarness();
  const html = renderer.render(
    '| [![LinkedIn](/api/v1/personal/email/local/images/linkedin?email_uid=uid)](https://linkedin.example/in/dave) | [My Profile](https://linkedin.example/in/dave) |\n'
    + '| --- | --- |\n',
  );

  assert.match(html, /<table class="rich-md-table">/);
  assert.match(html, /<a href="https:\/\/linkedin\.example\/in\/dave" target="_blank" rel="noopener noreferrer">/);
  assert.match(html, /<img class="rich-md-image" src="\/api\/v1\/personal\/email\/local\/images\/linkedin\?email_uid=uid" alt="LinkedIn"/);
  assert.match(html, />My Profile<\/a>/);
  assert.doesNotMatch(html, /\[!\[LinkedIn\]/);
});
