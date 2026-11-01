// Tests for the owner-decision bugs of the 2026-10-31 audit that were decided and fixed afterwards:
// BUG-07 (allocation floor), BUG-08 (question number), BUG-09 (topic names stored with the exam), BUG-11 (rating on the shown
// percentage), BUG-12 (options and topic ids), BUG-13 (Quick Paste left as it is), BUG-15 (type), BUG-17 (numbers written as
// text), BUG-19 (receipt import checks), BUG-20 (fixed-value fields). The decisions are D26-D35 in docs/PLAN.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadInput, normalizePack, parseLegacyText } from '../js/loader.js';
import { validatePack } from '../js/validator.js';
import { completeness } from '../js/parts.js';
import { summarizePack } from '../js/packsummary.js';
import { gradeExam, ratingForPercent } from '../js/grader.js';
import { analyzeExam, allocateNextExam, storedTopics } from '../js/analytics.js';
import { importReceipt, receiptToEntry, readHistory, loadSnapshots } from '../js/history.js';
import { buildReceipt, parseReceipt } from '../js/receipt.js';
import { buildBackup, parseBackup } from '../js/backup.js';
import { buildSession } from '../js/session.js';
import { selectOption } from '../js/exam.js';
import { HISTORY_SCHEMA_VERSION, packKey } from '../js/constants.js';
import { basePack, readSample, newStore, packWith, takeExam, answers } from './helpers.js';

const load = (pack) => loadInput(JSON.stringify(pack));
const codes = (list) => list.map((i) => i.code);
const samplePack = () => JSON.parse(readSample('sample-pack.json'));

// ---- BUG-07 ----------------------------------------------------------------------------------------------------------
const topic = (id, status, misses, n = 4) => ({
  id, name: id, total: n, correct: n - misses, wrong: misses, skipped: 0, unsure: 0, shaky: 0, misses, accuracy: (n - misses) / n, shakyRatio: 0, status,
});
const weakTopics = (k) => Array.from({ length: k }, (_, i) => topic(`w${i}`, 'weak', 4 - (i % 3)));
const others = () => [topic('m1', 'watch', 1), topic('m2', 'developing', 2), topic('s1', 'strong', 0), topic('s2', 'strong', 0)];
const countsOf = (alloc) => Object.fromEntries(alloc.allocations.map((a) => [a.topic, a.count]));
const sumOf = (alloc) => alloc.allocations.reduce((n, a) => n + a.count, 0);

test('BUG-07 no weak topic is left without a question: 7 weak topics at N = 10 get one each (the weak share grows, the others give)', () => {
  const alloc = allocateNextExam([...weakTopics(7), ...others()], 10);
  const c = countsOf(alloc);
  assert.equal(sumOf(alloc), 10);
  for (let i = 0; i < 7; i++) assert.ok(c[`w${i}`] >= 1, `w${i} has a question`);
  assert.equal(Object.keys(c).filter((id) => id.startsWith('w')).length, 7);
});

test('BUG-07 the 60% share is kept while it can give each weak topic a question (4 weak at N = 10: 6 questions), and 2 each when it can (3 weak at N = 40)', () => {
  const alloc = allocateNextExam([...weakTopics(4), ...others()], 10);
  const weak = Object.entries(countsOf(alloc)).filter(([id]) => id.startsWith('w')).map(([, n]) => n);
  assert.equal(weak.reduce((a, b) => a + b, 0), 6, 'the 60% share is kept when it is big enough for one each');
  assert.ok(weak.every((n) => n >= 1));
  const roomy = countsOf(allocateNextExam([...weakTopics(3), ...others()], 40));
  assert.ok(['w0', 'w1', 'w2'].every((id) => roomy[id] >= 2), 'at N = 40 three weak topics get at least 2 each');
});

