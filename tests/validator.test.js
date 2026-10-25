// P2-04: validator errors (block) and warnings (allow).
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePack } from '../js/validator.js';
import { normalizePack, loadInput } from '../js/loader.js';
import { basePack, readSample } from './helpers.js';

const codes = (issues) => issues.map((i) => i.code);
const run = (pack) => validatePack(normalizePack(pack));

test('a clean pack has no errors and no warnings', () => {
  assert.deepEqual(run(basePack()), { errors: [], warnings: [] });
});

// ---------------------------------------------------------------- errors

test('error: missing or empty `questions`, and non-object packs', () => {
  const p = basePack();
  delete p.questions;
  assert.deepEqual(codes(run(p).errors), ['no_questions']);
  p.questions = [];
  assert.deepEqual(codes(run(p).errors), ['no_questions']);
  p.questions = 'nope';
  assert.deepEqual(codes(run(p).errors), ['no_questions']);
  for (const bad of [null, undefined, 5, 'x', []]) assert.deepEqual(codes(validatePack(bad).errors), ['no_questions']);
});

test('error: missing `question`, `answer` and `topic` (each reported with its question number)', () => {
  const p = basePack();
  delete p.questions[0].question;
  delete p.questions[1].answer;
  p.questions[2].topic = '';
  const { errors } = run(p);
  assert.deepEqual(errors.map((e) => [e.code, e.number]), [
    ['missing_question', 1], ['missing_answer', 2], ['missing_topic', 3],
  ]);
  assert.match(errors[1].message, /Question 2/);
});

test('error: whitespace-only text counts as missing', () => {
  const p = basePack();
  p.questions[0].question = '   ';
  assert.deepEqual(codes(run(p).errors), ['missing_question']);
});

test('error: answer not among the options (mc), with the available letters in the message', () => {
  const p = basePack();
  p.questions[1].answer = 'E';
  const { errors } = run(p);
  assert.deepEqual(errors.map((e) => [e.code, e.number]), [['answer_not_in_options', 2]]);
  assert.match(errors[0].message, /"E"/);
  assert.match(errors[0].message, /A, B, C, D/);
});

test('error: mc question with no options cannot have its answer checked', () => {
  const p = basePack();
  delete p.questions[0].options;
  p.questions[0].type = 'mc';
  assert.deepEqual(codes(run(p).errors), ['answer_not_in_options']);
});

test('error: True/False answer must be True or False (with and without an options object)', () => {
  const p = basePack();
  p.questions[0] = { number: 1, type: 'tf', topic: 't1', question: 'Q?', answer: 'Maybe', explanation: 'x', concept: 'c' };
  assert.deepEqual(codes(run(p).errors), ['answer_not_in_options']);
  p.questions[0].answer = 'true';
  assert.deepEqual(run(p).errors, []);
  p.questions[0].options = { True: 'True', False: 'False' };           // options on a tf question are tolerated
  assert.deepEqual(run(p).errors, []);
  assert.deepEqual(run(p).warnings, []);
});

test('error: duplicate question numbers are reported once per number', () => {
  const p = basePack();
  p.questions[2].number = 1;
  p.questions[3].number = 1;
  const { errors } = run(p);
  assert.deepEqual(errors.map((e) => [e.code, e.number]), [['duplicate_number', 1]]);
  assert.match(errors[0].message, /positions 1 and 3/);
});

test('error: topic id not in meta.topics (also when meta.topics is missing, with a hint)', () => {
  const p = basePack();
  p.questions[0].topic = 't9';
  let { errors } = run(p);
  assert.deepEqual(errors.map((e) => [e.code, e.number]), [['unknown_topic', 1]]);
  delete p.meta.topics;
  errors = run(p).errors;
  assert.equal(errors.length, 4);
  assert.match(errors[0].message, /missing or empty/);
});

test('error: a question that is not an object is reported without crashing the rest', () => {
  const p = basePack();
  p.questions[1] = 'oops';
  p.questions[2] = null;
  const { errors } = run(p);
  assert.deepEqual(codes(errors), ['bad_question', 'bad_question']);
});

