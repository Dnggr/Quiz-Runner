// BUG-46 / D53: the app spreads the correct letters evenly after a pack loads (js/balance.js).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  balanceAnswers, balanceResult, describeBalance, answerCounts, longestRun, isPositionDependent, seedFromPack, seededRng,
} from '../js/balance.js';
import { loadInput } from '../js/loader.js';
import { validatePack } from '../js/validator.js';
import { addToAssembly } from '../js/parts.js';
import { gradeExam } from '../js/grader.js';
import { ANSWER_MAX_RUN, OPTION_LETTERS } from '../js/constants.js';
import { basePack, readSample } from './helpers.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** An n-question multiple-choice pack. `answerFor(i)` gives the correct letter of question i (0-based). Every option text is unique. */
function packOf(n, answerFor, { quizId = 'balance-01', tweak } = {}) {
  const pack = basePack();
  pack.meta.quiz_id = quizId;
  pack.meta.total_questions = n;
  pack.questions = Array.from({ length: n }, (_, i) => {
    const answer = answerFor(i);
    const options = {};
    for (const l of OPTION_LETTERS) options[l] = `q${i + 1} ${l === answer ? 'RIGHT' : 'wrong'} ${l}`;
    const q = {
      number: i + 1, type: 'mc', topic: i % 2 ? 't2' : 't1', concept: `Concept ${i + 1}`, difficulty: 'easy', skill: 'definition',
      question: `Question ${i + 1}?`, options, answer, explanation: `Because of reason ${i + 1}.`,
    };
    if (tweak) tweak(q, i);
    return q;
  });
  return pack;
}
const correctText = (q) => q.options[q.answer];
const share = (pack, letter) => answerCounts(pack)[letter] / pack.questions.length;

// ---- the owner's case: 73 of 150 are "A" -------------------------------------------------------------------------
test('BUG-46 a 150-question pack with 49% "A" comes out evenly spread, with no run above 3', () => {
  const pack = packOf(150, (i) => (i < 73 ? 'A' : OPTION_LETTERS[1 + (i % 3)]));
  assert.equal(answerCounts(pack).A, 73);
  const { pack: out, report } = balanceAnswers(pack);
  const counts = answerCounts(out);
  assert.ok(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts)) <= 1, JSON.stringify(counts));
  assert.deepEqual(Object.values(counts).reduce((a, b) => a + b, 0), 150);
  assert.ok(longestRun(out.questions.map((q) => q.answer)) <= ANSWER_MAX_RUN);
  assert.equal(report.changed, true);
  assert.equal(report.before.A, 73);
  assert.equal(report.after.A, counts.A);
  assert.ok(share(out, 'A') < 0.40, 'no skew warning any more');
  assert.equal(validatePack(out).errors.length, 0);
  assert.equal(validatePack(out).warnings.some((w) => w.code === 'skewed_answers'), false);
});

test('BUG-46 every question keeps the same four option texts and the same correct text', () => {
  const pack = packOf(60, () => 'A');
  const { pack: out } = balanceAnswers(pack);
  pack.questions.forEach((q, i) => {
    const o = out.questions[i];
    assert.equal(o.number, q.number);
    assert.equal(o.question, q.question);
    assert.equal(o.explanation, q.explanation);
    assert.equal(o.topic, q.topic);
    assert.equal(correctText(o), correctText(q), `question ${q.number}: the right text must still be the answer`);
    assert.deepEqual(Object.values(o.options).sort(), Object.values(q.options).sort());
    assert.deepEqual(Object.keys(o.options), OPTION_LETTERS);
  });
});

test('BUG-46 grading still works: picking the right text after the shuffle is graded correct', () => {
  const pack = packOf(40, () => 'A');
  const { pack: out } = balanceAnswers(pack);
  const responses = {};
  for (const q of out.questions) responses[q.number] = { selected: q.answer, unsure: false };
  assert.equal(gradeExam(out, responses).totals.correct, 40);
  const wrong = {};
  for (const q of out.questions) wrong[q.number] = { selected: 'A', unsure: false };
  assert.equal(gradeExam(out, wrong).totals.correct, answerCounts(out).A);
});

