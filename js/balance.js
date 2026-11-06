// balance.js — spread the correct letters evenly after a pack loads (BUG-46, D53). Pure module: no DOM, no storage.
// AIs keep putting the right answer in "A" (49% in the owner's 150-question pack). QUIZ_PACK_SPEC rule 6 asks them not to,
// but the app cannot make them, so after a pack loads the app moves the options itself:
//   - about 25% each of A, B, C, D (as even as the questions that may move allow),
//   - never more than ANSWER_MAX_RUN identical correct letters in a row (when the questions that may move allow it),
//   - the order is pseudo-random, seeded from the pack's own content, so loading the same pack again gives the same
//     arrangement (a retake still fits the saved pack and the old exam's review, BUG-09 / D25).
// A question is left exactly as the AI wrote it ("fixed") when moving its options could make it wrong: an option or the
// explanation points at a letter or a position ("Option B swaps the two", "A and B", "all of the above", "the last option").
//
//   balanceAnswers(pack, { rng? })       -> { pack, report }   new pack; the input is never modified
//   balanceResult(result, { rng? })      -> { result, report } the same for a `loadInput` / `addToAssembly` result (warnings recomputed)
//   describeBalance(report)              -> one sentence for the Topics preview, or '' when nothing moved
//   answerCounts(pack), longestRun(list), isPositionDependent(question), seedFromPack(pack), seededRng(seed)
import { OPTION_LETTERS, ANSWER_MAX_RUN, BALANCE_MAX_ATTEMPTS } from './constants.js';
import { validatePack } from './validator.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---- which questions may move ------------------------------------------------------------------------------------

const KEYWORD_THEN_LETTER = /\b(?:options?|choices?|answers?|letters?|statements?|responses?)(?:\s+|\s*\(\s*)([A-Da-d])\b/gi;
const PARENTHESIZED_LETTER = /\(\s*[A-D]\s*\)/;
const LETTER_LIST = /\b[A-D]\s*(?:,|&|\/)\s*[A-D]\b|\b[A-D]\s+(?:and|or|to)\s+[A-D]\b/;
const ALL_NONE_OF = /\b(?:all|none|both|neither)\s+of\s+the\s+(?:above|following|these|options?|choices?)\b|\b(?:all|none)\s+of\s+(?:these|them)\b|\b(?:both|neither)\s+(?:options?|choices?|statements?|answers?)\b|\babove\s+(?:options?|choices?|statements?)\b/i;
const POSITION_WORD = /\b(?:first|second|third|fourth|last|previous|preceding|next)\s+(?:option|choice|answer|statement)s?\b/i;
const LETTER_PREFIX = /^\s*\(?[A-D][.):]\s/;

/**
 * True when a question's wording depends on where its options sit, so moving them could make it wrong or misleading:
 * the question, an option or the explanation names a letter ("Option B", "(C)", "A and B"), says "all of the above" /
 * "both options" / "the last option", or an option text starts with its own letter ("A. HTTP").
 * Deliberately cautious: a false positive only means the question keeps the AI's order.
 */
export function isPositionDependent(q) {
  if (!isPlainObject(q)) return false;
  const options = isPlainObject(q.options) ? Object.values(q.options) : [];
  if (options.some((o) => typeof o === 'string' && LETTER_PREFIX.test(o))) return true;
  const texts = [q.question, q.explanation, ...options].filter((t) => typeof t === 'string');
  return texts.some((t) => {
    for (const m of t.matchAll(KEYWORD_THEN_LETTER)) if (/[A-D]/.test(m[1])) return true;   // "option B", not "answer a student gives"
    return PARENTHESIZED_LETTER.test(t) || LETTER_LIST.test(t) || ALL_NONE_OF.test(t) || POSITION_WORD.test(t);
  });
}

/** A multiple-choice question with exactly the options A-D and an answer among them: its letter counts and it may move. */
function hasLetterAnswer(q) {
  if (!isPlainObject(q) || q.type === 'tf' || !isPlainObject(q.options)) return false;
  return typeof q.answer === 'string' && OPTION_LETTERS.includes(q.answer) && q.answer in q.options;
}
function canMove(q) {
  if (!hasLetterAnswer(q)) return false;
  const keys = Object.keys(q.options);
  if (keys.length !== OPTION_LETTERS.length || !OPTION_LETTERS.every((l) => keys.includes(l))) return false;
  if (!OPTION_LETTERS.every((l) => typeof q.options[l] === 'string')) return false;
  return !isPositionDependent(q);
}

// ---- counting ------------------------------------------------------------------------------------------------------

/** Correct-letter counts over the multiple-choice questions: `{ A, B, C, D }`. */
export function answerCounts(pack) {
  const counts = Object.fromEntries(OPTION_LETTERS.map((l) => [l, 0]));
  for (const q of questionsOf(pack)) if (hasLetterAnswer(q)) counts[q.answer]++;
  return counts;
}

/** Longest stretch of identical letters in a list. `null` (a question with no letter answer) breaks a run. */
export function longestRun(letters) {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const l of letters) {
    run = l !== null && l === prev ? run + 1 : (l === null ? 0 : 1);
    prev = l;
    if (run > best) best = run;
  }
  return best;
}

const questionsOf = (pack) => (isPlainObject(pack) && Array.isArray(pack.questions) ? pack.questions : []);
const lettersInOrder = (questions) => questions.map((q) => (hasLetterAnswer(q) ? q.answer : null));

// ---- seeded randomness ---------------------------------------------------------------------------------------------

