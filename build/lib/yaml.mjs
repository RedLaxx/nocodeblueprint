/**
 * A small, dependency-free YAML reader/writer covering the subset that
 * Pages CMS (and this repository's content files) actually produce.
 *
 * Supported on read:
 *   - nested block mappings and block sequences (indentation based)
 *   - mappings nested inside sequence items ("- key: value")
 *   - flow sequences ("[a, b]") and flow mappings ("{a: b}")
 *   - plain, single-quoted and double-quoted scalars, including the
 *     multi-line folding that the `yaml` npm package emits at 80 columns
 *   - literal (|, |-) and folded (>, >-) block scalars
 *   - comments (full line and trailing, quote aware)
 *   - booleans, integers, floats and null
 *
 * Deliberate deviations from the full specification, chosen for safety:
 *   - "YYYY-MM-DD" always parses to a string, never to a Date. Timezone
 *     shifting of publication dates would silently change sitemap lastmod
 *     values and RSS pubDates.
 *   - Unparsable input throws instead of guessing. A failed build leaves the
 *     previously deployed public/ directory live, which is the safe outcome.
 *
 * Everything here is exercised by build/test/run.mjs, including a
 * differential test against the real `yaml` package when it is installed.
 */

export class YamlError extends Error {
  constructor(message, line) {
    super(line === undefined ? message : `${message} (line ${line + 1})`);
    this.name = 'YamlError';
    this.line = line;
  }
}

function indentOf(line) {
  let n = 0;
  while (n < line.length && line[n] === ' ') n += 1;
  return n;
}

function isBlank(line) {
  return /^\s*$/.test(line);
}

function isIgnorable(line) {
  return isBlank(line) || /^\s*#/.test(line);
}

/**
 * Remove a trailing comment from a scalar fragment, respecting quotes.
 * A "#" only starts a comment at the start of the fragment or after
 * whitespace, which matches the YAML rules.
 */
function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote === '"') {
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") {
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i).replace(/\s+$/, '');
    }
  }
  return text.replace(/\s+$/, '');
}

const DOUBLE_ESCAPES = {
  0: '\0', a: '\x07', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f', r: '\r',
  e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0',
  L: '\u2028', P: '\u2029',
};

/**
 * Read a quoted scalar beginning at `column` on `lineIndex`, continuing onto
 * following raw lines when the closing quote is not on the same line.
 */
function readQuoted(lines, lineIndex, column) {
  const quote = lines[lineIndex][column];
  if (quote !== '"' && quote !== "'") {
    throw new YamlError('Expected a quoted scalar', lineIndex);
  }
  let value = '';
  let index = lineIndex;
  let cursor = column + 1;
  let closed = false;

  while (!closed) {
    const line = lines[index];
    if (line === undefined) {
      throw new YamlError(`Unterminated ${quote}-quoted scalar`, lineIndex);
    }
    const start = index === lineIndex ? cursor : indentOf(line);
    let segment = '';
    let escapedBreak = false;
    let p = start;
    for (; p < line.length; p += 1) {
      const ch = line[p];
      if (quote === "'") {
        if (ch === "'") {
          if (line[p + 1] === "'") {
            segment += "'";
            p += 1;
            continue;
          }
          closed = true;
          p += 1;
          break;
        }
        segment += ch;
        continue;
      }
      if (ch === '\\') {
        const next = line[p + 1];
        if (next === undefined) {
          escapedBreak = true;
          break;
        }
        if (next === 'u' || next === 'x') {
          const width = next === 'u' ? 4 : 2;
          const hex = line.slice(p + 2, p + 2 + width);
          if (!new RegExp(`^[0-9a-fA-F]{${width}}$`).test(hex)) {
            throw new YamlError(`Invalid \\${next} escape sequence`, index);
          }
          segment += String.fromCharCode(parseInt(hex, 16));
          p += width + 1;
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(DOUBLE_ESCAPES, next)) {
          segment += DOUBLE_ESCAPES[next];
          p += 1;
          continue;
        }
        throw new YamlError(`Unknown escape sequence "\\${next}"`, index);
      }
      if (ch === '"') {
        closed = true;
        p += 1;
        break;
      }
      segment += ch;
    }

    value += segment;
    cursor = p;
    if (closed) break;
    index += 1;
    if (!escapedBreak && value !== '' && !value.endsWith(' ')) value += ' ';
  }

  const trailing = stripComment(lines[index].slice(cursor));
  if (trailing !== '') {
    throw new YamlError(`Unexpected content after quoted scalar: "${trailing}"`, index);
  }
  return { value, nextIndex: index + 1, endColumn: cursor };
}

