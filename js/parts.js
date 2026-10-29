// parts.js — which questions of a pack are still missing, and merging the parts of a multi-part pack (P7-01..P7-04).
// Pure module: no DOM, no storage. Input is what `loadInput` (loader.js) returns for a pack; nothing here parses text.
//
//   completeness(pack)            -> { loaded, total, missing, complete }      "Loaded 97 of 130" and the numbers the AI must still send
//   formatRanges([46,47,48,91])   -> "46-48, 91"
//   mergePacks(base, incoming)    -> one pack: questions combined by `number`, the LATER pack wins a conflict (QUIZ_PACK_SPEC §4)
//   addToAssembly(assembly, res)  -> keeps the parts loaded so far for one `quiz_id` and reports "Parts loaded: 2 of 3"
//
// SPEC GAP notes ("SPEC GAP:") mark every place the specs were silent; they are listed in the hand-off notes.
import { validatePack } from './validator.js';
import { MAX_PACK_QUESTIONS } from './constants.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const metaOf = (pack) => (isPlainObject(pack) && isPlainObject(pack.meta) ? pack.meta : {});
const questionsOf = (pack) => (isPlainObject(pack) && Array.isArray(pack.questions) ? pack.questions.filter(isPlainObject) : []);
const hasText = (v) => typeof v === 'string' && v.trim() !== '';

// ===========================================================================
// What is missing (P7-01, P7-02)
// ===========================================================================

/**
 * How much of the planned pack has arrived. The plan is `meta.total_questions`, numbered 1..total (QUIZ_PACK_SPEC rule 10).
 * A question counts as loaded when its `number` is a whole number in 1..total; `loaded` is `total - missing.length`.
 * SPEC GAP: a `total_questions` that is missing, not a whole number, or above MAX_PACK_QUESTIONS means the plan is unknown:
 * `total` is null, nothing is reported as missing and the pack counts as complete (there is nothing to compare it with).
 * @param {any} pack
 * @returns {{ loaded: number, total: number | null, missing: number[], complete: boolean }}
 */
export function completeness(pack) {
  const questions = questionsOf(pack);
  const total = metaOf(pack).total_questions;
  if (!Number.isInteger(total) || total < 1 || total > MAX_PACK_QUESTIONS) {
    return { loaded: questions.length, total: null, missing: [], complete: true };
  }
  const present = new Set(questions.map((q) => q.number).filter((n) => Number.isInteger(n) && n >= 1 && n <= total));
  const missing = [];
  for (let n = 1; n <= total; n++) if (!present.has(n)) missing.push(n);
  return { loaded: total - missing.length, total, missing, complete: missing.length === 0 };
}