test('BUG-46 the input pack is never modified', () => {
  const pack = packOf(30, () => 'A');
  const snapshot = JSON.stringify(pack);
  balanceAnswers(pack);
  assert.equal(JSON.stringify(pack), snapshot);
});

// ---- random but repeatable ---------------------------------------------------------------------------------------
test('BUG-46 the same pack always gives the same arrangement (a retake still fits the saved pack)', () => {
  const a = balanceAnswers(packOf(80, () => 'A')).pack;
  const b = balanceAnswers(packOf(80, () => 'A')).pack;
  assert.deepEqual(a, b);
});

test('BUG-46 a different pack (other quiz id) gets a different arrangement', () => {
  const a = balanceAnswers(packOf(80, () => 'A', { quizId: 'one-01' })).pack.questions.map((q) => q.answer).join('');
  const b = balanceAnswers(packOf(80, () => 'A', { quizId: 'two-01' })).pack.questions.map((q) => q.answer).join('');
  assert.notEqual(a, b);
  assert.notEqual(seedFromPack(packOf(5, () => 'A', { quizId: 'one-01' })), seedFromPack(packOf(5, () => 'A', { quizId: 'two-01' })));
});

test('BUG-46 an injected generator is used, so a test can pick the arrangement', () => {
  const pack = packOf(40, () => 'A');
  const a = balanceAnswers(pack, { rng: seededRng(1) }).pack.questions.map((q) => q.answer).join('');
  const b = balanceAnswers(pack, { rng: seededRng(2) }).pack.questions.map((q) => q.answer).join('');
  assert.notEqual(a, b);
  assert.deepEqual(balanceAnswers(pack, { rng: seededRng(1) }).pack.questions.map((q) => q.answer).join(''), a);
});

test('BUG-46 over many seeds: always within 1 of even, and never a run above 3', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const n = 20 + (seed * 7) % 111;
    const { pack: out } = balanceAnswers(packOf(n, (i) => (i % 5 === 0 ? 'B' : 'A')), { rng: seededRng(seed) });
    const counts = Object.values(answerCounts(out));
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `seed ${seed}, n ${n}: ${counts}`);
    assert.ok(longestRun(out.questions.map((q) => q.answer)) <= ANSWER_MAX_RUN, `seed ${seed}, n ${n}`);
  }
});

// ---- when nothing should change ------------------------------------------------------------------------------------
test('BUG-46 a pack that is already even and has no long run is returned untouched', () => {
  const pack = packOf(40, (i) => OPTION_LETTERS[(i * 3) % 4 === (i % 4) ? i % 4 : (i * 3) % 4]);   // 10 each, short runs
  const letters = pack.questions.map((q) => q.answer);
  assert.ok(Math.max(...Object.values(answerCounts(pack))) - Math.min(...Object.values(answerCounts(pack))) <= 1, letters.join(''));
  const { pack: out, report } = balanceAnswers(pack);
  assert.equal(out, pack);
  assert.equal(report.changed, false);
  assert.equal(describeBalance(report), '');
});

test('BUG-46 an even pack with a run of 4 is still fixed', () => {
  const order = 'AAAABCDBCDADBCADBCDA'.split('');   // 5 A, 5 B, 5 C, 5 D... first four are A
  const pack = packOf(order.length, (i) => order[i]);
  assert.ok(longestRun(order) >= 4);
  const { pack: out } = balanceAnswers(pack);
  assert.ok(longestRun(out.questions.map((q) => q.answer)) <= ANSWER_MAX_RUN);
});

test('BUG-46 fewer than two movable questions: nothing changes', () => {
  const one = packOf(1, () => 'A');
  assert.equal(balanceAnswers(one).pack, one);
  const empty = basePack();
  empty.questions = [];
  assert.equal(balanceAnswers(empty).pack, empty);
  assert.equal(balanceAnswers(null).pack, null);
});

test('BUG-46 true/false questions are not moved and not counted', () => {
  const pack = packOf(30, () => 'A', {
    tweak: (q, i) => { if (i % 3 === 0) { delete q.options; q.type = 'tf'; q.answer = 'True'; } },
  });
  const tf = pack.questions.filter((q) => q.type === 'tf');
  const { pack: out, report } = balanceAnswers(pack);
  assert.equal(report.mc, 30 - tf.length);
  out.questions.forEach((q, i) => { if (q.type === 'tf') assert.deepEqual(q, pack.questions[i]); });
  const counts = Object.values(answerCounts(out));
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
});

