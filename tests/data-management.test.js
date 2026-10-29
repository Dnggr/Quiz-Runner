// P6-10: delete one exam / clear all data. Also the store's new `keys()`, which clear-all and backup rely on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteExam, clearAllData, readHistory } from '../js/history.js';
import { createStore } from '../js/store.js';
import { buildProgress } from '../js/progress.js';
import { STORAGE_KEYS, STORAGE_PREFIX, packKey } from '../js/constants.js';
import { newStore, fakeStorage, packWith, takeExam, answers } from './helpers.js';

const topics = (...names) => names.map((name, i) => ({ id: `t${i + 1}`, name }));

function seeded() {
  const ctx = newStore();
  const a = packWith('q1', topics('Networks', 'Security'));
  const b = packWith('q2', topics('Storage', 'Cloud'));
  const ids = {
    a1: takeExam(ctx.store, a, '2026-10-01T10:00:00.000Z', answers(a, [1])),
    a2: takeExam(ctx.store, a, '2026-10-05T10:00:00.000Z', answers(a, [1, 2])),   // a retake of q1
    b1: takeExam(ctx.store, b, '2026-10-08T10:00:00.000Z', answers(b, [1, 2, 3])),
  };
  return { ...ctx, ids };
}

// ---- delete one exam ---------------------------------------------------------------------------------------------

test('P6-10 deleting an exam removes it from the history and its pack when nothing else needs it', () => {
  const { store, ids } = seeded();
  const res = deleteExam(store, ids.b1);
  assert.deepEqual([res.ok, res.saved, res.packRemoved], [true, true, true]);
  assert.equal(readHistory(store).entries.some((e) => e.quiz_id === 'q2'), false);
  assert.equal(store.get(packKey('q2'), null), null);
  assert.deepEqual(buildProgress(store).exams.map((e) => e.id), [ids.a2, ids.a1]);
});

test('P6-10 the pack stays while another attempt of the same quiz is still stored', () => {
  const { store, ids } = seeded();
  const first = deleteExam(store, ids.a1);
  assert.deepEqual([first.ok, first.packRemoved], [true, false]);
  assert.ok(store.get(packKey('q1')));
  assert.equal(buildProgress(store).exams.find((e) => e.id === ids.a2).canOpen, true);
  const last = deleteExam(store, ids.a2);
  assert.equal(last.packRemoved, true);
  assert.equal(store.get(packKey('q1'), null), null);
});

test('P6-10 it also changes the analysis: a deleted exam no longer counts in the trend, mastery or priority topics', () => {
  const { store, ids } = seeded();
  assert.equal(buildProgress(store).trend.points.length, 3);
  deleteExam(store, ids.a1);
  assert.equal(buildProgress(store).trend.points.length, 2);
});

test('P6-10 an unknown id, or a history that cannot be read, changes nothing', () => {
  const { store, ids } = seeded();
  const before = JSON.stringify(readHistory(store).entries);
  const unknown = deleteExam(store, 'nope@2026-01-01T00:00:00.000Z');
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /not in your history/);
  assert.equal(JSON.stringify(readHistory(store).entries), before);

  const bad = newStore();
  const raw = JSON.stringify({ not: 'an array' });
  bad.storage.setItem(STORAGE_PREFIX + STORAGE_KEYS.history, raw);
  const res = deleteExam(bad.store, ids.a1);
  assert.equal(res.ok, false);
  assert.match(res.error, /could not be read/);
  assert.equal(bad.storage.getItem(STORAGE_PREFIX + STORAGE_KEYS.history), raw);
});

test('P6-10 deleting an exam does not touch an unfinished exam or the settings', () => {
  const { store, ids } = seeded();
  store.set(STORAGE_KEYS.session, { quiz_id: 'q1', finished: false });
  store.set(STORAGE_KEYS.settings, { promptBuilder: { subject: 'S' } });
  deleteExam(store, ids.a1);
  deleteExam(store, ids.a2);
  assert.deepEqual(store.get(STORAGE_KEYS.session), { quiz_id: 'q1', finished: false });
  assert.deepEqual(store.get(STORAGE_KEYS.settings), { promptBuilder: { subject: 'S' } });
});

test('P6-10 when the browser cannot save the deletion, it says so', () => {
  const storage = fakeStorage();
  const store = createStore({ storage });
  const a = packWith('q1', topics('Networks', 'Security'));
  const id = takeExam(store, a, '2026-10-01T10:00:00.000Z', answers(a, [1]));
  storage.setItem = () => { throw new Error('blocked'); };
  assert.equal(deleteExam(store, id).saved, false);
});

// ---- clear all data ----------------------------------------------------------------------------------------------

test('P6-10 clear all removes the history, every pack, the settings and an unfinished exam', () => {
  const { store, storage } = seeded();
  store.set(STORAGE_KEYS.session, { quiz_id: 'q1' });
  store.set(STORAGE_KEYS.settings, { a: 1 });
  store.set(packKey('orphan'), { questions: [] });   // a pack no exam points at
  const res = clearAllData(store);
  assert.deepEqual(res, { removed: 6, remaining: 0 });
  assert.equal(storage.data.size, 0);
  assert.deepEqual(buildProgress(store).exams, []);
});

test('P6-10 clear all leaves other apps\' data on the same origin alone', () => {
  const { store, storage } = seeded();
  storage.setItem('other-app:key', 'keep me');
  storage.setItem('qr:v2:future', 'not ours');
  clearAllData(store);
  assert.deepEqual([...storage.data.keys()].sort(), ['other-app:key', 'qr:v2:future']);
});

test('P6-10 clear all reports what the browser refused to remove', () => {
  const { store, storage } = seeded();
  storage.removeItem = () => { throw new Error('blocked'); };
  const res = clearAllData(store);
  assert.ok(res.remaining > 0);
});

test('P6-10 clear all on an empty device is harmless', () => {
  assert.deepEqual(clearAllData(newStore().store), { removed: 0, remaining: 0 });
});

// ---- store.keys --------------------------------------------------------------------------------------------------

test('store.keys lists the namespaced keys without the prefix, sorted, and not other apps\' keys or the probe', () => {
  const storage = fakeStorage();
  const s = createStore({ storage });
  s.set('settings', {});
  s.set('pack:b', {});
  s.set('history', []);
  storage.setItem('other:x', '1');
  s.isPersistent();   // writes and removes the probe
  assert.deepEqual(s.keys(), ['history', 'pack:b', 'settings']);
});

test('store.keys includes keys that live only in memory, and works when storage cannot be listed or is unavailable', () => {
  const full = createStore({ storage: fakeStorage({ quotaAfter: 0 }) });
  full.set('history', []);
  assert.deepEqual(full.keys(), ['history']);

  const { length, key, ...unlistable } = fakeStorage();
  const plain = createStore({ storage: { ...unlistable } });
  plain.set('a', 1);
  assert.deepEqual(plain.keys(), []);   // cannot be listed: nothing is invented

  const none = createStore({ storage: null });
  none.set('m', 1);
  assert.deepEqual(none.keys(), ['m']);
  none.remove('m');
  assert.deepEqual(none.keys(), []);
});

test('store.keys never throws when the storage does', () => {
  const broken = { length: 1, key() { throw new Error('boom'); }, getItem: () => null, setItem() {}, removeItem() {} };
  assert.deepEqual(createStore({ storage: broken }).keys(), []);
});