/** FNV-1a hash of the pack's identity and content (quiz id, every question's text and answer) -> a 32-bit seed. */
export function seedFromPack(pack) {
  const meta = isPlainObject(pack) && isPlainObject(pack.meta) ? pack.meta : {};
  let text = `${meta.quiz_id ?? ''}|`;
  for (const q of questionsOf(pack)) {
    if (isPlainObject(q)) text += `${q.number}:${q.question ?? ''}:${q.answer ?? ''}|`;
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: a small seedable generator returning numbers in [0, 1). */
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---- the balancing -------------------------------------------------------------------------------------------------

/** How many questions of each letter the movable questions should get so that the whole pack is as even as it can be. */
function targetLetters(fixedCounts, movableCount, rng) {
  const have = { ...fixedCounts };
  const picks = [];
  for (let i = 0; i < movableCount; i++) {
    const low = Math.min(...OPTION_LETTERS.map((l) => have[l]));
    const candidates = OPTION_LETTERS.filter((l) => have[l] === low);
    const letter = candidates[Math.floor(rng() * candidates.length)];
    have[letter]++;
    picks.push(letter);
  }
  return picks;
}

/**
 * Move the options of a pack so the correct letters are spread evenly (see the top of the file).
 * Nothing changes when the pack is already even (counts differ by at most 1) and has no run above ANSWER_MAX_RUN, when fewer
 * than two questions may move, or when the pack has no multiple-choice questions.
 * @param {any} pack  a normalized, error-free pack
 * @param {{ rng?: () => number }} [options]  default: seeded from the pack, so the same pack always gives the same result
 * @returns {{ pack: any, report: {
 *   mc: number, movable: number, fixed: number, moved: number, changed: boolean,
 *   before: Record<string, number>, after: Record<string, number>, runBefore: number, runAfter: number,
 * } }}
 */
export function balanceAnswers(pack, { rng } = {}) {
  const questions = questionsOf(pack);
  const before = answerCounts(pack);
  const runBefore = longestRun(lettersInOrder(questions));
  const mcIndexes = questions.map((q, i) => (hasLetterAnswer(q) ? i : -1)).filter((i) => i >= 0);
  const movableIndexes = mcIndexes.filter((i) => canMove(questions[i]));

  const report = {
    mc: mcIndexes.length, movable: movableIndexes.length, fixed: mcIndexes.length - movableIndexes.length, moved: 0, changed: false,
    before, after: { ...before }, runBefore, runAfter: runBefore,
  };

  const counts = OPTION_LETTERS.map((l) => before[l]);
  const alreadyEven = Math.max(...counts) - Math.min(...counts) <= 1 && runBefore <= ANSWER_MAX_RUN;
  if (movableIndexes.length < 2 || alreadyEven) return { pack, report };

  const random = typeof rng === 'function' ? rng : seededRng(seedFromPack(pack));

  // Letters the questions that cannot move already use up.
  const fixedCounts = Object.fromEntries(OPTION_LETTERS.map((l) => [l, 0]));
  const movableSet = new Set(movableIndexes);
  for (const i of mcIndexes) if (!movableSet.has(i)) fixedCounts[questions[i].answer]++;

  const pool = targetLetters(fixedCounts, movableIndexes.length, random);

  // Random order of those letters over the movable questions; keep the order with the shortest runs (stop at the first one within the limit).
  let best = null;
  let bestRun = Infinity;
  for (let attempt = 0; attempt < BALANCE_MAX_ATTEMPTS; attempt++) {
    const order = shuffled(pool, random);
    const letters = lettersInOrder(questions);
    movableIndexes.forEach((qi, k) => { letters[qi] = order[k]; });
    const run = longestRun(letters);
    if (run < bestRun) { best = order; bestRun = run; }
    if (run <= ANSWER_MAX_RUN) break;
  }

  const next = questions.map((q) => q);
  let moved = 0;
  movableIndexes.forEach((qi, k) => {
    const q = questions[qi];
    const target = best[k];
    if (q.answer === target) return;                      // already in the right place: leave the AI's order alone
    const correctText = q.options[q.answer];
    const others = shuffled(OPTION_LETTERS.filter((l) => l !== q.answer).map((l) => q.options[l]), random);
    const options = {};
    let o = 0;
    for (const letter of OPTION_LETTERS) options[letter] = letter === target ? correctText : others[o++];
    next[qi] = { ...q, options, answer: target };
    moved++;
  });

  const out = { ...pack, questions: next };
  report.moved = moved;
  report.changed = moved > 0;
  report.after = answerCounts(out);
  report.runAfter = longestRun(lettersInOrder(next));
  return { pack: out, report };
}

/**
 * `balanceAnswers` for a loadable result (`loadInput` / `addToAssembly`): same result shape, with the pack balanced and the
 * warnings worked out again from it (so the "spread out, about 25% each" warning goes away when the app has fixed it, and stays
 * when it could not, because too many questions are fixed). A result with errors, or one that did not change, is returned as it is.
 */
export function balanceResult(result, options = {}) {
  if (!isPlainObject(result) || result.ok === false || !isPlainObject(result.pack)) return { result, report: null };
  const { pack, report } = balanceAnswers(result.pack, options);
  if (!report.changed) return { result, report };
  const { errors, warnings } = validatePack(pack);
  return { result: { ...result, pack, errors, warnings }, report };
}

/**
 * One sentence for the Topics preview. It names no letter and no answer (the preview never shows answers, P3-10).
 * @returns {string} '' when nothing moved
 */
export function describeBalance(report) {
  if (!report || !report.changed) return '';
  const noun = (n) => `${n} ${n === 1 ? 'question' : 'questions'}`;
  let text = `The answer choices were shuffled so the correct letter is spread evenly across A to D (${noun(report.moved)} of ${report.mc} moved).`;
  if (report.fixed > 0) {
    text += ` ${noun(report.fixed)} kept the AI's order because their wording refers to an option letter or position.`;
  }
  return text;
}
