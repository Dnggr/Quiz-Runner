// Tests for the sixth-pass bug flags that were fixed afterwards (2026-11-01):
// BUG-26 (a topic left without a question by the next-exam allocation), BUG-27 (a pack saved under the old rules, read back
// after the update), BUG-28 (a receipt without `percent`), BUG-29 (an absurd `exam.taken_at` in a receipt).
// The decisions are D40-D43 in docs/PLAN.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readStoredPack, normalizePack } from '../js/loader.js';
import { validatePack } from '../js/validator.js';
import { gradeExam } from '../js/grader.js';
import { allocateNextExam } from '../js/analytics.js';
import { importReceipt, receiptToEntry, readHistory } from '../js/history.js';
import { buildReceipt, parseReceipt } from '../js/receipt.js';
import { buildBackup, parseBackup, restoreBackup } from '../js/backup.js';
import { buildSession, parseSession } from '../js/session.js';
import { selectOption } from '../js/exam.js';
import { examDate } from '../js/progress.js';
import { newStore, packWith, takeExam, answers } from './helpers.js';

// ---- BUG-26 ----------------------------------------------------------------------------------------------------------
const topic = (id, status, misses, accuracy, n = 4) => ({
  id, name: id, total: n, correct: n - misses, wrong: misses, skipped: 0, unsure: 0, shaky: 0, misses, accuracy, shakyRatio: 0, status,
});
/** `w` weak topics (most missed first), `m` watch topics (lowest accuracy first), `s` strong topics. */
const topicsOf = (w, m, s) => [
  ...Array.from({ length: w }, (_, i) => topic(`w${i}`, 'weak', 4 - (i % 3), (i % 3) / 4)),
  ...Array.from({ length: m }, (_, i) => topic(`m${i}`, 'watch', 1, 0.5 + i * 0.01)),
  ...Array.from({ length: s }, (_, i) => topic(`s${i}`, 'strong', 0, 1)),
];
const countsOf = (alloc) => Object.fromEntries(alloc.allocations.map((a) => [a.topic, a.count]));
const sumOf = (alloc) => alloc.allocations.reduce((n, a) => n + a.count, 0);
const groupSum = (c, prefix) => Object.entries(c).filter(([id]) => id.startsWith(prefix)).reduce((n, [, v]) => n + v, 0);

test('BUG-26 repro (2 weak, 12 watch, 1 strong at N = 10): the strong topic goes first, then the least urgent watch topics; weak topics are all covered', () => {
  const alloc = allocateNextExam(topicsOf(2, 12, 1), 10);
  const c = countsOf(alloc);
  assert.equal(sumOf(alloc), 10);
  assert.equal(c.s0, undefined, 'a strong topic has no question while watch topics have none');
  assert.ok(c.w0 >= 1 && c.w1 >= 1);
  assert.equal(groupSum(c, 'w'), 6, 'the 60% weak share is kept when N cannot cover every topic');
  for (const id of ['m0', 'm1', 'm2', 'm3']) assert.equal(c[id], 1, `${id} (lowest accuracy) is covered first`);
  assert.equal(c.m11, undefined);
});

test('BUG-26 when N is at least the number of topics, every topic gets a question: the weak share gives way last', () => {
  const alloc = allocateNextExam(topicsOf(2, 12, 1), 20);   // 15 topics
  const c = countsOf(alloc);
  assert.equal(sumOf(alloc), 20);
  assert.equal(Object.keys(c).length, 15, 'every topic is in the allocation');
  assert.equal(c.s0, 1, 'strong keeps its one question (its floor)');
  for (let i = 0; i < 12; i++) assert.equal(c[`m${i}`], 1);
  assert.equal(groupSum(c, 'w'), 7, 'the weak share gave 5 of its 12 to cover the watch topics');
  const exact = allocateNextExam(topicsOf(2, 12, 1), 15);
  assert.ok(Object.values(countsOf(exact)).every((n) => n === 1), 'N equal to the number of topics gives one each');
});

