(function () {
  'use strict';

  const API_BASE = '/api/v1/personal/rich-doc';
  const IMAGE_URI_PREFIX = 'blueprints://rich-doc-image/';
  const state = {
    activeField: null,
    activeInsertion: null,
    contextMenu: null,
    pickerImages: [],
    fullscreenTarget: null,
    filterTimer: null,
    listenersInstalled: false,
    inFlightUploads: new Set(),
    recentUploads: new Map(),
    recentInsertions: new Map(),
  };
  const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

  function escHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escAttr(value) {
    return escHtml(value).replace(/`/g, '&#96;');
  }

  function stripFrontmatter(markdown) {
    return String(markdown || '').replace(/^---\s*\n[\s\S]*?\n---\s*(\n|$)/, '');
  }

  function encodePath(path) {
    return String(path || '')
      .split('/')
      .map(part => encodeURIComponent(part))
      .join('/');
  }

  function imageUrl(src) {
    const raw = String(src || '').trim();
    if (!raw) return '';
    if (raw.startsWith(IMAGE_URI_PREFIX)) {
      const rest = raw.slice(IMAGE_URI_PREFIX.length);
      const slash = rest.indexOf('/');
      if (slash <= 0) return '';
      const domain = rest.slice(0, slash).replace(/[^a-zA-Z0-9_-]/g, '');
      const path = rest.slice(slash + 1).replace(/^\/+/, '');
      return `${API_BASE}/images/file/${domain}/${encodePath(path)}`;
    }
    if (/^https?:\/\//i.test(raw) || raw.startsWith('/api/') || raw.startsWith('/fallback-ui/')) {
      return raw;
    }
    if (/^[./]?[a-zA-Z0-9_.:/%-]+\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(raw)) {
      return raw;
    }
    return '';
  }

  function richDocImageRecordFromUri(uri) {
    const raw = String(uri || '').trim();
    if (!raw.startsWith(IMAGE_URI_PREFIX)) return null;
    const rest = raw.slice(IMAGE_URI_PREFIX.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) return null;
    const domain = rest.slice(0, slash).replace(/[^a-zA-Z0-9_-]/g, '');
    const path = rest.slice(slash + 1).replace(/^\/+/, '');
    if (!domain || !path) return null;
    const filename = path.split('/').filter(Boolean).pop() || 'picture';
    const url = imageUrl(raw);
    if (!url) return null;
    return {
      image_id: `referenced:${domain}:${path}`,
      domain,
      path,
      filename,
      url,
      uri: raw,
      markdown: `![${PathName(filename)}](${raw})`,
      referenced: true,
    };
  }

  function imageRefsFromMarkdown(markdown) {
    const refs = [];
    const seen = new Set();
    const pattern = /blueprints:\/\/rich-doc-image\/[a-zA-Z0-9_-]+\/[^\s)]+/g;
    let match;
    while ((match = pattern.exec(String(markdown || '')))) {
      const record = richDocImageRecordFromUri(match[0]);
      if (!record) continue;
      const key = `${record.domain}:${record.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(record);
    }
    return refs;
  }

  function imageKey(image) {
    return `${image?.domain || ''}:${image?.path || image?.uri || ''}`;
  }

  function imageMatchesFilter(image, filter) {
    const query = String(filter || '').trim().toLowerCase();
    if (!query) return true;
    return [image?.filename, image?.path, image?.uri]
      .some(value => String(value || '').toLowerCase().includes(query));
  }

  function mergePickerImages(serverImages, filter = '') {
    const merged = [];
    const seen = new Set();
    (Array.isArray(serverImages) ? serverImages : []).forEach(image => {
      const key = imageKey(image);
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(image);
    });
    imageRefsFromMarkdown(state.activeField?.value || '').forEach(image => {
      const key = imageKey(image);
      if (!key || seen.has(key) || !imageMatchesFilter(image, filter)) return;
      seen.add(key);
      merged.push(image);
    });
    return merged;
  }

  function linkUrl(src) {
    const raw = String(src || '').trim();
    if (!raw) return '';
    if (raw.startsWith('blueprints://')) return raw;
    if (/^(https?:|mailto:)/i.test(raw)) return raw;
    if (raw.startsWith('/') || raw.startsWith('#')) return raw;
    return '';
  }

  function splitMarkdownTarget(rawTarget) {
    const text = String(rawTarget || '').trim();
    const quoted = text.match(/^(\S+)(?:\s+"([^"]*)")?$/);
    return {
      href: quoted ? quoted[1] : text,
      title: quoted && quoted[2] ? quoted[2] : '',
    };
  }

  function renderInline(raw) {
    const source = String(raw || '');
    const pattern = /(!?\[([^\]\n]{0,240})\]\(([^)\n]{1,1000})\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*)/g;
    let html = '';
    let last = 0;
    let match;
    while ((match = pattern.exec(source))) {
      html += escHtml(source.slice(last, match.index));
      last = pattern.lastIndex;
      if (match[1]?.startsWith('!')) {
        const target = splitMarkdownTarget(match[3]);
        const src = imageUrl(target.href);
        if (!src) {
          html += escHtml(match[0]);
          continue;
        }
        const alt = match[2] || PathName(target.href);
        html += `<img class="rich-md-image" src="${escAttr(src)}" alt="${escAttr(alt)}" loading="lazy"${target.title ? ` title="${escAttr(target.title)}"` : ''} data-rich-md-image-uri="${escAttr(target.href)}" />`;
        continue;
      }
      if (match[1]) {
        const target = splitMarkdownTarget(match[3]);
        const href = linkUrl(target.href);
        if (!href) {
          html += escHtml(match[0]);
          continue;
        }
        const attrs = href.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : '';
        html += `<a href="${escAttr(href)}"${attrs}${target.title ? ` title="${escAttr(target.title)}"` : ''}>${renderInline(match[2])}</a>`;
        continue;
      }
      if (match[4]) {
        html += `<code>${escHtml(match[4])}</code>`;
      } else if (match[5]) {
        html += `<strong>${escHtml(match[5])}</strong>`;
      } else if (match[6]) {
        html += `<em>${escHtml(match[6])}</em>`;
      }
    }
    html += escHtml(source.slice(last));
    return html;
  }

  function PathName(value) {
    const clean = String(value || '').split(/[/?#]/).filter(Boolean).pop() || 'image';
    return clean.replace(/\.[a-z0-9]+$/i, '');
  }

  function filenameStem(value, fallback = 'image') {
    const raw = String(value || '').split(/[/?#]/).filter(Boolean).pop() || fallback;
    const stem = raw.replace(/\.[a-z0-9]+$/i, '');
    return stem
      .replace(/[^a-zA-Z0-9_.:-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 88) || fallback;
  }

  function timestampSuffix(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
    ].join('') + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  function stemWithTimestamp(stem) {
    const clean = filenameStem(stem, 'image');
    return /\d{8}-\d{6}$/.test(clean) ? clean : `${clean}-${timestampSuffix()}`;
  }

  function filenameWithExtension(stem, extension) {
    const cleanExt = String(extension || 'png').replace(/[^a-z0-9]+/gi, '').toLowerCase() || 'png';
    return `${stemWithTimestamp(stem)}.${cleanExt}`;
  }

  function uploadDedupeName(file, prepared) {
    const raw = String(prepared?.name || file?.name || 'image.png');
    const suffix = raw.match(/(\.[a-z0-9]+)$/i)?.[1]?.toLowerCase() || '';
    const stem = filenameStem(raw, 'image').replace(/-\d{8}-\d{6}$/i, '');
    return `${stem || 'image'}${suffix}`;
  }

  function imageNameInputValue() {
    return document.getElementById('rich-markdown-picture-name')?.value || '';
  }

  function titleNearActiveField() {
    const field = state.activeField;
    const root = field?.closest?.('.kanban-detail-workspace, [data-kanban-scoped-row], dialog, .calendar-modal-body, .todo-modal-body')
      || field?.closest?.('[data-rme-field-shell]')
      || document;
    const selectors = [
      '[data-kanban-detail-field="title"]',
      '[data-kanban-scoped-field="title"]',
      '[data-todo-field="title"]',
      'input[id$="-title-input"]',
      'input[id$="-title"]',
    ];
    for (const selector of selectors) {
      const input = root.querySelector?.(selector);
      const value = String(input?.value || '').trim();
      if (value) return value;
    }
    const shell = fieldShellFrom(field);
    const label = Array.from(shell?.querySelectorAll?.('.rich-md-label-row span') || [])
      .map(node => String(node.textContent || '').trim())
      .find(Boolean);
    if (label && !/^document$/i.test(label)) return label;
    const context = contextFromElement(field);
    return context.document_id || context.document_type || 'rich-document';
  }

  function suggestedImageStem(file, options = {}) {
    const typed = imageNameInputValue();
    if (typed) return filenameStem(typed, 'image');
    const fileStem = filenameStem(file?.name || '', '');
    if (fileStem && !/^image$|^clipboard|^screenshot$/i.test(fileStem)) return fileStem;
    const title = filenameStem(titleNearActiveField(), 'rich-document');
    const source = options.source === 'clipboard' ? 'screenshot' : 'image';
    return `${title}-${source}`;
  }

  async function promptImageFilename(defaultName) {
    if (typeof HubDialogs === 'undefined' || typeof HubDialogs.prompt !== 'function') return defaultName;
    const value = await HubDialogs.prompt({
      title: 'Image Name',
      message: 'Name this picture before saving.',
      inputLabel: 'Name',
      value: defaultName,
      confirmText: 'Save',
      validate: input => filenameStem(input, '') ? '' : 'Enter a filename.',
    });
    if (value == null) return null;
    return value;
  }

  function imageExtensionForFile(file, options = {}) {
    if (options.forcePng) return 'png';
    const suffix = String(file?.name || '').match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(suffix)) return suffix;
    return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' })[file?.type] || 'png';
  }

  function isSupportedImageFile(file) {
    return Boolean(file && SUPPORTED_IMAGE_TYPES.has(String(file.type || '').toLowerCase()));
  }

  function canvasBlob(canvas, type = 'image/png') {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Image conversion failed'))), type);
    });
  }

  async function imageFileToPng(file, filename) {
    if (!file) return null;
    let bitmap = null;
    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        const blob = await canvasBlob(canvas, 'image/png');
        return new File([blob], filename, { type: 'image/png', lastModified: Date.now() });
      } catch (_) {
        // Fall back to object URL decoding below.
      } finally {
        bitmap?.close?.();
      }
    }
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const node = new Image();
        node.onload = () => resolve(node);
        node.onerror = () => reject(new Error('Image conversion failed'));
        node.src = objectUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const blob = await canvasBlob(canvas, 'image/png');
      return new File([blob], filename, { type: 'image/png', lastModified: Date.now() });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function prepareImageFile(file, options = {}) {
    if (!isSupportedImageFile(file)) {
      throw new Error('Picture type is not supported.');
    }
    const extension = imageExtensionForFile(file, options);
    const defaultStem = suggestedImageStem(file, options);
    const chosen = options.promptName ? await promptImageFilename(defaultStem) : defaultStem;
    if (chosen == null) return null;
    const filename = filenameWithExtension(chosen, extension);
    if (options.forcePng) return imageFileToPng(file, filename);
    return new File([file], filename, {
      type: file.type || `image/${extension === 'jpg' ? 'jpeg' : extension}`,
      lastModified: file.lastModified || Date.now(),
    });
  }

  function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line || '');
  }

  function splitTableRow(line) {
    return String(line || '')
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(cell => cell.trim());
  }

  function render(markdown, options = {}) {
    const emptyText = typeof options === 'string' ? options : (options.emptyText || 'No content.');
    const clean = stripFrontmatter(markdown).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!clean) return `<p class="calendar-markdown-empty">${escHtml(emptyText)}</p>`;
    const lines = clean.split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        out.push('<div class="calendar-markdown-gap"></div>');
        i += 1;
        continue;
      }
      const fence = line.match(/^```([a-zA-Z0-9_-]*)\s*$/);
      if (fence) {
        const lang = fence[1] || '';
        const code = [];
        i += 1;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
          code.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        out.push(`<pre><code${lang ? ` class="language-${escAttr(lang)}"` : ''}>${escHtml(code.join('\n'))}</code></pre>`);
        continue;
      }
      if (i + 1 < lines.length && line.includes('|') && isTableSeparator(lines[i + 1])) {
        const headers = splitTableRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          rows.push(splitTableRow(lines[i]));
          i += 1;
        }
        out.push(`<div class="rich-md-table-wrap"><table class="rich-md-table"><thead><tr>${headers.map(cell => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_, idx) => `<td>${renderInline(row[idx] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = Math.min(6, heading[1].length);
        out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        i += 1;
        continue;
      }
      if (/^\s*([-*+])\s+/.test(line)) {
        const items = [];
        while (i < lines.length) {
          const item = lines[i].match(/^\s*[-*+]\s+(.*)$/);
          if (!item) break;
          items.push(`<li>${renderInline(item[1])}</li>`);
          i += 1;
        }
        out.push(`<ul>${items.join('')}</ul>`);
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length) {
          const item = lines[i].match(/^\s*\d+\.\s+(.*)$/);
          if (!item) break;
          items.push(`<li>${renderInline(item[1])}</li>`);
          i += 1;
        }
        out.push(`<ol>${items.join('')}</ol>`);
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        const quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        out.push(`<blockquote>${render(quote.join('\n'), { emptyText })}</blockquote>`);
        continue;
      }
      if (/^\s*---+\s*$/.test(line)) {
        out.push('<hr />');
        i += 1;
        continue;
      }
      const para = [line.trim()];
      i += 1;
      while (
        i < lines.length
        && lines[i].trim()
        && !/^(#{1,6})\s+/.test(lines[i])
        && !/^```/.test(lines[i])
        && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])
        && !/^\s*>\s?/.test(lines[i])
      ) {
        para.push(lines[i].trim());
        i += 1;
      }
      out.push(`<p>${renderInline(para.join(' '))}</p>`);
    }
    return out.join('');
  }

  function contextAttrs(context = {}) {
    const pairs = {
      domain: context.domain || 'diary',
      documentType: context.documentType || context.document_type || 'document',
      documentId: context.documentId || context.document_id || '',
      localDate: context.localDate || context.local_date || '',
      itemId: context.itemId || context.item_id || '',
      discussionId: context.discussionId || context.discussion_id || '',
    };
    return Object.entries(pairs)
      .map(([key, value]) => ` data-rme-${key.replace(/[A-Z]/g, ch => `-${ch.toLowerCase()}`)}="${escAttr(value)}"`)
      .join('');
  }

  function attrsFromObject(attrs = {}) {
    return Object.entries(attrs)
      .filter(([, value]) => value !== false && value != null)
      .map(([key, value]) => value === true ? ` ${escAttr(key)}` : ` ${escAttr(key)}="${escAttr(value)}"`)
      .join('');
  }

  function fieldHtml(options = {}) {
    const textareaId = String(options.textareaId || options.id || 'rich-md-editor').replace(/[^a-zA-Z0-9_-]/g, '-');
    const previewId = String(options.previewId || `${textareaId}-preview`).replace(/[^a-zA-Z0-9_-]/g, '-');
    const label = options.label || 'Document';
    const value = String(options.value || '');
    const previewDefault = Boolean(options.previewDefault);
    const hideLabel = Boolean(options.hideLabel);
    const emptyText = options.emptyText || `No ${String(label).toLowerCase()}.`;
    const wrapperClasses = ['rich-md-field', options.wrapperClass || 'calendar-markdown-field'].filter(Boolean).join(' ');
    const textareaClasses = ['rich-md-textarea', options.textareaClass || ''].filter(Boolean).join(' ');
    const previewClasses = ['rich-md-preview', 'calendar-markdown-preview', options.previewClass || ''].filter(Boolean).join(' ');
    const dataAttrs = attrsFromObject(options.textareaAttrs || {});
    return `
      <div class="${escAttr(wrapperClasses)}" data-rme-field-shell${contextAttrs(options.context)} data-rme-empty-text="${escAttr(emptyText)}">
        <div class="calendar-field__label-row rich-md-label-row${hideLabel ? ' calendar-field__label-row--actions-only' : ''}">
          <span class="${hideLabel ? 'kanban-visually-hidden' : ''}">${escHtml(label)}</span>
          <div class="rich-md-toolbar" role="group" aria-label="Markdown tools">
            <div class="rich-md-mode-toggle" role="group" aria-label="Markdown mode">
              <button class="rich-md-mode-btn${previewDefault ? '' : ' is-active'}" type="button" data-rme-action="mode" data-rme-mode="edit" aria-pressed="${previewDefault ? 'false' : 'true'}">Edit</button>
              <button class="rich-md-mode-btn${previewDefault ? ' is-active' : ''}" type="button" data-rme-action="mode" data-rme-mode="preview" aria-pressed="${previewDefault ? 'true' : 'false'}">Preview</button>
            </div>
            <button class="rich-md-icon-btn rich-md-icon-btn--picture" type="button" data-rme-action="picture" title="Insert Picture" aria-label="Insert Picture"></button>
            <button class="rich-md-icon-btn rich-md-icon-btn--fullscreen" type="button" data-rme-action="fullscreen" title="Full screen" aria-label="Open document full screen"></button>
          </div>
        </div>
        <textarea id="${escAttr(textareaId)}" class="${escAttr(textareaClasses)}" rows="${escAttr(options.rows || 4)}" maxlength="${escAttr(options.maxlength || 20000)}" data-rme-field data-rme-preview-id="${escAttr(previewId)}"${contextAttrs(options.context)}${dataAttrs}${previewDefault ? ' hidden' : ''}>${escHtml(value)}</textarea>
        <div id="${escAttr(previewId)}" class="${escAttr(previewClasses)}" data-rme-preview data-rme-editor-id="${escAttr(textareaId)}" tabindex="0"${contextAttrs(options.context)}${previewDefault ? '' : ' hidden'}>${previewDefault ? render(value, { emptyText }) : ''}</div>
      </div>`;
  }

  function fieldShellFrom(target) {
    return target?.closest?.('[data-rme-field-shell]');
  }

  function textareaFromShell(shell) {
    if (!shell) return null;
    const direct = shell.querySelector('[data-rme-field]');
    if (direct) return direct;
    const preview = shell.querySelector('[data-rme-preview]');
    return preview?.dataset?.rmeEditorId ? document.getElementById(preview.dataset.rmeEditorId) : null;
  }

  function previewForTextarea(textarea) {
    if (!textarea) return null;
    return textarea.dataset.rmePreviewId ? document.getElementById(textarea.dataset.rmePreviewId) : null;
  }

  function setMode(shell, mode) {
    const textarea = textareaFromShell(shell);
    const preview = previewForTextarea(textarea);
    if (!textarea || !preview) return;
    const showPreview = mode === 'preview';
    if (showPreview) {
      preview.innerHTML = render(textarea.value, { emptyText: shell?.dataset?.rmeEmptyText || 'No content.' });
    }
    textarea.hidden = showPreview;
    preview.hidden = !showPreview;
    shell.querySelectorAll('[data-rme-action="mode"]').forEach(btn => {
      const active = btn.dataset.rmeMode === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function contextFromElement(el) {
    const shell = fieldShellFrom(el);
    const source = el?.dataset?.rmeDomain ? el : shell;
    return {
      domain: source?.dataset?.rmeDomain || shell?.dataset?.rmeDomain || 'diary',
      document_type: source?.dataset?.rmeDocumentType || shell?.dataset?.rmeDocumentType || 'document',
      document_id: source?.dataset?.rmeDocumentId || shell?.dataset?.rmeDocumentId || '',
      local_date: source?.dataset?.rmeLocalDate || shell?.dataset?.rmeLocalDate || '',
      item_id: source?.dataset?.rmeItemId || shell?.dataset?.rmeItemId || '',
      discussion_id: source?.dataset?.rmeDiscussionId || shell?.dataset?.rmeDiscussionId || '',
    };
  }

  function rmeDatasetKey(key) {
    return `rme${String(key || '').replace(/(^|_)([a-z])/g, (_m, _p, ch) => ch.toUpperCase())}`;
  }

  function applyContextDataset(node, context = {}) {
    if (!node?.dataset) return;
    ['domain', 'document_type', 'document_id', 'local_date', 'item_id', 'discussion_id'].forEach(key => {
      node.dataset[rmeDatasetKey(key)] = context[key] || '';
    });
  }

  function emitDraftChange(field, value = field?.value || '') {
    if (typeof CustomEvent !== 'function' || !field?.dataset) return;
    document.dispatchEvent(new CustomEvent('blueprints:rich-markdown-draft', {
      detail: {
        context: contextFromElement(field),
        fieldName: field.dataset.kanbanDetailField || '',
        targetId: field.id || '',
        value: String(value || ''),
      },
    }));
  }

  function insertionForTextarea(textarea) {
    const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length;
    const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : start;
    return { start, end };
  }

  function insertionForPreview(preview, event) {
    const textarea = document.getElementById(preview?.dataset?.rmeEditorId || '');
    if (!textarea) return { start: 0, end: 0 };
    const lines = stripFrontmatter(textarea.value).split('\n');
    const blocks = Array.from(preview.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,pre,blockquote,img,.calendar-markdown-gap'));
    if (!blocks.length) return { start: textarea.value.length, end: textarea.value.length };
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    blocks.forEach((block, index) => {
      const rect = block.getBoundingClientRect();
      const y = rect.top + rect.height / 2;
      const distance = Math.abs(y - event.clientY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    const lineIndex = Math.min(lines.length, bestIndex + (event.clientY > blocks[bestIndex].getBoundingClientRect().top ? 1 : 0));
    const source = textarea.value;
    let offset = 0;
    for (let i = 0; i < lineIndex && i < lines.length; i += 1) offset += lines[i].length + 1;
    offset = Math.min(source.length, offset);
    return { start: offset, end: offset };
  }

  function rememberInsertion(target, event) {
    const shell = fieldShellFrom(target);
    const textarea = textareaFromShell(shell);
    if (!textarea) return null;
    state.activeField = textarea;
    if (target?.matches?.('[data-rme-preview]') || target?.closest?.('[data-rme-preview]')) {
      const preview = target.matches?.('[data-rme-preview]') ? target : target.closest('[data-rme-preview]');
      state.activeInsertion = insertionForPreview(preview, event);
    } else {
      state.activeInsertion = insertionForTextarea(textarea);
    }
    return state.activeInsertion;
  }

  function insertAtActiveField(markdown, options = {}) {
    const textarea = state.activeField;
    if (!textarea) return false;
    const dedupeKey = options.dedupeKey || '';
    if (dedupeKey) {
      const key = `${textarea.id || 'field'}:${dedupeKey}`;
      const now = Date.now();
      const last = state.recentInsertions.get(key) || 0;
      if (now - last < 5000) return false;
      state.recentInsertions.set(key, now);
      for (const [recentKey, timestamp] of state.recentInsertions.entries()) {
        if (now - timestamp > 10000) state.recentInsertions.delete(recentKey);
      }
    }
    const insertion = state.activeInsertion || insertionForTextarea(textarea);
    const before = textarea.value.slice(0, insertion.start);
    const after = textarea.value.slice(insertion.end);
    const needsLead = before && !before.endsWith('\n') ? '\n\n' : '';
    const needsTail = after && !after.startsWith('\n') ? '\n\n' : '';
    textarea.value = `${before}${needsLead}${markdown}${needsTail}${after}`;
    const caret = `${before}${needsLead}${markdown}`.length;
    state.activeInsertion = { start: caret, end: caret };
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    emitDraftChange(textarea, textarea.value);
    const preview = previewForTextarea(textarea);
    if (preview && !preview.hidden) preview.innerHTML = render(textarea.value, { emptyText: fieldShellFrom(textarea)?.dataset?.rmeEmptyText || 'No content.' });
    return true;
  }

  function pruneRecentUploads(now = Date.now()) {
    for (const [recentKey, timestamp] of state.recentUploads.entries()) {
      if (now - timestamp > 10000) state.recentUploads.delete(recentKey);
    }
  }

  function recentlyProcessedUpload(key) {
    if (!key) return false;
    const now = Date.now();
    const last = state.recentUploads.get(key) || 0;
    pruneRecentUploads(now);
    return now - last < 5000;
  }

  function rememberProcessedUpload(key) {
    if (!key) return;
    const now = Date.now();
    state.recentUploads.set(key, now);
    pruneRecentUploads(now);
  }

  function closeContextMenu() {
    state.contextMenu?.remove();
    state.contextMenu = null;
  }

  function showContextMenu(event) {
    const shell = fieldShellFrom(event.target);
    if (!shell) return;
    rememberInsertion(event.target, event);
    event.preventDefault();
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'rich-md-context-menu';
    menu.innerHTML = '<button type="button" data-rme-context-action="picture">Insert Picture</button>';
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 190)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 60)}px`;
    const host = shell.closest('dialog[open]') || document.body;
    host.appendChild(menu);
    state.contextMenu = menu;
  }

  function pickerModal() {
    return document.getElementById('rich-markdown-picture-modal');
  }

  function setPickerStatus(message) {
    const el = document.getElementById('rich-markdown-picture-status');
    if (el) el.textContent = message || '';
  }

  function imageCard(image) {
    const label = image.filename || image.path || 'picture';
    return `
      <button class="rich-md-picture-card" type="button" data-rme-picture-path="${escAttr(image.path)}" data-rme-picture-domain="${escAttr(image.domain)}">
        <img src="${escAttr(image.url)}" alt="${escAttr(label)}" loading="lazy" />
        <span>${escHtml(label)}</span>
      </button>`;
  }

  function renderPickerGrid(images) {
    const grid = document.getElementById('rich-markdown-picture-grid');
    if (!grid) return;
    grid.innerHTML = images.length
      ? images.map(imageCard).join('')
      : '<div class="rich-md-picture-empty">No pictures found.</div>';
  }

  async function loadPictures() {
    const context = contextFromElement(state.activeField);
    const params = new URLSearchParams();
    if (context.domain) params.set('domain', context.domain);
    if (context.domain !== 'kanban') {
      Object.entries(context).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
    }
    const filter = document.getElementById('rich-markdown-picture-filter')?.value || '';
    if (filter) params.set('q', filter);
    setPickerStatus('Loading pictures...');
    const fetcher = typeof window.apiFetch === 'function' ? window.apiFetch : window.fetch.bind(window);
    const resp = await fetcher(`${API_BASE}/images?${params.toString()}`);
    if (!resp.ok) throw new Error(`Picture list failed: HTTP ${resp.status}`);
    const payload = await resp.json();
    state.pickerImages = mergePickerImages(Array.isArray(payload.images) ? payload.images : [], filter);
    renderPickerGrid(state.pickerImages);
    const pool = context.domain === 'kanban' ? ' central Kanban' : '';
    setPickerStatus(`${state.pickerImages.length}${pool} picture${state.pickerImages.length === 1 ? '' : 's'} available.`);
  }

  async function openPicturePicker() {
    const modal = pickerModal();
    if (!modal || !state.activeField) return;
    const filter = document.getElementById('rich-markdown-picture-filter');
    if (filter) filter.value = '';
    const name = document.getElementById('rich-markdown-picture-name');
    if (name && !name.value) name.value = suggestedImageStem(null, { source: 'upload' });
    if (typeof HubModal !== 'undefined') HubModal.open(modal, { onOpen: () => loadPictures().catch(showError) });
    else modal.showModal();
  }

  function markdownForImage(domain, path, alt) {
    const cleanAlt = String(alt || PathName(path)).replace(/[\[\]\n\r]/g, ' ').trim() || 'picture';
    return `![${cleanAlt}](${IMAGE_URI_PREFIX}${domain}/${path})`;
  }

  async function uploadPicture(file) {
    if (!file) return null;
    const context = contextFromElement(state.activeField);
    const form = new FormData();
    form.append('file', file, file.name || 'image.png');
    Object.entries(context).forEach(([key, value]) => form.append(key, value || ''));
    form.append('actor', 'blueprints-ui');
    form.append('source_surface', 'rich-document-editor');
    setPickerStatus('Uploading picture...');
    const fetcher = typeof window.apiFetch === 'function' ? window.apiFetch : window.fetch.bind(window);
    const resp = await fetcher(`${API_BASE}/images/upload`, { method: 'POST', body: form });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || `Picture upload failed: HTTP ${resp.status}`);
    }
    const payload = await resp.json();
    return payload.image || null;
  }

  async function uploadAndInsertPicture(file, options = {}) {
    if (!file) return null;
    const prepared = await prepareImageFile(file, options);
    if (!prepared) return null;
    const context = contextFromElement(state.activeField);
    const uploadKey = [
      context.domain,
      context.document_type,
      context.document_id,
      context.item_id,
      context.discussion_id,
      options.source || 'upload',
      uploadDedupeName(file, prepared),
      prepared.size,
      prepared.type || file.type || '',
    ].join(':');
    if (state.inFlightUploads.has(uploadKey) || recentlyProcessedUpload(uploadKey)) return null;
    state.inFlightUploads.add(uploadKey);
    try {
      const image = await uploadPicture(prepared);
      if (!image) return null;
      const markdown = markdownForImage(image.domain, image.path, PathName(image.filename));
      insertAtActiveField(markdown, { dedupeKey: uploadKey });
      rememberProcessedUpload(uploadKey);
      return image;
    } finally {
      state.inFlightUploads.delete(uploadKey);
    }
  }

  function showError(error) {
    const message = error?.message || String(error || 'Unknown error');
    setPickerStatus(message);
    if (typeof HubDialogs !== 'undefined') HubDialogs.alert({ title: 'Rich Document', message, tone: 'warning' });
  }

  function fullscreenModal() {
    return document.getElementById('rich-markdown-fullscreen-modal');
  }

  function openFullscreen(target) {
    const shell = fieldShellFrom(target);
    const textarea = textareaFromShell(shell);
    const modal = fullscreenModal();
    const editor = document.getElementById('rich-markdown-fullscreen-editor');
    const preview = document.getElementById('rich-markdown-fullscreen-preview');
    const fullscreenShell = document.getElementById('rich-markdown-fullscreen-shell');
    if (!textarea || !modal || !editor || !preview || !fullscreenShell) return;
    state.fullscreenTarget = textarea;
    editor.value = textarea.value;
    state.activeField = editor;
    state.activeInsertion = insertionForTextarea(editor);
    const context = contextFromElement(textarea);
    [fullscreenShell, editor, preview].forEach(node => applyContextDataset(node, context));
    if (textarea.dataset.kanbanDetailField) editor.dataset.kanbanDetailField = textarea.dataset.kanbanDetailField;
    else delete editor.dataset.kanbanDetailField;
    fullscreenShell.dataset.rmeEmptyText = shell?.dataset?.rmeEmptyText || 'No content.';
    preview.innerHTML = render(editor.value, { emptyText: shell?.dataset?.rmeEmptyText || 'No content.' });
    const onOpen = () => {
      if (typeof window.BlueprintsLocalShade?.refresh === 'function') window.BlueprintsLocalShade.refresh();
      editor.focus();
    };
    if (typeof HubModal !== 'undefined') HubModal.open(modal, { onOpen });
    else {
      modal.showModal();
      onOpen();
    }
  }

  function applyFullscreen() {
    const target = state.fullscreenTarget;
    const editor = document.getElementById('rich-markdown-fullscreen-editor');
    if (!target || !editor) return;
    target.value = editor.value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    emitDraftChange(target, target.value);
    const preview = previewForTextarea(target);
    const shell = fieldShellFrom(target);
    if (preview && !preview.hidden) preview.innerHTML = render(target.value, { emptyText: shell?.dataset?.rmeEmptyText || 'No content.' });
    const modal = fullscreenModal();
    if (typeof HubModal !== 'undefined' && modal) HubModal.close(modal);
    else modal?.close();
  }

  function syncFullscreenTarget() {
    const target = state.fullscreenTarget;
    const editor = document.getElementById('rich-markdown-fullscreen-editor');
    if (!target || !editor || target.value === editor.value) return;
    target.value = editor.value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    emitDraftChange(target, target.value);
    const preview = previewForTextarea(target);
    const shell = fieldShellFrom(target);
    if (preview && !preview.hidden) preview.innerHTML = render(target.value, { emptyText: shell?.dataset?.rmeEmptyText || 'No content.' });
  }

  function installListeners() {
    if (state.listenersInstalled) return;
    state.listenersInstalled = true;
    document.addEventListener('click', event => {
      const contextAction = event.target.closest?.('[data-rme-context-action]');
      if (contextAction) {
        closeContextMenu();
        if (contextAction.dataset.rmeContextAction === 'picture') openPicturePicker();
        return;
      }
      if (state.contextMenu && !event.target.closest?.('.rich-md-context-menu')) closeContextMenu();
      const action = event.target.closest?.('[data-rme-action]');
      if (!action) return;
      const shell = fieldShellFrom(action);
      if (action.dataset.rmeAction === 'mode') {
        setMode(shell, action.dataset.rmeMode === 'preview' ? 'preview' : 'edit');
      } else if (action.dataset.rmeAction === 'picture') {
        rememberInsertion(action, event);
        openPicturePicker();
      } else if (action.dataset.rmeAction === 'fullscreen') {
        openFullscreen(action);
      } else if (action.dataset.rmeAction === 'fullscreen-apply') {
        applyFullscreen();
      } else if (action.dataset.rmeAction === 'fullscreen-preview') {
        const editor = document.getElementById('rich-markdown-fullscreen-editor');
        const preview = document.getElementById('rich-markdown-fullscreen-preview');
        if (editor && preview) preview.innerHTML = render(editor.value, { emptyText: 'No content.' });
      }
    });
    document.addEventListener('contextmenu', event => {
      if (fieldShellFrom(event.target)) showContextMenu(event);
    });
    document.addEventListener('input', event => {
      if (!event.target.matches?.('[data-rme-field]')) return;
      const preview = previewForTextarea(event.target);
      if (preview && !preview.hidden) {
        preview.innerHTML = render(event.target.value, { emptyText: fieldShellFrom(event.target)?.dataset?.rmeEmptyText || 'No content.' });
      }
      emitDraftChange(event.target, event.target.value);
      if (event.target.id === 'rich-markdown-fullscreen-editor') syncFullscreenTarget();
    });
    document.addEventListener('dragover', event => {
      if (!fieldShellFrom(event.target)) return;
      event.preventDefault();
    });
    document.addEventListener('drop', event => {
      if (!fieldShellFrom(event.target)) return;
      event.preventDefault();
      rememberInsertion(event.target, event);
      const file = Array.from(event.dataTransfer?.files || []).find(item => /^image\//.test(item.type));
      if (file) {
        uploadAndInsertPicture(file, { source: 'drop', promptName: true })
          .catch(showError);
      }
    });
    document.addEventListener('paste', event => {
      if (!fieldShellFrom(event.target)) return;
      const file = Array.from(event.clipboardData?.items || [])
        .find(item => item.kind === 'file' && /^image\//.test(item.type || ''))
        ?.getAsFile?.();
      if (!file) return;
      event.preventDefault();
      rememberInsertion(event.target, event);
      uploadAndInsertPicture(file, { source: 'clipboard', forcePng: true, promptName: true })
        .catch(showError);
    });
    document.getElementById('rich-markdown-picture-filter')?.addEventListener('input', () => {
      window.clearTimeout(state.filterTimer);
      state.filterTimer = window.setTimeout(() => loadPictures().catch(showError), 180);
    });
    document.getElementById('rich-markdown-picture-upload')?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file) return;
      uploadAndInsertPicture(file, { source: 'upload' })
        .then(image => {
          event.target.value = '';
          if (!image) return;
          return loadPictures();
        })
        .catch(showError);
    });
    document.getElementById('rich-markdown-picture-grid')?.addEventListener('click', event => {
      const card = event.target.closest?.('[data-rme-picture-path]');
      if (!card) return;
      insertAtActiveField(markdownForImage(card.dataset.rmePictureDomain, card.dataset.rmePicturePath, PathName(card.dataset.rmePicturePath)));
      const modal = pickerModal();
      if (typeof HubModal !== 'undefined' && modal) HubModal.close(modal);
      else modal?.close();
    });
    document.getElementById('rich-markdown-fullscreen-editor')?.addEventListener('input', event => {
      const preview = document.getElementById('rich-markdown-fullscreen-preview');
      if (preview) preview.innerHTML = render(event.target.value, { emptyText: fieldShellFrom(event.target)?.dataset?.rmeEmptyText || 'No content.' });
    });
  }

  function init() {
    installListeners();
  }

  window.BlueprintsMarkdown = {
    stripFrontmatter,
    render,
    renderInline,
    imageUrl,
  };
  window.BlueprintsRichMarkdown = {
    init,
    fieldHtml,
    render,
    insertAtActiveField,
    openPicturePicker,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
