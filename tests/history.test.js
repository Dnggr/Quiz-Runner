import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoryEntry, readHistory, saveFinishedExam } from '../js/history.js';
import { buildSession } from '../js/session.js';
import { gradeExam } from '../js/grader.js';
import { createStore } from '../js/store.js';
import { selectOption } from '../js/exam.js';
import { STORAGE_PREFIX, STORAGE_KEYS, HISTORY_SCHEMA_VERSION, SPEC_VERSION, APP_VERSION, packKey } from '../js/constants.js';
import { basePack } from './helpers.js';

function fakeStorage() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}
const finished = (startedAt = '2026-10-25T10:00:00.000Z') => {
  const s = buildSession(basePack(), new Date(startedAt));
  s.responses = selectOption(selectOption(s.responses, 1, 'B'), 2, 'A');   // 1 correct, 2 wrong, 3 and 4 skipped
  s.finished = true;
  s.finished_at = '2026-10-25T10:20:00.000Z';
  return s;
};
const read = (storage, key) => JSON.parse(storage.data.get(STORAGE_PREFIX + key));

test('P3-09 buildHistoryEntry: ids, timestamps, versions, totals and per-question outcomes', () => {
  const s = finished();
  const graded = gradeExam(s.pack, s.responses);
  const e = buildHistoryEntry(s, graded);
  assert.deepEqual(
    { ...e, totals: undefined, outcomes: undefined },
    {
      entry_version: HISTORY_SCHEMA_VERSION, id: 'test-pack-01@2026-10-25T10:00:00.000Z', quiz_id: 'test-pack-01', title: 'Test pack',
      subject: 'Testing', quiz_type: 'custom', quiz_number: null, started_at: '2026-10-25T10:00:00.000Z',
      finished_at: '2026-10-25T10:20:00.000Z', spec_version: SPEC_VERSION, app_version: APP_VERSION, totals: undefined, outcomes: undefined,
    },
  );
  assert.equal(e.totals.correct, 1);
  assert.equal(e.outcomes.length, 4);
  assert.deepEqual(e.outcomes[1], { number: 2, topic: 't1', selected: 'A', answer: 'D', outcome: 'wrong', unsure: false });
});

test('P3-09 saveFinishedExam writes pack:<quiz_id> and the history array', () => {
  const storage = fakeStorage();
  const s = finished();
  const out = saveFinishedExam(createStore({ storage }), s, gradeExam(s.pack, s.responses));
  assert.deepEqual(out, { packSaved: true, historySaved: true });
  assert.ok(storage.data.has(STORAGE_PREFIX + 'pack:test-pack-01'));
  assert.equal(packKey('test-pack-01'), 'pack:test-pack-01');
  assert.deepEqual(read(storage, 'pack:test-pack-01'), s.pack);
  const history = read(storage, STORAGE_KEYS.history);
  assert.equal(history.length, 1);
  assert.equal(history[0].totals.percent, 25);
});

test('P3-09 saving the same attempt twice replaces it; a retake adds a second entry (oldest first)', () => {
  const storage = fakeStorage();
  const store = createStore({ storage });
  const a = finished('2026-10-25T10:00:00.000Z');
  saveFinishedExam(store, a, gradeExam(a.pack, a.responses));
  saveFinishedExam(store, a, gradeExam(a.pack, a.responses));
  assert.equal(read(storage, STORAGE_KEYS.history).length, 1);
  const b = finished('2026-10-26T09:00:00.000Z');
  saveFinishedExam(store, b, gradeExam(b.pack, b.responses));
  assert.deepEqual(read(storage, STORAGE_KEYS.history).map((e) => e.started_at), ['2026-10-25T10:00:00.000Z', '2026-10-26T09:00:00.000Z']);
  assert.deepEqual(readHistory(store).entries.length, 2);
});

test('P3-09 an unreadable history (not an array) is never overwritten; the pack is still saved', () => {
  const storage = fakeStorage();
  storage.setItem(STORAGE_PREFIX + STORAGE_KEYS.history, '{"oops":true}');
  const s = finished();
  const out = saveFinishedExam(createStore({ storage }), s, gradeExam(s.pack, s.responses));
  assert.deepEqual(out, { packSaved: true, historySaved: false });
  assert.equal(storage.data.get(STORAGE_PREFIX + STORAGE_KEYS.history), '{"oops":true}');
  assert.deepEqual(readHistory(createStore({ storage })), { entries: [], corrupt: true });
});

test('P3-09 storage unavailable: reports false for both, and the data is still readable for this page', () => {
  const store = createStore({ storage: null });
  const s = finished();
  assert.deepEqual(saveFinishedExam(store, s, gradeExam(s.pack, s.responses)), { packSaved: false, historySaved: false });
  assert.equal(readHistory(store).entries.length, 1);
});

test('P3-09 readHistory: nothing stored is an empty, healthy history; junk entries are dropped', () => {
  assert.deepEqual(readHistory(createStore({ storage: fakeStorage() })), { entries: [], corrupt: false });
  const storage = fakeStorage();
  storage.setItem(STORAGE_PREFIX + STORAGE_KEYS.history, JSON.stringify([null, 5, { id: 'x' }]));
  assert.deepEqual(readHistory(createStore({ storage })), { entries: [{ id: 'x' }], corrupt: false });
});
