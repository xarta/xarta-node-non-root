import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const index = readFileSync(resolve(root, 'index.html'), 'utf8');
const js = readFileSync(resolve(root, 'js/settings/matrix-chat.js'), 'utf8');
const css = readFileSync(resolve(root, 'css/matrix-chat.css'), 'utf8');

assert.match(index, /id="matrix-chat-attachment-modal"/);
assert.match(index, /id="matrix-chat-attachment-download"/);
assert.match(index, /id="matrix-chat-attachment-preview"/);

assert.match(js, /function openAttachmentModal/);
assert.match(js, /function attachmentBlobEntry/);
assert.match(js, /apiFetch\(attachmentDownloadPath/);
assert.match(js, /apiJson\(attachmentPreviewPath/);
assert.match(js, /URL\.createObjectURL\(blob\)/);
assert.match(js, /URL\.revokeObjectURL/);
assert.doesNotMatch(js, /onclick=/);

assert.match(css, /\.matrix-chat-inline-image-button/);
assert.match(css, /\.matrix-chat-attachment-preview-image/);
assert.match(css, /\.matrix-chat-attachment-audio-icon/);
assert.match(css, /speaker-blue\.svg/);