test('BUG-26 nothing changes while the shares already cover every topic (3 weak, 4 watch, 2 strong at N = 40)', () => {
  const c = countsOf(allocateNextExam(topicsOf(3, 4, 2), 40));
  assert.equal(groupSum(c, 'w'), 24);
  assert.equal(groupSum(c, 'm'), 10);
  assert.equal(groupSum(c, 's'), 6);
});

test('BUG-26 over many group sizes and totals: the sum is N, weak topics are never skipped, nothing is skipped when N >= topics, strong goes before watch', () => {
  let checked = 0;
  for (let w = 0; w <= 8; w++) for (let m = 0; m <= 14; m++) for (let s = 0; s <= 8; s++) {
    if (w + m + s === 0) continue;
    for (const n of [10, 13, 20, 40, 130]) {
      const alloc = allocateNextExam(topicsOf(w, m, s), n);
      const c = countsOf(alloc);
      const label = `w${w} m${m} s${s} N${n}`;
      checked++;
      assert.equal(sumOf(alloc), n, label);
      assert.ok(alloc.allocations.every((a) => a.count >= 1), label);
      assert.equal(Array.from({ length: w }, (_, i) => c[`w${i}`] || 0).filter((x) => x === 0).length, Math.max(0, w - n), `${label}: weak topics only go without when there are more than N`);
      if (w + m + s <= n) assert.equal(Object.keys(c).length, w + m + s, `${label}: everything is covered`);
      const strongHas = Array.from({ length: s }, (_, i) => c[`s${i}`] || 0).some((x) => x > 0);
      const watchMissing = Array.from({ length: m }, (_, i) => c[`m${i}`] || 0).some((x) => x === 0);
      assert.ok(!(strongHas && watchMissing), `${label}: a strong topic has a question while a watch topic has none`);
    }
  }
  assert.ok(checked > 1000);
});

// ---- BUG-27 ----------------------------------------------------------------------------------------------------------
/** A pack the way an older version could have saved it: numbers and option text written as text / numbers. */
function oldStylePack() {
  const pack = packWith('old-01', [{ id: 't1', name: 'Networks' }, { id: 't2', name: 'Security' }]);
  pack.questions.forEach((q) => { q.number = String(q.number); });
  pack.questions[0].options.C = 42;   // a number as option text
  return pack;
}
const sessionRecord = (pack) => ({ ...buildSession(packWith('x', [{ id: 't1', name: 'T' }])), pack });

test('BUG-27 the old-style pack really is refused by the current validator, so the cases below are not trivially passing', () => {
  assert.ok(validatePack(oldStylePack()).errors.length > 0);
});

test('BUG-27 a saved exam in progress whose pack was saved under the old rules is normalized and resumed, not dropped', () => {
  const resumed = parseSession(sessionRecord(oldStylePack()));
  assert.notEqual(resumed, null);
  assert.deepEqual(resumed.pack.questions.map((q) => q.number), [1, 2, 3, 4]);
  assert.equal(resumed.pack.questions[0].options.C, '42');
  assert.equal(validatePack(resumed.pack).errors.length, 0);
});

test('BUG-27 a backup holding such a pack restores it (normalized) instead of skipping it', () => {
  const { store } = newStore();
  const pack = packWith('old-01', [{ id: 't1', name: 'Networks' }, { id: 't2', name: 'Security' }]);
  takeExam(store, pack, '2026-10-01T10:00:00.000Z', answers(pack, [1, 2]));
  const built = buildBackup(store, { now: new Date('2026-11-01T08:00:00.000Z') });
  assert.equal(built.ok, true);
  const file = JSON.parse(built.text);
  file.data.packs['old-01'] = oldStylePack();
  const parsed = parseBackup(JSON.stringify(file));
  assert.equal(parsed.ok, true, parsed.errors.join('; '));
  assert.equal(parsed.counts.skippedPacks, 0);
  assert.equal(parsed.counts.packs, 1);
  assert.deepEqual(parsed.data.packs['old-01'].questions.map((q) => q.number), [1, 2, 3, 4]);
  const target = newStore();
  assert.equal(restoreBackup(target.store, parsed).ok, true);
});

