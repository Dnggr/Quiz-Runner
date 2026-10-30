// Phase 7 — Resilience, the storage side: P7-05 storage full (message, backup, prune oldest) and P7-07 damaged session/history
// (offer a reset, never a blank page). The page itself was checked in a headless DOM by hand; these are the logic tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, isQuotaError } from '../js/store.js';
import { STORAGE_KEYS } from '../js/constants.js';
import { buildSession, loadSession, describeSession, saveSession } from '../js/session.js';
import { selectOption } from '../js/exam.js';
import { gradeExam } from '../js/grader.js';
import { saveFinishedExam, readHistory, loadSnapshots, rebuildLatestReceipt, prepareProfileReceipt, deleteExam, importReceipt } from '../js/history.js';
import { buildProgress, openPastExam } from '../js/progress.js';
import { buildBackup } from '../js/backup.js';
import {
  scanStoredData, damagedText, resetStoredKey, describeStorageFailure, storageUsage, prunablePacks, pruneOldestPack,
} from '../js/storagehealth.js';
import { fakeStorage, newStore, packWith, takeExam } from './helpers.js';

const TOPICS = [{ id: 't1', name: 'Alpha' }, { id: 't2', name: 'Beta' }, { id: 't3', name: 'Gamma' }];
const KEY = (k) => `qr:v1:${k}`;
const quotaError = () => Object.assign(new Error('full'), { name: 'QuotaExceededError' });

/** A store on a storage that is full once it holds `limit` characters (keys + values), like a browser's quota. */
function sizedStore(limit = Infinity) {
  const storage = fakeStorage();
  const set = storage.setItem;
  const used = () => [...storage.data].reduce((n, [k, v]) => n + k.length + v.length, 0);
  storage.setItem = (k, v) => {
    const old = storage.data.get(k);
    if (used() + k.length + String(v).length - (old === undefined ? 0 : k.length + old.length) > storage.limit) throw quotaError();
    set(k, v);
  };
  storage.limit = limit;
  storage.used = used;
  return { storage, store: createStore({ storage }) };
}

const fatPack = (id) => {
  const pack = packWith(id, TOPICS);
  for (const q of pack.questions) q.explanation = `${q.explanation || 'because'} ${'filler '.repeat(300)}`;
  return pack;
};

// ============================================================================================================
// store.js: what P7-05 / P7-07 rely on
// ============================================================================================================

test('P7-05 isQuotaError recognises the full-storage error of every browser, and nothing else', () => {
  assert.equal(isQuotaError({ name: 'QuotaExceededError' }), true);       // Chrome, Safari, Edge
  assert.equal(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }), true); // Firefox
  assert.equal(isQuotaError({ name: 'Error', code: 22 }), true);           // legacy code
  assert.equal(isQuotaError({ name: 'Error', code: 1014 }), true);         // legacy Firefox code
  assert.equal(isQuotaError({ name: 'SecurityError' }), false);
  assert.equal(isQuotaError(new Error('x')), false);
  assert.equal(isQuotaError(null), false);
  assert.equal(isQuotaError(undefined), false);
});

test('P7-05 a value that does not fit stays readable from memory and the listener hears why', () => {
  const { store } = newStore({ quotaAfter: 1 });
  const heard = [];
  store.onWriteFailure((f) => heard.push(f));
  assert.equal(store.set('a', 1), true);
  assert.equal(store.set('b', { x: 2 }), false);
  assert.deepEqual(store.get('b'), { x: 2 }, 'the value is not lost while the page stays open');
  assert.deepEqual(heard, [{ key: 'b', reason: 'quota' }]);
  assert.deepEqual(store.pendingKeys(), ['b']);
});

test('P7-05 other write failures are "blocked", and a missing localStorage is "unavailable"', () => {
  const storage = fakeStorage();
  storage.setItem = () => { throw Object.assign(new Error('no'), { name: 'SecurityError' }); };
  const blocked = createStore({ storage });
  const heardBlocked = [];
  blocked.onWriteFailure((f) => heardBlocked.push(f.reason));
  blocked.set('k', 1);
  assert.deepEqual(heardBlocked, ['blocked']);

  const none = createStore({ storage: null });
  const heardNone = [];
  none.onWriteFailure((f) => heardNone.push(f.reason));
  none.set('k', 1);
  assert.deepEqual(heardNone, ['unavailable']);
  assert.equal(none.get('k'), 1);
});

