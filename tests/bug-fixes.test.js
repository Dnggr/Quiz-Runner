// Tests for BUG-09 (stored pack must fit the exam), BUG-10 and BUG-16 (quiz id numbering) from the 2026-10-31 audit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextQuizNumber, nextQuizId } from '../js/receipt.js';
import { buildPrompt } from '../js/promptBuilder.js';
import { packFitsEntry, snapshotFromHistoryEntry } from '../js/analytics.js';
import { loadSnapshots, rebuildLatestReceipt, prepareProfileReceipt, readHistory } from '../js/history.js';
import { openProblem, OPEN_PROBLEMS } from '../js/progress.js';
import { packKey } from '../js/constants.js';
import { newStore, packWith, takeExam, answers } from './helpers.js';

const topics = (...pairs) => pairs.map(([id, name]) => ({ id, name }));
const nextId = (snaps, subject, mode = 'initial') => nextQuizId(subject, mode, nextQuizNumber(snaps, subject));

// ---- BUG-16 ----------------------------------------------------------------------------------------------------------
test('BUG-16 after an exam is deleted, the next quiz id is above the highest one left, not a repeat', () => {
  assert.equal(nextId([{ quiz_id: 'networks-initial-02', subject: 'Networks' }], 'Networks'), 'networks-initial-03');
  assert.equal(nextId([{ quiz_id: 'networks-initial-01', subject: 'Networks' }, { quiz_id: 'networks-targeted-03', subject: 'Networks' }], 'Networks'), 'networks-initial-04');
});
test('BUG-16 the Prompt Builder gives the new prompt that id', () => {
  const built = buildPrompt({ mode: 'initial', subject: 'Networks', count: 130 }, { snapshots: [{ quiz_id: 'networks-initial-02', subject: 'Networks' }] });
  assert.equal(built.ok, true);
  assert.equal(built.meta.quizId, 'networks-initial-03');
  assert.equal(built.meta.quizNumber, 3);
});
test('BUG-16 the old rule still holds: no exams -> 01; ids that do not follow the pattern still count', () => {
  assert.equal(nextQuizNumber([], 'Networks'), 1);
  assert.equal(nextQuizNumber(undefined, 'Networks'), 1);
  const snaps = [{ quiz_id: 'a', subject: 'Networks' }, { quiz_id: 'a', subject: 'networks ' }, { quiz_id: 'b', subject: 'Networks' }, { quiz_id: 'c', subject: 'DB' }];
  assert.equal(nextQuizNumber(snaps, 'NETWORKS'), 3);
  assert.equal(nextQuizNumber([null, 5, { quiz_id: 7 }], 'Networks'), 1);   // junk entries are ignored
});

// ---- BUG-10 ----------------------------------------------------------------------------------------------------------
test('BUG-10 subjects that share a slug share one counter, so their ids never collide', () => {
  assert.equal(nextId([{ quiz_id: 'c-initial-01', subject: 'C++' }], 'C#'), 'c-initial-02');
  assert.equal(nextId([{ quiz_id: 'quiz-initial-01', subject: '数学' }], '物理'), 'quiz-initial-02');
  assert.equal(nextId([{ quiz_id: 'c-initial-01', subject: 'C++' }, { quiz_id: 'c-initial-02', subject: 'C#' }], 'C'), 'c-initial-03');
});
test('BUG-10 an id of another slug is not counted ("c-sharp-..." does not belong to "c"; a regex character in a slug is harmless)', () => {
  assert.equal(nextQuizNumber([{ quiz_id: 'c-sharp-initial-07', subject: 'C Sharp' }], 'C'), 1);
  assert.equal(nextQuizNumber([{ quiz_id: 'quizXinitial-05', subject: 'x' }], '???'), 1);
});

// ---- BUG-09 ----------------------------------------------------------------------------------------------------------
const take = (store, pack, at, right) => takeExam(store, pack, at, answers(pack, right));

test('BUG-09 packFitsEntry: same pack fits; other answers, other topic ids, other length or no outcomes do not', () => {
  const { store } = newStore();
  const pack = packWith('shared-01', topics(['t1', 'Alpha'], ['t2', 'Beta']));
  take(store, pack, '2026-10-01T10:00:00.000Z', [1, 2]);
  const [entry] = readHistory(store).entries;
  assert.equal(packFitsEntry(entry, pack), true);
  const otherAnswer = structuredClone(pack); otherAnswer.questions[0].answer = 'C';
  const otherTopic = structuredClone(pack); otherTopic.questions[0].topic = 't2';
  const shorter = structuredClone(pack); shorter.questions.pop();
  assert.equal(packFitsEntry(entry, otherAnswer), false);
  assert.equal(packFitsEntry(entry, otherTopic), false);
  assert.equal(packFitsEntry(entry, shorter), false);
  assert.equal(packFitsEntry({ ...entry, outcomes: [] }, pack), false);
  for (const junk of [null, 5, {}, { outcomes: [null] }]) assert.equal(packFitsEntry(junk, pack), false);
  assert.equal(packFitsEntry(entry, null), false);
});

