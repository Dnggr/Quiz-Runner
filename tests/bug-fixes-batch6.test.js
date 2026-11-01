// Tests for the flags worked on in the tenth pass (2026-11-01):
// BUG-34 (a receipt date that is not a real date is read as one), BUG-35 (a future-dated receipt without `receipt_id` can be
// imported twice), and the docs that record them. The decisions are D47 and D48 in docs/PLAN.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { gradeExam } from '../js/grader.js';
import { importReceipt, receiptToEntry, readHistory, findDuplicate } from '../js/history.js';
import { buildReceipt, parseReceipt, parseIsoDateMs } from '../js/receipt.js';
import { buildSession } from '../js/session.js';
import { selectOption } from '../js/exam.js';
import { newStore, packWith, answers } from './helpers.js';

/** A real receipt (JSON form) of a graded exam, as parsed data that a test can edit before importing. */
function receiptData() {
  const pack = packWith('rcpt-06', [{ id: 't1', name: 'Networks' }, { id: 't2', name: 'Security' }]);
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
const NOW = new Date('2026-11-01T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

// ---- BUG-34 ----------------------------------------------------------------------------------------------------------
test('BUG-34 parseIsoDateMs reads real ISO 8601 dates, with or without a time and an offset', () => {
  const cases = {
    '2026-10-25': '2026-10-25T00:00:00.000Z',
    '2026-10-25T14:10:00+08:00': '2026-10-25T06:10:00.000Z',
    '2026-10-25T14:10:00+0800': '2026-10-25T06:10:00.000Z',
    '2026-10-25T14:10:00+08': '2026-10-25T06:10:00.000Z',
    '2026-10-25T14:10:00-05:30': '2026-10-25T19:40:00.000Z',
    '2026-10-25T14:10:00Z': '2026-10-25T14:10:00.000Z',
    '2026-10-25T14:10:00.123Z': '2026-10-25T14:10:00.123Z',
    '2026-10-25T14:10:00.123456789Z': '2026-10-25T14:10:00.123Z',
    '2026-10-25T14:10': '2026-10-25T14:10:00.000Z',
    '2026-10-25 14:10:30': '2026-10-25T14:10:30.000Z',
    '  2026-10-25T14:10:00Z  ': '2026-10-25T14:10:00.000Z',
    '2024-02-29': '2024-02-29T00:00:00.000Z',
    '2026-12-31T23:59:59Z': '2026-12-31T23:59:59.000Z',
  };
  for (const [text, expected] of Object.entries(cases)) assert.equal(iso(parseIsoDateMs(text)), expected, text);
});

test('BUG-34 a text with no offset counts as UTC, so the result does not depend on the device time zone', () => {
  assert.equal(parseIsoDateMs('2026-10-25T14:10:00'), parseIsoDateMs('2026-10-25T14:10:00Z'));
  assert.equal(parseIsoDateMs('2026-10-25'), parseIsoDateMs('2026-10-25T00:00:00Z'));
});

test('BUG-34 parseIsoDateMs refuses loose text, days that do not exist, impossible times and anything that is not text', () => {
  const bad = [
    '12', '10', 'March 5', '25 Oct 2026', 'Oct 25, 2026', '10/25/2026', '25/10/2026', '2026/10/25', '20261025', '2026-10', '2026',
    '2026-02-31T00:00:00Z', '2026-02-29', '2025-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-00', '2026-10-32',
    '2026-10-25T24:00:00Z', '2026-10-25T14:60:00Z', '2026-10-25T14:10:60Z', '2026-10-25T14:10:00+24:00', '2026-10-25T14:10:00+08:60',
    '2026-10-25T14:10:00 PM', '2026-10-25T14:10:00 UTC', '2026-10-25T', '2026-10-25T14', '2026-10-25+08:00', '2026-10-25Z',
    '+275760-09-13T00:00:00.000Z', '-271821-04-20T00:00:00.000Z', '12026-10-25', '', '   ', 'nope', 'Invalid Date', 'NaN',
    12, 2026, 1.79e12, null, undefined, true, {}, [], ['2026-10-25'], new Date(),
  ];
  for (const v of bad) assert.ok(Number.isNaN(parseIsoDateMs(v)), `${typeof v === 'string' ? JSON.stringify(v) : String(v)} must not be read as a date`);
});

test('BUG-34 years 0000-0099 are read as those years (Date.UTC would move them to 1900-1999)', () => {
  assert.equal(new Date(parseIsoDateMs('0050-06-15T00:00:00Z')).getUTCFullYear(), 50);
  assert.equal(new Date(parseIsoDateMs('0001-01-01T00:00:00Z')).getUTCFullYear(), 1);
});

test('BUG-34 repros: "12", "March 5", "10" and 2026-02-31 are no date: the creation time is used, with the existing warning', () => {
  const created = '2026-10-30T09:00:00Z';
  for (const taken of ['12', 'March 5', '10', '2026-02-31T00:00:00Z', '25 Oct 2026', '10/25/2026', '']) {
    const res = receiptToEntry(parsedWith((d) => { d.exam.taken_at = taken; d.created_at = created; }), { now: NOW });
    assert.equal(res.ok, true, taken);
    assert.equal(res.entry.started_at, '2026-10-30T09:00:00.000Z', `${JSON.stringify(taken)} was placed in the wrong year`);
    assert.ok(res.warnings.some((w) => /no valid exam date/.test(w)), `${JSON.stringify(taken)} needs the warning`);
  }
});

test('BUG-34 a taken_at that is a number (12, an epoch value) is not read as a date either', () => {
  for (const taken of [12, 2026, 1792908600000]) {
    const res = receiptToEntry(parsedWith((d) => { d.exam.taken_at = taken; d.created_at = '2026-10-30T09:00:00Z'; }), { now: NOW });
    assert.equal(res.ok, true);
    assert.equal(res.entry.started_at, '2026-10-30T09:00:00.000Z');
    assert.ok(res.warnings.some((w) => /no valid exam date/.test(w)));
  }
});

test('BUG-34 the creation time (created_at) follows the same rule: a loose one is no date, and with no other date the receipt is refused', () => {
  const res = receiptToEntry(parsedWith((d) => { d.exam.taken_at = 'March 5'; d.created_at = '12'; }), { now: NOW });
  assert.equal(res.ok, false);
  assert.match(res.error, /usable date/);
  assert.match(res.error, /2026-10-25T14:10:00\+08:00/, 'the message shows the form that works');
  // a loose taken_at with a good created_at is fine, a good taken_at with a loose created_at needs no fallback and no warning
  const ok = receiptToEntry(parsedWith((d) => { d.exam.taken_at = '2026-10-25T14:10:00+08:00'; d.created_at = 'yesterday'; }), { now: NOW });
  assert.equal(ok.ok, true);
  assert.equal(ok.entry.started_at, '2026-10-25T06:10:00.000Z');
  assert.ok(!ok.warnings.some((w) => /date/.test(w)));
});

test('BUG-34 what a hand-typed date may be: 2026-10-25 and 2026-10-25 14:30 keep working, 25 Oct 2026 does not', () => {
  const dateOnly = receiptToEntry(parsedWith((d) => { d.exam.taken_at = '2026-10-25'; }), { now: NOW });
  assert.equal(dateOnly.entry.started_at, '2026-10-25T00:00:00.000Z');
  assert.ok(!dateOnly.warnings.some((w) => /date/.test(w)), 'a date-only text is accepted without a warning');
  const spaced = receiptToEntry(parsedWith((d) => { d.exam.taken_at = '2026-10-25 14:30'; }), { now: NOW });
  assert.equal(spaced.entry.started_at, '2026-10-25T14:30:00.000Z');
  const words = receiptToEntry(parsedWith((d) => { d.exam.taken_at = '25 Oct 2026'; }), { now: NOW });
  assert.notEqual(words.entry.started_at, '2026-10-25T00:00:00.000Z');
  assert.ok(words.warnings.some((w) => /no valid exam date/.test(w)));
});

test('BUG-34 a real receipt written by the app still imports with no date warning, and the limits of BUG-29 and BUG-32 still apply to ISO dates', () => {
  const real = receiptToEntry(parsedWith(() => {}), { now: NOW });
  assert.equal(real.ok, true);
  assert.ok(!real.warnings.some((w) => /date/.test(w)));
  for (const taken of ['0001-01-01T00:00:00Z', '1969-12-31T23:59:59Z']) {   // real dates, but before 1970
    const res = receiptToEntry(parsedWith((d) => { d.exam.taken_at = taken; }), { now: NOW });
    assert.ok(res.warnings.some((w) => /no valid exam date/.test(w)), taken);
  }
  const future = receiptToEntry(parsedWith((d) => { d.exam.taken_at = '9000-01-01'; }), { now: NOW });
  assert.ok(future.warnings.some((w) => /in the future/.test(w)));
});

test('BUG-34 the list of other exams in a profile receipt matches by a real ISO date only', () => {
  const taken = '2026-10-25T14:10:00+08:00';
  const res = receiptToEntry(parsedWith((d) => {
    d.exam.taken_at = taken;
    d.history = [
      { quiz_id: d.exam.quiz_id, taken_at: taken },               // this exam: not counted as another one
      { quiz_id: d.exam.quiz_id, taken_at: '12' },                // not a date: another exam
      { quiz_id: 'other-exam', taken_at: '2026-09-01T10:00:00Z' },
    ];
  }), { now: NOW });
  assert.equal(res.otherExams, 2);
});

test('BUG-34 end to end through importReceipt: a loose date is not placed in 2001, and the entry that is stored has a real date', () => {
  const { store } = newStore();
  const res = importReceipt(store, parsedWith((d) => { d.exam.taken_at = '12'; d.created_at = '2026-10-30T09:00:00Z'; }), { now: NOW });
  assert.equal(res.ok, true);
  const { entries } = readHistory(store);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].started_at, '2026-10-30T09:00:00.000Z');
  assert.ok(res.warnings.some((w) => /no valid exam date/.test(w)));
});

