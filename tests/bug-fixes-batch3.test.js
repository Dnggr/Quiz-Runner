// Tests for the fifth-pass bug flags that were fixed afterwards (2026-11-01):
// BUG-22 (a JSON text that contains the receipt marker), BUG-23 (a pack without `meta.quiz_id`), BUG-24 (a huge `duration_sec`
// in a receipt). BUG-25 (pinch-zoom) is a one-line change in index.html and is pinned in tests/a11y-static.test.js (D39).
// The decisions are D36-D39 in docs/PLAN.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadInput } from '../js/loader.js';
import { validatePack } from '../js/validator.js';
import { gradeExam } from '../js/grader.js';
import { importReceipt, receiptToEntry } from '../js/history.js';
import { buildReceipt, parseReceipt, isMarkdownReceipt, RECEIPT_BEGIN, RECEIPT_END } from '../js/receipt.js';
import { buildBackup, parseBackup, restoreBackup } from '../js/backup.js';
import { buildSession } from '../js/session.js';
import { selectOption } from '../js/exam.js';
import { readHistory } from '../js/history.js';
import { readSample, newStore, packWith, takeExam, answers } from './helpers.js';

const samplePack = () => JSON.parse(readSample('sample-pack.json'));
const codes = (list) => list.map((i) => i.code);

// ---- BUG-22 ----------------------------------------------------------------------------------------------------------
/** An exam whose pack has the receipt marker inside a question's explanation, taken and graded. */
function examWithMarker({ marker = true } = {}) {
  const pack = packWith('marker-01', [{ id: 't1', name: 'Networks' }, { id: 't2', name: 'Security' }]);
  if (marker) {
    pack.questions[0].explanation = `Do not write ${RECEIPT_BEGIN} or ${RECEIPT_END} in a file.`;
    pack.questions[1].question = `What does ${RECEIPT_BEGIN} start?`;
  }
  const session = buildSession(pack, new Date('2026-10-01T10:00:00.123Z'));
  let responses = session.responses;
  for (const [n, l] of Object.entries(answers(pack, [3, 4]))) responses = selectOption(responses, Number(n), l);
  const graded = gradeExam(pack, responses);
  const receipt = buildReceipt({
    pack, graded, startedAt: session.started_at, finishedAt: null, now: new Date('2026-11-01T08:00:00.000Z'),
    tzOffsetMinutes: 0, snapshots: [], options: {},
  });
  return { pack, receipt };
}

test('BUG-22 a .json receipt with the marker inside a question or explanation is read as JSON', () => {
  const { receipt } = examWithMarker();
  assert.ok(receipt.json.includes(RECEIPT_BEGIN), 'the repro needs the marker in the JSON text');
  const parsed = parseReceipt(receipt.json);
  assert.equal(parsed.ok, true, parsed.errors.join('; '));
  assert.equal(parsed.source, 'json');
  assert.equal(parsed.data.exam.quiz_id, 'marker-01');
});

test('BUG-22 the Markdown form of the same receipt still imports, and so does text before the marker', () => {
  const { receipt } = examWithMarker();
  const md = parseReceipt(receipt.markdown);
  assert.equal(md.ok, true, md.errors.join('; '));
  assert.equal(md.source, 'markdown');
  const withPreamble = parseReceipt(`Here is my receipt:\n\n${receipt.markdown}\n\nthanks`);
  assert.equal(withPreamble.ok, true, withPreamble.errors.join('; '));
  assert.equal(withPreamble.source, 'markdown');
});

test('BUG-22 a cut-off Markdown receipt still says the end marker is missing', () => {
  const { receipt } = examWithMarker();
  const cut = receipt.markdown.slice(0, receipt.markdown.indexOf(RECEIPT_END));
  const parsed = parseReceipt(cut);
  assert.equal(parsed.ok, false);
  assert.match(parsed.errors[0], /cut off/);
});

test('BUG-22 a backup whose packs contain the marker is a backup, not "a receipt"', () => {
  const { store } = newStore();
  const pack = packWith('marker-01', [{ id: 't1', name: 'Networks' }, { id: 't2', name: 'Security' }]);
  pack.questions[0].explanation = `Never type ${RECEIPT_BEGIN} here.`;
  takeExam(store, pack, '2026-10-01T10:00:00.000Z', answers(pack, [1, 2]));
  const backup = buildBackup(store, { now: new Date('2026-11-01T08:00:00.000Z') });
  assert.equal(backup.ok, true);
  assert.ok(backup.text.includes(RECEIPT_BEGIN), 'the repro needs the marker in the backup text');
  const parsed = parseBackup(backup.text);
  assert.equal(parsed.ok, true, parsed.errors.join('; '));
  assert.deepEqual([parsed.counts.exams, parsed.counts.packs], [1, 1]);

  // and it restores onto an empty device
  const target = newStore().store;
  const restored = restoreBackup(target, parsed);
  assert.equal(restored.ok, true);
  assert.equal(readHistory(target).entries.length, 1);
});

test('BUG-22 a real Markdown receipt given to the backup import is still refused as a receipt', () => {
  const { receipt } = examWithMarker();
  assert.match(parseBackup(receipt.markdown).errors[0], /receipt, not a backup/);
  assert.match(parseBackup(`note\n${receipt.markdown}`).errors[0], /receipt, not a backup/);
  assert.match(parseBackup('<!-- BEGIN RECEIPT -->\n# QUIZ RUNNER RECEIPT').errors[0], /receipt, not a backup/);
});