test('BUG-27 what cannot be repaired is still refused, in both places: a blank option, a missing number, a missing quiz_id (validation is not weakened)', () => {
  const blankOption = () => { const p = packWith('bad-01', [{ id: 't1', name: 'T' }]); p.questions[0].options.B = ''; return p; };
  const noNumber = () => { const p = packWith('bad-01', [{ id: 't1', name: 'T' }]); delete p.questions[0].number; return p; };
  const noQuizId = () => { const p = packWith('bad-01', [{ id: 't1', name: 'T' }]); delete p.meta.quiz_id; return p; };
  for (const make of [blankOption, noNumber, noQuizId]) {
    assert.deepEqual(readStoredPack(make()), { ok: false });
    assert.equal(parseSession(sessionRecord(make())), null);
    const { store } = newStore();
    const built = buildBackup(store, { now: new Date('2026-11-01T08:00:00.000Z') });
    const file = JSON.parse(built.ok ? built.text : '{}');
    file.format = file.format || 'quizrunner.backup';
    file.data = { history: [], packs: { 'bad-01': make() }, settings: null };
    const parsed = parseBackup(JSON.stringify(file));
    assert.equal(parsed.ok, false);
    assert.equal(parsed.counts.skippedPacks, 1);
  }
});

test('BUG-27 a pack that is already valid comes back as the very same object, and the input is never modified', () => {
  const good = packWith('ok-01', [{ id: 't1', name: 'T' }]);
  const out = readStoredPack(good);
  assert.equal(out.ok, true);
  assert.equal(out.pack, good);
  const old = oldStylePack();
  const before = JSON.stringify(old);
  const repaired = readStoredPack(old);
  assert.equal(repaired.ok, true);
  assert.notEqual(repaired.pack, old);
  assert.equal(JSON.stringify(old), before);
  assert.deepEqual(repaired.pack, normalizePack(old));
  assert.deepEqual(readStoredPack(null), { ok: false });
  assert.deepEqual(readStoredPack({ questions: 'no' }), { ok: false });
});

// ---- BUG-28 / BUG-29 -------------------------------------------------------------------------------------------------
/** A real receipt (JSON form) of a graded exam, as parsed data that a test can edit before importing. */
function receiptData() {
  const pack = packWith('rcpt-01', [{ id: 't1', name: 'Networks' }, { id: 't2', name: 'Security' }]);
  const session = buildSession(pack, new Date('2026-10-01T10:00:00.123Z'));
  let responses = session.responses;
  for (const [n, l] of Object.entries(answers(pack, [1, 2, 3]))) responses = selectOption(responses, Number(n), l);
  const graded = gradeExam(pack, responses);
  const receipt = buildReceipt({
    pack, graded, startedAt: session.started_at, finishedAt: null, now: new Date('2026-11-01T08:00:00.000Z'),
    tzOffsetMinutes: 0, snapshots: [], options: {},
  });
  return JSON.parse(receipt.json);
}
const parsedWith = (edit) => {
  const data = receiptData();
  edit(data);
  const parsed = parseReceipt(JSON.stringify(data));
  assert.equal(parsed.ok, true, parsed.errors.join('; '));
  return parsed;
};

test('BUG-28 a receipt with correct counts but no percent imports; the percent and rating come from the counts, with no percent warning', () => {
  const res = receiptToEntry(parsedWith((d) => { delete d.result.percent; delete d.result.rating; }));
  assert.equal(res.ok, true, res.error);
  assert.equal(res.entry.totals.percent, 75);
  assert.equal(res.entry.totals.rating, 'Good');
  assert.ok(!res.warnings.some((w) => /%/.test(w)));
});