test('BUG-07 when there are more weak topics than questions, the most missed topics get the questions, one each', () => {
  const alloc = allocateNextExam(weakTopics(15), 10);
  assert.equal(sumOf(alloc), 10);
  assert.equal(alloc.allocations.length, 10);
  assert.ok(alloc.allocations.every((a) => a.count === 1));
  const c = countsOf(alloc);
  // misses are 4 for w0, w3, w6, w9, w12; 3 for w1, w4, w7, w10, w13; 2 for w2, w5, w8, w11, w14: the 2-miss topics are the ones left out
  for (const id of ['w0', 'w3', 'w6', 'w9', 'w12', 'w1', 'w4', 'w7', 'w10', 'w13']) assert.equal(c[id], 1, id);
  for (const id of ['w2', 'w5', 'w8', 'w11', 'w14']) assert.equal(c[id], undefined, id);
});

test('BUG-07 every N from 10 to 130 and 1 to 15 weak topics: the total is exactly N and no weak topic is dropped while N allows it', () => {
  for (let n = 10; n <= 130; n++) {
    for (let k = 1; k <= 15; k++) {
      const alloc = allocateNextExam([...weakTopics(k), ...others()], n);
      assert.equal(sumOf(alloc), n, `N=${n} weak=${k}`);
      const c = countsOf(alloc);
      const weakWithQuestions = Object.keys(c).filter((id) => id.startsWith('w')).length;
      assert.equal(weakWithQuestions, Math.min(k, n), `N=${n} weak=${k}: weak topics with a question`);
    }
  }
});

// ---- BUG-11 ----------------------------------------------------------------------------------------------------------
const gradeOf = (correct, total) => {
  const pack = { questions: Array.from({ length: total }, (_, i) => ({ number: i + 1, topic: 't1', answer: 'A' })) };
  const responses = {};
  for (let i = 1; i <= correct; i++) responses[i] = { selected: 'A', unsure: false };
  return gradeExam(pack, responses);
};

test('BUG-11 the rating follows the percentage the learner sees: 269/299 shows 90 and is Excellent, not Good', () => {
  const { totals } = gradeOf(269, 299);
  assert.equal(totals.percent, 90);
  assert.equal(totals.rating, 'Excellent');
});
test('BUG-11 the same at the 75 and 60 edges (1499/2000 = 74.95 shows 75; 1199/2000 = 59.95 shows 60)', () => {
  assert.deepEqual([gradeOf(1499, 2000).totals.percent, gradeOf(1499, 2000).totals.rating], [75, 'Good']);
  assert.deepEqual([gradeOf(1199, 2000).totals.percent, gradeOf(1199, 2000).totals.rating], [60, 'Fair']);
});
test('BUG-11 a score clearly below an edge is not moved, and the rating always equals the rating of the shown percentage', () => {
  assert.equal(gradeOf(89, 100).totals.rating, 'Good');
  for (let t = 1; t <= 300; t++) {
    for (let c = 0; c <= t; c++) {
      const { percent, rating } = gradeOf(c, t).totals;
      assert.equal(rating, ratingForPercent(percent), `${c}/${t}`);
    }
  }
});
test('BUG-11 analyzeExam reports the same rating as the totals', () => {
  const pack = basePack();
  const graded = gradeExam(pack, { 1: { selected: 'B' }, 2: { selected: 'D' }, 3: { selected: 'A' }, 4: { selected: 'C' } });
  assert.equal(analyzeExam(pack, graded).rating, graded.totals.rating);
});

// ---- BUG-08 ----------------------------------------------------------------------------------------------------------
test('BUG-08 a question without a number blocks loading, one error per question', () => {
  const p = samplePack();
  for (const q of p.questions) delete q.number;
  const res = load(p);
  assert.equal(res.ok, false);
  assert.equal(res.errors.filter((e) => e.code === 'bad_number').length, p.questions.length);
  assert.match(res.errors[0].message, /needs a "number"/);
  assert.equal(res.errors.some((e) => e.code === 'duplicate_number'), false, 'unnumbered questions are not "duplicates" of each other');
});

