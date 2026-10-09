/**
 * A focused Markdown -> HTML converter for NoCode Blueprint content.
 *
 * It is deliberately small and fully deterministic: the same input always
 * produces byte-identical output, with no dependency on a package version.
 *
 * Supported block syntax
 *   ## Heading 2                 -> <h2> (levels 1-6)
 *   Paragraph text               -> <p>
 *   - item  /  1. item           -> <ul> / <ol>, nested by indentation
 *   > quote                      -> <blockquote>
 *   ```lang ... ```              -> <pre><code class="language-lang">
 *   ---                          -> <hr>
 *   <div class="x"> ...          -> passed through untouched (raw HTML block)
 *
 * Supported components (the site's editorial building blocks)
 *   :::callout      -> <div class="callout">...</div>
 *   :::notice       -> <div class="notice">...</div>
 *   :::checklist    -> <ul class="checklist">...</ul>  (items are "- " lines)
 *   :::prompt "L"   -> <div class="prompt-box"><span class="prompt-label">L</span>...</div>
 *
 * Content inside :::prompt is VERBATIM: no Markdown and no escaping. Prompts
 * routinely contain "-", "1.", "{{variable}}", quotes and indentation that
 * must survive unchanged.
 *
 * Supported inline syntax
 *   **bold**  *italic*  _italic_  `code`  [text](url)
 *   Inline HTML tags are passed through; a stray "<" is escaped.
 *
 * "_emphasis_" only applies at word boundaries, so identifiers such as
 * needs_human_review are never mangled.
 */

export class MarkdownError extends Error {
  constructor(message, line) {
    super(line === undefined ? message : `${message} (line ${line + 1})`);
    this.name = 'MarkdownError';
    this.line = line;
  }
}

const CONTAINERS = ['callout', 'notice', 'checklist', 'prompt'];
const CONTAINER_SET = new Set(CONTAINERS);

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n]*$/;
const UL_ITEM = /^( *)([-*+])([ \t]+)(.*)$/;
const OL_ITEM = /^( *)(\d{1,9})([.)])([ \t]+)(.*)$/;
const HR = /^ {0,3}([-*_])( *\1){2,} *$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const CONTAINER_OPEN = /^ {0,3}:::[ \t]*([a-zA-Z][\w-]*)[ \t]*(.*)$/;
const CONTAINER_CLOSE = /^ {0,3}:::[ \t]*$/;
const RAW_HTML = /^ {0,3}<(?:[a-zA-Z][\w-]*|\/|!--)/;

/* ------------------------------------------------------------------ *
 * Escaping and inline rendering
 * ------------------------------------------------------------------ */

