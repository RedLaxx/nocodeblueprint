/**
 * JSON serializer for JSON-LD.
 *
 * Node's JSON.stringify omits spaces after ":" and ",". The launch markup was
 * written with the more readable ", " / ": " separators, and search-console
 * inspections plus any diff against the deployed HTML depend on that spacing
 * staying stable. Non-ASCII characters are emitted literally rather than as
 * \uXXXX escapes, again matching the existing markup.
 */

function escapeString(value) {
  let out = '"';
  for (const ch of String(value)) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code === 8) out += '\\b';
    else if (code === 12) out += '\\f';
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

export function serializeJson(value) {
  if (value === null || value === undefined) return 'null';
  const type = typeof value;
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (type === 'string') return escapeString(value);
  if (Array.isArray(value)) return `[${value.map(serializeJson).join(', ')}]`;
  if (type !== 'object') throw new TypeError(`Cannot serialize value of type ${type} as JSON`);
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => `${escapeString(key)}: ${serializeJson(item)}`);
  return `{${entries.join(', ')}}`;
}