test('P7-05 a listener that throws, or one that unsubscribed, never breaks or hears a save', () => {
  const { store } = newStore({ quotaAfter: 0 });
  let calls = 0;
  store.onWriteFailure(() => { throw new Error('faulty listener'); });
  const off = store.onWriteFailure(() => { calls++; });
  assert.equal(store.set('a', 1), false, 'the save still reports its own result');
  assert.equal(calls, 1);
  off();
  store.set('b', 2);
  assert.equal(calls, 1);
});

test('P7-05 a value that cannot be written as JSON is not a storage problem: nobody is told "no room"', () => {
  const { store } = newStore();
  let calls = 0;
  store.onWriteFailure(() => { calls++; });
  const loop = {}; loop.self = loop;
  assert.equal(store.set('k', loop), false);
  assert.equal(calls, 0);
});

test('P7-05 flush saves what waited once there is room, and reports what still does not fit', () => {
  const { storage, store } = newStore({ quotaAfter: 1 });
  store.set('a', 1);
  store.set('b', 2);
  store.set('c', 3);
  assert.deepEqual(store.pendingKeys(), ['b', 'c']);
  assert.deepEqual(store.flush(), { saved: [], failed: ['b', 'c'] }, 'still full');
  store.remove('a');
  const res = store.flush();
  assert.deepEqual(res.saved, ['b'], 'one key of room: the first waiting key gets it');
  assert.deepEqual(res.failed, ['c']);
  assert.deepEqual(store.pendingKeys(), ['c']);
  assert.ok(storage.data.has(KEY('b')));
});

test('P7-07 inspect tells a missing key from an unreadable one and keeps the damaged text', () => {
  const { storage, store } = newStore();
  assert.deepEqual(store.inspect('nope'), { found: false, readable: true, value: null, raw: null, pending: false });
  store.set('ok', { a: 1 });
  assert.deepEqual(store.inspect('ok'), { found: true, readable: true, value: { a: 1 }, raw: null, pending: false });
  storage.data.set(KEY('bad'), '[{"id":"a"');
  assert.deepEqual(store.inspect('bad'), { found: true, readable: false, value: null, raw: '[{"id":"a"', pending: false });
  assert.equal(store.get('bad', 'fallback'), 'fallback', 'get is unchanged: it cannot tell the difference, which is why inspect exists');
});

test('P7-07 inspect: a value held only in memory is found and marked pending; a storage that throws is "not found", not "damaged"', () => {
  const { store } = newStore({ quotaAfter: 0 });
  store.set('k', [1]);
  assert.deepEqual(store.inspect('k'), { found: true, readable: true, value: [1], raw: null, pending: true });

  const storage = fakeStorage();
  storage.getItem = () => { throw Object.assign(new Error('denied'), { name: 'SecurityError' }); };
  const locked = createStore({ storage });
  assert.deepEqual(locked.inspect('k'), { found: false, readable: true, value: null, raw: null, pending: false });
  assert.equal(locked.size('k'), 0);
});

test('P7-05 size counts the stored characters, or the JSON of a value in memory', () => {
  const { store } = newStore({ quotaAfter: 1 });
  store.set('a', 'xxxx');
  store.set('b', 'yy');
  assert.equal(store.size('a'), JSON.stringify('xxxx').length);
  assert.equal(store.size('b'), JSON.stringify('yy').length, 'in memory');
  assert.equal(store.size('missing'), 0);
});

// ============================================================================================================
// P7-05: the message
// ============================================================================================================