test('BUG-08 a number that is not a whole number from 1 up blocks loading (1.5, 0, -2, text, null, a list)', () => {
  for (const bad of [1.5, 0, -2, 'abc', '1.5', '', null, [1], { n: 1 }, true]) {
    const p = basePack();
    p.questions[0].number = bad;
    const res = load(p);
    assert.equal(res.ok, false, `number ${JSON.stringify(bad)} should block`);
    assert.ok(codes(res.errors).includes('bad_number'), JSON.stringify(bad));
  }
});

test('BUG-08 a number written as digits is converted: "3" becomes 3, and "Loaded 10 of 10" is reported instead of "0 of 10"', () => {
  const p = samplePack();
  p.questions.forEach((q) => { q.number = String(q.number); });
  const res = load(p);
  assert.equal(res.ok, true, res.errors.map((e) => e.message).join('; '));
  assert.ok(res.pack.questions.every((q) => Number.isInteger(q.number)));
  const c = completeness(res.pack);
  assert.deepEqual([c.loaded, c.total, c.missing], [10, 10, []]);
});

test('BUG-08 "3" and 3 in one pack are a duplicate number once converted', () => {
  const p = basePack();
  p.questions[1].number = 1;
  p.questions[0].number = '1';
  const res = load(p);
  assert.equal(res.ok, false);
  assert.deepEqual(codes(res.errors), ['duplicate_number']);
});

test('BUG-08 the Repair prompt lines name the problem (the messages are the validator\'s own)', () => {
  const p = basePack();
  delete p.questions[2].number;
  const { errors } = load(p);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /position 3 needs a "number" that is a whole number from 1 up .*there is none/);
});

// ---- BUG-17 ----------------------------------------------------------------------------------------------------------
test('BUG-17 "total_questions": "130" (text) is read as 130, so the count warning and the missing numbers work', () => {
  const p = samplePack();
  p.meta.total_questions = '12';
  const res = load(p);
  assert.equal(res.ok, true);
  assert.equal(res.pack.meta.total_questions, 12);
  assert.ok(codes(res.warnings).includes('count_mismatch'));
  const c = completeness(res.pack);
  assert.deepEqual([c.loaded, c.total, c.missing], [10, 12, [11, 12]]);
});

test('BUG-17 "part": "2" and "total_parts": "3" are read as numbers, so the part progress is right', () => {
  const p = basePack();
  p.meta.part = '2';
  p.meta.total_parts = ' 3 ';
  const res = load(p);
  assert.deepEqual([res.pack.meta.part, res.pack.meta.total_parts], [2, 3]);
  assert.equal(codes(res.warnings).includes('meta_number_invalid'), false);
});

test('BUG-17 a count that cannot be read as a whole number gets a warning and is ignored (it never blocks loading)', () => {
  for (const [field, bad] of [['total_questions', 'many'], ['total_questions', 12.5], ['total_questions', 0], ['part', 'two'], ['total_parts', -1], ['quiz_number', 'x']]) {
    const p = basePack();
    p.meta[field] = bad;
    const res = load(p);
    assert.equal(res.ok, true, `${field}=${JSON.stringify(bad)} still loads`);
    assert.ok(codes(res.warnings).includes('meta_number_invalid'), `${field}=${JSON.stringify(bad)}`);
    assert.ok(res.warnings.find((w) => w.code === 'meta_number_invalid').message.includes(`meta.${field}`));
    if (field === 'total_questions') assert.equal(codes(res.warnings).includes('count_mismatch'), false, 'one warning, not two');
  }
  const missing = basePack();
  delete missing.meta.total_questions;
  assert.equal(codes(load(missing).warnings).includes('meta_number_invalid'), false, 'an absent count stays silent, as before');
});

