// P6-09: full backup (download) and restore. A backup is built from a device that took real exams, restored into another
// device, and compared through the Progress model, so what is tested is what the learner would see.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, parseBackup, restoreBackup, backupFileName } from '../js/backup.js';
import { readHistory } from '../js/history.js';
import { buildProgress, openPastExam } from '../js/progress.js';
import { savePromptSettings } from '../js/settings.js';
import { BACKUP_FORMAT, STORAGE_KEYS, STORAGE_PREFIX, packKey } from '../js/constants.js';
import { newStore, packWith, takeExam, answers } from './helpers.js';

const NOW = new Date('2026-11-01T08:00:00.000Z');
const topics = (...names) => names.map((name, i) => ({ id: `t${i + 1}`, name }));

function seeded() {
  const ctx = newStore();
  const a = packWith('q1', topics('Networks', 'Security'));
  const b = packWith('q2', topics('Storage', 'Cloud'));
  takeExam(ctx.store, a, '2026-10-01T10:00:00.000Z', answers(a, [1, 2]));
  takeExam(ctx.store, b, '2026-10-08T10:00:00.000Z', answers(b, [1, 2, 3]));
  savePromptSettings(ctx.store, { mode: 'retention', subject: 'Testing', count: 12 });
  return ctx;
}

const backupOf = (store) => { const b = buildBackup(store, { now: NOW, tzOffsetMinutes: 480 }); assert.equal(b.ok, true); return b; };
const parsedOf = (store) => { const p = parseBackup(backupOf(store).text); assert.equal(p.ok, true, p.errors.join('; ')); return p; };

// ---- building ----------------------------------------------------------------------------------------------------

test('P6-09 nothing stored: there is nothing to back up, and it says so', () => {
  const { store } = newStore();
  const b = buildBackup(store, { now: NOW });
  assert.equal(b.ok, false);
  assert.match(b.error, /nothing to back up/);
});

test('P6-09 the backup holds the history, every pack and the settings, and names its format and version', () => {
  const { store } = seeded();
  const b = backupOf(store);
  assert.equal(b.exams, 2);
  assert.equal(b.packs, 2);
  const file = JSON.parse(b.text);
  assert.equal(file.format, BACKUP_FORMAT);
  assert.equal(file.version, 1);
  assert.equal(file.created_at, '2026-11-01T16:00:00+08:00');
  assert.deepEqual(Object.keys(file.data.packs).sort(), ['q1', 'q2']);
  assert.equal(file.data.history.length, 2);
  assert.equal(file.data.settings.promptBuilder.subject, 'Testing');
});

test('P6-09 an unfinished exam is not in the backup: its pack holds answers that are still hidden', () => {
  const { store } = seeded();
  store.set(STORAGE_KEYS.session, { quiz_id: 'q3', pack: packWith('q3', topics('Secret')), finished: false });
  const text = backupOf(store).text;
  assert.equal(text.includes('Secret'), false);
  assert.equal('session' in JSON.parse(text).data, false);
});

test('P6-09 the file name carries the learner\'s local date and time', () => {
  assert.equal(backupFileName(NOW, 480), 'quiz-runner-backup-20261101-1600.json');
  assert.equal(backupFileName(NOW, 0), 'quiz-runner-backup-20261101-0800.json');
  assert.equal(backupFileName(NOW, -300), 'quiz-runner-backup-20261101-0300.json');
});

test('P6-09 a history that cannot be read is left out with a warning, the packs and settings are still saved', () => {
  const { storage, store } = seeded();
  storage.setItem(STORAGE_PREFIX + STORAGE_KEYS.history, JSON.stringify({ not: 'an array' }));
  const b = backupOf(store);
  assert.equal(b.exams, 0);
  assert.equal(b.packs, 2);
  assert.equal(b.warnings.length, 1);
  assert.match(b.warnings[0], /history could not be read/);
});

// ---- reading -----------------------------------------------------------------------------------------------------

