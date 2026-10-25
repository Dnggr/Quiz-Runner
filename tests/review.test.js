import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewItems, filterReviewItems, reviewCounts, REVIEW_FILTERS, DEFAULT_REVIEW_FILTER } from '../js/review.js';
import { gradeExam } from '../js/grader.js';
import { loadInput } from '../js/loader.js';
import { basePack, readSample } from './helpers.js';

// basePack answers: 1 B (t1) · 2 D (t1) · 3 A (t2) · 4 C (t2)
function reviewOf(pack, picks, flagged = []) {
  const responses = {};
  for (const q of pack.questions) responses[q.number] = { selected: picks[q.number] ?? null, unsure: flagged.includes(q.number) };
  const graded = gradeExam(pack, responses);
  return buildReviewItems(pack, graded.outcomes);
}

test('P3-07 each item carries question, your answer, correct answer, explanation, topic name and concept', () => {
  const [i1, i2, i3] = reviewOf(basePack(), { 1: 'B', 2: 'A' }, [2]);
  assert.deepEqual(i1, {
    number: 1, type: 'mc', outcome: 'correct', unsure: false, topicId: 't1', topicName: 'One', concept: 'Concept 1',
    question: 'Question text 1?', selected: 'B', selectedText: 'b', answer: 'B', answerText: 'b', explanation: 'Because B.',
  });
  assert.equal(i2.outcome, 'wrong');
  assert.equal(i2.unsure, true);
  assert.deepEqual([i2.selected, i2.selectedText, i2.answer, i2.answerText], ['A', 'a', 'D', 'd']);
  assert.equal(i3.outcome, 'skipped');
  assert.deepEqual([i3.selected, i3.selectedText], [null, '']);
  assert.equal(i3.topicName, 'Two');
});

test('P3-07 True/False items show True/False as the answer texts', () => {
  const pack = loadInput(readSample('sample-pack.json')).pack;
  const items = reviewOf(pack, { 6: 'False' });
  const tf = items.find((i) => i.number === 6);
  assert.deepEqual([tf.type, tf.selected, tf.selectedText, tf.answer, tf.answerText, tf.outcome], ['tf', 'False', 'False', 'True', 'True', 'wrong']);
});

test('P3-07 missing concept becomes "", unknown topic id falls back to the id, junk input does not throw', () => {
  const pack = basePack();
  delete pack.questions[0].concept;
  pack.questions[1].topic = 'zz';
  const items = reviewOf(pack, {});
  assert.equal(items[0].concept, '');
  assert.equal(items[1].topicName, 'zz');
  assert.deepEqual(buildReviewItems(null, null), []);
  assert.equal(buildReviewItems({}, [{ number: 9, outcome: 'skipped', selected: null, unsure: false }])[0].question, '');
});

test('P3-07 filters: Wrong and Skipped are outcomes; Unsure is the flag on any outcome; All is everything', () => {
  // 1 correct+unsure, 2 wrong+unsure, 3 skipped+unsure, 4 wrong
  const items = reviewOf(basePack(), { 1: 'B', 2: 'A', 4: 'A' }, [1, 2, 3]);
  const nums = (f) => filterReviewItems(items, f).map((i) => i.number);
  assert.deepEqual(nums('wrong'), [2, 4]);
  assert.deepEqual(nums('skipped'), [3]);
  assert.deepEqual(nums('unsure'), [1, 2, 3]);
  assert.deepEqual(nums('all'), [1, 2, 3, 4]);
  assert.deepEqual(nums('nonsense'), [1, 2, 3, 4]);
  assert.deepEqual(reviewCounts(items), { wrong: 2, unsure: 3, skipped: 1, all: 4 });
});

test('P3-07 chip order is Wrong · Unsure · Skipped · All, and Wrong is the default', () => {
  assert.deepEqual(REVIEW_FILTERS.map((f) => f.label), ['Wrong', 'Unsure', 'Skipped', 'All']);
  assert.equal(DEFAULT_REVIEW_FILTER, 'wrong');
});

test('P3-07 filtering does not change the items or their order', () => {
  const items = reviewOf(basePack(), {});
  const copy = JSON.stringify(items);
  filterReviewItems(items, 'skipped');
  assert.equal(JSON.stringify(items), copy);
});