// ---- BUG-12 ----------------------------------------------------------------------------------------------------------
test('BUG-12 an empty option blocks loading and names the option', () => {
  const p = basePack();
  p.questions[0].options.B = '   ';
  const res = load(p);
  assert.equal(res.ok, false);
  const e = res.errors.find((x) => x.code === 'option_not_text');
  assert.equal(e.number, 1);
  assert.match(e.message, /option "B" is empty or not text/);
});

test('BUG-12 an option that is null, an object, a list or true/false blocks loading; several bad options are one error', () => {
  for (const bad of [null, { a: 1 }, ['x'], true]) {
    const p = basePack();
    p.questions[0].options.C = bad;
    assert.ok(codes(load(p).errors).includes('option_not_text'), JSON.stringify(bad));
  }
  const p = basePack();
  p.questions[0].options.A = '';
  p.questions[0].options.D = null;
  const errors = load(p).errors.filter((e) => e.code === 'option_not_text');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /options "A", "D" are empty or not text/);
});

test('BUG-12 an option written as a number is read as text ("5"), it does not block', () => {
  const p = basePack();
  p.questions[0].options.A = 5;
  const res = load(p);
  assert.equal(res.ok, true);
  assert.equal(res.pack.questions[0].options.A, '5');
});

test('BUG-12 a True/False question is not checked for options (it has none)', () => {
  const res = load(samplePack());
  assert.equal(res.ok, true);
  assert.ok(res.pack.questions.some((q) => q.type === 'tf'));
});

test('BUG-12 the same topic id twice is a warning (the pack still loads), and names the id', () => {
  const p = basePack();
  p.meta.topics.push({ id: 't1', name: 'Another name' });
  const res = load(p);
  assert.equal(res.ok, true);
  const w = res.warnings.filter((x) => x.code === 'duplicate_topic_id');
  assert.equal(w.length, 1);
  assert.match(w[0].message, /"t1" more than once/);
  assert.equal(codes(validatePack(normalizePack(basePack())).warnings).includes('duplicate_topic_id'), false);
});

// ---- BUG-15 ----------------------------------------------------------------------------------------------------------
test('BUG-15 "TF", "True/False", "true or false" and "tf " become tf; the answer "True" stays valid (the repro: sample question 6)', () => {
  for (const spelling of ['TF', 'True/False', 'true or false', ' tf ', 'True-False', 'TRUE_FALSE']) {
    const p = samplePack();
    const q = p.questions.find((x) => x.type === 'tf');
    q.type = spelling;
    q.answer = q.answer.toUpperCase();
    const res = load(p);
    assert.equal(res.ok, true, `${JSON.stringify(spelling)}: ${res.errors.map((e) => e.message).join('; ')}`);
    const got = res.pack.questions.find((x) => x.number === q.number);
    assert.deepEqual([got.type, got.answer], ['tf', q.answer[0] + q.answer.slice(1).toLowerCase()]);
  }
});

test('BUG-15 "MC", "Multiple Choice" and "multiple-choice" become mc', () => {
  for (const spelling of ['MC', 'Multiple Choice', 'multiple-choice', 'MCQ']) {
    const p = basePack();
    p.questions[0].type = spelling;
    assert.equal(load(p).pack.questions[0].type, 'mc', spelling);
  }
});

test('BUG-15 a type that is neither (an essay) still loads as multiple choice, with a warning on that question', () => {
  const p = basePack();
  p.questions[1].type = 'Essay';
  const res = load(p);
  assert.equal(res.ok, true);
  const w = res.warnings.find((x) => x.code === 'unknown_type');
  assert.equal(w.number, 2);
  assert.equal(res.pack.questions[1].type, 'essay');
});

