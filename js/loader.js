// loader.js — turns pasted/uploaded text into either a Quiz Pack or legacy questions. Pure module: no DOM.
//
//   loadInput(raw)  ->  { kind: 'pack' | 'legacy' | 'error', ... }      (the one entry point for the UI)
//
// Pipeline for JSON packs (P2-02):
//   strip BOM -> skip code fence / surrounding prose -> extract first top-level {...}
//   -> JSON.parse -> on failure blank out trailing commas and retry -> else report the error with a position
// Then: normalizePack (P2-05) -> validatePack (P2-04, validator.js).
// Plain numbered text (today's Quick Paste input) is detected and returned as kind 'legacy' (P2-03).
//
// The LEGACY plain-text parser below is unchanged from Phase 1 (identical to Quiz Runner v1, tag `v1-legacy`).
import { validatePack } from './validator.js';

/**
 * Parse numbered plain-text questions ("1. ...", "A. ...", True/False without options).
 * Behaviour is intentionally identical to Quiz Runner v1 (tag `v1-legacy`).
 * @param {string} raw
 * @returns {{ number: number, text: string, options: {letter: string, text: string}[], type: 'mc'|'tf' }[]}
 */
export function parseLegacyText(raw) {
  const lines = raw.split(/\r?\n/);
  const qStartRegex = /^\*{0,2}(\d+)\.\*{0,2}\s*(.*)$/;
  const optRegex = /^([A-Da-d])[.)]\s*(.*)$/;
  const parsed = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const qMatch = line.match(qStartRegex);
    if (qMatch) {
      if (current) parsed.push(current);
      current = { number: parseInt(qMatch[1], 10), text: qMatch[2].trim(), options: [] };
      continue;
    }

    const oMatch = line.match(optRegex);
    if (oMatch && current) {
      current.options.push({ letter: oMatch[1].toUpperCase(), text: oMatch[2].trim() });
      continue;
    }

    if (current) {
      if (current.options.length === 0) {
        current.text += (current.text ? ' ' : '') + line;
      }
    }
  }
  if (current) parsed.push(current);

  parsed.forEach((q) => {
    if (q.options.length === 0) {
      q.type = 'tf';
      q.options = [
        { letter: 'True', text: 'True' },
        { letter: 'False', text: 'False' },
      ];
      q.text = q.text.replace(/^true or false:?\s*/i, '').trim();
    } else {
      q.type = 'mc';
    }
  });

  return parsed;
}

// ===========================================================================
// Tolerant JSON pipeline (P2-02)
// ===========================================================================

/** Remove a leading UTF-8 byte-order mark (U+FEFF). */
export function stripBom(text) {
  return String(text ?? '').replace(/^\uFEFF/, '');
}

/**
 * Find the first top-level `{ ... }` in `text`, ignoring a code fence and any prose around it.
 * Braces inside JSON strings are skipped. If the object never closes (cut-off reply), `complete`
 * is false and `text` runs to the end of the input.
 * @returns {{ text: string, start: number, end: number, complete: boolean } | null}
 */