function parseScalar(text, lineIndex) {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '~' || /^(null|Null|NULL)$/.test(trimmed)) return null;
  if (/^(true|True|TRUE)$/.test(trimmed)) return true;
  if (/^(false|False|FALSE)$/.test(trimmed)) return false;
  if (trimmed[0] === '"' || trimmed[0] === "'") {
    return readQuoted([trimmed], 0, 0).value;
  }
  // Integers and floats. Dates stay strings on purpose (see header comment).
  if (/^[-+]?[0-9]+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isSafeInteger(n)) return n;
  }
  if (/^[-+]?([0-9]+\.[0-9]*|\.[0-9]+|[0-9]+)([eE][-+]?[0-9]+)?$/.test(trimmed)
      && /(\.|[eE])/.test(trimmed)) {
    return Number(trimmed);
  }
  void lineIndex;
  return trimmed;
}

/** Split a flow collection body on top-level commas. */
function splitFlow(body) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && quote === '"') {
        current += body[i + 1] ?? '';
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '[' || ch === '{') depth += 1;
    if (ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/**
 * Locate the ":" that terminates a mapping key.
 * Returns { key, hasValue, valueColumn } where valueColumn is the offset of
 * the value within `fragment`, or null when this is not a mapping entry.
 */
function splitKey(fragment) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < fragment.length; i += 1) {
    const ch = fragment[i];
    if (quote) {
      if (ch === '\\' && quote === '"') { i += 1; continue; }
      if (ch === quote) {
        if (quote === "'" && fragment[i + 1] === "'") { i += 1; continue; }
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '[' || ch === '{') depth += 1;
    if (ch === ']' || ch === '}') depth -= 1;
    if (ch === '#' && depth === 0 && (i === 0 || /\s/.test(fragment[i - 1]))) return null;
    if (ch === ':' && depth === 0) {
      const next = fragment[i + 1];
      if (next === undefined || next === ' ' || next === '\t') {
        const key = fragment.slice(0, i).replace(/\s+$/, '');
        if (key === '') return null;
        let valueColumn = i + 1;
        while (valueColumn < fragment.length && fragment[valueColumn] === ' ') valueColumn += 1;
        return { key, hasValue: valueColumn < fragment.length, valueColumn };
      }
    }
  }
  return null;
}

class Parser {
  constructor(text) {
    this.lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    this.i = 0;
  }

  fail(message, index = this.i) {
    throw new YamlError(message, index);
  }

  peek() {
    let index = this.i;
    while (index < this.lines.length && isIgnorable(this.lines[index])) index += 1;
    if (index >= this.lines.length) return null;
    const raw = this.lines[index];
    if (/^[ ]*\t/.test(raw)) this.fail('Tabs cannot be used for indentation', index);
    const indent = indentOf(raw);
    return { index, raw, indent, text: raw.slice(indent) };
  }

  parseDocument() {
    const head = this.peek();
    if (!head) return null;
    if (head.text === '---' || head.text.startsWith('--- ')) {
      this.i = head.index + 1;
      const after = this.peek();
      if (!after) return null;
    }
    const start = this.peek();
    const value = this.parseNode(start.indent);
    const trailing = this.peek();
    if (trailing && trailing.text !== '...' && trailing.text !== '---') {
      this.fail(`Unexpected content: ${trailing.text}`, trailing.index);
    }
    return value === undefined ? null : value;
  }

  parseNode(indent) {
    const line = this.peek();
    if (!line || line.indent < indent) return null;
    if (line.indent > indent) this.fail('Unexpected indentation', line.index);
    if (line.text === '-' || line.text.startsWith('- ')) return this.parseSequence(indent);
    return this.parseMapping(indent);
  }