// ---- BUG-20 ----------------------------------------------------------------------------------------------------------
test('BUG-20 an unknown quiz_type warns and is kept as written (lowercased); a known one in any case or with spaces is accepted quietly', () => {
  const odd = basePack();
  odd.meta.quiz_type = 'Exam';
  const res = load(odd);
  assert.equal(res.ok, true);
  assert.equal(res.pack.meta.quiz_type, 'exam');
  assert.match(res.warnings.find((w) => w.code === 'quiz_type_unknown').message, /"exam".*initial, targeted, retention, custom/);
  const ok = basePack();
  ok.meta.quiz_type = ' Retention ';
  const res2 = load(ok);
  assert.equal(res2.pack.meta.quiz_type, 'retention');
  assert.equal(codes(res2.warnings).includes('quiz_type_unknown'), false);
});

test('BUG-20 difficulty and skill are lowercased, so "Easy" counts as easy in the preview; unknown values get one warning each', () => {
  const p = basePack();
  p.questions[0].difficulty = 'EASY';
  p.questions[1].difficulty = 'hard';
  p.questions[2].difficulty = 'Medium';
  p.questions[0].skill = 'Definition';
  p.questions[3].skill = 'memory';
  const res = load(p);
  assert.equal(res.ok, true);
  assert.equal(res.pack.questions[0].difficulty, 'easy');
  const summary = summarizePack(res.pack);
  assert.equal(summary.difficulty.find((d) => d.level === 'easy').count, 2);   // question 4 was already easy
  const d = res.warnings.filter((w) => w.code === 'difficulty_unknown');
  const s = res.warnings.filter((w) => w.code === 'skill_unknown');
  assert.equal(d.length, 1);
  assert.match(d[0].message, /2 questions have a "difficulty".*questions 2, 3/);
  assert.equal(s.length, 1);
  assert.match(s[0].message, /1 question has a "skill".*question 4/);
});

test('BUG-20 the good samples still load with no new warnings', () => {
  const res = load(samplePack());
  for (const code of ['quiz_type_unknown', 'difficulty_unknown', 'skill_unknown', 'unknown_type', 'meta_number_invalid', 'duplicate_topic_id']) {
    assert.equal(codes(res.warnings).includes(code), false, code);
  }
});

// ---- BUG-19 ----------------------------------------------------------------------------------------------------------
function exportedJson(edit) {
  const pack = packWith('q1', [{ id: 't1', name: 'Networks' }, { id: 't2', name: 'Security' }]);
  let session = buildSession(pack, new Date('2026-10-01T10:00:00.123Z'));
  let responses = session.responses;
  for (const [n, l] of Object.entries(answers(pack, [1, 2]))) responses = selectOption(responses, Number(n), l);
  const graded = gradeExam(pack, responses);
  const receipt = buildReceipt({ pack, graded, startedAt: session.started_at, finishedAt: null, now: new Date('2026-11-01T08:00:00.000Z'), tzOffsetMinutes: 0, snapshots: [], options: {} });
  const data = JSON.parse(receipt.json);
  edit(data);
  const parsed = parseReceipt(JSON.stringify(data));
  assert.equal(parsed.ok, true, parsed.errors.join('; '));
  return parsed;
}

test('BUG-19 percent and rating come from the counts: a receipt that says 100% / Excellent for 2 of 4 is imported as 50 / Needs work, with a warning', () => {
  const parsed = exportedJson((d) => { d.result.percent = 100; d.result.rating = 'Excellent'; });
  const res = receiptToEntry(parsed);
  assert.equal(res.ok, true);
  assert.deepEqual([res.entry.totals.percent, res.entry.totals.rating], [50, 'Needs work']);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0].replace(/\s+/g, ' '), /says 100%, but its counts \(2 of 4\) give 50%/);
});

test('BUG-19 a rating that does not fit the (right) percentage is replaced, with a warning; any text is no longer stored as the rating', () => {
  const parsed = exportedJson((d) => { d.result.rating = 'Superb!!'; });
  const res = receiptToEntry(parsed);
  assert.equal(res.entry.totals.rating, 'Needs work');
  assert.ok(res.warnings.some((w) => /rating/.test(w) && /Superb/.test(w)));
});

