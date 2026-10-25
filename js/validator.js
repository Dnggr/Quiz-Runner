// validator.js — checks a (normalized) Quiz Pack. Pure module: no DOM, no I/O.
// Rules come from docs/ai/QUIZ_PACK_SPEC.md §7 and DEV_CHECKLIST P2-04.
//
//   ERRORS   block loading.   missing `questions` · missing `question` / `answer` / `topic`
//                             · answer not in options · duplicate `number` · topic id not in `meta.topics`
//   WARNINGS load anyway.     count ≠ `meta.total_questions` · missing `explanation` · any correct letter > 40%
//                             · option count ≠ 4 · missing `concept`
//
// Every issue carries the question number (or null for pack-level issues) so the error screen (P2-06)
// can group problems by question. Thresholds come from constants.js.
import { ANSWER_SKEW_MAX_SHARE, EXPECTED_OPTION_COUNT } from './constants.js';

/**
 * @typedef {{ code: string, message: string, number: number | null, index: number | null }} Issue
 *   `number` = the question's own `number` (null for pack-level issues or a question without one)
 *   `index`  = 0-based position in `questions` (null for pack-level issues)
 */

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasText = (v) => typeof v === 'string' && v.trim() !== '';
const TF_ANSWERS = ['True', 'False'];

/**
 * @param {any} pack  normally the output of `normalizePack`; works on raw packs too
 * @returns {{ errors: Issue[], warnings: Issue[] }}
 */
export function validatePack(pack) {
  /** @type {Issue[]} */ const errors = [];
  /** @type {Issue[]} */ const warnings = [];
  const error = (code, message, q = null, index = null) => errors.push({ code, message, number: numberOf(q), index });
  const warn = (code, message, q = null, index = null) => warnings.push({ code, message, number: numberOf(q), index });

  // ---- pack level ----------------------------------------------------------
  if (!isPlainObject(pack)) {
    error('no_questions', 'The pack has no "questions" list.');
    return { errors, warnings };
  }
  const questions = pack.questions;
  if (!Array.isArray(questions)) {
    error('no_questions', 'The pack has no "questions" list.');
    return { errors, warnings };
  }
  if (questions.length === 0) {
    error('no_questions', 'The "questions" list is empty.');
    return { errors, warnings };
  }

  const meta = isPlainObject(pack.meta) ? pack.meta : {};
  const topicIds = new Set(
    (Array.isArray(meta.topics) ? meta.topics : [])
      .filter((t) => isPlainObject(t) && hasText(t.id))
      .map((t) => t.id),
  );

  // ---- per question --------------------------------------------------------
  const firstIndexOfNumber = new Map();   // number -> index of first use
  const reportedDuplicate = new Set();

  questions.forEach((q, index) => {
    if (!isPlainObject(q)) {
      error('bad_question', `${label(q, index)} is not a question object.`, q, index);
      return;
    }
    const who = label(q, index);

    // required text fields
    if (!hasText(q.question)) error('missing_question', `${who} is missing its "question" text.`, q, index);
    if (!hasText(q.answer)) error('missing_answer', `${who} is missing its "answer".`, q, index);
    if (!hasText(q.topic)) error('missing_topic', `${who} is missing its "topic".`, q, index);

    // answer must be one of the options
    if (hasText(q.answer)) {
      if (q.type === 'tf') {
        if (!TF_ANSWERS.includes(q.answer)) {
          error('answer_not_in_options', `${who}: the answer "${q.answer}" must be "True" or "False".`, q, index);
        }
      } else {
        const letters = isPlainObject(q.options) ? Object.keys(q.options) : [];
        if (letters.length === 0) {
          error('answer_not_in_options', `${who}: the answer "${q.answer}" can't be checked because the question has no options.`, q, index);
        } else if (!letters.includes(q.answer)) {
          error('answer_not_in_options', `${who}: the answer "${q.answer}" is not among the options (${letters.join(', ')}).`, q, index);
        }
      }
    }

    // topic must exist in meta.topics
    if (hasText(q.topic) && !topicIds.has(q.topic)) {
      const hint = topicIds.size === 0 ? ' (meta.topics is missing or empty)' : '';
      error('unknown_topic', `${who}: the topic "${q.topic}" is not listed in meta.topics${hint}.`, q, index);
    }

    // duplicate numbers: one error per repeated number, pointing at both positions
    if (q.number !== undefined && q.number !== null) {
      if (firstIndexOfNumber.has(q.number)) {
        if (!reportedDuplicate.has(q.number)) {
          reportedDuplicate.add(q.number);
          error(
            'duplicate_number',
            `The question number ${q.number} is used more than once (questions at positions ${firstIndexOfNumber.get(q.number) + 1} and ${index + 1}).`,
            q,
            index,
          );
        }
      } else {
        firstIndexOfNumber.set(q.number, index);
      }
    }

    // ---- warnings that belong to one question ----------------------------
    if (!hasText(q.explanation)) warn('missing_explanation', `${who} has no explanation.`, q, index);
    if (!hasText(q.concept)) warn('missing_concept', `${who} has no concept tag.`, q, index);
    if (q.type !== 'tf' && isPlainObject(q.options)) {
      const count = Object.keys(q.options).length;
      if (count > 0 && count !== EXPECTED_OPTION_COUNT) {
        warn('option_count', `${who} has ${count} options instead of ${EXPECTED_OPTION_COUNT}.`, q, index);
      }
    }
  });

  // ---- warnings that belong to the whole pack ------------------------------
  const totalParts = Number.isFinite(meta.total_parts) ? meta.total_parts : 1;
  if (Number.isFinite(meta.total_questions) && totalParts <= 1 && meta.total_questions !== questions.length) {
    warn('count_mismatch', `meta.total_questions says ${meta.total_questions} but the pack has ${questions.length} questions.`);
  }

  const letterCounts = {};
  for (const q of questions) {
    if (isPlainObject(q) && q.type !== 'tf' && hasText(q.answer)) {
      letterCounts[q.answer] = (letterCounts[q.answer] || 0) + 1;
    }
  }
  for (const [letter, count] of Object.entries(letterCounts).sort()) {
    const share = count / questions.length;
    if (share > ANSWER_SKEW_MAX_SHARE) {
      warn(
        'skewed_answers',
        `The correct answer is "${letter}" for ${count} of ${questions.length} questions (${Math.round(share * 100)}%). It should be spread out, about 25% each.`,
      );
    }
  }

  return { errors, warnings };
}

function numberOf(q) {
  return isPlainObject(q) && Number.isInteger(q.number) ? q.number : null;
}

function label(q, index) {
  const n = numberOf(q);
  return n !== null ? `Question ${n}` : `The question at position ${index + 1}`;
}
