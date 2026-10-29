// P6-08: import a receipt (or profile) into the history, skipping what is already there.
// Receipts are made by the real exporter and read by the real parser, so a receipt in these tests is one the app wrote.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  importReceipt, receiptToEntry, findDuplicate, readHistory, loadSnapshots, prepareProfileReceipt, rebuildLatestReceipt,
} from '../js/history.js';
import { buildReceipt, parseReceipt } from '../js/receipt.js';
import { gradeExam } from '../js/grader.js';
import { buildProgress, OPEN_PROBLEMS, openPastExam } from '../js/progress.js';
import { buildSession } from '../js/session.js';
import { selectOption } from '../js/exam.js';
import { STORAGE_KEYS, STORAGE_PREFIX } from '../js/constants.js';
import { newStore, packWith, takeExam, answers } from './helpers.js';

const topics = (...names) => names.map((name, i) => ({ id: `t${i + 1}`, name }));
const NOW = new Date('2026-11-01T08:00:00.000Z');

/** A receipt of an exam taken on a device, as the app exports it. */
function exportedReceipt({ quizId = 'q1', startedAt = '2026-10-01T10:00:00.123Z', right = [1, 2], when = NOW, tz = 480, options } = {}) {
  const pack = packWith(quizId, topics('Networks', 'Security'), { title: `Exam ${quizId}` });
  let session = buildSession(pack, new Date(startedAt));
  let responses = session.responses;
  for (const [n, l] of Object.entries(answers(pack, right))) responses = selectOption(responses, Number(n), l);
  session = { ...session, responses, finished: true, finished_at: new Date(Date.parse(startedAt) + 600000).toISOString() };
  const graded = gradeExam(pack, responses);
  return buildReceipt({ pack, graded, startedAt, finishedAt: session.finished_at, now: when, tzOffsetMinutes: tz, snapshots: [], options });
}

const parse = (text) => { const p = parseReceipt(text); assert.equal(p.ok, true, p.errors.join('; ')); return p; };

test('P6-08 a receipt from another device becomes a history entry with its totals and topic statuses, and no answers', () => {
  const { store } = newStore();
  const receipt = exportedReceipt();
  const res = importReceipt(store, parse(receipt.json), { now: NOW });
  assert.equal(res.ok, true);
  assert.equal(res.status, 'imported');
  assert.equal(res.saved, true);

  const { entries } = readHistory(store);
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.quiz_id, 'q1');
  assert.equal(e.title, 'Exam q1');
  assert.deepEqual(e.totals, { total: 4, correct: 2, wrong: 2, skipped: 0, unsure: 0, percent: 50, rating: 'Needs work' });
  assert.deepEqual(e.outcomes, []);
  assert.equal(e.receipt_id, receipt.receiptId);
  assert.equal(e.started_at, '2026-10-01T10:00:00.000Z');   // the receipt's time has no milliseconds
  assert.equal(e.id, 'q1@2026-10-01T10:00:00.000Z');
  assert.deepEqual(e.imported.topics.map((t) => [t.id, t.name, t.status]), [['t1', 'Networks', 'insufficient'], ['t2', 'Security', 'weak']]);
});

test('P6-08 the same receipt twice is skipped by receipt_id', () => {
  const { store } = newStore();
  const parsed = parse(exportedReceipt().json);
  assert.equal(importReceipt(store, parsed, { now: NOW }).status, 'imported');
  const again = importReceipt(store, parsed, { now: NOW });
  assert.equal(again.ok, true);
  assert.equal(again.status, 'duplicate');
  assert.match(again.message, /already imported/);
  assert.equal(readHistory(store).entries.length, 1);
});

test('P6-08 the .md form and the .json form are the same receipt: importing both adds one exam', () => {
  const { store } = newStore();
  const receipt = exportedReceipt();
  assert.equal(importReceipt(store, parse(receipt.markdown), { now: NOW }).status, 'imported');
  assert.equal(importReceipt(store, parse(receipt.json), { now: NOW }).status, 'duplicate');
  assert.equal(readHistory(store).entries.length, 1);
});

test('P6-08 a receipt exported again later (new receipt_id) is still the same exam, so it is not counted twice', () => {
  const { store } = newStore();
  const first = exportedReceipt({ when: new Date('2026-11-01T08:00:00Z') });
  const later = exportedReceipt({ when: new Date('2026-11-05T09:30:00Z') });
  assert.notEqual(first.receiptId, later.receiptId);
  assert.equal(importReceipt(store, parse(first.json), { now: NOW }).status, 'imported');
  const res = importReceipt(store, parse(later.json), { now: NOW });
  assert.equal(res.status, 'duplicate');
  assert.match(res.message, /already in your history/);
  assert.equal(readHistory(store).entries.length, 1);
});