test('BUG-19 a hand-rounded percent (50 vs 50.0, or 0.4 off) imports quietly', () => {
  const parsed = exportedJson((d) => { d.result.percent = 50.4; });
  const res = receiptToEntry(parsed);
  assert.equal(res.entry.totals.percent, 50);
  assert.deepEqual(res.warnings, []);
});

test('BUG-19 unsure above the number of questions is refused', () => {
  const parsed = exportedJson((d) => { d.result.unsure = 9999; });
  const res = receiptToEntry(parsed);
  assert.equal(res.ok, false);
  assert.match(res.error, /9999 questions were marked unsure, but the exam has only 4/);
  const { store } = newStore();
  assert.equal(importReceipt(store, parsed).ok, false);
  assert.deepEqual(readHistory(store).entries, []);
});

test('BUG-19 unsure equal to the total is allowed; an untouched receipt imports with no warning', () => {
  assert.equal(receiptToEntry(exportedJson((d) => { d.result.unsure = 4; })).ok, true);
  const res = receiptToEntry(exportedJson(() => {}));
  assert.deepEqual(res.warnings, []);
  assert.deepEqual([res.entry.totals.percent, res.entry.totals.rating], [50, 'Needs work']);
});

// ---- BUG-13 (decision: left as it is) -----------------------------------------------------------------------------------
test('BUG-13 DECISION: the Quick Paste parser is unchanged; a wrapped option is cut and a fifth option dropped, but a trailing "Answer:" line never leaks into an option', () => {
  const [q] = parseLegacyText(['1. Which protocol is used?', 'A. HTTP, which sends everything in', 'plain text', 'B. HTTPS', 'C. FTP', 'D. SSH', 'E. Telnet', 'Answer: B'].join('\n'));
  assert.deepEqual(q.options.map((o) => o.text), ['HTTP, which sends everything in', 'HTTPS', 'FTP', 'SSH']);
});

// ---- BUG-09 (topics stored with the exam) -------------------------------------------------------------------------------
test('BUG-09 a new history entry is version 2 and stores the topic ids and names', () => {
  const { store } = newStore();
  takeExam(store, packWith('v2-01', [{ id: 't1', name: 'Alpha' }, { id: 't2', name: 'Beta' }]), '2026-10-01T10:00:00.000Z', {});
  const [e] = readHistory(store).entries;
  assert.equal(HISTORY_SCHEMA_VERSION, 2);
  assert.equal(e.entry_version, 2);
  assert.deepEqual(e.topics, [{ id: 't1', name: 'Alpha' }, { id: 't2', name: 'Beta' }]);
});

test('BUG-09 storedTopics skips junk and falls back to the id when a name is missing', () => {
  assert.deepEqual(storedTopics({ topics: [{ id: 't1', name: ' A ' }, { id: 't2' }, null, 5, { name: 'no id' }, { id: '   ', name: 'x' }] }), [{ id: 't1', name: 'A' }, { id: 't2', name: 't2' }]);
  assert.deepEqual(storedTopics({}), []);
  assert.deepEqual(storedTopics({ topics: 'nope' }), []);
  assert.deepEqual(storedTopics(null), []);
});

test('BUG-09 a backup carries the topics, and a restored exam names them without its pack', () => {
  const { store } = newStore();
  takeExam(store, packWith('bk-01', [{ id: 't1', name: 'Alpha' }, { id: 't2', name: 'Beta' }]), '2026-10-01T10:00:00.000Z', {});
  const built = buildBackup(store);
  assert.equal(built.ok, true);
  const parsed = parseBackup(built.text);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data.history[0].topics, [{ id: 't1', name: 'Alpha' }, { id: 't2', name: 'Beta' }]);
  const other = newStore().store;
  other.set('history', parsed.data.history);   // the entry only, no pack
  assert.equal(other.get(packKey('bk-01'), null), null);
  assert.deepEqual(loadSnapshots(other)[0].topics.map((t) => t.name), ['Alpha', 'Beta']);
});