test('P7-05 the message says what could not be saved, what that means, and only offers "make room" when the cause is a full storage', () => {
  const full = describeStorageFailure({ reason: 'quota', keys: [STORAGE_KEYS.history, 'pack:quiz-a'] });
  assert.equal(full.canMakeRoom, true);
  assert.match(full.title, /no room/i);
  assert.match(full.message, /your exam history and the questions of a finished exam/);
  assert.match(full.message, /refreshing or closing the page would lose it/);
  assert.match(full.message, /backup/i);
  assert.doesNotMatch(full.message, /exam in progress/, 'only mentioned when the exam in progress is what failed');

  const exam = describeStorageFailure({ reason: 'quota', keys: [STORAGE_KEYS.session] });
  assert.match(exam.message, /your exam progress/);
  assert.match(exam.message, /does not include an exam in progress/);

  const blocked = describeStorageFailure({ reason: 'blocked', keys: [STORAGE_KEYS.settings] });
  assert.equal(blocked.canMakeRoom, false);
  assert.match(blocked.message, /Prompt Builder options/);

  const off = describeStorageFailure({ reason: 'unavailable', keys: ['something'] });
  assert.equal(off.canMakeRoom, false);
  assert.match(off.title, /turned off/i);
  assert.match(off.message, /some data/);
});

// ============================================================================================================
// P7-05: pruning the oldest saved questions
// ============================================================================================================

function threeExams() {
  const ctx = newStore();
  const { store } = ctx;
  // quiz-b is the oldest quiz that was last taken in October; quiz-a was retaken last, so it is newer than quiz-c.
  takeExam(store, packWith('quiz-a', TOPICS), '2026-10-01T10:00:00.000Z', { 1: 'A' });
  takeExam(store, packWith('quiz-b', TOPICS), '2026-10-02T10:00:00.000Z', { 1: 'A' });
  takeExam(store, packWith('quiz-c', TOPICS), '2026-10-05T10:00:00.000Z', { 1: 'A' });
  takeExam(store, packWith('quiz-a', TOPICS), '2026-10-09T10:00:00.000Z', { 1: 'A' });
  return ctx;
}

test('P7-05 packs are listed oldest first, by the newest exam that used them (a retake keeps a pack young)', () => {
  const { store } = threeExams();
  const plan = prunablePacks(store);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.packs.map((p) => p.quizId), ['quiz-b', 'quiz-c', 'quiz-a']);
  assert.ok(plan.packs.every((p) => p.chars > 0 && p.orphan === false));
  assert.equal(plan.packs[0].title, 'Exam quiz-b');
});

test('P7-05 a pack no exam uses any more comes first; a pack that only lives in memory is never offered', () => {
  const { store } = threeExams();
  store.set('pack:left-over', packWith('left-over', TOPICS));
  assert.deepEqual(prunablePacks(store).packs.map((p) => p.quizId)[0], 'left-over');
  assert.equal(prunablePacks(store).packs[0].orphan, true);

  const { store: full } = newStore({ quotaAfter: 3 });
  takeExam(full, packWith('quiz-a', TOPICS), '2026-10-01T10:00:00.000Z', {});   // pack:quiz-a + history = 2 keys
  full.set('pack:waiting', packWith('waiting', TOPICS));                          // 3rd key fits
  full.set('pack:memory-only', packWith('memory-only', TOPICS));                  // 4th does not: memory only
  assert.deepEqual(full.pendingKeys(), ['pack:memory-only']);
  assert.ok(!prunablePacks(full).packs.some((p) => p.quizId === 'memory-only'), 'removing it would destroy the only copy');
});

test('P7-05 pruning removes the oldest pack only: the exam keeps its score and date, and only its review is gone', () => {
  const { storage, store } = threeExams();
  const before = readHistory(store).entries;
  const freedExpected = store.size('pack:quiz-b');
  const res = pruneOldestPack(store);
  assert.equal(res.ok, true);
  assert.equal(res.quizId, 'quiz-b');
  assert.equal(res.title, 'Exam quiz-b');
  assert.equal(res.freedChars, freedExpected);
  assert.equal(res.remaining, 2);
  assert.ok(!storage.data.has(KEY('pack:quiz-b')));
  assert.ok(storage.data.has(KEY('pack:quiz-a')) && storage.data.has(KEY('pack:quiz-c')));
  assert.deepEqual(readHistory(store).entries, before, 'history is untouched');

  const progress = buildProgress(store, {});
  assert.equal(progress.exams.length, 4, 'every exam is still listed');
  const pruned = progress.exams.find((e) => e.quizId === 'quiz-b');
  assert.ok(pruned, 'with its score');
  assert.equal(pruned.canOpen, false, 'but it cannot be opened for review any more');
});