test('P6-08 a receipt of an exam taken on THIS device is skipped, whatever its time zone or milliseconds', () => {
  const { store } = newStore();
  const pack = packWith('q1', topics('Networks', 'Security'), { title: 'Exam q1' });
  takeExam(store, pack, '2026-10-01T10:00:00.123Z', answers(pack, [1, 2]));
  for (const tz of [0, 480, -300]) {
    const res = importReceipt(store, parse(exportedReceipt({ tz }).json), { now: NOW });
    assert.equal(res.status, 'duplicate', `tz ${tz}`);
  }
  assert.equal(readHistory(store).entries.length, 1);
  // ...but another attempt of the same quiz (another start time) is a different exam.
  const retake = importReceipt(store, parse(exportedReceipt({ startedAt: '2026-10-09T10:00:00.000Z' }).json), { now: NOW });
  assert.equal(retake.status, 'imported');
  assert.equal(readHistory(store).entries.length, 2);
});

test('P6-08 an imported exam shows in the list, the trend and the mastery, but cannot be opened, and says why', () => {
  const { store } = newStore();
  const local = packWith('q0', topics('Networks', 'Security'));
  takeExam(store, local, '2026-09-20T10:00:00.000Z', answers(local, [1, 2, 3, 4]));
  importReceipt(store, parse(exportedReceipt().json), { now: NOW });

  const p = buildProgress(store);
  assert.equal(p.exams.length, 2);
  const row = p.exams.find((e) => e.quizId === 'q1');
  assert.deepEqual([row.imported, row.canOpen, row.reason, row.correct, row.total, row.percent], [true, false, OPEN_PROBLEMS.imported, 2, 4, 50]);
  assert.equal(p.exams.find((e) => e.quizId === 'q0').imported, false);
  assert.equal(p.trend.points.length, 2);
  const security = p.mastery.find((t) => t.name === 'Security');
  assert.equal(security.exams, 2);          // in the local exam q0 and in the imported exam q1
  assert.equal(security.status, 'weak');    // as of the newest of them, the imported one
  assert.equal(openPastExam(store, row.id).ok, false);
});

test('P6-08 imported topics take part in the cumulative rules: weak in a local exam and in an imported one makes a priority topic', () => {
  const { store } = newStore();
  const local = packWith('q0', topics('Networks', 'Security'));
  takeExam(store, local, '2026-09-20T10:00:00.000Z', answers(local, []));   // Security weak
  importReceipt(store, parse(exportedReceipt().json), { now: NOW });         // Security weak again
  assert.deepEqual(buildProgress(store).priority, [{ name: 'Security', exams: 2 }]);
});

test('P6-08 an imported exam also shows in the History section of the next receipt', () => {
  const { store } = newStore();
  importReceipt(store, parse(exportedReceipt().json), { now: NOW });
  const snaps = loadSnapshots(store);
  assert.equal(snaps.length, 1);
  assert.deepEqual([snaps[0].correct, snaps[0].total, snaps[0].percent, snaps[0].rating], [2, 4, 50, 'Needs work']);
});

test('P6-08 the missed questions of the receipt are kept, as the spec says; nothing is kept that is not a known field', () => {
  const { store } = newStore();
  const receipt = exportedReceipt();
  const parsed = parse(receipt.json);
  parsed.data.missed[0].evil = '<script>x</script>';
  importReceipt(store, parsed, { now: NOW });
  const { imported } = readHistory(store).entries[0];
  assert.equal(imported.missed.length, 2);
  assert.deepEqual(Object.keys(imported.missed[0]).sort(), ['answer', 'concept', 'explanation', 'number', 'question', 'selected', 'topic', 'unsure']);
  assert.deepEqual(imported.covered_concepts.Networks, ['Networks concept 1', 'Networks concept 2']);
});

test('P6-08 a profile receipt imports its own exam only, and says how many other exams it listed', () => {
  const src = newStore();
  const a = packWith('q1', topics('Networks', 'Security'));
  const b = packWith('q2', topics('Networks', 'Security'));
  takeExam(src.store, a, '2026-10-01T10:00:00.000Z', answers(a, []));
  takeExam(src.store, b, '2026-10-08T10:00:00.000Z', answers(b, [1, 2]));
  const prepared = prepareProfileReceipt(src.store, { now: NOW, tzOffsetMinutes: 0 });
  const profile = parse(prepared.build().markdown);
  assert.equal(profile.data.history.length, 2);

  const dst = newStore();
  const res = importReceipt(dst.store, profile, { now: NOW });
  assert.equal(res.status, 'imported');
  assert.equal(readHistory(dst.store).entries.length, 1);
  assert.equal(readHistory(dst.store).entries[0].quiz_id, 'q2');
  assert.match(res.message, /also lists 1 other exam; it was not imported/);
});