test('P6-09 files that are not a backup are refused with a reason', () => {
  assert.match(parseBackup('').errors[0], /empty/);
  assert.match(parseBackup('   ').errors[0], /empty/);
  assert.match(parseBackup('{ nope').errors[0], /could not be read/);
  assert.match(parseBackup('[1,2]').errors[0], /not a Quiz Runner backup/);
  assert.match(parseBackup(JSON.stringify({ format: 'quizrunner.receipt' })).errors[0], /Import receipt/);
  assert.match(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1 })).errors[0], /no data section/);
  assert.match(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: { history: [], packs: {} } })).errors[0], /nothing that can be restored/);
  assert.match(parseBackup('<!-- BEGIN RECEIPT -->\n# QUIZ RUNNER RECEIPT').errors[0], /receipt, not a backup/);
  for (const text of ['', '{ nope', '[1,2]']) assert.equal(parseBackup(text).ok, false);
});

test('P6-09 a byte-order mark at the start of the file is tolerated', () => {
  const { store } = seeded();
  assert.equal(parseBackup(`\uFEFF${backupOf(store).text}`).ok, true);
});

test('P6-09 an unknown version is a warning; a missing one too', () => {
  const { store } = seeded();
  const file = JSON.parse(backupOf(store).text);
  file.version = 9;
  assert.match(parseBackup(JSON.stringify(file)).warnings[0], /version 9/);
  delete file.version;
  assert.match(parseBackup(JSON.stringify(file)).warnings[0], /no version number/);
});

test('P6-09 a damaged exam or pack is left out and counted; it never reaches the device', () => {
  const { store } = seeded();
  const file = JSON.parse(backupOf(store).text);
  file.data.history.push(null, { quiz_id: 'x', totals: {} }, 'junk');
  file.data.packs.broken = { meta: {}, questions: [] };
  file.data.packs.worse = 'text';
  file.data.packs['  '] = file.data.packs.q1;
  const parsed = parseBackup(JSON.stringify(file));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.counts, { exams: 2, packs: 2, skippedExams: 3, skippedPacks: 3 });
  assert.equal(parsed.warnings.length, 2);
  assert.deepEqual(Object.keys(parsed.data.packs).sort(), ['q1', 'q2']);
});

// ---- restoring ---------------------------------------------------------------------------------------------------

test('P6-09 restoring into an empty device brings back the same progress, the same packs and the same settings', () => {
  const src = seeded();
  const parsed = parsedOf(src.store);
  const dst = newStore();
  const res = restoreBackup(dst.store, parsed);
  assert.equal(res.ok, true);
  assert.deepEqual([res.addedExams, res.existingExams, res.addedPacks, res.keptPacks, res.settingsRestored], [2, 0, 2, 0, true]);
  assert.match(res.message, /2 exams added.*2 question packs added.*settings restored/);

  assert.deepEqual(buildProgress(dst.store), buildProgress(src.store));
  assert.deepEqual(dst.store.get(packKey('q1')), src.store.get(packKey('q1')));
  assert.deepEqual(dst.store.get(STORAGE_KEYS.settings), src.store.get(STORAGE_KEYS.settings));
  const id = buildProgress(dst.store).exams[0].id;
  assert.equal(openPastExam(dst.store, id).ok, true);   // a restored exam can be opened again
});

test('P6-09 restoring twice adds nothing the second time', () => {
  const parsed = parsedOf(seeded().store);
  const dst = newStore();
  restoreBackup(dst.store, parsed);
  const again = restoreBackup(dst.store, parsed);
  assert.equal(again.ok, true);
  assert.deepEqual([again.addedExams, again.existingExams, again.addedPacks, again.keptPacks, again.settingsRestored], [0, 2, 0, 2, false]);
  assert.equal(readHistory(dst.store).entries.length, 2);
});

test('P6-09 restoring merges: what is on the device stays, what is missing is added; local packs and settings are never overwritten', () => {
  const src = seeded();
  const parsed = parsedOf(src.store);

  const dst = newStore();
  const localPack = packWith('q1', topics('Different', 'Topics'));   // same quiz id, other content
  takeExam(dst.store, localPack, '2026-10-01T10:00:00.000Z', answers(localPack, []));   // same exam as the backup's first one
  const newer = packWith('q5', topics('Newer', 'Exam'));
  takeExam(dst.store, newer, '2026-10-20T10:00:00.000Z', answers(newer, [1]));
  savePromptSettings(dst.store, { subject: 'Local subject' });

  const res = restoreBackup(dst.store, parsed);
  assert.equal(res.ok, true);
  assert.deepEqual([res.addedExams, res.existingExams, res.addedPacks, res.keptPacks, res.settingsRestored], [1, 1, 1, 1, false]);
  const quizIds = readHistory(dst.store).entries.map((e) => e.quiz_id).sort();
  assert.deepEqual(quizIds, ['q1', 'q2', 'q5']);
  assert.equal(dst.store.get(packKey('q1')).meta.topics[0].name, 'Different');   // the local pack was kept
  assert.equal(dst.store.get(STORAGE_KEYS.settings).promptBuilder.subject, 'Local subject');
  assert.ok(dst.store.get(packKey('q5')));   // nothing local was deleted
});