  parseSequence(indent) {
    const out = [];
    for (;;) {
      const line = this.peek();
      if (!line || line.indent !== indent) break;
      if (!(line.text === '-' || line.text.startsWith('- '))) break;

      const afterRaw = line.text.slice(1);
      const spaces = afterRaw.length - afterRaw.replace(/^ +/, '').length;
      const rest = afterRaw.slice(spaces);

      if (rest === '') {
        this.i = line.index + 1;
        const next = this.peek();
        out.push(next && next.indent > indent ? this.parseNode(next.indent) : null);
        continue;
      }

      const itemIndent = indent + 1 + spaces;
      // Rewrite the line so the item content sits at its own column and can be
      // parsed by the ordinary mapping/sequence/scalar logic.
      this.lines[line.index] = `${' '.repeat(itemIndent)}${rest}`;
      this.i = line.index;
      if (rest === '-' || rest.startsWith('- ')) {
        out.push(this.parseSequence(itemIndent));
      } else if (splitKey(rest)) {
        out.push(this.parseMapping(itemIndent));
      } else {
        out.push(this.parseValue(indent, line.index, itemIndent, itemIndent));
      }
    }
    return out;
  }

  parseMapping(indent) {
    const out = {};
    for (;;) {
      const line = this.peek();
      if (!line || line.indent !== indent) break;
      if (line.text === '-' || line.text.startsWith('- ')) break;

      const split = splitKey(line.text);
      if (!split) this.fail(`Expected "key: value" but found: ${line.text}`, line.index);

      let key = split.key;
      if (key[0] === '"' || key[0] === "'") {
        key = readQuoted(this.lines, line.index, indent).value;
      }
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        this.fail(`Duplicate key "${key}"`, line.index);
      }

      if (!split.hasValue) {
        this.i = line.index + 1;
        const next = this.peek();
        out[key] = next && next.indent > indent ? this.parseNode(next.indent) : null;
        continue;
      }

      const column = indent + split.valueColumn;
      this.i = line.index;
      out[key] = this.parseValue(indent, line.index, column, indent + 1);
    }
    return out;
  }

  /**
   * Parse the value that starts at `column` on `lineIndex`.
   * @param {number} blockIndent  indentation a nested block must exceed
   * @param {number} lineIndex    line the value starts on
   * @param {number} column       column the value starts at
   * @param {number} foldIndent   minimum indentation of a folded continuation
   */
  parseValue(blockIndent, lineIndex, column, foldIndent) {
    const line = this.lines[lineIndex];
    const quotedStart = line[column] === '"' || line[column] === "'";
    let rest = line.slice(column);
    if (!quotedStart) rest = stripComment(rest);

    if (rest === '') {
      this.i = lineIndex + 1;
      const next = this.peek();
      if (next && next.indent > blockIndent) return this.parseNode(next.indent);
      return null;
    }

    if (rest[0] === '|' || rest[0] === '>') {
      return this.parseBlockScalar(rest, lineIndex, blockIndent);
    }

    if (rest[0] === '[' || rest[0] === '{') {
      const open = rest[0];
      const close = open === '[' ? ']' : '}';
      let text = line.slice(column);
      let index = lineIndex;
      for (;;) {
        let depth = 0;
        let quote = null;
        for (let p = 0; p < text.length; p += 1) {
          const ch = text[p];
          if (quote) {
            if (ch === '\\' && quote === '"') { p += 1; continue; }
            if (ch === quote) quote = null;
            continue;
          }
          if (ch === '"' || ch === "'") { quote = ch; continue; }
          if (ch === open) depth += 1;
          if (ch === close) depth -= 1;
        }
        if (depth <= 0) break;
        index += 1;
        if (index >= this.lines.length) this.fail(`Unterminated flow collection, expected "${close}"`, lineIndex);
        text += ` ${this.lines[index].trim()}`;
      }
      const body = stripComment(text);
      if (!body.endsWith(close)) this.fail(`Unterminated flow collection, expected "${close}"`, lineIndex);
      const inner = body.slice(1, body.length - 1);
      this.i = index + 1;
      if (open === '[') return splitFlow(inner).map((part) => parseScalar(part, lineIndex));
      const obj = {};
      for (const part of splitFlow(inner)) {
        const split = splitKey(part);
        if (!split) this.fail(`Invalid flow mapping entry: "${part}"`, lineIndex);
        obj[parseScalar(split.key, lineIndex)] = parseScalar(part.slice(split.hasValue ? split.valueColumn : part.length), lineIndex);
      }
      return obj;
    }

    if (quotedStart) {
      const quoted = readQuoted(this.lines, lineIndex, column);
      this.i = quoted.nextIndex;
      return quoted.value;
    }

    // Plain scalar, possibly folded across following more-indented lines.
    const parts = [rest];
    let index = lineIndex + 1;
    while (index < this.lines.length) {
      const raw = this.lines[index];
      if (isIgnorable(raw)) break;
      const ind = indentOf(raw);
      if (ind < foldIndent) break;
      const text = raw.slice(ind);
      if (text === '-' || text.startsWith('- ')) break;
      if (splitKey(text)) break;
      parts.push(stripComment(text));
      index += 1;
    }
    this.i = index;
    return parseScalar(parts.join(' '), lineIndex);
  }

  parseBlockScalar(header, lineIndex, parentIndent) {
    const match = /^([|>])([+-]?)([0-9]*)[ \t]*(#.*)?$/.exec(header);
    if (!match) this.fail(`Invalid block scalar header: "${header}"`, lineIndex);
    const [, style, chomp, explicit] = match;

    const collected = [];
    let index = lineIndex + 1;
    let blockIndent = explicit ? parentIndent + Number(explicit) : null;
    while (index < this.lines.length) {
      const raw = this.lines[index];
      if (isBlank(raw)) {
        collected.push('');
        index += 1;
        continue;
      }
      const ind = indentOf(raw);
      if (blockIndent === null) {
        if (ind <= parentIndent) break;
        blockIndent = ind;
      }
      if (ind < blockIndent) break;
      collected.push(raw.slice(blockIndent));
      index += 1;
    }
    while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop();

    let text;
    if (style === '|') {
      text = collected.join('\n');
    } else {
      const chunks = [];
      let current = [];
      for (const raw of collected) {
        if (raw === '') { chunks.push(current.join(' ')); current = []; } else current.push(raw);
      }
      chunks.push(current.join(' '));
      text = chunks.join('\n');
    }
    if (chomp !== '-') text += '\n';
    this.i = index;
    return text;
  }
}