// ---- questions that must keep their order ------------------------------------------------------------------------------
test('BUG-46 isPositionDependent: what freezes a question and what does not', () => {
  const q = (over) => ({ question: 'Which one?', options: { A: 'x', B: 'y', C: 'z', D: 'w' }, explanation: 'Because.', ...over });
  assert.equal(isPositionDependent(q({})), false);
  assert.equal(isPositionDependent(q({ explanation: 'Option C swaps the two.' })), true);        // the spec's own example wording
  assert.equal(isPositionDependent(q({ explanation: 'Choice (B) is a common mix-up.' })), true);
  assert.equal(isPositionDependent(q({ explanation: 'Both A and B are true.' })), true);
  assert.equal(isPositionDependent(q({ options: { A: 'x', B: 'y', C: 'z', D: 'All of the above' } })), true);
  assert.equal(isPositionDependent(q({ options: { A: 'x', B: 'y', C: 'z', D: 'None of these' } })), true);
  assert.equal(isPositionDependent(q({ options: { A: 'Both statements', B: 'y', C: 'z', D: 'w' } })), true);
  assert.equal(isPositionDependent(q({ options: { A: 'A. HTTP', B: 'B. FTP', C: 'C. SMTP', D: 'D. DNS' } })), true);
  assert.equal(isPositionDependent(q({ explanation: 'The last option is too broad.' })), true);
  assert.equal(isPositionDependent(q({ explanation: 'The answer a student gives first is usually wrong.' })), false);   // "a" is the article
  assert.equal(isPositionDependent(q({ question: 'Which option a technician picks first?' })), false);
  assert.equal(isPositionDependent(q({ question: 'A router and a switch differ how?' })), false);
  assert.equal(isPositionDependent(null), false);
});

test('BUG-46 questions that refer to letters keep their options and answer; the others make up for them', () => {
  const pack = packOf(40, () => 'A', {
    tweak: (q, i) => { if (i < 8) q.explanation = 'Option B swaps the two.'; },   // 8 fixed questions, all "A"
  });
  const { pack: out, report } = balanceAnswers(pack);
  assert.equal(report.fixed, 8);
  assert.equal(report.movable, 32);
  for (let i = 0; i < 8; i++) assert.deepEqual(out.questions[i], pack.questions[i]);
  const counts = answerCounts(out);
  assert.ok(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts)) <= 1, JSON.stringify(counts));   // 8 fixed A + 32 spread: A 10, others 10
  assert.match(describeBalance(report), /8 questions kept the AI's order/);
});

test('BUG-46 when too many questions are fixed the pack stays skewed and the warning stays', () => {
  const pack = packOf(20, () => 'A', { tweak: (q, i) => { if (i < 16) q.explanation = 'Option B is wrong.'; } });
  const result = { kind: 'pack', pack, ok: true, errors: [], warnings: validatePack(pack).warnings, repaired: false, salvaged: null };
  const { result: out } = balanceResult(result);
  assert.ok(out.warnings.some((w) => w.code === 'skewed_answers'), 'still reported: 16 of 20 cannot move');
  assert.ok(share(out.pack, 'A') >= 0.8);
});

test('BUG-46 a question with five options, or a missing letter, is fixed', () => {
  const five = packOf(12, () => 'A', { tweak: (q, i) => { if (i === 0) q.options.E = 'extra'; } });
  const { report } = balanceAnswers(five);
  assert.equal(report.fixed, 1);
  const holey = packOf(12, () => 'A', { tweak: (q, i) => { if (i === 0) { q.options = { A: 'a', B: 'b', C: 'c' }; } } });
  assert.equal(balanceAnswers(holey).report.fixed, 1);
});

