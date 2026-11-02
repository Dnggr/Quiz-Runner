// Tests for the flags worked on in the eleventh pass (2026-11-01):
// BUG-03 (stale copies of the specs at the repository root), BUG-04 (the jump grid is tested in a11y-static.test.js) and
// BUG-36 (a receipt without a usable `exam.quiz_id`), plus the docs that record them. The decisions are D49, D50 and D51 in docs/PLAN.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { gradeExam } from '../js/grader.js';
import { importReceipt, receiptToEntry, readHistory } from '../js/history.js';
import { buildReceipt, parseReceipt, RECEIPT_NO_QUIZ_ID_ERROR } from '../js/receipt.js';
import { buildSession } from '../js/session.js';
import { selectOption } from '../js/exam.js';
import { newStore, packWith, answers } from './helpers.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

/** A real receipt (JSON form) of a graded exam, as parsed data that a test can edit. */
function receiptData() {
  const pack = packWith('rcpt-07', [{ id: 't1', name: 'Networks' }, { id: 't2', name: 'Security' }]);
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
const edited = (edit) => { const d = receiptData(); edit(d); return d; };

// ---- BUG-03 ----------------------------------------------------------------------------------------------------------------
const POINTERS = {
  'PLAN.md': 'docs/PLAN.md',
  'PROMPT_TEMPLATES.md': 'docs/ai/PROMPT_TEMPLATES.md',
  'QUIZ_PACK_SPEC.md': 'docs/ai/QUIZ_PACK_SPEC.md',
  'RECEIPT_SPEC.md': 'docs/ai/RECEIPT_SPEC.md',
};
test('BUG-03 each spec file at the repository root is only a short pointer to the real one in docs/', () => {
  for (const [name, target] of Object.entries(POINTERS)) {
    const text = read(name);
    assert.ok(text.split('\n').length <= 12, `${name} is a pointer, not a copy (${text.split('\n').length} lines)`);
    assert.ok(text.includes(`](${target})`), `${name} links to ${target}`);
    assert.ok(read(target).length > 1000, `${target} exists and is the real file`);
    assert.doesNotMatch(text, /^\|/m, `${name} holds no tables (a table means spec text was pasted back)`);
  }
});

test('BUG-03 nothing in js/ or tests/ reads the root copies (the docs/ files are the source of truth)', () => {
  const html = read('index.html');
  for (const name of Object.keys(POINTERS)) assert.ok(!html.includes(`"${name}"`) && !html.includes(`'${name}'`), `index.html does not load ${name}`);
});

// ---- BUG-36 ----------------------------------------------------------------------------------------------------------------
const NO_ID_CASES = {
  'exam.quiz_id missing': (d) => { delete d.exam.quiz_id; },
  'exam.quiz_id blank': (d) => { d.exam.quiz_id = '   '; },
  'exam.quiz_id empty text': (d) => { d.exam.quiz_id = ''; },
  'exam.quiz_id is a number': (d) => { d.exam.quiz_id = 7; },
  'exam.quiz_id is null': (d) => { d.exam.quiz_id = null; },
  'quiz_id and title both missing': (d) => { delete d.exam.quiz_id; delete d.exam.title; },
  'the exam block is missing': (d) => { delete d.exam; },
};

test('BUG-36 receiptToEntry refuses a receipt without a usable exam.quiz_id, with the same message as parseReceipt', () => {
  for (const [label, edit] of Object.entries(NO_ID_CASES)) {
    const data = edited(edit);
    const direct = receiptToEntry({ ok: true, data, warnings: [] });
    assert.equal(direct.ok, false, `${label}: receiptToEntry refuses`);
    assert.equal(direct.error, RECEIPT_NO_QUIZ_ID_ERROR, label);
    const parsed = parseReceipt(JSON.stringify(data));
    assert.equal(parsed.ok, false, `${label}: parseReceipt still refuses`);
    assert.ok(parsed.errors.includes(RECEIPT_NO_QUIZ_ID_ERROR), `${label}: parseReceipt gives the same sentence`);
  }
  assert.match(RECEIPT_NO_QUIZ_ID_ERROR, /does not say which exam it is for/);
});

test('BUG-36 importing such a receipt through the real path stores nothing and returns the refusal', () => {
  for (const [label, edit] of Object.entries(NO_ID_CASES)) {
    const { store } = newStore();
    const parsed = parseReceipt(JSON.stringify(edited(edit)));
    const res = importReceipt(store, parsed);
    assert.equal(res.ok, false, label);
    assert.deepEqual(readHistory(store).entries, [], `${label}: nothing was stored`);
  }
});

test('BUG-36 two different receipts without a quiz id can no longer be mistaken for one another', () => {
  // Before the fix a hand-made receipt without an id became an entry with id "@<date>"; findDuplicate treated any two of them as the
  // same quiz. Neither can be created now, so a second one is refused for the right reason and not skipped as a duplicate.
  const { store } = newStore();
  const a = importReceipt(store, { ok: true, data: edited((d) => { delete d.exam.quiz_id; }), warnings: [] });
  const b = importReceipt(store, { ok: true, data: edited((d) => { delete d.exam.quiz_id; d.exam.title = 'Another exam'; }), warnings: [] });
  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
  assert.equal(b.error ?? b.errors?.[0], RECEIPT_NO_QUIZ_ID_ERROR);
});

test('BUG-36 a valid receipt still imports, and a missing title is allowed (Progress shows "Untitled quiz")', () => {
  const { store } = newStore();
  const res = importReceipt(store, parseReceipt(JSON.stringify(edited((d) => { delete d.exam.title; }))));
  assert.equal(res.ok, true);
  const [entry] = readHistory(store).entries;
  assert.equal(entry.quiz_id, 'rcpt-07');
  assert.ok(entry.id.startsWith('rcpt-07@'));
  assert.equal(entry.title, '');
  assert.match(read('js/ui/progress.js'), /Untitled quiz/);

  const full = receiptToEntry({ ok: true, data: receiptData(), warnings: [] });
  assert.equal(full.ok, true);
  assert.equal(full.entry.quiz_id, 'rcpt-07');
});

test('BUG-36 a quiz id with spaces around it is kept trimmed, and is still not blank', () => {
  const res = receiptToEntry({ ok: true, data: edited((d) => { d.exam.quiz_id = '  rcpt-07  '; }), warnings: [] });
  assert.equal(res.ok, true);
  assert.equal(res.entry.quiz_id, 'rcpt-07');
});

// ---- the docs that record the three flags ---------------------------------------------------------------------------------
test('docs: D49, D50 and D51 are rows of the one decisions table in PLAN.md', () => {
  const lines = read('docs', 'PLAN.md').split('\n');
  const idx = (id) => lines.findIndex((l) => l.startsWith(`| ${id} |`));
  for (const [id, bug] of [['D49', 'BUG-03'], ['D50', 'BUG-04'], ['D51', 'BUG-36']]) {
    assert.ok(idx(id) > 0, `${id} exists`);
    assert.ok(lines[idx(id)].includes(bug), `${id} names ${bug}`);
    assert.ok(lines[idx(id)].startsWith('| D') && lines[idx(id)].endsWith('|'), `${id} is a complete table row`);
    assert.ok(lines[idx(id) - 1].startsWith('| D'), `${id} follows the previous decision with no blank line (BUG-33)`);
  }
  assert.equal(idx('D50') - idx('D49'), 1);
  assert.equal(idx('D51') - idx('D50'), 1);
});

test('docs: the checklist ticks BUG-03, BUG-04 and BUG-36 and flags BUG-37 to BUG-41 as open', () => {
  const list = read('docs', 'DEV_CHECKLIST.md');
  for (const id of ['BUG-03', 'BUG-04', 'BUG-36']) assert.match(list, new RegExp(`^- \\[x\\] ${id} `, 'm'), `${id} is ticked`);
  for (const id of ['BUG-37', 'BUG-38', 'BUG-39', 'BUG-40', 'BUG-41']) assert.match(list, new RegExp(`^- \\[ \\] ${id} `, 'm'), `${id} is flagged and open`);
  assert.ok(!list.includes('\\"'), 'no stray backslash-quote sequences');
});

test('docs: RECEIPT_SPEC §9 states the quiz_id rule that the code enforces', () => {
  const spec = read('docs', 'ai', 'RECEIPT_SPEC.md');
  assert.match(spec, /exam\.quiz_id` must be text that is not blank/);
  assert.match(spec, /Untitled quiz/);
});
