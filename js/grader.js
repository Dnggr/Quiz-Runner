// grader.js — pack + responses -> per-question outcomes and totals (P3-05). Pure module: no DOM, no storage.
// Rules: docs/ai/RECEIPT_SPEC.md §1 (answer states) and §2 (rating).
//   correct = selected equals the answer · wrong = something else selected · skipped = nothing selected.
//   `unsure` is a separate flag on top of the outcome; it never changes it.
// Grading is deterministic and uses only the pack and the responses.
import { RATING_BANDS } from './constants.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * @typedef {'correct' | 'wrong' | 'skipped'} Outcome
 * @typedef {{ number: number, topic: string, selected: string | null, answer: string, outcome: Outcome, unsure: boolean }} QuestionResult
 * @typedef {{
 *   total: number, correct: number, wrong: number, skipped: number, unsure: number,
 *   percent: number, rating: string,
 * }} Totals
 */

/** Rating label for a percentage (0-100), from `RATING_BANDS` in constants.js. */
export function ratingForPercent(percent) {
  const band = RATING_BANDS.find((b) => percent >= b.min);
  return band ? band.label : RATING_BANDS[RATING_BANDS.length - 1].label;
}

/**
 * @param {{ questions: object[] }} pack  a normalized, valid pack (it holds the answers)
 * @param {Record<string | number, { selected: string | null, unsure: boolean }>} responses  keyed by question number;
 *   a missing entry counts as skipped and not unsure
 * @returns {{ outcomes: QuestionResult[], totals: Totals }}
 *   `outcomes` is in pack order. `totals.unsure` counts every flagged question, whatever its outcome.
 *   `totals.percent` = correct / total, one decimal (70, 72.3); the rating uses the unrounded value.
 */
export function gradeExam(pack, responses) {
  const questions = isPlainObject(pack) && Array.isArray(pack.questions) ? pack.questions.filter(isPlainObject) : [];
  const given = isPlainObject(responses) ? responses : {};

  let correct = 0;
  let wrong = 0;
  let skipped = 0;
  let unsure = 0;

  const outcomes = questions.map((q) => {
    const r = isPlainObject(given[q.number]) ? given[q.number] : {};
    const selected = typeof r.selected === 'string' && r.selected !== '' ? r.selected : null;
    const flagged = r.unsure === true;

    /** @type {Outcome} */
    let outcome;
    if (selected === null) outcome = 'skipped';
    else if (selected === q.answer) outcome = 'correct';
    else outcome = 'wrong';

    if (outcome === 'correct') correct++;
    else if (outcome === 'wrong') wrong++;
    else skipped++;
    if (flagged) unsure++;

    return { number: q.number, topic: q.topic, selected, answer: q.answer, outcome, unsure: flagged };
  });

  const total = outcomes.length;
  const exactPercent = total === 0 ? 0 : (100 * correct) / total;
  return {
    outcomes,
    totals: {
      total, correct, wrong, skipped, unsure,
      percent: Math.round(exactPercent * 10) / 10,
      rating: ratingForPercent(exactPercent),
    },
  };
}