export function parse(text) {
  return new Parser(text).parseDocument();
}

/* ------------------------------------------------------------------ *
 * Writer
 * ------------------------------------------------------------------ */

function needsQuotes(value) {
  if (value === '') return true;
  if (/^[\s]|[\s]$/.test(value)) return true;
  if (/[\n\r\t]/.test(value)) return true;
  if (/^[#[\]{},&*!|>%@`'"]/.test(value)) return true;
  if (/:\s|\s#/.test(value)) return true;
  if (/^-\s/.test(value)) return true;
  if (/^(true|false|null|~|yes|no|on|off)$/i.test(value)) return true;
  if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)$/.test(value)) return true;
  return false;
}

function quoteDouble(value) {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

function writeScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  const text = String(value);
  return needsQuotes(text) ? quoteDouble(text) : text;
}

function isComposite(value) {
  return value !== null && typeof value === 'object' && !(Array.isArray(value) && value.length === 0);
}

function writeLines(value, indent, out) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isComposite(item)) {
        const nested = [];
        writeLines(item, indent + 2, nested);
        out.push(`${pad}- ${nested[0].slice(indent + 2)}`);
        out.push(...nested.slice(1));
      } else {
        out.push(`${pad}- ${writeScalar(item)}`);
      }
    }
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const safeKey = needsQuotes(key) ? quoteDouble(key) : key;
    if (isComposite(item)) {
      out.push(`${pad}${safeKey}:`);
      writeLines(item, indent + 2, out);
    } else {
      out.push(`${pad}${safeKey}: ${writeScalar(item)}`);
    }
  }
}

/** Serialize to block-style YAML. Key order is preserved for stable diffs. */
export function stringify(value) {
  if (!isComposite(value)) return `${writeScalar(value)}\n`;
  if (Array.isArray(value) && value.length === 0) return '[]\n';
  if (!Array.isArray(value) && Object.keys(value).length === 0) return '{}\n';
  const out = [];
  writeLines(value, 0, out);
  return `${out.join('\n')}\n`;
}

/** Split "---\nfrontmatter\n---\nbody" into { data, body }. */
export function splitFrontmatter(source) {
  const text = String(source).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(\n[\s\S]*)?$/.exec(text);
  if (!match) {
    if (/^---\s*$/.test(text.split('\n')[0] ?? '')) {
      throw new YamlError('Frontmatter block is not closed with "---"');
    }
    return { data: {}, body: text };
  }
  return { data: parse(match[1]) ?? {}, body: (match[2] ?? '').replace(/^\n+/, '') };
}

/** Rebuild a frontmatter document with a single blank line before the body. */
export function formatFrontmatter(data, body) {
  const front = stringify(data).replace(/\n$/, '');
  const content = body.replace(/^\n+/, '').replace(/\s+$/, '');
  return `---\n${front}\n---\n\n${content}\n`;
}
