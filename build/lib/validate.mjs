/**
 * Dependency-free structural validation for the generated site.
 *
 * These parsers are deliberately strict about the things that actually break in
 * production (unbalanced tags, malformed entities, unterminated attributes) and
 * deliberately quiet about the things HTML and XML allow to differ. They exist
 * so `npm run check` can prove the build output is well formed without pulling
 * a dependency into a zero-dependency repository.
 */

export class ValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ValidationError';
    Object.assign(this, details);
  }
}

const HTML_VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Elements whose content is raw text and must not be scanned for tags. */
const HTML_RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);

const HTML_ENTITY_PATTERN = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;
const XML_ENTITY_PATTERN = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|lt|gt|amp|quot|apos);/g;

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

/**
 * Tokenize and nest an HTML document.
 * Returns `{ root, elements, errors }`. Errors are collected rather than thrown
 * so a single run reports every problem in the file.
 */
export function parseHtml(source) {
  const errors = [];
  const elements = [];
  const root = { tag: '#document', children: [], attributes: {} };
  const stack = [root];
  const attributePattern = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]*)))?/g;

  let index = 0;
  while (index < source.length) {
    const open = source.indexOf('<', index);
    if (open === -1) break;

    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      if (end === -1) {
        errors.push(`line ${lineOf(source, open)}: unterminated comment`);
        break;
      }
      index = end + 3;
      continue;
    }

    if (source.startsWith('<!', open) || source.startsWith('<?', open)) {
      const end = source.indexOf('>', open);
      if (end === -1) {
        errors.push(`line ${lineOf(source, open)}: unterminated declaration`);
        break;
      }
      index = end + 1;
      continue;
    }

    const closing = source[open + 1] === '/';
    const tagMatch = /^<\/?\s*([a-zA-Z][^\s/>]*)/.exec(source.slice(open));
    if (!tagMatch) {
      errors.push(`line ${lineOf(source, open)}: malformed tag "${source.slice(open, open + 30)}"`);
      index = open + 1;
      continue;
    }

    const end = source.indexOf('>', open);
    if (end === -1) {
      errors.push(`line ${lineOf(source, open)}: unterminated tag "<${tagMatch[1]}"`);
      break;
    }

    const tag = tagMatch[1].toLowerCase();
    const inner = source.slice(open + tagMatch[0].length, end);

    if (closing) {
      const current = stack[stack.length - 1];
      if (current === root) {
        errors.push(`line ${lineOf(source, open)}: closing tag "</${tag}>" with nothing open`);
      } else if (current.tag !== tag) {
        errors.push(
          `line ${lineOf(source, open)}: closing tag "</${tag}>" does not match open "<${current.tag}>" from line ${current.line}`,
        );
        // Recover by unwinding to a matching ancestor if one exists.
        const at = stack.findIndex((item) => item.tag === tag);
        if (at > 0) stack.length = at;
      } else {
        stack.pop();
      }
      index = end + 1;
      continue;
    }

    const selfClosing = inner.trimEnd().endsWith('/');
    const attributes = {};
    attributePattern.lastIndex = 0;
    let attributeMatch;
    const attributeSource = selfClosing ? inner.slice(0, -1) : inner;
    while ((attributeMatch = attributePattern.exec(attributeSource)) !== null) {
      const name = attributeMatch[1];
      const value = attributeMatch[2] ?? attributeMatch[3] ?? attributeMatch[4] ?? '';
      if (name in attributes) {
        errors.push(`line ${lineOf(source, open)}: duplicate attribute "${name}" on <${tag}>`);
      }
      attributes[name] = value;
    }

    const element = { tag, attributes, children: [], line: lineOf(source, open) };
    stack[stack.length - 1].children.push(element);
    elements.push(element);

    if (!selfClosing && !HTML_VOID_ELEMENTS.has(tag)) {
      if (HTML_RAW_TEXT_ELEMENTS.has(tag)) {
        const closePattern = new RegExp(`</${tag}\\s*>`, 'i');
        const closeMatch = closePattern.exec(source.slice(end + 1));
        if (!closeMatch) {
          errors.push(`line ${lineOf(source, open)}: <${tag}> is never closed`);
          index = source.length;
          continue;
        }
        element.text = source.slice(end + 1, end + 1 + closeMatch.index);
        index = end + 1 + closeMatch.index + closeMatch[0].length;
        continue;
      }
      stack.push(element);
    }
    index = end + 1;
  }

  for (const unclosed of stack.slice(1)) {
    errors.push(`line ${unclosed.line}: <${unclosed.tag}> is never closed`);
  }

  return { root, elements, errors };
}

/**
 * Strict XML parse. Throws ValidationError on the first problem, because XML
 * has no error recovery: a browser or feed reader will reject the whole file.
 */
