import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeExam, ratingForPercent } from '../js/grader.js';
import { loadInput } from '../js/loader.js';
import { basePack, readSample } from './helpers.js';

// basePack answers: 1 B · 2 D · 3 A · 4 C (all mc)
const answers = { 1: 'B', 2: 'D', 3: 'A', 4: 'C' };
const respond = (sel, unsure = {}) => Object.fromEntries(
  [1, 2, 3, 4].map((n) => [n, { selected: sel[n] ?? null, unsure: unsure[n] === true }]),
);

test('P3-05 all correct', () => {
  const { outcomes, totals } = gradeExam(basePack(), respond(answers));
  assert.deepEqual(outcomes.map((o) => o.outcome), ['correct', 'correct', 'correct', 'correct']);
  assert.deepEqual(totals, { total: 4, correct: 4, wrong: 0, skipped: 0, unsure: 0, percent: 100, rating: 'Excellent' });
});

test('P3-05 all wrong', () => {
  const { totals } = gradeExam(basePack(), respond({ 1: 'A', 2: 'A', 3: 'B', 4: 'D' }));
  assert.deepEqual(totals, { total: 4, correct: 0, wrong: 4, skipped: 0, unsure: 0, percent: 0, rating: 'Needs work' });
});

test('P3-05 all skipped (also when responses are empty or missing)', () => {
  for (const responses of [respond({}), {}, undefined, null]) {
    const { outcomes, totals } = gradeExam(basePack(), responses);
    assert.ok(outcomes.every((o) => o.outcome === 'skipped' && o.selected === null && o.unsure === false));
    assert.deepEqual(totals, { total: 4, correct: 0, wrong: 0, skipped: 4, unsure: 0, percent: 0, rating: 'Needs work' });
  }
});

test('P3-05 mix: correct + wrong + skipped, outcomes keep pack order and carry topic, selected, answer', () => {
  const { outcomes, totals } = gradeExam(basePack(), respond({ 1: 'B', 2: 'A', 4: 'C' }));
  assert.deepEqual(outcomes, [
    { number: 1, topic: 't1', selected: 'B', answer: 'B', outcome: 'correct', unsure: false },
    { number: 2, topic: 't1', selected: 'A', answer: 'D', outcome: 'wrong', unsure: false },
    { number: 3, topic: 't2', selected: null, answer: 'A', outcome: 'skipped', unsure: false },
    { number: 4, topic: 't2', selected: 'C', answer: 'C', outcome: 'correct', unsure: false },
  ]);
  assert.deepEqual(totals, { total: 4, correct: 2, wrong: 1, skipped: 1, unsure: 0, percent: 50, rating: 'Needs work' });
});

test('P3-05 unsure is a separate flag: it never changes the outcome, and counts every flagged question', () => {
  const { outcomes, totals } = gradeExam(
    basePack(),
    respond({ 1: 'B', 2: 'A' }, { 1: true, 2: true, 3: true }),   // correct+unsure, wrong+unsure, skipped+unsure
  );
  assert.deepEqual(outcomes.map((o) => [o.outcome, o.unsure]), [
    ['correct', true], ['wrong', true], ['skipped', true], ['skipped', false],
  ]);
  assert.equal(totals.unsure, 3);
  assert.equal(totals.correct, 1);
});

test('P3-05 True/False questions are graded against "True" / "False"', () => {
  const pack = loadInput(readSample('sample-pack.json')).pack;
  const tf = pack.questions.find((q) => q.type === 'tf');
  assert.equal(tf.answer, 'True');
  const grade = (selected) => gradeExam(pack, { [tf.number]: { selected, unsure: false } }).outcomes.find((o) => o.number === tf.number).outcome;
  assert.equal(grade('True'), 'correct');
  assert.equal(grade('False'), 'wrong');
  assert.equal(grade(null), 'skipped');
});

test('P3-05 a selected value that is not the answer is wrong, even if it is not an option (corrupt data)', () => {
  const { outcomes } = gradeExam(basePack(), respond({ 1: 'Z' }));
  assert.equal(outcomes[0].outcome, 'wrong');
});

test('P3-05 matches the hand-made sample receipt (samples/sample-receipt.md): 7/10, 70%, Fair, 2 unsure', () => {
  const pack = loadInput(readSample('sample-pack.json')).pack;
  const wrongPick = { 4: 'A', 5: 'D' };                       // from the receipt's "missed" list
  const responses = {};
  for (const q of pack.questions) {
    responses[q.number] = { selected: wrongPick[q.number] ?? q.answer, unsure: false };
  }
  responses[6] = { selected: null, unsure: true };            // Q6: skipped and unsure
  responses[1].unsure = true;                                 // Q1: correct but unsure
  const { outcomes, totals } = gradeExam(pack, responses);
  assert.deepEqual(totals, { total: 10, correct: 7, wrong: 2, skipped: 1, unsure: 2, percent: 70, rating: 'Fair' });
  assert.deepEqual(outcomes.filter((o) => o.outcome !== 'correct').map((o) => o.number), [4, 5, 6]);
});

test('P3-05 percent has one decimal; the rating uses the exact value', () => {
  const pack = { questions: Array.from({ length: 130 }, (_, i) => ({ number: i + 1, topic: 't1', answer: 'A' })) };
  const responses = {};
  for (let i = 1; i <= 94; i++) responses[i] = { selected: 'A', unsure: false };
  const { totals } = gradeExam(pack, responses);
  assert.equal(totals.percent, 72.3);                         // 94/130, the RECEIPT_SPEC example
  assert.equal(totals.rating, 'Fair');
});

test('ratingForPercent follows RECEIPT_SPEC §2 band edges', () => {
  const cases = [[100, 'Excellent'], [90, 'Excellent'], [89.9, 'Good'], [75, 'Good'], [74.9, 'Fair'], [60, 'Fair'], [59.9, 'Needs work'], [0, 'Needs work']];
  for (const [p, label] of cases) assert.equal(ratingForPercent(p), label, String(p));
});

test('gradeExam with no questions does not divide by zero', () => {
  assert.deepEqual(gradeExam({ questions: [] }, {}).totals, { total: 0, correct: 0, wrong: 0, skipped: 0, unsure: 0, percent: 0, rating: 'Needs work' });
  assert.deepEqual(gradeExam(null, null).outcomes, []);
});
