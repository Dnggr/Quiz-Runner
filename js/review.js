// review.js — data for Results > Review (P3-07, P3-08). Pure module: no DOM.
// Joins the pack (question text, options, explanation, topic, concept) with the graded outcomes.
// It is only ever called after the exam is finished: it is the one place that puts answers next to questions.

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** Filter chips, in display order. `unsure` is the flag (any outcome); the other two are outcomes. */
export const REVIEW_FILTERS = Object.freeze([
  Object.freeze({ id: 'wrong', label: 'Wrong' }),
  Object.freeze({ id: 'unsure', label: 'Unsure' }),
  Object.freeze({ id: 'skipped', label: 'Skipped' }),
  Object.freeze({ id: 'all', label: 'All' }),
]);
export const DEFAULT_REVIEW_FILTER = 'wrong';

/**
 * @typedef {{
 *   number: number, type: 'mc' | 'tf', outcome: 'correct' | 'wrong' | 'skipped', unsure: boolean,
 *   topicId: string, topicName: string, concept: string,
 *   question: string, selected: string | null, selectedText: string, answer: string, answerText: string,
 *   explanation: string,
 * }} ReviewItem
 */

/** Text of the option `value` of question `q` ("True"/"False" for tf). Empty when it has none. */
function optionText(q, value) {
  if (value === null || value === undefined) return '';
  if (q.type === 'tf') return String(value);
  return isPlainObject(q.options) && value in q.options ? String(q.options[value] ?? '') : '';
}

/**
 * @param {{ meta?: object, questions: object[] }} pack  a normalized, valid pack
 * @param {{ number: number, outcome: string, selected: string | null, unsure: boolean }[]} outcomes  from gradeExam, in pack order
 * @returns {ReviewItem[]}  one per outcome, in the same order. Topic falls back to its id, then to "".
 */
export function buildReviewItems(pack, outcomes) {
  const questions = isPlainObject(pack) && Array.isArray(pack.questions) ? pack.questions.filter(isPlainObject) : [];
  const byNumber = new Map(questions.map((q) => [q.number, q]));
  const topics = isPlainObject(pack) && isPlainObject(pack.meta) && Array.isArray(pack.meta.topics) ? pack.meta.topics : [];
  const topicNames = new Map(topics.filter(isPlainObject).map((t) => [str(t.id), str(t.name) || str(t.id)]));

  return (Array.isArray(outcomes) ? outcomes : []).map((o) => {
    const q = byNumber.get(o.number) || {};
    const topicId = str(q.topic);
    return {
      number: o.number,
      type: q.type === 'tf' ? 'tf' : 'mc',
      outcome: o.outcome,
      unsure: o.unsure === true,
      topicId,
      topicName: topicNames.get(topicId) || topicId,
      concept: str(q.concept),
      question: String(q.question ?? ''),
      selected: o.selected ?? null,
      selectedText: optionText(q, o.selected),
      answer: String(q.answer ?? ''),
      answerText: optionText(q, q.answer),
      explanation: String(q.explanation ?? ''),
    };
  });
}

/** Items for one chip. Unknown filter ids behave like "all". */
export function filterReviewItems(items, filter) {
  switch (filter) {
    case 'wrong': return items.filter((i) => i.outcome === 'wrong');
    case 'skipped': return items.filter((i) => i.outcome === 'skipped');
    case 'unsure': return items.filter((i) => i.unsure);
    default: return items.slice();
  }
}

/** Number shown on each chip. */
export function reviewCounts(items) {
  return {
    wrong: filterReviewItems(items, 'wrong').length,
    unsure: filterReviewItems(items, 'unsure').length,
    skipped: filterReviewItems(items, 'skipped').length,
    all: items.length,
  };
}