export function escapeText(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttribute(text) {
  return escapeText(text).replace(/"/g, '&quot;');
}

/** Turn inline Markdown into HTML. */
export function renderInline(input) {
  const placeholders = [];
  const rendered = inlinePass(String(input), placeholders);
  return rendered.replace(/\u0000(\d+)\u0000/g, (_m, index) => placeholders[Number(index)]);
}

function inlinePass(text, placeholders) {
  const stash = (html) => {
    placeholders.push(html);
    return `\u0000${placeholders.length - 1}\u0000`;
  };

  let out = text;

  // Protect raw inline HTML tags and pre-written entities from escaping.
  out = out.replace(/<\/?[a-zA-Z][^>]*>/g, (match) => stash(match));
  out = out.replace(/&[a-zA-Z#][a-zA-Z0-9]*;/g, (match) => stash(match));

  // Inline code: nothing inside backticks is interpreted further.
  out = out.replace(/`([^`]+)`/g, (_m, code) => stash(`<code>${escapeText(code)}</code>`));

  // Links: [label](href "optional title")
  out = out.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g, (_m, label, href, title) => {
    const attrs = ` href="${escapeAttribute(href)}"${title ? ` title="${escapeAttribute(title)}"` : ''}`;
    return stash(`<a${attrs}>${inlinePass(label, placeholders)}</a>`);
  });

  out = escapeText(out);
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1<em>$2</em>');

  return out;
}

/* ------------------------------------------------------------------ *
 * Block helpers
 * ------------------------------------------------------------------ */

function indentOf(line) {
  let n = 0;
  while (n < line.length && line[n] === ' ') n += 1;
  return n;
}

function isBlank(line) {
  return /^\s*$/.test(line);
}

function isBlockStart(line) {
  return HEADING.test(line)
    || FENCE.test(line)
    || HR.test(line)
    || UL_ITEM.test(line)
    || OL_ITEM.test(line)
    || QUOTE.test(line)
    || CONTAINER_OPEN.test(line)
    || CONTAINER_CLOSE.test(line)
    || RAW_HTML.test(line);
}

/**
 * Collect a list starting at `start`.
 * Items are single-line or continue on lines indented to the item's content
 * column; a deeper marker starts a nested list. Output is always tight, which
 * matches the existing article markup.
 */
function parseList(lines, start) {
  const ordered = OL_ITEM.test(lines[start]);
  const first = ordered ? OL_ITEM.exec(lines[start]) : UL_ITEM.exec(lines[start]);
  const baseIndent = first[1].length;
  const items = [];
  let i = start;

  const openItem = (line) => {
    const ul = UL_ITEM.exec(line);
    if (ul) {
      return { column: ul[1].length + ul[2].length + ul[3].length, text: ul[4], ordered: false };
    }
    const ol = OL_ITEM.exec(line);
    return {
      column: ol[1].length + ol[2].length + ol[3].length + ol[4].length,
      text: ol[5],
      ordered: true,
    };
  };

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j += 1;
      const next = lines[j];
      const keepsGoing = next !== undefined
        && ((UL_ITEM.test(next) || OL_ITEM.test(next))
          ? indentOf(next) === baseIndent
          : indentOf(next) >= baseIndent + 2);
      if (!keepsGoing) break;
      i = j;
      continue;
    }

    const marker = UL_ITEM.test(line) || OL_ITEM.test(line);
    if (marker && indentOf(line) === baseIndent) {
      const opened = openItem(line);
      if (opened.ordered !== ordered) break;
      items.push({ text: [opened.text], children: [], column: opened.column });
      i += 1;
      continue;
    }

    if (marker && indentOf(line) > baseIndent && items.length > 0) {
      const nested = collectIndented(lines, i, baseIndent + 1);
      items[items.length - 1].children.push(nested.lines);
      i = nested.next;
      continue;
    }

    if (items.length === 0) break;
    const current = items[items.length - 1];
    if (indentOf(line) < current.column) break;
    current.text.push(line.slice(Math.min(current.column, indentOf(line))));
    i += 1;
  }

  if (items.length === 0) return { html: '', next: start + 1 };

  const tag = ordered ? 'ol' : 'ul';
  const body = items.map((item) => {
    const lead = `<li>${renderInline(item.text.join('\n'))}`;
    const nested = item.children.map((child) => renderBlocks(child)).join('');
    return `${lead}${nested}</li>`;
  }).join('');
  return { html: `<${tag}>${body}</${tag}>`, next: i };
}

function collectIndented(lines, start, minIndent) {
  const collected = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j += 1;
      if (j >= lines.length || indentOf(lines[j]) < minIndent) break;
      collected.push('');
      i = j;
      continue;
    }
    if (indentOf(line) < minIndent) break;
    collected.push(line);
    i += 1;
  }
  return { lines: collected, next: i };
}

/* ------------------------------------------------------------------ *
 * Block rendering
 * ------------------------------------------------------------------ */

/** Render Markdown into HTML blocks joined by "\n". */
export function renderBlocks(source, startLine = 0) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const lineIndex = startLine + i;

    if (isBlank(line)) {
      i += 1;
      continue;
    }

    /* ---- ::: components ---- */
    const container = CONTAINER_OPEN.exec(line);
    if (container) {
      const name = container[1];
      if (!CONTAINER_SET.has(name)) {
        throw new MarkdownError(
          `Unknown component ":::${name}". Supported components: ${CONTAINERS.map((c) => `:::${c}`).join(', ')}`,
          lineIndex,
        );
      }
      const inner = [];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        if (CONTAINER_CLOSE.test(lines[j])) {
          closed = true;
          break;
        }
        if (CONTAINER_OPEN.test(lines[j])) {
          throw new MarkdownError(`":::${name}" cannot contain another ":::" component`, startLine + j);
        }
        inner.push(lines[j]);
        j += 1;
      }
      if (!closed) throw new MarkdownError(`":::${name}" is never closed with ":::"`, lineIndex);

      blocks.push(renderContainer(name, container[2], inner, lineIndex));
      i = j + 1;
      continue;
    }

    /* ---- headings ---- */
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    /* ---- fenced code ---- */
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const closing = new RegExp(`^ {0,3}\\${marker}{${fence[1].length},}[ \\t]*$`);
      const body = [];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        if (closing.test(lines[j])) {
          closed = true;
          break;
        }
        body.push(lines[j]);
        j += 1;
      }
      if (!closed) throw new MarkdownError('Code fence is never closed', lineIndex);
      const cls = fence[2] ? ` class="language-${escapeAttribute(fence[2])}"` : '';
      blocks.push(`<pre><code${cls}>${escapeText(body.join('\n'))}</code></pre>`);
      i = j + 1;
      continue;
    }

    /* ---- horizontal rule ---- */
    if (HR.test(line)) {
      blocks.push('<hr>');
      i += 1;
      continue;
    }

    /* ---- lists ---- */
    if (UL_ITEM.test(line) || OL_ITEM.test(line)) {
      const list = parseList(lines, i);
      blocks.push(list.html);
      i = list.next;
      continue;
    }

    /* ---- blockquote ---- */
    if (QUOTE.test(line)) {
      const inner = [];
      let j = i;
      while (j < lines.length) {
        const match = QUOTE.exec(lines[j]);
        if (match) {
          inner.push(match[1]);
          j += 1;
          continue;
        }
        if (isBlank(lines[j]) || isBlockStart(lines[j])) break;
        inner.push(lines[j]);
        j += 1;
      }
      blocks.push(`<blockquote>\n${renderBlocks(inner.join('\n'), lineIndex)}\n</blockquote>`);
      i = j;
      continue;
    }

    /* ---- raw HTML block ---- */
    if (RAW_HTML.test(line)) {
      const raw = [line];
      let j = i + 1;
      while (j < lines.length && !isBlank(lines[j])) {
        raw.push(lines[j]);
        j += 1;
      }
      blocks.push(raw.join('\n'));
      i = j;
      continue;
    }

    /* ---- paragraph ---- */
    const paragraph = [line];
    let j = i + 1;
    while (j < lines.length && !isBlank(lines[j]) && !isBlockStart(lines[j])) {
      paragraph.push(lines[j]);
      j += 1;
    }
    blocks.push(`<p>${renderInline(paragraph.join('\n'))}</p>`);
    i = j;
  }

  return blocks.join('\n');
}

function renderContainer(name, rawArgs, inner, lineIndex) {
  const args = rawArgs.trim();

  if (name === 'prompt') {
    const quoted = /^"([^"]*)"$/.exec(args) || /^'([^']*)'$/.exec(args);
    const label = quoted ? quoted[1] : args;
    if (label === '') {
      throw new MarkdownError(':::prompt needs a label, for example :::prompt "Draft prompt"', lineIndex);
    }
    const verbatim = inner.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
    return `<div class="prompt-box"><span class="prompt-label">${escapeText(label)}</span>${verbatim}</div>`;
  }

  if (name === 'checklist') {
    const items = [];
    for (const raw of inner) {
      if (isBlank(raw)) continue;
      const item = UL_ITEM.exec(raw);
      if (!item) {
        throw new MarkdownError(
          ':::checklist items must be Markdown list items starting with "- "',
          lineIndex,
        );
      }
      items.push(`<li>${renderInline(item[4])}</li>`);
    }
    if (items.length === 0) throw new MarkdownError(':::checklist is empty', lineIndex);
    return `<ul class="checklist">${items.join('')}</ul>`;
  }

  if (args !== '') {
    throw new MarkdownError(`:::${name} does not take arguments`, lineIndex);
  }
  const content = inner.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
  if (content === '') throw new MarkdownError(`:::${name} is empty`, lineIndex);

  // A callout or notice holding a single run of prose renders inline, with no
  // <p> wrapper — that is the shape every launch article uses, and wrapping it
  // would change spacing inside the box. As soon as the content contains a
  // blank line or a block-level element it is rendered as real Markdown blocks
  // instead, so lists and headings work inside a box too.
  if (!hasBlockContent(content)) return `<div class="${name}">${renderInline(content)}</div>`;
  return `<div class="${name}">\n${renderBlocks(content, lineIndex + 1)}\n</div>`;
}

/** True when a container body holds anything beyond a single run of prose. */
function hasBlockContent(content) {
  const lines = content.split('\n');
  if (lines.some((line) => isBlank(line))) return true;
  return lines.some((line) =>
    HEADING.test(line) || UL_ITEM.test(line) || OL_ITEM.test(line)
    || FENCE.test(line) || QUOTE.test(line) || HR.test(line) || CONTAINER_OPEN.test(line));
}

/** Render a full Markdown document body. */
export function renderMarkdown(source) {
  return renderBlocks(String(source).replace(/^\n+/, '').replace(/\s+$/, ''));
}

/**
 * Approximate prose word count, used when a post does not carry an explicit
 * word_count. Code fences and :::prompt blocks are excluded because they are
 * reference material rather than reading copy.
 */
export function countWords(source) {
  const text = String(source)
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/^ {0,3}:::prompt[^\n]*\n[\s\S]*?\n {0,3}:::[ \t]*$/gm, ' ')
    .replace(/^ {0,3}:::.*$/gm, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|]/g, ' ');
  return text.split(/\s+/).filter(Boolean).length;
}