export function extractJsonObject(text) {
  // A real newline can never appear inside a JSON string, so a fence opener ("```json\n") is never pack content.
  const fence = /```[\w-]*[ \t]*\r?\n/.exec(text);
  let from = 0;
  if (fence) {
    const afterFence = fence.index + fence[0].length;
    if (text.indexOf('{', afterFence) !== -1) from = afterFence;
  }
  const start = text.indexOf('{', from);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { text: text.slice(start, i + 1), start, end: i + 1, complete: true };
    }
  }
  return { text: text.slice(start), start, end: text.length, complete: false };
}

/**
 * Replace trailing commas (a comma followed only by whitespace and then `}` or `]`) with a space.
 * A space, not a deletion, so every character offset stays the same and error positions stay valid.
 * Commas inside strings are left alone.
 */
export function removeTrailingCommas(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === ',') {
      let j = i + 1;
      while (j < text.length && ' \t\r\n'.includes(text[j])) j++;
      out += text[j] === '}' || text[j] === ']' ? ' ' : c;
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * Strict JSON syntax scan that returns WHERE the first problem is.
 * JSON.parse messages differ per browser (Safari gives no position), so we find the offset ourselves.
 * @returns {{ index: number, message: string } | null}   null = syntactically valid
 */
export function findJsonSyntaxError(text) {
  const n = text.length;
  let i = 0;
  const MAX_DEPTH = 500;
  const fail = (message, at = i) => { throw { index: Math.min(at, n), message }; };
  const skipWs = () => { while (i < n && ' \t\n\r'.includes(text[i])) i++; };
  const show = (c) => (c === undefined ? 'end of text' : `"${c}"`);

  function parseString() {
    i++; // opening quote
    while (i < n) {
      const c = text[i];
      if (c === '"') { i++; return; }
      if (c === '\\') {
        const e = text[i + 1];
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail('Bad \\u escape in a string', i);
          i += 6;
        } else if (e !== undefined && '"\\/bfnrt'.includes(e)) {
          i += 2;
        } else {
          fail(`Bad escape "\\${e ?? ''}" in a string`, i);
        }
        continue;
      }
      if (c < ' ') fail('A line break or control character inside a string (it must be written as \\n)', i);
      i++;
    }
    fail('A string is missing its closing quote', n);
  }

  function parseValue(depth) {
    if (depth > MAX_DEPTH) fail('Nested too deeply');
    skipWs();
    const c = text[i];
    if (c === undefined) fail('The text ends where a value was expected', n);
    if (c === '{') return parseObject(depth);
    if (c === '[') return parseArray(depth);
    if (c === '"') return parseString();
    if (c === '-' || (c >= '0' && c <= '9')) {
      const re = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
      re.lastIndex = i;
      const m = re.exec(text);
      if (!m) fail('Malformed number');
      i += m[0].length;
      return;
    }
    for (const word of ['true', 'false', 'null']) {
      if (text.startsWith(word, i)) { i += word.length; return; }
    }
    fail(`Unexpected ${show(c)}`);
  }

  function parseObject(depth) {
    i++; // {
    skipWs();
    if (text[i] === '}') { i++; return; }
    for (;;) {
      skipWs();
      if (text[i] === '}') fail('Trailing comma before "}"');
      if (text[i] !== '"') fail(`Expected a property name in straight double quotes but found ${show(text[i])}`, i >= n ? n : i);
      parseString();
      skipWs();
      if (text[i] !== ':') fail(`Expected ":" after a property name but found ${show(text[i])}`, i >= n ? n : i);
      i++;
      parseValue(depth + 1);
      skipWs();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '}') { i++; return; }
      fail(`Expected "," or "}" but found ${show(text[i])}`, i >= n ? n : i);
    }
  }

  function parseArray(depth) {
    i++; // [
    skipWs();
    if (text[i] === ']') { i++; return; }
    for (;;) {
      skipWs();
      if (text[i] === ']') fail('Trailing comma before "]"');
      parseValue(depth + 1);
      skipWs();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ']') { i++; return; }
      fail(`Expected "," or "]" but found ${show(text[i])}`, i >= n ? n : i);
    }
  }

  try {
    parseValue(0);
    skipWs();
    if (i < n) fail(`Unexpected ${show(text[i])} after the end of the JSON`);
    return null;
  } catch (e) {
    if (e && typeof e.index === 'number') return e;
    throw e;
  }
}

/** 1-based line and column of a character offset. */
export function indexToLineCol(text, index) {
  const upTo = text.slice(0, Math.max(0, Math.min(index, text.length)));
  const lines = upTo.split(/\r\n|\r|\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/**
 * Parse a JSON object tolerantly: JSON.parse, then once more with trailing commas blanked out.
 * @param {string} text  already extracted `{...}` text
 * @returns {{ ok: true, value: any, repaired: boolean } | { ok: false, index: number | null, detail: string }}
 *   On failure `index` is an offset into `text`.
 */
export function parseJsonTolerant(text) {
  try {
    return { ok: true, value: JSON.parse(text), repaired: false };
  } catch (firstError) {
    const cleaned = removeTrailingCommas(text);
    if (cleaned !== text) {
      try {
        return { ok: true, value: JSON.parse(cleaned), repaired: true };
      } catch { /* fall through to the error report */ }
    }
    const found = findJsonSyntaxError(cleaned);           // offsets are identical in `text` and `cleaned`
    if (found) return { ok: false, index: found.index, detail: found.message };
    // Our scanner and the engine disagree (should not happen): fall back to the engine's own message.
    const m = /position (\d+)/.exec(String(firstError && firstError.message));
    return { ok: false, index: m ? Number(m[1]) : null, detail: String((firstError && firstError.message) || 'Invalid JSON') };
  }
}

// ===========================================================================
// Normalization (P2-05)
// ===========================================================================

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Deep copy with every string trimmed. Uses fromEntries so a "__proto__" key stays plain data. */
function trimDeep(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(trimDeep);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.trim(), trimDeep(v)]));
  return value;
}

const isBlank = (v) => v === undefined || v === null || v === '';

/**
 * Normalize a parsed pack. Returns a new object; the input is not modified.
 *  - trim whitespace in every string (and object key)
 *  - uppercase option letters and `mc` answers; `tf` answers become exactly "True" / "False"
 *  - infer `type` when missing: `tf` if there are no options, otherwise `mc`
 *  - default `meta.part` and `meta.total_parts` to 1
 * Anything that is not a pack-shaped object is returned unchanged (the validator reports it).
 */
export function normalizePack(pack) {
  if (!isPlainObject(pack)) return pack;
  const out = trimDeep(pack);

  if (isPlainObject(out.meta)) {
    if (isBlank(out.meta.part)) out.meta.part = 1;
    if (isBlank(out.meta.total_parts)) out.meta.total_parts = 1;
  }

  if (Array.isArray(out.questions)) {
    for (const q of out.questions) {
      if (!isPlainObject(q)) continue;

      if (isPlainObject(q.options)) {
        const upper = {};
        for (const [key, text] of Object.entries(q.options)) {
          const letter = key.toUpperCase();
          if (!(letter in upper)) upper[letter] = text;      // if "a" and "A" both exist, the first one wins
        }
        q.options = upper;
      }

      if (isBlank(q.type)) q.type = isBlank(q.options) ? 'tf' : 'mc';

      if (typeof q.answer === 'string') {
        if (q.type === 'tf') {
          const lower = q.answer.toLowerCase();
          if (lower === 'true') q.answer = 'True';
          else if (lower === 'false') q.answer = 'False';
        } else {
          q.answer = q.answer.toUpperCase();
        }
      }
    }
  }
  return out;
}

// ===========================================================================
// Entry point (P2-01 / P2-02 / P2-03)
// ===========================================================================

// Keys that only a Quiz Pack has, in straight OR curly quotes (so a smart-quoted pack still gets the JSON error).
const PACK_KEY_HINT = /["\u201C\u201D](format|questions|meta)["\u201C\u201D]\s*:/;

/**
 * Decide what a piece of pasted/uploaded text is.
 * @returns {'empty' | 'json' | 'legacy' | 'unknown'}
 */
export function detectInputKind(raw) {
  const text = stripBom(raw).trim();
  if (!text) return 'empty';
  if (PACK_KEY_HINT.test(text)) return 'json';
  if (parseLegacyText(text).length > 0) return 'legacy';
  if (extractJsonObject(text)) return 'json';
  return 'unknown';
}

/**
 * @typedef {{ code: string, message: string, number: number | null, index: number | null }} Issue
 * @typedef {{ kind: 'pack', pack: any, ok: boolean, errors: Issue[], warnings: Issue[], repaired: boolean }
 *         | { kind: 'legacy', questions: ReturnType<typeof parseLegacyText> }
 *         | { kind: 'error', error: { code: 'empty' | 'unrecognized' | 'invalid_json', message: string,
 *                                     line?: number, column?: number, index?: number, truncated?: boolean } }} LoadResult
 */

/**
 * Turn raw pasted/uploaded text into a result the UI can act on. Never throws.
 *  - kind 'legacy': numbered plain text -> route to Quick Paste (answers only)
 *  - kind 'pack':   parsed + normalized + validated; load only when `ok` (no errors); show `warnings` either way
 *  - kind 'error':  nothing usable; `error.message` is ready to show, with a line/column for bad JSON
 * @param {string} raw
 * @returns {LoadResult}
 */
export function loadInput(raw) {
  const text = stripBom(raw);
  const kind = detectInputKind(text);

  if (kind === 'empty') {
    return { kind: 'error', error: { code: 'empty', message: 'Nothing to load yet. Paste a Quiz Pack or your questions, or choose a file.' } };
  }
  if (kind === 'legacy') {
    return { kind: 'legacy', questions: parseLegacyText(text) };
  }
  if (kind === 'unknown') {
    return {
      kind: 'error',
      error: {
        code: 'unrecognized',
        message:
          "Couldn't find a Quiz Pack or any questions in that text. Paste the JSON pack from the AI, or numbered questions " +
          'where each question starts with a number like "1." and each option starts with "A.", "B.", etc.',
      },
    };
  }

  const extracted = extractJsonObject(text);
  if (!extracted) {
    return { kind: 'error', error: { code: 'invalid_json', message: 'No JSON object (starting with "{") was found in that text.' } };
  }

  const parsed = parseJsonTolerant(extracted.text);
  if (!parsed.ok) return { kind: 'error', error: describeJsonError(text, extracted, parsed) };

  const pack = normalizePack(parsed.value);
  const { errors, warnings } = validatePack(pack);
  return { kind: 'pack', pack, ok: errors.length === 0, errors, warnings, repaired: parsed.repaired };
}

/** Build the user-facing "invalid JSON" error, with a position in the text the user pasted. */
function describeJsonError(fullText, extracted, parsed) {
  const base = { code: 'invalid_json' };
  if (parsed.index === null) {
    return { ...base, message: `That text isn't valid JSON: ${parsed.detail}.` };
  }
  // The scan only reached the very end (ignoring trailing blank space) = the text stops before the JSON is finished.
  const contentEnd = extracted.text.trimEnd().length;
  const truncated = parsed.index >= contentEnd;
  const localIndex = truncated ? contentEnd : parsed.index;
  const index = extracted.start + localIndex;
  const { line, column } = indexToLineCol(fullText, index);

  if (truncated) {
    return {
      ...base,
      message: `The pack stops in the middle (after line ${line}, column ${column}): the AI's reply looks cut off, so the JSON is incomplete.`,
      line,
      column,
      index,
      truncated: true,
    };
  }
  let message = `That text isn't valid JSON at line ${line}, column ${column}: ${parsed.detail}.`;
  if (/[\u201C\u201D]/.test(extracted.text)) {
    message += ' Curly quotes (\u201C \u201D) were found; JSON needs straight double quotes (").';
  }
  return { ...base, message, line, column, index, truncated: false };
}