/** `[1,2,3,7,9,10]` -> `"1-3, 7, 9-10"`. Input is sorted and de-duplicated first. */
export function formatRanges(numbers) {
  const sorted = [...new Set((Array.isArray(numbers) ? numbers : []).filter(Number.isInteger))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return out.join(', ');
}

// ===========================================================================
// Merging parts (P7-04)
// ===========================================================================

const partNumber = (pack) => (Number.isInteger(metaOf(pack).part) && metaOf(pack).part >= 1 ? metaOf(pack).part : 1);
const totalPartsOf = (pack) => (Number.isInteger(metaOf(pack).total_parts) && metaOf(pack).total_parts >= 1 ? metaOf(pack).total_parts : 1);

/** True when both packs have a `quiz_id` and it is the same one. */
export function sameQuiz(a, b) {
  const x = metaOf(a).quiz_id;
  const y = metaOf(b).quiz_id;
  return hasText(x) && hasText(y) && x === y;
}

/**
 * Union of two topic lists by `id`: the first list's order, then new ids; for an id in both, the later (second) one wins.
 * SPEC GAP: the spec says every part has identical `meta`; it does not say what to do when the topics differ.
 */
function mergeTopics(base, incoming) {
  const out = [];
  const index = new Map();
  for (const list of [base, incoming]) {
    for (const t of Array.isArray(list) ? list : []) {
      if (!isPlainObject(t) || !hasText(t.id)) continue;
      if (index.has(t.id)) out[index.get(t.id)] = t;
      else { index.set(t.id, out.length); out.push(t); }
    }
  }
  return out;
}

/**
 * Combine two packs of the same `quiz_id` by question `number`. Questions of `incoming` win a conflict, so a part pasted
 * twice changes nothing and a corrected part replaces its earlier version. The result is sorted by number; questions
 * without a usable number cannot be matched and are all kept, after the numbered ones.
 * `meta`: later wins for every field that `incoming` has; topics are the union; `part` / `total_parts` become 1 / 1
 * because the result is one combined pack (SPEC GAP: not specified; progress is tracked in the assembly instead).
 * Neither input is modified.
 * @returns {{ ok: true, pack: any, replaced: number[], added: number } | { ok: false, reason: string }}
 */
export function mergePacks(base, incoming) {
  if (!sameQuiz(base, incoming)) return { ok: false, reason: 'The two packs do not have the same quiz_id.' };

  const byNumber = new Map();
  const unnumbered = [];
  const replaced = [];
  let added = 0;
  for (const q of questionsOf(base)) {
    if (Number.isInteger(q.number)) byNumber.set(q.number, q);
    else unnumbered.push(q);
  }
  for (const q of questionsOf(incoming)) {
    if (!Number.isInteger(q.number)) { unnumbered.push(q); added++; continue; }
    if (byNumber.has(q.number)) {
      if (JSON.stringify(byNumber.get(q.number)) !== JSON.stringify(q)) replaced.push(q.number);
    } else {
      added++;
    }
    byNumber.set(q.number, q);
  }

  const numbered = [...byNumber.entries()].sort((a, b) => a[0] - b[0]).map(([, q]) => q);
  const meta = { ...metaOf(base), ...metaOf(incoming), part: 1, total_parts: 1 };
  const topics = mergeTopics(metaOf(base).topics, metaOf(incoming).topics);
  if (topics.length > 0) meta.topics = topics;

  const pack = { ...(isPlainObject(base) ? base : {}), ...(isPlainObject(incoming) ? incoming : {}), meta, questions: [...numbered, ...unnumbered] };
  return { ok: true, pack, replaced: replaced.sort((a, b) => a - b), added };
}

// ===========================================================================
// The parts loaded so far (P7-04)
// ===========================================================================

/**
 * @typedef {{
 *   quizId: string, pack: any, repaired: boolean,
 *   parts: Record<number, boolean>,     part number -> true once a COMPLETE copy of it has been loaded
 *   totalParts: number,
 * }} Assembly
 * @typedef {{ loaded: number, total: number | null, missing: number[], complete: boolean,
 *             partsLoaded: number, totalParts: number, multiPart: boolean, salvaged: boolean }} AssemblyStatus
 */

/** A part counts as loaded when it arrived whole: a part that was cut off (salvaged) does not count until a complete copy comes. */
function noteParts(parts, result) {
  const n = partNumber(result.pack);
  const whole = !result.salvaged;
  return { ...parts, [n]: Boolean(parts[n]) || whole };
}

/**
 * Add a loadable pack (`loadInput` result with `ok: true`) to the parts loaded so far.
 *  - `assembly` null, or a different `quiz_id`: the pack starts a new assembly (`merged: false`; `replacedOther` tells the UI the old one was dropped).
 *  - the same `quiz_id`: the two are merged (P7-04) and validated again as one pack.
 * Returns a loadInput-shaped `result` for the merged pack, so the screens do not need to know about merging.
 * @param {Assembly | null} assembly
 * @param {{ pack: any, warnings: any[], errors: any[], repaired: boolean, salvaged?: { kept: number } | null }} incoming
 * @returns {{ assembly: Assembly, result: any, merged: boolean, replacedOther: boolean, replaced: number[], added: number, status: AssemblyStatus }}
 */
export function addToAssembly(assembly, incoming) {
  const quizId = hasText(metaOf(incoming.pack).quiz_id) ? metaOf(incoming.pack).quiz_id : '';

  if (!assembly || !sameQuiz(assembly.pack, incoming.pack)) {
    const next = {
      quizId,
      pack: incoming.pack,
      repaired: Boolean(incoming.repaired),
      parts: noteParts({}, incoming),
      totalParts: totalPartsOf(incoming.pack),
    };
    return {
      assembly: next,
      result: { ...incoming, salvaged: incoming.salvaged ?? null },
      merged: false,
      replacedOther: Boolean(assembly),
      replaced: [],
      added: questionsOf(incoming.pack).length,
      status: assemblyStatus(next, incoming),
    };
  }

  const merge = mergePacks(assembly.pack, incoming.pack);
  const pack = merge.pack;
  const { errors, warnings } = validatePack(pack);
  const next = {
    quizId: assembly.quizId,
    pack,
    repaired: assembly.repaired || Boolean(incoming.repaired),
    parts: noteParts(assembly.parts, incoming),
    totalParts: Math.max(assembly.totalParts, totalPartsOf(incoming.pack)),
  };
  const result = { kind: 'pack', pack, ok: errors.length === 0, errors, warnings, repaired: next.repaired, salvaged: incoming.salvaged ?? null };
  return { assembly: next, result, merged: true, replacedOther: false, replaced: merge.replaced, added: merge.added, status: assemblyStatus(next, incoming) };
}

/**
 * "Loaded 97 of 130" and "Parts loaded: 2 of 3" for the Topics preview.
 * @param {Assembly} assembly
 * @param {{ salvaged?: any }} [latest]  the result that was just added (tells whether it was cut off)
 * @returns {AssemblyStatus}
 */
export function assemblyStatus(assembly, latest = {}) {
  const c = completeness(assembly.pack);
  const partsLoaded = Object.values(assembly.parts).filter(Boolean).length;
  return {
    ...c,
    partsLoaded,
    totalParts: assembly.totalParts,
    multiPart: assembly.totalParts > 1,
    salvaged: Boolean(latest && latest.salvaged),
  };
}

/**
 * One sentence for the Topics preview about what `addToAssembly` just did, or '' when there is nothing to say.
 * @param {ReturnType<typeof addToAssembly>} step
 */
export function describeAddition(step) {
  if (step.replacedOther) return 'This pack has a different quiz_id from the one that was loaded before, so it replaced it.';
  if (!step.merged) return '';
  const n = step.added;
  let text = `Added to the questions already loaded (same quiz_id): ${n} new ${n === 1 ? 'question' : 'questions'}.`;
  if (step.replaced.length > 0) text += ` Replaced the earlier version of ${step.replaced.length === 1 ? 'question' : 'questions'} ${formatRanges(step.replaced)}.`;
  return text;
}
