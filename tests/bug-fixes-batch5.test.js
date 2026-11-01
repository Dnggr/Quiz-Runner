// Tests for the flags worked on in the ninth pass (2026-11-01):
// BUG-30 (a receipt that claims any number of questions), BUG-31 (the other required `meta` fields),
// BUG-32 (a receipt dated in the future). BUG-33 is a docs fix (a blank line in the decisions table), pinned at the end.
// The decisions are D44-D46 in docs/PLAN.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadInput } from '../js/loader.js';
import { gradeExam } from '../js/grader.js';
import { importReceipt, receiptToEntry, readHistory } from '../js/history.js';
import { buildReceipt, parseReceipt } from '../js/receipt.js';
import { buildSession } from '../js/session.js';
import { selectOption } from '../js/exam.js';
import { RECEIPT_FUTURE_SLACK_MS, MAX_PACK_QUESTIONS } from '../js/constants.js';
import { newStore, packWith, answers, readSample } from './helpers.js';

/** A real receipt (JSON form) of a graded exam, as parsed data that a test can edit before importing. */
function receiptData() {
  const pack = packWith('rcpt-05', [{ id: 't1', name: 'Networks' }, { id: 't2', name: 'Security' }]);
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

// ---- BUG-30 ----------------------------------------------------------------------------------------------------------
const claim = (total) => (d) => { d.exam.total = total; d.result.correct = total; d.result.wrong = 0; d.result.skipped = 0; d.result.unsure = 0; };

test('BUG-30 repros: a receipt claiming 1e300 or 9e15 questions is refused, with the "may have been edited" wording', () => {
  for (const total of [1e300, 9e15, MAX_PACK_QUESTIONS + 1]) {
    const res = receiptToEntry(parsedWith(claim(total)), { now: NOW });
    assert.equal(res.ok, false, String(total));
    assert.match(res.error, /may have been edited/);
    assert.match(res.error, new RegExp(`at most ${MAX_PACK_QUESTIONS}`));
  }
});

test('BUG-30 the limit is MAX_PACK_QUESTIONS itself: 1000 questions import, 1001 do not', () => {
  const ok = receiptToEntry(parsedWith(claim(MAX_PACK_QUESTIONS)), { now: NOW });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.entry.totals.total, MAX_PACK_QUESTIONS);
  assert.equal(ok.entry.totals.percent, 100);
  assert.equal(receiptToEntry(parsedWith(claim(MAX_PACK_QUESTIONS + 1)), { now: NOW }).ok, false);
});

test('BUG-30 through importReceipt: nothing is saved for a refused receipt; a normal receipt is unchanged', () => {
  const { store } = newStore();
  const refused = importReceipt(store, parsedWith(claim(1e300)), { now: NOW });
  assert.equal(refused.ok, false);
  assert.equal(readHistory(store).entries.length, 0);
  const fine = importReceipt(store, parsedWith(() => {}), { now: NOW });
  assert.equal(fine.ok, true);
  assert.equal(readHistory(store).entries.length, 1);
});

// ---- BUG-31 ----------------------------------------------------------------------------------------------------------
const loadSample = (edit) => {
  const pack = JSON.parse(readSample('sample-pack.json'));
  edit(pack.meta);
  return loadInput(JSON.stringify(pack));
};
const missingWarnings = (r) => r.warnings.filter((w) => w.code === 'meta_field_missing');

test('BUG-31 the sample pack has all four fields and gets no such warning', () => {
  const r = loadSample(() => {});
  assert.equal(r.ok, true);
  assert.equal(missingWarnings(r).length, 0);
});

test('BUG-31 repro: removing any one of title, subject, quiz_type, total_questions still loads, with exactly one warning that names the field', () => {
  for (const field of ['title', 'subject', 'quiz_type', 'total_questions']) {
    const r = loadSample((m) => { delete m[field]; });
    assert.equal(r.ok, true, `${field}: the pack still loads`);
    assert.equal(r.errors.length, 0, field);
    const w = missingWarnings(r);
    assert.equal(w.length, 1, field);
    assert.ok(w[0].message.startsWith(`meta.${field} is missing`), w[0].message);
    assert.equal(w[0].number, null, 'a pack-level warning');
  }
});

test('BUG-31 a blank or non-text value counts as missing for the text fields; a blank total_questions too', () => {
  for (const [field, value] of [['title', ''], ['title', '   '], ['subject', null], ['quiz_type', 7], ['total_questions', ''], ['total_questions', null]]) {
    const r = loadSample((m) => { m[field] = value; });
    assert.equal(r.ok, true);
    assert.equal(missingWarnings(r).length, 1, `${field}=${JSON.stringify(value)}`);
  }
});

test('BUG-31 a total_questions that is present but unusable keeps its own warning and is not reported twice; an absent one gives no count warning', () => {
  const bad = loadSample((m) => { m.total_questions = 'many'; });
  assert.equal(missingWarnings(bad).length, 0);
  assert.equal(bad.warnings.filter((w) => w.code === 'meta_number_invalid').length, 1);
  const absent = loadSample((m) => { delete m.total_questions; });
  assert.equal(absent.warnings.filter((w) => w.code === 'count_mismatch').length, 0);
});