test('a question without a `number` is labelled by its position, and does not cause false duplicates', () => {
  const p = basePack();
  delete p.questions[0].number;
  delete p.questions[1].number;
  delete p.questions[0].answer;
  const { errors } = run(p);
  assert.deepEqual(codes(errors), ['missing_answer']);
  assert.equal(errors[0].number, null);
  assert.equal(errors[0].index, 0);
  assert.match(errors[0].message, /position 1/);
});

test('missing meta entirely: only the topic errors, no crash', () => {
  const p = basePack();
  delete p.meta;
  const { errors, warnings } = run(p);
  assert.ok(errors.every((e) => e.code === 'unknown_topic'));
  assert.deepEqual(warnings, []);
});

// ---------------------------------------------------------------- warnings

test('warning: count differs from meta.total_questions', () => {
  const p = basePack();
  p.meta.total_questions = 130;
  const { errors, warnings } = run(p);
  assert.deepEqual(errors, []);
  assert.deepEqual(codes(warnings), ['count_mismatch']);
  assert.match(warnings[0].message, /130/);
});

test('count check is skipped for one part of a multi-part pack (total_questions spans all parts)', () => {
  const p = basePack();
  p.meta.total_questions = 130;
  p.meta.part = 1;
  p.meta.total_parts = 3;
  assert.deepEqual(run(p).warnings, []);
});

test('warning: missing explanation / missing concept (per question)', () => {
  const p = basePack();
  delete p.questions[0].explanation;
  p.questions[1].explanation = '  ';
  delete p.questions[2].concept;
  const { errors, warnings } = run(p);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.map((w) => [w.code, w.number]), [
    ['missing_explanation', 1], ['missing_explanation', 2], ['missing_concept', 3],
  ]);
});

test('warning: option count other than 4 (3 and 5), but not for True/False', () => {
  const p = basePack();
  delete p.questions[0].options.D;
  p.questions[0].answer = 'B';
  p.questions[1].options.E = 'e';
  p.questions[3] = { number: 4, type: 'tf', topic: 't2', question: 'Q?', answer: 'True', explanation: 'x', concept: 'c' };
  const { errors, warnings } = run(p);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.map((w) => [w.code, w.number]), [['option_count', 1], ['option_count', 2]]);
});

test('warning: a correct letter above 40% (strictly above): exactly 40% -> no warning, 50% -> warning', () => {
  const mk = (answers) => {
    const p = basePack();
    const tmpl = p.questions[0];
    p.questions = answers.map((a, i) => ({ ...structuredClone(tmpl), number: i + 1, answer: a, topic: 't1' }));
    p.meta.total_questions = answers.length;
    return p;
  };
  assert.deepEqual(run(mk(['A', 'A', 'B', 'C', 'D'])).warnings, []);                               // A = 40%
  const w = run(mk(['A', 'A', 'A', 'B', 'C', 'D'])).warnings;                                      // A = 50%
  assert.deepEqual(codes(w), ['skewed_answers']);
  assert.match(w[0].message, /"A"/);
  assert.match(w[0].message, /50%/);
});

test('warnings never block: a pack with only warnings is `ok`', () => {
  const p = basePack();
  delete p.questions[0].explanation;
  const res = loadInput(JSON.stringify(p));
  assert.equal(res.kind, 'pack');
  assert.equal(res.ok, true);
  assert.equal(res.warnings.length, 1);
});

// ---------------------------------------------------------------- the sample files

test('samples: expected validator outcome for each pack in samples/ and samples/broken/', () => {
  const expected = {
    '04-missing-answer.json': [['missing_answer', 3]],
    '05-answer-not-in-options.json': [['answer_not_in_options', 2]],
    '06-duplicate-numbers.json': [['duplicate_number', 2]],
    '07-unknown-topic.json': [['unknown_topic', 3]],
  };
  for (const [file, want] of Object.entries(expected)) {
    const res = loadInput(readSample('broken', file));
    assert.equal(res.kind, 'pack', file);
    assert.equal(res.ok, false, file);
    assert.deepEqual(res.errors.map((e) => [e.code, e.number]), want, file);
  }
});