// ---- the load path ---------------------------------------------------------------------------------------------------------
test('BUG-46 balanceResult: a skewed pack loaded from text has no skew warning afterwards', () => {
  const pack = packOf(150, (i) => (i < 73 ? 'A' : OPTION_LETTERS[1 + (i % 3)]));
  const loaded = loadInput(JSON.stringify(pack));
  assert.equal(loaded.ok, true);
  assert.ok(loaded.warnings.some((w) => w.code === 'skewed_answers'), 'the warning of the screenshot');
  const { result, report } = balanceResult(loaded);
  assert.equal(result.ok, true);
  assert.equal(result.warnings.some((w) => w.code === 'skewed_answers'), false);
  assert.equal(result.errors.length, 0);
  assert.equal(result.kind, 'pack');
  assert.equal(report.changed, true);
});

test('BUG-46 balanceResult keeps the other warnings (e.g. a count mismatch)', () => {
  const pack = packOf(40, () => 'A');
  pack.meta.total_questions = 41;
  const loaded = loadInput(JSON.stringify(pack));
  const { result } = balanceResult(loaded);
  assert.ok(result.warnings.some((w) => w.code === 'count_mismatch'));
  assert.equal(result.warnings.some((w) => w.code === 'skewed_answers'), false);
});

test('BUG-46 balanceResult leaves a result with errors, or one that did not change, exactly as it is', () => {
  const bad = { kind: 'pack', pack: packOf(10, () => 'A'), ok: false, errors: [{ code: 'x' }], warnings: [] };
  assert.equal(balanceResult(bad).result, bad);
  const even = loadInput(readSample('sample-pack.json'));
  const out = balanceResult(even);
  assert.equal(out.result, even);
  assert.equal(out.report.changed, false);
  assert.deepEqual(balanceResult(null), { result: null, report: null });
});

test('BUG-46 parts: the held (merged) pack stays as the AI wrote it; only the copy for the exam is balanced', () => {
  const full = packOf(60, () => 'A', { quizId: 'parts-01' });
  const part1 = { ...full, meta: { ...full.meta, part: 1, total_parts: 2 }, questions: full.questions.slice(0, 30) };
  const part2 = { ...full, meta: { ...full.meta, part: 2, total_parts: 2 }, questions: full.questions.slice(30) };
  const first = addToAssembly(null, loadInput(JSON.stringify(part1)));
  const b1 = balanceResult(first.result);
  assert.equal(answerCounts(first.assembly.pack).A, 30, 'held pack untouched');
  assert.ok(answerCounts(b1.result.pack).A < 30);
  const second = addToAssembly(first.assembly, loadInput(JSON.stringify(part2)));
  const b2 = balanceResult(second.result);
  assert.equal(answerCounts(second.assembly.pack).A, 60);
  assert.equal(b2.result.pack.questions.length, 60);
  const counts = Object.values(answerCounts(b2.result.pack));
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
});

// ---- the preview sentence ----------------------------------------------------------------------------------------------
test('BUG-46 describeBalance names no letter of any answer and no count per letter', () => {
  const { report } = balanceAnswers(packOf(30, () => 'A'));
  const text = describeBalance(report);
  assert.match(text, /spread evenly across A to D/);
  assert.match(text, /\d+ questions of 30 moved/);
  assert.equal(/\bA\b[^t]*\d+%|"A"/.test(text), false);
  assert.equal(describeBalance(null), '');
});

// ---- wiring and rules ------------------------------------------------------------------------------------------------------
test('BUG-46 main.js balances what the Topics preview and the exam use; balance.js stays pure', () => {
  const main = readFileSync(join(root, 'js', 'main.js'), 'utf8');
  assert.match(main, /import \{ balanceResult, describeBalance \} from '\.\/balance\.js'/);
  assert.match(main, /const balanced = balanceResult\(step\.result\)/);
  assert.match(main, /packResult = balanced\.result/);
  assert.match(main, /preview\.show\(balanced\.result,/);
  const source = readFileSync(join(root, 'js', 'balance.js'), 'utf8');
  assert.equal(/\b(document|window|localStorage|fetch)\b/.test(source.replace(/\/\/.*$/gm, '')), false, 'no DOM, storage or network');
  assert.equal(/Math\.random/.test(source), false, 'the default generator is seeded from the pack');
});

test('BUG-46 the run limit and attempt count live in constants.js', () => {
  assert.equal(ANSWER_MAX_RUN, 3);
});
