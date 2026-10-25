// P2-07: the data behind the Topics preview screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePack } from '../js/packsummary.js';
import { loadInput } from '../js/loader.js';
import { basePack, readSample } from './helpers.js';

test('summarizes title, subject, count, topics with subtopics and per-topic counts', () => {
  const p = basePack();
  p.meta.subject = ' Networks ';
  p.meta.topics[0].subtopics = ['Alpha', 'Beta'];
  const s = summarizePack(p);
  assert.equal(s.title, 'Test pack');
  assert.equal(s.subject, 'Networks');
  assert.equal(s.questionCount, 4);
  assert.deepEqual(s.topics, [
    { id: 't1', name: 'One', subtopics: ['Alpha', 'Beta'], count: 2 },
    { id: 't2', name: 'Two', subtopics: [], count: 2 },
  ]);
});

test('difficulty mix: always easy, moderate, challenging in order; counts and rounded percentages', () => {
  const p = basePack();
  p.questions[0].difficulty = 'moderate';
  p.questions[1].difficulty = 'challenging';
  p.questions[2].difficulty = 'challenging';
  const s = summarizePack(p);
  assert.deepEqual(s.difficulty, [
    { level: 'easy', count: 1, percent: 25 },
    { level: 'moderate', count: 1, percent: 25 },
    { level: 'challenging', count: 2, percent: 50 },
  ]);
  assert.equal(s.untaggedDifficulty, 0);
});

test('questions with no or an unknown difficulty are counted separately, not dropped', () => {
  const p = basePack();
  delete p.questions[0].difficulty;
  p.questions[1].difficulty = 'impossible';
  const s = summarizePack(p);
  assert.equal(s.untaggedDifficulty, 2);
  assert.equal(s.difficulty.reduce((n, d) => n + d.count, 0), 2);
});

test('meta.notes: array of strings, a lenient single string, or nothing; blanks and non-strings dropped', () => {
  const p = basePack();
  p.meta.notes = ['  Only 8 topics supported ', '', 5, null, 'Second'];
  assert.deepEqual(summarizePack(p).notes, ['Only 8 topics supported', 'Second']);
  p.meta.notes = 'One note';
  assert.deepEqual(summarizePack(p).notes, ['One note']);
  p.meta.notes = { a: 1 };
  assert.deepEqual(summarizePack(p).notes, []);
  delete p.meta.notes;
  assert.deepEqual(summarizePack(p).notes, []);
});

test('missing title falls back; a topic without a name shows its id; a topic with no questions has count 0', () => {
  const p = basePack();
  delete p.meta.title;
  p.meta.topics[1] = { id: 't2' };
  p.meta.topics.push({ id: 't3', name: 'Empty topic', subtopics: 'not a list' });
  const s = summarizePack(p);
  assert.equal(s.title, 'Untitled Quiz Pack');
  assert.deepEqual(s.topics.map((t) => [t.id, t.name, t.count, t.subtopics]), [
    ['t1', 'One', 2, []],
    ['t2', 't2', 2, []],
    ['t3', 'Empty topic', 0, []],
  ]);
});

test('junk input never throws and yields an empty summary', () => {
  for (const bad of [null, undefined, 5, 'x', [], {}, { meta: 'x', questions: 'y' }]) {
    const s = summarizePack(bad);
    assert.equal(s.questionCount, 0);
    assert.deepEqual(s.topics, []);
    assert.deepEqual(s.notes, []);
    assert.equal(s.title, 'Untitled Quiz Pack');
  }
});

test('summary never exposes answers, explanations or option text', () => {
  const s = JSON.stringify(summarizePack(basePack()));
  assert.ok(!s.includes('Because'));
  assert.ok(!s.includes('"answer"'));
});

test('sample-pack.json: 10 questions, topics 4/3/3, difficulty 3/4/3, one note', () => {
  const r = loadInput(readSample('sample-pack.json'));
  const s = summarizePack(r.pack);
  assert.equal(s.questionCount, 10);
  assert.deepEqual(s.topics.map((t) => t.count), [4, 3, 3]);
  assert.ok(s.topics.every((t) => t.subtopics.length > 0));
  assert.deepEqual(s.difficulty.map((d) => d.count), [3, 4, 3]);
  assert.equal(s.notes.length, 1);
});
