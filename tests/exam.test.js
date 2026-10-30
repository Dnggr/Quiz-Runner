import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toExamQuestions, createResponses, selectOption, pressNotSure,
  progressCounts, firstUnansweredIndex, firstUnsureIndex, examShortcut, SHORTCUT_OPTION_LETTERS,
} from '../js/exam.js';
import { loadInput } from '../js/loader.js';
import { basePack, readSample } from './helpers.js';

const samplePack = () => loadInput(readSample('sample-pack.json')).pack;

test('P3-01 createResponses: every question starts as { selected: null, unsure: false }', () => {
  const qs = toExamQuestions(basePack());
  const r = createResponses(qs);
  assert.deepEqual(Object.keys(r), ['1', '2', '3', '4']);
  for (const v of Object.values(r)) assert.deepEqual(v, { selected: null, unsure: false });
});

test('P3-01 selectOption keeps the unsure flag, does not mutate, ignores unknown numbers', () => {
  const r0 = createResponses(toExamQuestions(basePack()));
  const r1 = pressNotSure(r0, 1).responses;                  // flagged, nothing selected
  const r2 = selectOption(r1, 1, 'C');
  assert.deepEqual(r2[1], { selected: 'C', unsure: true });
  assert.deepEqual(r0[1], { selected: null, unsure: false }, 'input untouched');
  assert.equal(selectOption(r0, 99, 'A'), r0);
  assert.deepEqual(selectOption(r2, 1, 'D')[1], { selected: 'D', unsure: true }, 'changing the answer keeps the flag');
});

test('P3-02 Not sure with no option selected: flags it and advances', () => {
  const r0 = createResponses(toExamQuestions(basePack()));
  const { responses, advance } = pressNotSure(r0, 2);
  assert.equal(advance, true);
  assert.deepEqual(responses[2], { selected: null, unsure: true });
  assert.deepEqual(r0[2], { selected: null, unsure: false });
});

test('P3-02 Not sure with no option selected stays flagged when pressed again (it advances, never un-flags)', () => {
  const once = pressNotSure(createResponses(toExamQuestions(basePack())), 2).responses;
  const twice = pressNotSure(once, 2);
  assert.equal(twice.advance, true);
  assert.deepEqual(twice.responses[2], { selected: null, unsure: true });
});

test('P3-02 Not sure with an option selected: toggles the flag and stays', () => {
  let r = selectOption(createResponses(toExamQuestions(basePack())), 3, 'B');
  const on = pressNotSure(r, 3);
  assert.equal(on.advance, false);
  assert.deepEqual(on.responses[3], { selected: 'B', unsure: true });
  const off = pressNotSure(on.responses, 3);
  assert.equal(off.advance, false);
  assert.deepEqual(off.responses[3], { selected: 'B', unsure: false });
});

test('P3-02 Not sure on an unknown question does nothing', () => {
  const r = createResponses(toExamQuestions(basePack()));
  assert.deepEqual(pressNotSure(r, 42), { responses: r, advance: false });
});

test('P3-04 progressCounts: unanswered = nothing selected; unsure counts flagged questions, selected or not', () => {
  const qs = toExamQuestions(basePack());
  let r = createResponses(qs);
  assert.deepEqual(progressCounts(qs, r), { total: 4, answered: 0, unanswered: 4, unsure: 0 });
  r = selectOption(r, 1, 'A');
  r = pressNotSure(r, 1).responses;           // selected + flagged
  r = pressNotSure(r, 2).responses;           // flagged, not selected
  assert.deepEqual(progressCounts(qs, r), { total: 4, answered: 1, unanswered: 3, unsure: 2 });
});

test('P3-04 firstUnansweredIndex / firstUnsureIndex return pack-order indexes or -1', () => {
  const qs = toExamQuestions(basePack());
  let r = createResponses(qs);
  assert.equal(firstUnansweredIndex(qs, r), 0);
  assert.equal(firstUnsureIndex(qs, r), -1);
  r = selectOption(selectOption(r, 1, 'A'), 2, 'B');
  assert.equal(firstUnansweredIndex(qs, r), 2);
  r = pressNotSure(r, 2).responses;           // selected + flagged
  r = pressNotSure(r, 4).responses;
  assert.equal(firstUnsureIndex(qs, r), 1);
  r = selectOption(selectOption(r, 3, 'A'), 4, 'A');
  assert.equal(firstUnansweredIndex(qs, r), -1);
});