test('P7-05 pruning one at a time ends with a clear "nothing left" message, never touching the exam in progress', () => {
  const { storage, store } = threeExams();
  saveSession(store, buildSession(packWith('quiz-z', TOPICS), new Date('2026-10-20T10:00:00Z')));
  for (let i = 0; i < 3; i++) assert.equal(pruneOldestPack(store).ok, true);
  const none = pruneOldestPack(store);
  assert.equal(none.ok, false);
  assert.match(none.error, /no saved questions left/i);
  assert.ok(storage.data.has(KEY('session')), 'the exam in progress is never pruned');
  assert.equal(readHistory(store).entries.length, 4);
});

test('P7-05 without a readable history the app cannot tell which pack is oldest, so it prunes nothing', () => {
  const { storage, store } = threeExams();
  storage.data.set(KEY('history'), '[{"id":');
  assert.deepEqual(prunablePacks(store), { ok: false, reason: 'history-unreadable' });
  const res = pruneOldestPack(store);
  assert.equal(res.ok, false);
  assert.match(res.error, /history could not be read/);
  assert.ok(storage.data.has(KEY('pack:quiz-b')), 'nothing was removed');
});

test('P7-05 if the browser will not remove the pack, that is reported instead of claiming success', () => {
  const { storage, store } = threeExams();
  storage.removeItem = () => {};
  const res = pruneOldestPack(store);
  assert.equal(res.ok, false);
  assert.match(res.error, /would not remove it/);
});

test('P7-05 storageUsage counts characters and packs', () => {
  const { store } = threeExams();
  const usage = storageUsage(store);
  assert.equal(usage.packs, 3);
  assert.ok(usage.packChars > 0 && usage.chars > usage.packChars);
});

// ============================================================================================================
// P7-05: the whole story, end to end
// ============================================================================================================

test('P7-05 storage fills up: the learner is told, a backup still holds the unsaved exam, pruning makes room, and nothing is lost', () => {
  const { storage, store } = sizedStore();
  takeExam(store, fatPack('quiz-a'), '2026-10-01T10:00:00.000Z', { 1: 'A' });
  takeExam(store, fatPack('quiz-b'), '2026-10-05T10:00:00.000Z', { 1: 'A' });
  storage.limit = storage.used() + 2000;   // a third exam's pack will not fit

  const heard = [];
  store.onWriteFailure((f) => heard.push(f));
  const third = fatPack('quiz-c');
  const session = { ...buildSession(third, new Date('2026-10-20T10:00:00Z')), finished: true, finished_at: '2026-10-20T10:30:00.000Z' };
  const saved = saveFinishedExam(store, session, gradeExam(third, session.responses));
  assert.equal(saved.packSaved, false);
  assert.deepEqual(heard.map((f) => [f.key, f.reason]), [['pack:quiz-c', 'quota']], 'the app is told which value and why');
  assert.deepEqual(store.pendingKeys(), ['pack:quiz-c']);
  assert.match(describeStorageFailure({ reason: 'quota', keys: heard.map((f) => f.key) }).message, /questions of a finished exam/);

  // The backup is taken while the pack is still only in memory: it must be in the file.
  const backup = buildBackup(store, { now: new Date('2026-10-20T11:00:00Z'), tzOffsetMinutes: 0 });
  assert.equal(backup.ok, true);
  assert.equal(backup.packs, 3, 'all three packs, including the one that did not fit');
  assert.ok(backup.text.includes('quiz-c'));

  const res = pruneOldestPack(store);
  assert.equal(res.quizId, 'quiz-a');
  const flushed = store.flush();
  assert.deepEqual(flushed, { saved: ['pack:quiz-c'], failed: [] });
  assert.deepEqual(store.pendingKeys(), []);
  assert.ok(storage.data.has(KEY('pack:quiz-c')) && storage.data.has(KEY('pack:quiz-b')));
  assert.equal(readHistory(store).entries.length, 3, 'no exam was removed from the history');
  assert.equal(openPastExam(store, `quiz-c@${session.started_at}`, {}).ok, true, 'the new exam can be opened for review');
});