test('P6-08 what it needs is checked: numbers that do not add up, a missing result, a missing date', () => {
  const base = () => parse(exportedReceipt().json);
  const mutate = (fn) => { const p = base(); fn(p.data); return receiptToEntry(p, { now: NOW }); };

  assert.match(mutate((d) => { d.result.correct = 3; }).error, /do not add up/);
  assert.match(mutate((d) => { delete d.result; }).error, /no usable result/);
  assert.match(mutate((d) => { d.result.percent = 'x'; }).error, /no usable result/);
  assert.match(mutate((d) => { d.exam.total = 0; }).error, /no usable result/);
  assert.match(mutate((d) => { d.exam.taken_at = 'never'; d.created_at = ''; }).error, /when the exam was taken/);

  const fallback = mutate((d) => { d.exam.taken_at = ''; });
  assert.equal(fallback.ok, true);
  assert.ok(fallback.warnings.some((w) => /creation time was used/.test(w)));
  assert.equal(fallback.entry.started_at, new Date(Date.parse(base().data.created_at)).toISOString());   // the creation time, as UTC
});

test('P6-08 a rating that is missing is worked out from the percentage; unusable topic rows are dropped', () => {
  const p = parse(exportedReceipt().json);
  delete p.data.result.rating;
  p.data.topics.push({ id: 't9', name: 'No status', accuracy: 0.5 }, { id: 't8', name: '', status: 'weak', accuracy: 0.1 }, null);
  const made = receiptToEntry(p, { now: NOW });
  assert.equal(made.entry.totals.rating, 'Needs work');
  assert.equal(made.entry.imported.topics.length, 2);
});

test('P6-08 an unknown version is a warning, not a refusal', () => {
  const { store } = newStore();
  const receipt = exportedReceipt();
  const data = JSON.parse(receipt.json);
  data.version = 7;
  const parsed = parseReceipt(JSON.stringify(data));
  assert.equal(parsed.ok, true);
  const res = importReceipt(store, parsed, { now: NOW });
  assert.equal(res.status, 'imported');
  assert.ok(res.warnings.some((w) => /spec v7/.test(w)));
});

test('P6-08 text that is not a receipt, or a receipt that failed to parse, is refused and nothing changes', () => {
  const { store } = newStore();
  assert.equal(importReceipt(store, parseReceipt('hello'), { now: NOW }).ok, false);
  assert.equal(importReceipt(store, parseReceipt(''), { now: NOW }).ok, false);
  assert.equal(importReceipt(store, null, { now: NOW }).ok, false);
  assert.deepEqual(readHistory(store).entries, []);
});

test('P6-08 a history that cannot be read is not overwritten', () => {
  const { storage, store } = newStore();
  const raw = JSON.stringify({ not: 'an array' });
  storage.setItem(STORAGE_PREFIX + STORAGE_KEYS.history, raw);
  const res = importReceipt(store, parse(exportedReceipt().json), { now: NOW });
  assert.equal(res.ok, false);
  assert.match(res.error, /could not be read/);
  assert.equal(storage.getItem(STORAGE_PREFIX + STORAGE_KEYS.history), raw);
});

test('P6-08 when the browser cannot store it, the result says it is only kept until the page closes', () => {
  const { store } = newStore({ quotaAfter: 0 });
  const res = importReceipt(store, parse(exportedReceipt().json), { now: NOW });
  assert.equal(res.ok, true);
  assert.equal(res.saved, false);
});

test('P6-08 "Use latest from this device" does not try to rebuild a receipt for an imported exam', () => {
  const { store } = newStore();
  const old = packWith('q0', topics('Networks', 'Security'));
  takeExam(store, old, '2026-09-20T10:00:00.000Z', answers(old, [1]));
  importReceipt(store, parse(exportedReceipt().json), { now: NOW });
  const res = rebuildLatestReceipt(store, { now: NOW });
  assert.equal(res.ok, false);
  assert.match(res.error, /imported from a receipt/);
});

test('findDuplicate: by receipt_id, by entry id, by same exam at the same second; never by a different second or quiz', () => {
  const entries = [{ id: 'a@2026-10-01T10:00:00.500Z', quiz_id: 'a', started_at: '2026-10-01T10:00:00.500Z', receipt_id: 'r1' }];
  assert.equal(findDuplicate(entries, { id: 'zzz', quiz_id: 'b', started_at: 'x', receipt_id: 'r1' }).by, 'receipt_id');
  assert.equal(findDuplicate(entries, { id: 'a@2026-10-01T10:00:00.500Z', quiz_id: 'b', started_at: 'x', receipt_id: '' }).by, 'id');
  assert.equal(findDuplicate(entries, { id: 'q', quiz_id: 'a', started_at: '2026-10-01T12:00:00+02:00', receipt_id: '' }).by, 'exam');
  assert.equal(findDuplicate(entries, { id: 'q', quiz_id: 'a', started_at: '2026-10-01T10:00:01.000Z', receipt_id: '' }), null);
  assert.equal(findDuplicate(entries, { id: 'q', quiz_id: 'other', started_at: '2026-10-01T10:00:00.000Z', receipt_id: '' }), null);
  assert.equal(findDuplicate(entries, { id: 'q', quiz_id: 'a', started_at: 'not a date', receipt_id: '' }), null);
  assert.equal(findDuplicate([], { id: 'q', quiz_id: 'a', started_at: '2026-10-01T10:00:00.000Z', receipt_id: 'r' }), null);
});
