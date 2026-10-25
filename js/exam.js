// exam.js — the exam's response model and rules (P3-01, P3-02, P3-04). Pure module: no DOM, no storage.
//
// A response is `{ selected: string | null, unsure: boolean }`, one per question, keyed by question number.
//   - `selected` is an option letter ('A'..) for `mc` questions and 'True' / 'False' for `tf` questions.
//   - `unsure` is the "Not sure" flag. It is separate from `selected` (PLAN.md D3).
// Every function returns new objects; nothing here mutates its input.
import { TRUE_FALSE_VALUES } from './constants.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * @typedef {{ selected: string | null, unsure: boolean }} Response
 * @typedef {Record<string | number, Response>} Responses
 * @typedef {{ number: number, type: 'mc' | 'tf', text: string, options: { value: string, text: string }[] }} ExamQuestion
 */

/**
 * What the exam screen is allowed to know about a question: number, type, text and options.
 * The answer, explanation, concept, topic, difficulty, skill and source are left out on purpose, so the
 * exam DOM can never contain them (AGENTS.md "No answers in the DOM during the exam"; P3-10).
 * @param {{ questions: object[] }} pack  a normalized, valid pack
 * @returns {ExamQuestion[]}  in pack order
 */
export function toExamQuestions(pack) {
  const questions = isPlainObject(pack) && Array.isArray(pack.questions) ? pack.questions.filter(isPlainObject) : [];
  return questions.map((q) => {
    const type = q.type === 'tf' ? 'tf' : 'mc';
    const options = type === 'tf'
      ? TRUE_FALSE_VALUES.map((value) => ({ value, text: value }))
      : Object.entries(isPlainObject(q.options) ? q.options : {})
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([value, text]) => ({ value, text: String(text ?? '') }));
    return { number: q.number, type, text: String(q.question ?? ''), options };
  });
}

/** A fresh response for every question: nothing selected, not flagged. */
export function createResponses(questions) {
  /** @type {Responses} */
  const responses = {};
  for (const q of questions) responses[q.number] = { selected: null, unsure: false };
  return responses;
}

/** Select an option. The "Not sure" flag is left as it is. Unknown question numbers are ignored. */
export function selectOption(responses, number, value) {
  const current = responses[number];
  if (!current) return responses;
  return { ...responses, [number]: { selected: value, unsure: current.unsure } };
}

/**
 * The "Not sure" button (P3-02):
 *   - no option selected  -> flag the question as unsure and advance (as the legacy flow does);
 *   - an option selected  -> toggle the flag and stay on the question.
 * @returns {{ responses: Responses, advance: boolean }}
 */
export function pressNotSure(responses, number) {
  const current = responses[number];
  if (!current) return { responses, advance: false };
  if (current.selected === null) {
    return { responses: { ...responses, [number]: { selected: null, unsure: true } }, advance: true };
  }
  return { responses: { ...responses, [number]: { selected: current.selected, unsure: !current.unsure } }, advance: false };
}

/**
 * Counts for the progress display and the finish confirmation (P3-04).
 * `unanswered` = nothing selected. `unsure` = every flagged question, selected or not.
 */
export function progressCounts(questions, responses) {
  let unanswered = 0;
  let unsure = 0;
  for (const q of questions) {
    const r = responses[q.number];
    if (!r || r.selected === null) unanswered++;
    if (r && r.unsure) unsure++;
  }
  return { total: questions.length, answered: questions.length - unanswered, unanswered, unsure };
}

/** Index (in `questions`) of the first question with nothing selected, or -1. */
export function firstUnansweredIndex(questions, responses) {
  return questions.findIndex((q) => !responses[q.number] || responses[q.number].selected === null);
}

/** Index (in `questions`) of the first question flagged "Not sure", or -1. */
export function firstUnsureIndex(questions, responses) {
  return questions.findIndex((q) => responses[q.number] && responses[q.number].unsure === true);
}