test('P7-05 a full storage while an exam is in progress: the exam keeps going from memory, and saves once there is room', () => {
  const { storage, store } = sizedStore();
  takeExam(store, fatPack('quiz-a'), '2026-10-01T10:00:00.000Z', {});
  storage.limit = storage.used() + 2000;   // less than a session needs; the pack that pruning frees is about as big as the session
  const heard = [];
  store.onWriteFailure((f) => heard.push(f.key));
  const live = buildSession(fatPack('quiz-b'), new Date('2026-10-20T10:00:00Z'));
  assert.equal(saveSession(store, live), false);
  const answered = { ...live, responses: selectOption(live.responses, 1, 'A') };
  assert.equal(saveSession(store, answered), false, 'every answer is another attempt');
  assert.equal(loadSession(store).responses[1].selected, 'A', 'the latest answers are in memory');
  assert.deepEqual([...new Set(heard)], ['session']);

  pruneOldestPack(store);
  assert.deepEqual(store.flush().failed, []);
  assert.ok(storage.data.has(KEY('session')));
  assert.equal(JSON.parse(storage.data.get(KEY('session'))).responses[1].selected, 'A');
});

// ============================================================================================================
// P7-07: damaged history
// ============================================================================================================

test('P7-07 a history that is cut off is reported as damaged and is never overwritten by the next exam', () => {
  const { storage, store } = newStore();
  const cut = '[{"id":"a","quiz_id":"x","totals":{"correct":1,"total":2,"percent":50}},{"id":"b"';
  storage.data.set(KEY('history'), cut);
  assert.deepEqual(readHistory(store), { entries: [], corrupt: true });

  const pack = packWith('quiz-z', TOPICS);
  const session = { ...buildSession(pack), finished: true, finished_at: new Date().toISOString() };
  const res = saveFinishedExam(store, session, gradeExam(pack, session.responses));
  assert.equal(res.historySaved, false);
  assert.equal(storage.data.get(KEY('history')), cut, 'the damaged text is exactly as it was');
});

test('P7-07 a damaged history is left alone by delete, import and backup too, and says why', () => {
  const { storage, store } = threeExams();
  const id = readHistory(store).entries[0].id;
  storage.data.set(KEY('history'), '{{{');
  assert.equal(deleteExam(store, id).ok, false);
  assert.equal(buildBackup(store, {}).ok, true, 'a backup of what is still readable (packs, settings) still works');
  assert.equal(storage.data.get(KEY('history')), '{{{');
  const imported = importReceipt(store, '{"x":1}');
  assert.equal(imported.ok, false);
  assert.equal(storage.data.get(KEY('history')), '{{{');
});

test('P7-07 scanStoredData: missing is fine; unreadable and wrong-shape are "unusable"; a finished exam in progress is fine', () => {
  const { storage, store } = newStore();
  assert.deepEqual(scanStoredData(store), { session: { state: 'missing', reason: null }, history: { state: 'missing', reason: null } });

  storage.data.set(KEY('session'), '{"version":1,"pack":{"questions":[');
  storage.data.set(KEY('history'), '{"not":"an array"}');
  assert.deepEqual(scanStoredData(store), { session: { state: 'unusable', reason: 'unreadable' }, history: { state: 'unusable', reason: 'invalid' } });

  const s = buildSession(packWith('quiz-a', TOPICS));
  storage.data.set(KEY('session'), JSON.stringify({ ...s, version: 999 }));
  assert.equal(scanStoredData(store).session.reason, 'invalid', 'another schema version cannot be resumed');
  storage.data.set(KEY('session'), JSON.stringify({ ...s, pack: { ...s.pack, questions: [] } }));
  assert.equal(scanStoredData(store).session.state, 'unusable', 'a pack that no longer validates');

  saveSession(store, { ...s, finished: true, finished_at: new Date().toISOString() });
  storage.data.set(KEY('history'), '[]');
  assert.deepEqual(scanStoredData(store), { session: { state: 'ok', reason: null }, history: { state: 'ok', reason: null } });
});