test('BUG-22 isMarkdownReceipt: JSON text never counts, other text counts when it holds the begin marker', () => {
  assert.equal(isMarkdownReceipt(`{"a":"${RECEIPT_BEGIN}"}`), false);
  assert.equal(isMarkdownReceipt(RECEIPT_BEGIN), true);
  assert.equal(isMarkdownReceipt(`text ${RECEIPT_BEGIN}`), true);
  assert.equal(isMarkdownReceipt('plain text'), false);
  assert.equal(isMarkdownReceipt(''), false);
});

// ---- BUG-23 ----------------------------------------------------------------------------------------------------------
test('BUG-23 a pack without meta.quiz_id is refused with an error that names meta.quiz_id (repro: the sample pack minus quiz_id)', () => {
  const p = samplePack();
  delete p.meta.quiz_id;
  const res = loadInput(JSON.stringify(p));
  assert.equal(res.kind, 'pack');
  assert.equal(res.ok, false);
  assert.deepEqual(codes(res.errors), ['missing_quiz_id']);
  assert.match(res.errors[0].message, /meta\.quiz_id/);
  assert.equal(res.errors[0].index, null, 'a pack-level issue, listed before the questions');
});

test('BUG-23 a blank, null or non-text quiz_id is refused too; a wrong shape is named by its kind, never echoed', () => {
  for (const bad of ['', '   ', null]) {
    const p = samplePack();
    p.meta.quiz_id = bad;
    assert.deepEqual(codes(validatePack(p).errors), ['missing_quiz_id'], JSON.stringify(bad));
  }
  for (const [bad, kind] of [[5, 'a number'], [true, 'true or false'], [['a'], 'a list'], [{ secret: 'x' }, 'an object']]) {
    const p = samplePack();
    p.meta.quiz_id = bad;
    const { errors } = validatePack(p);
    assert.deepEqual(codes(errors), ['missing_quiz_id']);
    assert.ok(errors[0].message.includes(kind), kind);
    assert.ok(!errors[0].message.includes('secret'));
  }
});

test('BUG-23 a pack with no meta at all reports the missing quiz_id once; a normal pack still loads without it', () => {
  const p = samplePack();
  delete p.meta;
  assert.equal(codes(validatePack(p).errors).filter((c) => c === 'missing_quiz_id').length, 1);
  assert.equal(loadInput(readSample('sample-pack.json')).ok, true);
});

test('BUG-23 every sample pack that is meant to load still has a quiz_id and loads', () => {
  for (const name of ['sample-pack.json']) {
    const res = loadInput(readSample(name));
    assert.equal(res.ok, true, name);
  }
});

// ---- BUG-24 ----------------------------------------------------------------------------------------------------------
function receiptWith(duration) {
  const { receipt } = examWithMarker({ marker: false });   // no marker here: BUG-24 is tested on its own
  const data = JSON.parse(receipt.json);
  if (duration === undefined) delete data.exam.duration_sec;
  else data.exam.duration_sec = duration;
  const parsed = parseReceipt(JSON.stringify(data));
  assert.equal(parsed.ok, true, parsed.errors.join('; '));
  return parsed;
}

test('BUG-24 a huge duration_sec no longer throws: the duration is ignored with a warning, the exam is still imported', () => {
  for (const huge of [1e300, 8.64e12, 8.64e15, Number.MAX_VALUE]) {
    let res;
    assert.doesNotThrow(() => { res = receiptToEntry(receiptWith(huge)); }, String(huge));
    assert.equal(res.ok, true, String(huge));
    assert.equal(res.entry.finished_at, '');
    assert.ok(res.warnings.some((w) => /duration/.test(w)), `a warning for ${huge}`);
  }
});

test('BUG-24 through importReceipt: no crash, and the entry is saved', () => {
  const { store } = newStore();
  const res = importReceipt(store, receiptWith(1e300));
  assert.equal(res.ok, true);
  assert.equal(res.status, 'imported');
  assert.equal(readHistory(store).entries.length, 1);
});

test('BUG-24 a normal duration is kept, and so is an absent, zero or negative one (no warning for those)', () => {
  const normal = receiptToEntry(receiptWith(540));
  assert.equal(normal.ok, true);
  assert.equal(Date.parse(normal.entry.finished_at) - Date.parse(normal.entry.started_at), 540000);
  assert.ok(!normal.warnings.some((w) => /duration/.test(w)));

  const zero = receiptToEntry(receiptWith(0));
  assert.equal(zero.entry.finished_at, zero.entry.started_at);

  for (const odd of [undefined, -5]) {
    const res = receiptToEntry(receiptWith(odd));
    assert.equal(res.ok, true);
    assert.equal(res.entry.finished_at, '');
    assert.ok(!res.warnings.some((w) => /duration/.test(w)));
  }
});

test('BUG-24 the largest duration that still gives a normal date is kept', () => {
  const parsed = receiptWith(1);
  const started = Date.parse(receiptToEntry(parsed).entry.started_at);
  const room = Math.floor((Date.UTC(9999, 11, 31, 23, 59, 59, 999) - started) / 1000);
  const ok = receiptToEntry(receiptWith(room));
  assert.equal(ok.ok, true);
  assert.ok(ok.entry.finished_at.startsWith('9999-'));
  const tooMuch = receiptToEntry(receiptWith(room + 1));
  assert.equal(tooMuch.entry.finished_at, '');
});