test('P3-10 toExamQuestions: only number, type, text and options; no answer, explanation or hints', () => {
  const qs = toExamQuestions(samplePack());
  assert.equal(qs.length, 10);
  for (const q of qs) assert.deepEqual(Object.keys(q).sort(), ['number', 'options', 'text', 'type']);
  const everything = JSON.stringify(qs);
  assert.ok(!everything.includes('explanation'));
  assert.ok(!/"answer"/.test(everything));
  assert.ok(!everything.includes('concept'));
});

test('P3-01 toExamQuestions: mc options sorted by letter; tf gets True/False', () => {
  const pack = basePack();
  pack.questions[0].options = { D: 'dd', B: 'bb', A: 'aa', C: 'cc' };
  const [q1] = toExamQuestions(pack);
  assert.deepEqual(q1.options.map((o) => o.value), ['A', 'B', 'C', 'D']);
  assert.equal(q1.options[1].text, 'bb');
  const tf = toExamQuestions(samplePack()).find((q) => q.type === 'tf');
  assert.equal(tf.number, 6);
  assert.deepEqual(tf.options, [{ value: 'True', text: 'True' }, { value: 'False', text: 'False' }]);
});

test('toExamQuestions tolerates junk without throwing', () => {
  assert.deepEqual(toExamQuestions(null), []);
  assert.deepEqual(toExamQuestions({ questions: [null, 5, { number: 1, question: 'q', options: null }] }),
    [{ number: 1, type: 'mc', text: 'q', options: [] }]);
});

// ---- P8-02 keyboard shortcuts --------------------------------------------------------------------------------------
const ABCD = ['A', 'B', 'C', 'D'];

test('P8-02 A-D choose that option, in either case', () => {
  for (const letter of ABCD) {
    assert.deepEqual(examShortcut({ key: letter }, ABCD), { action: 'select', value: letter });
    assert.deepEqual(examShortcut({ key: letter.toLowerCase() }, ABCD), { action: 'select', value: letter });
  }
  assert.deepEqual(SHORTCUT_OPTION_LETTERS, ABCD);
});

test('P8-02 N is next, P is previous, U is "Not sure" (either case)', () => {
  assert.deepEqual(examShortcut({ key: 'n' }, ABCD), { action: 'next' });
  assert.deepEqual(examShortcut({ key: 'N' }, ABCD), { action: 'next' });
  assert.deepEqual(examShortcut({ key: 'p' }, ABCD), { action: 'prev' });
  assert.deepEqual(examShortcut({ key: 'u' }, ABCD), { action: 'unsure' });
  assert.deepEqual(examShortcut({ key: 'U' }, ['True', 'False']), { action: 'unsure' }, 'N / P / U work on true/false questions too');
});

test('P8-02 a letter the question does not offer does nothing (3 options, true/false, no options)', () => {
  assert.equal(examShortcut({ key: 'd' }, ['A', 'B', 'C']), null);
  assert.equal(examShortcut({ key: 'a' }, ['True', 'False']), null);
  assert.equal(examShortcut({ key: 'a' }, []), null);
  assert.equal(examShortcut({ key: 'a' }), null);
  assert.equal(examShortcut({ key: 'e' }, ['A', 'B', 'C', 'D', 'E']), null, 'only A-D are shortcuts');
});

test('P8-02 other keys, modified keys, held keys and typing in a field are left alone', () => {
  for (const key of ['x', '1', 'Enter', ' ', 'Tab', 'Escape', 'ArrowRight', 'Dead', '']) assert.equal(examShortcut({ key }, ABCD), null, key);
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) assert.equal(examShortcut({ key: 'n', [mod]: true }, ABCD), null, mod);
  assert.equal(examShortcut({ key: 'n', repeat: true }, ABCD), null);
  assert.equal(examShortcut({ key: 'a', isComposing: true }, ABCD), null);
  for (const tagName of ['INPUT', 'textarea', 'Select']) assert.equal(examShortcut({ key: 'n', target: { tagName } }, ABCD), null, tagName);
  assert.equal(examShortcut({ key: 'n', target: { tagName: 'DIV', isContentEditable: true } }, ABCD), null);
  assert.deepEqual(examShortcut({ key: 'n', target: { tagName: 'BUTTON' } }, ABCD), { action: 'next' }, 'a focused button still gets shortcuts');
  assert.equal(examShortcut(null, ABCD), null);
  assert.equal(examShortcut({}, ABCD), null);
});

test('P8-02 shift does not change the meaning (a capital letter is still the same shortcut)', () => {
  assert.deepEqual(examShortcut({ key: 'B', shiftKey: true }, ABCD), { action: 'select', value: 'B' });
});