test('P7-07 damagedText offers the unreadable history for download, and never an exam in progress', () => {
  const { storage, store } = newStore();
  assert.equal(damagedText(store, STORAGE_KEYS.history), null, 'nothing stored');
  storage.data.set(KEY('history'), '[{"id":"a"');
  assert.equal(damagedText(store, STORAGE_KEYS.history), '[{"id":"a"');
  storage.data.set(KEY('history'), '{"not":"an array"}');
  assert.equal(damagedText(store, STORAGE_KEYS.history), '{"not":"an array"}');
  storage.data.set(KEY('history'), '[]');
  assert.equal(damagedText(store, STORAGE_KEYS.history), null, 'a healthy history is not "damaged data"');
  storage.data.set(KEY('session'), '{"cut');
  assert.equal(damagedText(store, STORAGE_KEYS.session), null, 'its answers stay out of any file, as in backup.js');
});

test('P7-07 reset clears only the key asked for; saved packs, settings and the other key stay', () => {
  const { storage, store } = threeExams();
  store.set(STORAGE_KEYS.settings, { language: 'English' });
  storage.data.set(KEY('history'), '[{"id":');
  storage.data.set(KEY('session'), '{"cut');

  assert.deepEqual(resetStoredKey(store, STORAGE_KEYS.history), { ok: true });
  assert.equal(storage.data.has(KEY('history')), false);
  assert.equal(storage.data.has(KEY('session')), true, 'the other damaged key is a separate decision');
  assert.ok(storage.data.has(KEY('pack:quiz-a')) && storage.data.has(KEY('settings')));
  assert.equal(scanStoredData(store).history.state, 'missing');

  // new exams are saved again
  assert.deepEqual(takeExam(store, packWith('quiz-n', TOPICS), '2026-10-25T10:00:00.000Z', {}), 'quiz-n@2026-10-25T10:00:00.000Z');
  assert.equal(readHistory(store).entries.length, 1);

  assert.deepEqual(resetStoredKey(store, STORAGE_KEYS.session), { ok: true });
  assert.equal(loadSession(store), null);
});

test('P7-07 reset refuses any other key, and reports a browser that will not remove it', () => {
  const { storage, store } = threeExams();
  assert.equal(resetStoredKey(store, 'pack:quiz-a').ok, false);
  assert.ok(storage.data.has(KEY('pack:quiz-a')));
  storage.data.set(KEY('history'), '{{{');
  storage.removeItem = () => {};
  const res = resetStoredKey(store, STORAGE_KEYS.history);
  assert.equal(res.ok, false);
  assert.match(res.error, /would not remove it/);
});

// ============================================================================================================
// P7-07: damaged entries inside a readable history must not take a screen down
// ============================================================================================================

test('P7-07 a history entry whose outcomes hold junk no longer breaks Progress, the receipt or "use latest"', () => {
  const { storage, store } = newStore();
  takeExam(store, packWith('quiz-a', TOPICS), '2026-10-01T10:00:00.000Z', { 1: 'A', 2: 'B' });
  takeExam(store, packWith('quiz-b', TOPICS), '2026-10-05T10:00:00.000Z', { 1: 'A', 2: 'A' });
  const history = JSON.parse(storage.data.get(KEY('history')));
  const newest = history.find((e) => e.quiz_id === 'quiz-b');
  newest.outcomes = [null, 5, 'x', ...newest.outcomes];
  storage.data.set(KEY('history'), JSON.stringify(history));

  assert.doesNotThrow(() => loadSnapshots(store));
  const progress = buildProgress(store, {});
  assert.equal(progress.exams.length, 2, 'the exam is still listed, built from the outcomes that are good');
  assert.doesNotThrow(() => prepareProfileReceipt(store));
  const latest = rebuildLatestReceipt(store, { options: { missed: false, history: true, concepts: true, formatSpec: false } });
  assert.equal(latest.ok, true);
  assert.match(latest.title, /quiz-a/, 'the damaged newest exam is skipped, the one before it is used');
});