test('P6-09 a device whose history cannot be read is not merged into; it is left exactly as it was', () => {
  const parsed = parsedOf(seeded().store);
  const { storage, store } = newStore();
  const raw = JSON.stringify({ not: 'an array' });
  storage.setItem(STORAGE_PREFIX + STORAGE_KEYS.history, raw);
  const res = restoreBackup(store, parsed);
  assert.equal(res.ok, false);
  assert.match(res.error, /Clear all data/);
  assert.equal(storage.getItem(STORAGE_PREFIX + STORAGE_KEYS.history), raw);
  assert.equal(storage.getItem(STORAGE_PREFIX + packKey('q1')), null);
});

test('P6-09 not enough room: nothing is restored, no half-written pack stays behind, and the old history is untouched', () => {
  const parsed = parsedOf(seeded().store);
  // Room for the history key and one pack, not for the second pack.
  const { storage, store } = newStore({ quotaAfter: 2 });
  const old = packWith('q0', topics('Old', 'Data'));
  takeExam(store, old, '2026-09-01T10:00:00.000Z', answers(old, [1]));   // uses 2 keys: pack:q0 and history
  const before = JSON.stringify([...storage.data.entries()]);
  const res = restoreBackup(store, parsed);
  assert.equal(res.ok, false);
  assert.match(res.error, /not enough room/);
  assert.equal(JSON.stringify([...storage.data.entries()]), before);
  assert.equal(store.get(packKey('q1'), null), null);   // not even in memory
  assert.equal(readHistory(store).entries.length, 1);
});

test('P6-09 the history is written last: if it cannot be written, the packs just written are taken back', () => {
  const parsed = parsedOf(seeded().store);
  const { storage, store } = newStore({ quotaAfter: 3 });
  store.set('settings', { x: 1 });   // key 1
  // Room for exactly the two packs (keys 2 and 3) but not for the history key.
  const res = restoreBackup(store, parsed);
  assert.equal(res.ok, false);
  assert.equal([...storage.data.keys()].some((k) => k.includes('pack:')), false);
  assert.equal(store.get(packKey('q1'), null), null);
  assert.equal(store.get(STORAGE_KEYS.history, null), null);
});

test('P6-09 restore refuses a parse that failed', () => {
  const { store } = newStore();
  assert.equal(restoreBackup(store, parseBackup('nope')).ok, false);
  assert.equal(restoreBackup(store, null).ok, false);
  assert.deepEqual(store.keys(), []);
});

test('P6-09 an exam imported from a receipt survives a backup and restore', () => {
  const src = newStore();
  src.store.set(STORAGE_KEYS.history, [{
    entry_version: 1, id: 'q9@2026-10-20T10:00:00.000Z', quiz_id: 'q9', title: 'Imported', subject: 'Testing', quiz_type: 'custom', quiz_number: null,
    started_at: '2026-10-20T10:00:00.000Z', finished_at: '', spec_version: 1, app_version: '2.0.0',
    totals: { total: 4, correct: 2, wrong: 2, skipped: 0, unsure: 0, percent: 50, rating: 'Needs work' }, outcomes: [], receipt_id: 'qr-q9-1',
    imported: { at: NOW.toISOString(), topics: [{ id: 't1', name: 'Databases', status: 'weak', accuracy: 0.5 }], missed: [], covered_concepts: {} },
  }]);
  const dst = newStore();
  assert.equal(restoreBackup(dst.store, parsedOf(src.store)).ok, true);
  const row = buildProgress(dst.store).exams[0];
  assert.deepEqual([row.imported, row.canOpen, row.percent], [true, false, 50]);
  assert.equal(buildProgress(dst.store).mastery[0].name, 'Databases');
});