test('BUG-28 a percent that is not a number is ignored like a missing one; a number far off still warns; missing counts are still refused', () => {
  const odd = receiptToEntry(parsedWith((d) => { d.result.percent = 'x'; }));
  assert.equal(odd.ok, true);
  assert.equal(odd.entry.totals.percent, 75);
  const off = receiptToEntry(parsedWith((d) => { d.result.percent = 12.5; }));
  assert.equal(off.ok, true);
  assert.ok(off.warnings.some((w) => /12\.5%/.test(w)));
  const noCount = receiptToEntry(parsedWith((d) => { delete d.result.wrong; }));
  assert.equal(noCount.ok, false);
  assert.match(noCount.error, /no usable result/);
});

test('BUG-28 through importReceipt: a receipt without percent is saved in the history', () => {
  const { store } = newStore();
  const res = importReceipt(store, parsedWith((d) => { delete d.result.percent; }));
  assert.equal(res.ok, true);
  assert.equal(res.status, 'imported');
  assert.equal(readHistory(store).entries[0].totals.percent, 75);
});

const ABSURD = ['+275760-09-13T00:00:00.000Z', '-271821-04-20T00:00:00.000Z', '0001-01-01T00:00:00Z'];

test('BUG-29 an absurd exam.taken_at is treated as no date: the creation time is used, with the existing warning (the three repros)', () => {
  for (const taken of ABSURD) {
    const res = receiptToEntry(parsedWith((d) => { d.exam.taken_at = taken; }));
    assert.equal(res.ok, true, taken);
    assert.match(res.entry.started_at, /^\d{4}-\d{2}-\d{2}T/, taken);
    assert.ok(res.entry.started_at.startsWith('2026-11-01'), `${taken}: the creation time was used`);
    assert.ok(!/[+-]\d{6}-/.test(res.entry.id), `${taken}: no extended year in the id`);
    assert.ok(res.warnings.some((w) => /no valid exam date/.test(w)), taken);
    assert.match(examDate(res.entry.started_at), /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('BUG-29 when both dates are unusable the receipt is refused with a message about the date', () => {
  const res = receiptToEntry(parsedWith((d) => { d.exam.taken_at = ABSURD[0]; d.created_at = ABSURD[2]; }));
  assert.equal(res.ok, false);
  assert.match(res.error, /usable date/);
});

test('BUG-29 the limits: 1970-01-01 is the first accepted moment; the last accepted moment is a day before the end of year 9999, and its label stays a normal date in any time zone', () => {
  // BUG-32: a date in the future is not trusted, so the clock is set to the end of year 9999 to test the upper limit of the date range itself
  const taken = (iso) => receiptToEntry(parsedWith((d) => { d.exam.taken_at = iso; }), { now: new Date('9999-12-30T23:59:59.999Z') });
  assert.ok(taken('1970-01-01T00:00:00.000Z').entry.started_at.startsWith('1970-01-01'));
  assert.ok(taken('1969-12-31T23:59:59.000Z').entry.started_at.startsWith('2026-11-01'));
  const last = taken('9999-12-30T23:59:59.999Z');
  assert.equal(last.entry.started_at, '9999-12-30T23:59:59.999Z');
  assert.ok(!last.warnings.some((w) => /no valid exam date/.test(w)));
  for (const offset of [-840, 0, 840]) assert.match(examDate(last.entry.started_at, offset), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(taken('9999-12-31T00:00:00.000Z').entry.started_at.startsWith('2026-11-01'));
});

test('BUG-29 a normal receipt date is unchanged and gives no date warning', () => {
  const res = receiptToEntry(parsedWith(() => {}));
  assert.equal(res.ok, true);
  assert.ok(!res.warnings.some((w) => /exam date/.test(w)));
});