// A pack, a history entry and a session, each damaged one field at a time with every kind of wrong value. Whatever the app
// reads must come back as a normal result, never an exception: an exception is a blank screen.
test('P7-07 every field of a stored exam, pack and session replaced by wrong values: nothing the app reads throws', () => {
  const JUNK = [null, 0, NaN, 'x', true, {}, [null]];
  const build = () => {
    const ctx = newStore();
    takeExam(ctx.store, packWith('quiz-a', TOPICS), '2026-10-01T10:00:00.000Z', { 1: 'A', 2: 'B', 3: 'A' });
    takeExam(ctx.store, packWith('quiz-b', TOPICS.slice(0, 2)), '2026-10-05T10:00:00.000Z', { 1: 'A', 2: 'A' });
    const s = buildSession(packWith('quiz-c', TOPICS), new Date('2026-10-20T10:00:00Z'));
    saveSession(ctx.store, { ...s, responses: selectOption(s.responses, 1, 'A') });
    return ctx;
  };
  // Every distinct field; of a list or a numbered table only the first two items (the rest repeat the same shapes).
  const paths = (o) => { const out = []; (function walk(x, p) { if (x && typeof x === 'object') for (const k of Object.keys(x)) { if (/^\d+$/.test(k) && Number(k) > 1) continue; out.push([...p, k]); walk(x[k], [...p, k]); } })(o, []); return out; };
  const withValue = (o, p, v) => { const c = JSON.parse(JSON.stringify(o)); let t = c; for (const k of p.slice(0, -1)) t = t[k]; t[p.at(-1)] = v; return c; };
  const without = (o, p) => { const c = JSON.parse(JSON.stringify(o)); let t = c; for (const k of p.slice(0, -1)) t = t[k]; if (Array.isArray(t)) t.splice(Number(p.at(-1)), 1); else delete t[p.at(-1)]; return c; };

  const readEverything = (store, where) => {
    const sess = loadSession(store);
    if (sess) describeSession(sess);
    readHistory(store);
    loadSnapshots(store);
    buildProgress(store, { compareId: 'quiz-a@2026-10-01T10:00:00.000Z', lockedQuizId: 'quiz-c' });
    rebuildLatestReceipt(store, { options: { missed: false, history: true, concepts: true, formatSpec: false } });
    const prepared = prepareProfileReceipt(store);
    if (prepared.ok) prepared.build({ concepts: true });
    for (const id of ['quiz-a@2026-10-01T10:00:00.000Z', 'quiz-b@2026-10-05T10:00:00.000Z']) openPastExam(store, id, {});
    buildBackup(store, {});
    scanStoredData(store);
    prunablePacks(store);
    return where;
  };

  const base = build();
  let cases = 0;
  for (const key of ['history', 'pack:quiz-a', 'session']) {
    const original = JSON.parse(base.storage.data.get(KEY(key)));
    const variants = [];
    for (const p of paths(original)) {
      for (const j of JUNK) variants.push([p.join('.'), withValue(original, p, j)]);
      variants.push([`${p.join('.')} (removed)`, without(original, p)]);
    }
    for (const j of JUNK) variants.push(['(whole value)', j]);
    for (const [where, value] of variants) {
      const { storage, store } = build();
      storage.data.set(KEY(key), JSON.stringify(value));
      cases++;
      assert.doesNotThrow(() => readEverything(store, where), `${key} ${where} = ${JSON.stringify(value)?.slice(0, 80)}`);
    }
  }
  assert.ok(cases > 800, `the sweep really ran (${cases} cases)`);
});

test('P7-07 stored text that is not JSON at all (cut off, binary, empty) never throws either', () => {
  for (const key of ['history', 'session', 'pack:quiz-a']) {
    for (const text of ['{{{', '[', '"', 'undefined', '\u0000\u0001', '<html>', '', '[{"id":"a"']) {
      const { storage, store } = newStore();
      takeExam(store, packWith('quiz-a', TOPICS), '2026-10-01T10:00:00.000Z', { 1: 'A' });
      storage.data.set(KEY(key), text);
      assert.doesNotThrow(() => {
        loadSession(store); readHistory(store); loadSnapshots(store); buildProgress(store, {});
        prepareProfileReceipt(store); rebuildLatestReceipt(store, { options: {} }); buildBackup(store, {}); scanStoredData(store); prunablePacks(store);
      }, `${key}: ${JSON.stringify(text)}`);
    }
  }
});
