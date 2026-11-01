// validator.js — checks a (normalized) Quiz Pack. Pure module: no DOM, no I/O.
// Rules come from docs/ai/QUIZ_PACK_SPEC.md §7 and DEV_CHECKLIST P2-04.
//
//   ERRORS   block loading.   missing `questions` · missing `question` / `answer` / `topic`
//                             · answer not in options · duplicate `number` · topic id not in `meta.topics`
//                             · `number` missing or not a whole number from 1 up (BUG-08)
//                             · an option that is empty or not text (BUG-12)
//                             · `meta.quiz_id` missing, blank or not text (BUG-23)
//   WARNINGS load anyway.     count ≠ `meta.total_questions` · missing `explanation` · any correct letter > 40%
//                             · option count ≠ 4 · missing `concept` · `version` ≠ SPEC_VERSION (P2-08)
//                             · the same topic id twice in `meta.topics` (BUG-12) · a `type` that is not mc / tf (BUG-15)
//                             · `quiz_type`, `difficulty` or `skill` outside the listed values (BUG-20)
//                             · `total_questions`, `part`, `total_parts` or `quiz_number` that is not a whole number (BUG-17)
//
// BUG-18: a wrong SHAPE (options as a list, a number as a topic id) is still an error, but the message names the real
// problem instead of "no options" / "missing topic". Same blocking rules as before; only the wording and two new codes.
//
// Every issue carries the question number (or null for pack-level issues) so the error screen (P2-06)
// can group problems by question: see `groupIssues`. Thresholds come from constants.js.
import {
  ANSWER_SKEW_MAX_SHARE, EXPECTED_OPTION_COUNT, SPEC_VERSION, QUIZ_TYPES, QUESTION_TYPES, DIFFICULTIES, SKILLS, ISSUE_EXAMPLE_NUMBERS,
} from './constants.js';

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

  // BUG-23: `meta.quiz_id` is required (QUIZ_PACK_SPEC §3.1) and is the key of the saved pack (`pack:<quiz_id>`), of the history
  // entry and of the receipt. Without it every such exam shares the key `pack:` and its receipt cannot be imported again.
  if (!hasText(meta.quiz_id)) {
    const why = meta.quiz_id === undefined || meta.quiz_id === null || typeof meta.quiz_id === 'string' ? 'it is missing or blank' : `it is ${kindOf(meta.quiz_id)}`;
    error('missing_quiz_id', `meta.quiz_id must be text that names this exam, such as "networks-initial-01", but ${why}. Without it the exam's saved questions and its receipt cannot be kept apart from other exams.`);
  }

  const topicEntries = Array.isArray(meta.topics) ? meta.topics : [];
  const usableTopics = topicEntries.filter((t) => isPlainObject(t) && hasText(t.id));
  const topicIds = new Set(usableTopics.map((t) => t.id));
  const topicsWithoutTextId = topicEntries.length - usableTopics.length;

  // BUG-12: the same topic id twice. Grading is not affected (a question names an id), but one of the two names is lost, so it is a warning.
  const seenTopicIds = new Set();
  const repeatedTopicIds = [];
  for (const t of usableTopics) {
    if (seenTopicIds.has(t.id) && !repeatedTopicIds.includes(t.id)) repeatedTopicIds.push(t.id);
    seenTopicIds.add(t.id);
  }
  for (const id of repeatedTopicIds) {
    warn('duplicate_topic_id', `meta.topics lists the id ${JSON.stringify(shortText(id))} more than once. Only one entry is used (the later one, with its name), so the other topic name is lost. Each topic needs its own id.`);
  }

  // ---- per question --------------------------------------------------------
  const firstIndexOfNumber = new Map();   // number -> index of first use
  const reportedDuplicate = new Set();

  questions.forEach((q, index) => {
    if (!isPlainObject(q)) {
      error('bad_question', `${label(q, index)} is not a question object.`, q, index);
      return;
    }
    const who = label(q, index);

    // BUG-08: `number` keys the answers and the grading, so a question without a usable one cannot be graded correctly
    if (!isQuestionNumber(q.number)) {
      error('bad_number', `${who} needs a "number" that is a whole number from 1 up (1, 2, 3 …), but ${describeNumber(q.number)}.`, q, index);
    }

    // required text fields
    if (!hasText(q.question)) error('missing_question', `${who} is missing its "question" text.`, q, index);
    if (!hasText(q.answer)) error('missing_answer', `${who} is missing its "answer".`, q, index);
    if (q.topic !== undefined && q.topic !== null && typeof q.topic !== 'string') {
      error('topic_not_text', `${who}: the "topic" must be the id text from meta.topics, such as "t1", but it is ${kindOf(q.topic)}.`, q, index);
    } else if (!hasText(q.topic)) {
      error('missing_topic', `${who} is missing its "topic".`, q, index);
    }

    // answer must be one of the options
    if (hasText(q.answer)) {
      if (q.type === 'tf') {
        if (!TF_ANSWERS.includes(q.answer)) {
          error('answer_not_in_options', `${who}: the answer "${q.answer}" must be "True" or "False".`, q, index);
        }
      } else {
        const letters = isPlainObject(q.options) ? Object.keys(q.options) : [];
        if (q.options !== undefined && q.options !== null && !isPlainObject(q.options)) {
          error('options_not_object', `${who}: "options" must be an object like { "A": "…", "B": "…" }, but it is ${kindOf(q.options)}, so the answer "${q.answer}" can't be checked.`, q, index);
        } else if (letters.length === 0) {
          error('answer_not_in_options', `${who}: the answer "${q.answer}" can't be checked because the question has no options.`, q, index);
        } else if (!letters.includes(q.answer)) {
          error('answer_not_in_options', `${who}: the answer "${q.answer}" is not among the options (${letters.join(', ')}).`, q, index);
        }
      }
    }

    // BUG-12: every option of a multiple-choice question must be text with something in it (a blank button cannot be answered or read)
    if (q.type !== 'tf' && isPlainObject(q.options)) {
      const bad = Object.entries(q.options).filter(([, v]) => !hasText(v)).map(([letter]) => letter);
      if (bad.length > 0) {
        const names = bad.map((l) => JSON.stringify(shortText(l))).join(', ');
        error('option_not_text', `${who}: ${bad.length === 1 ? `option ${names} is` : `options ${names} are`} empty or not text. Every option must be text.`, q, index);
      }
    }

    // topic must exist in meta.topics
    if (hasText(q.topic) && !topicIds.has(q.topic)) {
      let hint = '';
      if (topicEntries.length === 0) hint = ' (meta.topics is missing or empty)';
      else if (topicsWithoutTextId > 0) {
        const who = topicsWithoutTextId === topicEntries.length
          ? `none of the ${topicEntries.length} entries in meta.topics has an "id" written as text`
          : `${topicsWithoutTextId} of the ${topicEntries.length} entries in meta.topics have no "id" written as text`;
        hint = ` (${who}; ids must be text such as "t1")`;
      }
      error('unknown_topic', `${who}: the topic "${q.topic}" is not listed in meta.topics${hint}.`, q, index);
    }

    // duplicate numbers: one error per repeated number, pointing at both positions
    if (isQuestionNumber(q.number)) {
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
    if (hasText(q.type) && !QUESTION_TYPES.includes(q.type)) {
      warn('unknown_type', `${who} has the type ${JSON.stringify(shortText(q.type))}; it should be "mc" or "tf". It is treated as multiple choice.`, q, index);
    }
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
  if (pack.version !== SPEC_VERSION) {
    warn('version_mismatch', versionMessage(pack.version));
  }

  // BUG-20: fixed-value fields. A value outside the list is kept as written and only reported.
  if (hasText(meta.quiz_type) && !QUIZ_TYPES.includes(meta.quiz_type)) {
    warn('quiz_type_unknown', `meta.quiz_type is ${JSON.stringify(shortText(meta.quiz_type))}; it should be one of ${QUIZ_TYPES.join(', ')}. The pack still loads, and the value is kept as written.`);
  }
  for (const [field, allowed, effect] of [
    ['difficulty', DIFFICULTIES, 'They count as "no difficulty given".'],
    ['skill', SKILLS, 'They are kept as written.'],
  ]) {
    const odd = questions.map((q, index) => ({ q, index })).filter(({ q }) => isPlainObject(q) && hasText(q[field]) && !allowed.includes(q[field]));
    if (odd.length > 0) {
      warn(`${field}_unknown`, `${odd.length} ${odd.length === 1 ? 'question has' : 'questions have'} a "${field}" outside the listed values (${allowed.join(', ')}): ${examples(odd)}. ${effect}`);
    }
  }

  // BUG-17: a count or part number that is not a whole number is ignored by the app (nothing can be compared with it), so say so.
  for (const field of ['total_questions', 'part', 'total_parts', 'quiz_number']) {
    const v = meta[field];
    if (v !== undefined && v !== null && v !== '' && !(Number.isInteger(v) && v >= 1)) {
      warn('meta_number_invalid', `meta.${field} should be a whole number of 1 or more, but ${describeNumber(v)}. The app ignores it.`);
    }
  }

  const totalParts = Number.isFinite(meta.total_parts) ? meta.total_parts : 1;
  if (Number.isInteger(meta.total_questions) && meta.total_questions >= 1 && totalParts <= 1 && meta.total_questions !== questions.length) {   // BUG-17: an unusable count has its own warning
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

/** BUG-18: pack content is untrusted, so a wrong-shaped value is described by its kind only, never echoed. */
function kindOf(v) {
  if (Array.isArray(v)) return 'a list';
  if (isPlainObject(v)) return 'an object';
  if (typeof v === 'number') return 'a number';
  if (typeof v === 'boolean') return 'true or false';
  return 'text';
}

/** BUG-08: a question number is a whole number from 1 up (QUIZ_PACK_SPEC rule 10: numbered 1…N). */
const isQuestionNumber = (n) => Number.isInteger(n) && n >= 1;

/** BUG-08 / BUG-17: describes a value that should have been a whole number. Pack content is untrusted: only plain numbers are echoed. */
function describeNumber(v) {
  if (v === undefined || v === null || v === '') return 'there is none';
  if (typeof v === 'number') return Number.isFinite(v) ? `it is ${v}` : 'it is not a usable number';
  if (typeof v === 'string') return 'it is text that is not a whole number';
  return `it is ${kindOf(v)}`;
}

/** Pack text echoed into a message is cut short (it is untrusted and can be any length). */
const shortText = (v) => (String(v).length > 40 ? `${String(v).slice(0, 40)}…` : String(v));

/** `questions 3, 7, 12 …` for a pack-level warning; at most ISSUE_EXAMPLE_NUMBERS are named. A question without a usable number is named by its position. */
function examples(list) {
  const names = list.map(({ q, index }) => (isQuestionNumber(q.number) ? String(q.number) : `at position ${index + 1}`));
  return `question${names.length === 1 ? '' : 's'} ${names.slice(0, ISSUE_EXAMPLE_NUMBERS).join(', ')}${names.length > ISSUE_EXAMPLE_NUMBERS ? ' …' : ''}`;
}

function numberOf(q) {
  return isPlainObject(q) && Number.isInteger(q.number) ? q.number : null;
}

function label(q, index) {
  const n = numberOf(q);
  return n !== null ? `Question ${n}` : `The question at position ${index + 1}`;
}

/** P2-08: pack content is untrusted, so only plain scalars are echoed back. */
function versionMessage(version) {
  const tail = 'The pack will still load, but anything that changed between versions may not work as expected.';
  if (version === undefined || version === null || version === '') {
    return `The pack doesn't say which format version it uses (this app reads version ${SPEC_VERSION}). ${tail}`;
  }
  const shown = typeof version === 'string' || typeof version === 'number' || typeof version === 'boolean'
    ? JSON.stringify(version)
    : 'an unrecognized value';
  return `The pack says its format version is ${shown}, but this app reads version ${SPEC_VERSION}. ${tail}`;
}

/**
 * P2-06: group issues for display. Pack-level issues (no `index`) come first; then one group per question.
 * Groups are ordered by question number; a question without a usable number is listed by its
 * position in the file after the numbered ones.
 * @param {Issue[]} issues
 * @returns {{ pack: Issue[], questions: { number: number | null, index: number, label: string, issues: Issue[] }[] }}
 */
export function groupIssues(issues) {
  const pack = [];
  const groups = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (issue.index === null || issue.index === undefined) {
      pack.push(issue);
      continue;
    }
    const key = issue.number !== null ? `n${issue.number}` : `i${issue.index}`;
    if (!groups.has(key)) {
      groups.set(key, {
        number: issue.number,
        index: issue.index,
        label: issue.number !== null ? `Question ${issue.number}` : `Question at position ${issue.index + 1}`,
        issues: [],
      });
    }
    groups.get(key).issues.push(issue);
  }
  const questions = [...groups.values()].sort((a, b) => {
    if (a.number !== null && b.number !== null) return a.number - b.number || a.index - b.index;
    if (a.number !== null) return -1;
    if (b.number !== null) return 1;
    return a.index - b.index;
  });
  return { pack, questions };
}