test('BUG-09 an older exam does not take the topic names of a different pack saved under the same quiz id', () => {
  const { store } = newStore();
  const first = packWith('shared-01', topics(['t1', 'Alpha'], ['t2', 'Beta']));
  take(store, first, '2026-10-01T10:00:00.000Z', [1, 2]);
  const second = packWith('shared-01', topics(['t1', 'Gamma'], ['t9', 'Delta']));   // other topic id, so a different exam
  take(store, second, '2026-10-02T10:00:00.000Z', [1, 2, 3, 4]);
  const [a, b] = loadSnapshots(store);
  assert.deepEqual(a.topics, [], 'the first exam keeps its score but shows no topics');
  assert.equal(a.percent, 50);
  assert.deepEqual(b.topics.map((t) => t.name), ['Gamma', 'Delta']);
  assert.deepEqual(loadSnapshots(store).map((s) => s.quiz_id), ['shared-01', 'shared-01']);
});

test('BUG-09 the same pack taken twice still gives both exams their topics', () => {
  const { store } = newStore();
  const pack = packWith('same-01', topics(['t1', 'Alpha'], ['t2', 'Beta']));
  take(store, pack, '2026-10-01T10:00:00.000Z', [1]);
  take(store, pack, '2026-10-02T10:00:00.000Z', [1, 2, 3]);
  for (const s of loadSnapshots(store)) assert.deepEqual(s.topics.map((t) => t.name), ['Alpha', 'Beta']);
});

test('BUG-09 snapshotFromHistoryEntry: an imported exam still takes its topics from the receipt', () => {
  const entry = { id: 'x@1', quiz_id: 'x', title: 't', subject: 's', started_at: '2026-10-01T00:00:00.000Z', totals: { correct: 1, total: 2, percent: 50 }, outcomes: [],
    imported: { topics: [{ name: 'Imported', status: 'weak', accuracy: 0.5 }] } };
  assert.deepEqual(snapshotFromHistoryEntry(entry, packWith('x', topics(['t1', 'Other']))).topics.map((t) => t.name), ['Imported']);
});

test('BUG-09 the read-only view and the snapshot agree: a pack with another topic id is refused as a mismatch', () => {
  const { store } = newStore();
  const pack = packWith('shared-01', topics(['t1', 'Alpha'], ['t2', 'Beta']));
  take(store, pack, '2026-10-01T10:00:00.000Z', [1, 2]);
  const [entry] = readHistory(store).entries;
  assert.equal(openProblem(entry, pack), null);
  const other = structuredClone(pack); other.questions[1].topic = 't2';
  assert.equal(openProblem(entry, other), OPEN_PROBLEMS.mismatch);
});

test('BUG-09 a receipt is not rebuilt from a pack that belongs to another exam', () => {
  const { store } = newStore();
  const pack = packWith('shared-01', topics(['t1', 'Alpha'], ['t2', 'Beta']));
  take(store, pack, '2026-10-01T10:00:00.000Z', [1, 2]);
  assert.equal(rebuildLatestReceipt(store).ok, true);
  const other = packWith('shared-01', topics(['t1', 'Gamma'], ['t9', 'Delta']));
  store.set(packKey('shared-01'), other);   // e.g. a backup restored from another device
  const res = rebuildLatestReceipt(store);
  assert.equal(res.ok, false);
  assert.match(res.error, /belong to a different exam/);
  assert.equal(prepareProfileReceipt(store).ok, false, 'no exam on the device can be rebuilt, so there is no profile receipt either');
});

test('BUG-09 the profile receipt takes topics only from packs that fit their exam', () => {
  const { store } = newStore();
  const old = packWith('shared-01', topics(['t1', 'Alpha'], ['t2', 'Beta']));
  take(store, old, '2026-10-01T10:00:00.000Z', [1, 2]);
  const fresh = packWith('shared-01', topics(['t1', 'Gamma'], ['t9', 'Delta']));
  take(store, fresh, '2026-10-02T10:00:00.000Z', [1, 2, 3, 4]);
  const prepared = prepareProfileReceipt(store);
  assert.equal(prepared.ok, true);
  const text = prepared.build().markdown;
  assert.match(text, /Gamma/);
  assert.doesNotMatch(text, /Alpha/, 'the old exam adds nothing: its own pack is gone');
});

// Pins down a known limit (hand-off notes): a history entry stores no topic names, so a pack that keeps every number, answer
// and topic id but renames the topics cannot be told apart from the original. Closing this needs a history-entry change.
test('BUG-09 KNOWN LIMIT: a pack with only the topic names changed still fits the older exam', () => {
  const { store } = newStore();
  const first = packWith('shared-01', topics(['t1', 'Alpha'], ['t2', 'Beta']));
  take(store, first, '2026-10-01T10:00:00.000Z', [1, 2]);
  const renamed = packWith('shared-01', topics(['t1', 'Gamma'], ['t2', 'Delta']));
  take(store, renamed, '2026-10-02T10:00:00.000Z', [1, 2, 3, 4]);
  assert.deepEqual(loadSnapshots(store)[0].topics.map((t) => t.name), ['Gamma', 'Delta']);
});