// ---- BUG-35 ----------------------------------------------------------------------------------------------------------
const futureNoId = (extra = () => {}) => parsedWith((d) => {
  d.exam.taken_at = '2027-03-01T10:00:00Z'; d.created_at = '2027-03-01T10:20:00Z'; delete d.receipt_id; extra(d);
});

test('BUG-35 repro: a future-dated receipt without receipt_id, imported twice a minute apart, is one exam, not two', () => {
  const { store } = newStore();
  const first = importReceipt(store, futureNoId(), { now: NOW });
  assert.equal(first.status, 'imported');
  assert.equal(first.entry.receipt_id, '');
  const second = importReceipt(store, futureNoId(), { now: new Date(NOW.getTime() + 60000) });
  assert.equal(second.ok, true);
  assert.equal(second.status, 'duplicate');
  assert.match(second.message, /already in your history/);
  assert.equal(readHistory(store).entries.length, 1);
});

test('BUG-35 the same receipt imported again days later is still recognised', () => {
  const { store } = newStore();
  importReceipt(store, futureNoId(), { now: NOW });
  const later = importReceipt(store, futureNoId(), { now: new Date(NOW.getTime() + 5 * 86400000) });
  assert.equal(later.status, 'duplicate');
  assert.equal(readHistory(store).entries.length, 1);
});