export function parseXml(source) {
  const root = { tag: '#document', children: [], attributes: {}, text: '' };
  const stack = [root];
  const attributePattern = /([^\s"'>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  let index = 0;
  while (index < source.length) {
    const open = source.indexOf('<', index);
    const text = source.slice(index, open === -1 ? source.length : open);
    assertEntities(text, 'XML', source, index);
    stack[stack.length - 1].text += decodeEntities(text);
    if (open === -1) break;

    if (source.startsWith('<?', open)) {
      const end = source.indexOf('?>', open);
      if (end === -1) throw new ValidationError(`line ${lineOf(source, open)}: unterminated processing instruction`);
      index = end + 2;
      continue;
    }
    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      if (end === -1) throw new ValidationError(`line ${lineOf(source, open)}: unterminated comment`);
      if (source.slice(open + 4, end).includes('--')) {
        throw new ValidationError(`line ${lineOf(source, open)}: "--" is not allowed inside an XML comment`);
      }
      index = end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open + 9);
      if (end === -1) throw new ValidationError(`line ${lineOf(source, open)}: unterminated CDATA section`);
      stack[stack.length - 1].text += source.slice(open + 9, end);
      index = end + 3;
      continue;
    }

    const end = source.indexOf('>', open);
    if (end === -1) throw new ValidationError(`line ${lineOf(source, open)}: unterminated tag`);

    const closing = source[open + 1] === '/';
    const tagMatch = /^<\/?\s*([A-Za-z_][\w.:-]*)/.exec(source.slice(open));
    if (!tagMatch) throw new ValidationError(`line ${lineOf(source, open)}: malformed tag "${source.slice(open, open + 40)}"`);
    const tag = tagMatch[1];
    const inner = source.slice(open + tagMatch[0].length, end);

    if (closing) {
      if (inner.trim() !== '') throw new ValidationError(`line ${lineOf(source, open)}: attributes on closing tag </${tag}>`);
      const current = stack[stack.length - 1];
      if (current === root) throw new ValidationError(`line ${lineOf(source, open)}: closing </${tag}> with nothing open`);
      if (current.tag !== tag) {
        throw new ValidationError(`line ${lineOf(source, open)}: closing </${tag}> does not match open <${current.tag}> from line ${current.line}`);
      }
      stack.pop();
      index = end + 1;
      continue;
    }

    const selfClosing = inner.trimEnd().endsWith('/');
    const attributes = {};
    attributePattern.lastIndex = 0;
    let attributeMatch;
    const attributeSource = selfClosing ? inner.slice(0, -1) : inner;
    while ((attributeMatch = attributePattern.exec(attributeSource)) !== null) {
      const name = attributeMatch[1];
      if (name in attributes) throw new ValidationError(`line ${lineOf(source, open)}: duplicate attribute "${name}" on <${tag}>`);
      attributes[name] = attributeMatch[2] ?? attributeMatch[3];
    }
    attributePattern.lastIndex = 0;
    const unconsumed = attributeSource.replace(attributePattern, '').trim();
    if (unconsumed !== '') {
      throw new ValidationError(`line ${lineOf(source, open)}: unparsable content in <${tag}>: "${unconsumed}"`);
    }

    const element = { tag, attributes, children: [], text: '', line: lineOf(source, open) };
    stack[stack.length - 1].children.push(element);
    if (!selfClosing) stack.push(element);
    index = end + 1;
  }

  if (stack.length > 1) {
    const unclosed = stack[stack.length - 1];
    throw new ValidationError(`line ${unclosed.line}: <${unclosed.tag}> is never closed`);
  }
  return root;
}

function assertEntities(text, flavour, source, offset) {
  const stripped = text.replace(flavour === 'XML' ? XML_ENTITY_PATTERN : HTML_ENTITY_PATTERN, '');
  const stray = stripped.indexOf('&');
  if (stray === -1) return;
  const at = offset + stray;
  throw new ValidationError(
    `line ${lineOf(source, at)}: bare "&" is not a valid ${flavour} entity; write "&amp;"`,
  );
}

/** Decode the entities this site can actually emit. */
export function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Visible text of an HTML fragment: tags removed, entities decoded, whitespace collapsed. */
export function visibleText(fragment) {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Every `<script type="application/ld+json">` payload, parsed. */
export function extractJsonLd(source) {
  const payloads = [];
  const pattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    payloads.push({
      line: lineOf(source, match.index),
      raw: match[1],
      data: JSON.parse(match[1]),
    });
  }
  return payloads;
}

/** Every `href` and `src` value in a document, with its line number. */
export function extractLinks(source) {
  const links = [];
  const pattern = /\s(?:href|src)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    links.push({ url: match[1], line: lineOf(source, match.index) });
  }
  return links;
}

/** True when a link points somewhere outside the site. */
export function isExternalLink(url) {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url) || /^[a-z][a-z0-9+.-]*:/i.test(url);
}