test('BUG-31 all four missing: four warnings, no errors, and the missing quiz_id is still the only blocking meta field', () => {
  const r = loadSample((m) => { for (const f of ['title', 'subject', 'quiz_type', 'total_questions']) delete m[f]; });
  assert.equal(r.ok, true);
  assert.equal(missingWarnings(r).length, 4);
  const noId = loadSample((m) => { delete m.quiz_id; });
  assert.equal(noId.ok, false);
});

test('BUG-31 the warning says what an empty subject does (it is only compared with other exams without a subject) without echoing pack text', () => {
  const r = loadSample((m) => { m.subject = ''; });
  assert.match(missingWarnings(r)[0].message, /only compared with other exams that also have none/);
});

// ---- BUG-32 ----------------------------------------------------------------------------------------------------------
test('BUG-32 repro: an exam date far in the future is not used; the creation time is, with a warning that names the future date', () => {
  const res = receiptToEntry(parsedWith((d) => { d.exam.taken_at = '9000-01-01T00:00:00Z'; }), { now: NOW });
  assert.equal(res.ok, true, res.error);
  assert.ok(res.entry.started_at.startsWith('2026-11-01'), 'the creation time was used');
  assert.ok(res.warnings.some((w) => /in the future/.test(w)));
  assert.ok(!res.warnings.some((w) => /no valid exam date/.test(w)), 'the future case has its own wording');
});

test('BUG-32 a date a few days or years ahead is treated the same way', () => {
  for (const taken of ['2026-11-05T00:00:00Z', '2029-01-01T00:00:00Z']) {
    const res = receiptToEntry(parsedWith((d) => { d.exam.taken_at = taken; }), { now: NOW });
    assert.equal(res.ok, true, taken);
    assert.ok(res.entry.started_at.startsWith('2026-11-01'), taken);
    assert.ok(res.warnings.some((w) => /in the future/.test(w)), taken);
  }
});

test('BUG-32 a device whose clock was ahead (both dates in the future): the receipt imports and is dated at the moment of import', () => {
  const res = receiptToEntry(parsedWith((d) => { d.exam.taken_at = '2027-03-01T10:00:00Z'; d.created_at = '2027-03-01T10:20:00Z'; }), { now: NOW });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.entry.started_at, NOW.toISOString());
  assert.ok(res.warnings.some((w) => /imported as the exam date|time it was imported/.test(w)));
  assert.ok(new Date(res.entry.started_at).getTime() <= NOW.getTime(), 'never ahead of the clock');
});

test('BUG-32 one day of slack: now + 1 day is accepted as it is, one millisecond more is not', () => {
  const at = (ms) => new Date(NOW.getTime() + ms).toISOString();
  const ok = receiptToEntry(parsedWith((d) => { d.exam.taken_at = at(RECEIPT_FUTURE_SLACK_MS); }), { now: NOW });
  assert.equal(ok.entry.started_at, at(RECEIPT_FUTURE_SLACK_MS));
  assert.ok(!ok.warnings.some((w) => /future/.test(w)));
  const over = receiptToEntry(parsedWith((d) => { d.exam.taken_at = at(RECEIPT_FUTURE_SLACK_MS + 1); }), { now: NOW });
  assert.ok(over.entry.started_at.startsWith('2026-11-01'));
  assert.ok(over.warnings.some((w) => /in the future/.test(w)));
});

test('BUG-32 a garbled date is still "no valid date" (BUG-29), and refused when nothing is usable; a normal receipt gives no date warning', () => {
  const garbled = receiptToEntry(parsedWith((d) => { d.exam.taken_at = '0001-01-01T00:00:00Z'; }), { now: NOW });
  assert.ok(garbled.warnings.some((w) => /no valid exam date/.test(w)));
  const none = receiptToEntry(parsedWith((d) => { d.exam.taken_at = 'nope'; d.created_at = 'nope'; }), { now: NOW });
  assert.equal(none.ok, false);
  assert.match(none.error, /usable date/);
  const normal = receiptToEntry(parsedWith(() => {}), { now: NOW });
  assert.ok(!normal.warnings.some((w) => /date|future/.test(w)));
});

test('BUG-32 end to end: a far-future receipt cannot become the "latest" exam; a later real exam still sorts after it', () => {
  const { store } = newStore();
  importReceipt(store, parsedWith((d) => { d.exam.taken_at = '9000-01-01T00:00:00Z'; d.created_at = '9000-01-01T00:20:00Z'; }), { now: NOW });
  const [entry] = readHistory(store).entries;
  assert.ok(new Date(entry.started_at).getTime() <= NOW.getTime());
  assert.ok(new Date('2026-11-02T09:00:00Z').getTime() > new Date(entry.started_at).getTime(), 'the next real exam is newer than the imported one');
});

// ---- BUG-33 ----------------------------------------------------------------------------------------------------------
test('BUG-33 the decisions table in docs/PLAN.md has no blank line between its rows (it would end the table)', () => {
  const plan = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', 'docs', 'PLAN.md'), 'utf8').split('\n');
  const rows = plan.map((line, i) => ({ line, i })).filter(({ line }) => /^\| D\d+ \|/.test(line));
  assert.ok(rows.length >= 43, 'D1 to D43 at least');
  for (let k = 1; k < rows.length; k++) {
    assert.equal(rows[k].i, rows[k - 1].i + 1, `${rows[k].line.slice(0, 6)} follows the row before it with no gap`);
  }
});