test('BUG-35 a different exam is not mistaken for it: other quiz id, other title, any other count', () => {
  const { store } = newStore();
  importReceipt(store, futureNoId(), { now: NOW });
  let tick = 0;   // each import happens at its own moment, as in real use (the same quiz id in the same second is one exam)
  const variants = {
    'quiz id': (d) => { d.exam.quiz_id = 'rcpt-06-other'; },
    'title': (d) => { d.exam.title = 'A different exam'; },
    'correct/wrong': (d) => { d.result.correct -= 1; d.result.wrong += 1; },
    'skipped': (d) => { d.result.wrong -= 1; d.result.skipped += 1; },
    'unsure': (d) => { d.result.unsure += 1; },
    'total': (d) => { d.exam.total += 1; d.result.correct += 1; },
  };
  for (const [name, edit] of Object.entries(variants)) {
    const res = importReceipt(store, futureNoId(edit), { now: new Date(NOW.getTime() + 60000 * (++tick)) });
    assert.equal(res.status, 'imported', `${name} is another exam`);
  }
  assert.equal(readHistory(store).entries.length, 1 + Object.keys(variants).length);
});

test('BUG-35 the title is compared without regard to case and spacing', () => {
  const { store } = newStore();
  importReceipt(store, futureNoId(), { now: NOW });
  const again = importReceipt(store, futureNoId((d) => { d.exam.title = `  ${d.exam.title.toUpperCase()}  `; }), { now: new Date(NOW.getTime() + 1000) });
  assert.equal(again.status, 'duplicate');
});

test('BUG-35 the check is narrow on purpose: a normal receipt without receipt_id is matched by its date, so a retake with the same score is kept', () => {
  const { store } = newStore();
  const plain = (taken) => parsedWith((d) => { d.exam.taken_at = taken; d.created_at = taken; delete d.receipt_id; });
  assert.equal(importReceipt(store, plain('2026-10-20T10:00:00Z'), { now: NOW }).status, 'imported');
  assert.equal(importReceipt(store, plain('2026-10-20T10:00:00Z'), { now: NOW }).status, 'duplicate');     // same second: caught as before
  assert.equal(importReceipt(store, plain('2026-10-27T10:00:00Z'), { now: NOW }).status, 'imported');      // a retake, same counts, another day
  assert.equal(readHistory(store).entries.length, 2);
});

test('BUG-35 with a receipt_id nothing changes: it is caught by the id, whatever the date', () => {
  const { store } = newStore();
  const withId = () => parsedWith((d) => { d.exam.taken_at = '2027-03-01T10:00:00Z'; d.created_at = '2027-03-01T10:20:00Z'; });
  importReceipt(store, withId(), { now: NOW });
  const again = importReceipt(store, withId(), { now: new Date(NOW.getTime() + 60000) });
  assert.equal(again.status, 'duplicate');
  assert.match(again.message, /already imported/);
});

test('BUG-35 receiptToEntry says when the date is a guess; a receipt with a usable date says it is not', () => {
  assert.equal(receiptToEntry(futureNoId(), { now: NOW }).dateIsGuessed, true);
  assert.equal(receiptToEntry(parsedWith(() => {}), { now: NOW }).dateIsGuessed, false);
  // a future taken_at with a past created_at uses created_at: a real date, not a guess
  const mixed = receiptToEntry(parsedWith((d) => { d.exam.taken_at = '2027-03-01T10:00:00Z'; d.created_at = '2026-10-30T09:00:00Z'; }), { now: NOW });
  assert.equal(mixed.dateIsGuessed, false);
});

test('BUG-35 findDuplicate: the details match is opt-in, needs an empty receipt_id, and a stronger match wins over it', () => {
  const totals = { total: 10, correct: 7, wrong: 2, skipped: 1, unsure: 3 };
  const stored = { id: 'q@2026-11-01T12:00:00.000Z', quiz_id: 'q', title: 'Quiz', started_at: '2026-11-01T12:00:00.000Z', totals, receipt_id: '' };
  const candidate = { id: 'q@2026-11-01T12:05:00.000Z', quiz_id: 'q', title: 'quiz', started_at: '2026-11-01T12:05:00.000Z', totals: { ...totals }, receipt_id: '' };
  assert.equal(findDuplicate([stored], candidate), null, 'off by default (backup restore uses this call)');
  assert.equal(findDuplicate([stored], candidate, { dateIsGuessed: false }), null);
  assert.equal(findDuplicate([stored], candidate, { dateIsGuessed: true }).by, 'details');
  assert.equal(findDuplicate([stored], { ...candidate, receipt_id: 'r-9' }, { dateIsGuessed: true }), null, 'a receipt with an id is judged by the id');
  assert.equal(findDuplicate([{ ...stored, totals: { ...totals, wrong: 3 } }], candidate, { dateIsGuessed: true }), null);
  assert.equal(findDuplicate([{ ...stored, totals: undefined }], candidate, { dateIsGuessed: true }), null, 'an entry with no totals never matches');
  assert.equal(findDuplicate([{ ...stored, quiz_id: '' }], { ...candidate, quiz_id: '' }, { dateIsGuessed: true }), null, 'an empty quiz id is not evidence');
  const strong = { ...stored, id: 'x', receipt_id: 'r-1', totals: { ...totals, wrong: 9 } };
  assert.equal(findDuplicate([stored, strong], { ...candidate, receipt_id: '' }, { dateIsGuessed: true }).by, 'details');
  assert.equal(findDuplicate([stored, { ...stored, id: 'y' }], { ...candidate, started_at: stored.started_at }, { dateIsGuessed: true }).by, 'exam', 'a date match is stronger than a details match');
});

// ---- the docs that record the decisions ---------------------------------------------------------------------------------
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

test('docs: RECEIPT_SPEC §9 says which date texts are accepted and how a receipt without receipt_id is matched', () => {
  const spec = read('docs/ai/RECEIPT_SPEC.md');
  assert.match(spec, /BUG-34/);
  assert.match(spec, /ISO 8601/);
  assert.match(spec, /BUG-35/);
  assert.match(spec, /receipt_id/);
});

test('docs: PLAN.md records D47 and D48 inside the one decisions table, and the checklist ticks BUG-34 and BUG-35', () => {
  const plan = read('docs/PLAN.md');
  assert.match(plan, /^\| D47 \| \*\*Decided \(BUG-34/m);
  assert.match(plan, /^\| D48 \| \*\*Decided \(BUG-35/m);
  const rows = plan.split('\n').filter((l) => /^\| D\d+ \|/.test(l));
  const first = plan.split('\n').indexOf(rows[0]);
  const last = plan.split('\n').indexOf(rows[rows.length - 1]);
  assert.ok(plan.split('\n').slice(first, last + 1).every((l) => l.startsWith('|')), 'a blank line would end the table (BUG-33)');
  const checklist = read('docs/DEV_CHECKLIST.md');
  assert.match(checklist, /^- \[x\] BUG-34 /m);
  assert.match(checklist, /^- \[x\] BUG-35 /m);
});
