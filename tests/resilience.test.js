// Phase 7 — Resilience: P7-01 truncation salvage · P7-02 Continue prompt · P7-03 Repair prompt · P7-04 multi-part merge.
// Pure logic only (loader.js, parts.js, promptBuilder.js, validator.js); the screens are DOM code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadInput, salvageTruncatedPack } from '../js/loader.js';
import { validatePack } from '../js/validator.js';
import {
  completeness, formatRanges, mergePacks, sameQuiz, addToAssembly, assemblyStatus, describeAddition,
} from '../js/parts.js';
import { buildContinuePrompt, buildRepairPrompt } from '../js/promptBuilder.js';
import { MAX_PACK_QUESTIONS, REPAIR_MAX_LISTED_ERRORS, PROMPT_LINE_MAX_CHARS, SPEC_VERSION } from '../js/constants.js';
import { readSample } from './helpers.js';

// ---- fixtures ------------------------------------------------------------------------------------------------

const TOPICS = [
  { id: 't1', name: 'One', subtopics: ['a'] },
  { id: 't2', name: 'Two', subtopics: [] },
  { id: 't3', name: 'Three', subtopics: [] },
];
const ANSWERS = ['A', 'B', 'C', 'D'];

/** Question `n`; the answer cycles A-D so no letter is skewed. `tweak` overrides fields. */
const question = (n, tweak = {}) => ({
  number: n, type: 'mc', topic: TOPICS[n % 3].id, concept: `Concept ${n}`, difficulty: 'easy', skill: 'definition',
  question: `Question ${n}?`, options: { A: 'a', B: 'b', C: 'c', D: 'd' }, answer: ANSWERS[n % 4], explanation: `Because ${n}.`,
  ...tweak,
});

/** A pack object with questions `from..to`; `total` is the planned size across all parts. */
function packObject({ from = 1, to = 130, total = 130, part = 1, totalParts = 1, quizId = 'big-01', topics = TOPICS } = {}) {
  const questions = [];
  for (let n = from; n <= to; n++) questions.push(question(n));
  return {
    format: 'quizrunner.quiz', version: 1,
    meta: { quiz_id: quizId, title: 'Big', subject: 'Testing', quiz_type: 'custom', total_questions: total, part, total_parts: totalParts, topics, notes: [] },
    questions,
  };
}

/**
 * The text of a pack, written by hand so the offset where each question object ends is KNOWN (an oracle that does not
 * use the code under test). `ends[k]` = text length after question k+1 has been written completely.
 */
function packText(pack, { fence = false } = {}) {
  let text = `${fence ? '```json\n' : ''}{\n  "format": "quizrunner.quiz",\n  "version": 1,\n  "meta": ${JSON.stringify(pack.meta)},\n  "questions": [\n`;
  const ends = [];
  pack.questions.forEach((q, i) => {
    text += `    ${JSON.stringify(q)}`;
    ends.push(text.length);
    text += i < pack.questions.length - 1 ? ',\n' : '\n';
  });
  text += `  ]\n}${fence ? '\n```' : ''}\n`;
  return { text, ends };
}

const numbers = (res) => res.pack.questions.map((q) => q.number);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// ============================================================================================================
// P7-01 Truncation salvage
// ============================================================================================================

test('P7-01 a 130-question reply cut inside question 98 loads 97 questions: "Loaded 97 of 130"', () => {
  const pack = packObject();
  const { text, ends } = packText(pack);
  const cut = text.slice(0, ends[96] + 40);                 // 40 characters into question 98
  const res = loadInput(cut);

  assert.equal(res.kind, 'pack');
  assert.equal(res.ok, true);
  assert.deepEqual(res.salvaged, { kept: 97 });
  assert.deepEqual(numbers(res), range(1, 97));
  assert.deepEqual(res.pack.questions, pack.questions.slice(0, 97), 'kept questions are exactly the ones that were sent');
  assert.deepEqual(completeness(res.pack), { loaded: 97, total: 130, missing: range(98, 130), complete: false });
});

test('P7-01 every cut point of a pack: never throws; what is kept is exactly the complete questions before the cut', () => {
  const pack = packObject({ to: 6, total: 6 });
  const { text, ends } = packText(pack);
  for (let cut = 1; cut < text.length - 3; cut++) {          // `- 3`: the last chars are the closing "]\n}" (a whole pack)
    const res = loadInput(text.slice(0, cut));
    assert.ok(['pack', 'error', 'legacy'].includes(res.kind), `cut ${cut}`);
    const complete = ends.filter((e) => e <= cut).length;
    if (res.kind === 'pack' && res.salvaged) {
      assert.equal(res.salvaged.kept, complete, `cut ${cut}`);
      assert.deepEqual(res.pack.questions, pack.questions.slice(0, complete), `cut ${cut}`);
    }
    if (cut > ends[0] && cut < ends[5] + 2) {
      assert.equal(res.kind, 'pack', `cut ${cut} is after question 1 inside the list, so something is salvaged`);
      assert.equal(res.salvaged.kept, complete, `cut ${cut}`);
    }
  }
});

test('P7-01 braces, brackets and escaped quotes inside question text do not confuse the cut', () => {
  const pack = packObject({ to: 3, total: 5 });
  pack.questions[1] = question(2, { question: 'What does "}" or "]" or \\{ mean in {"a": [1, 2]}?', explanation: 'A "quote" \\" and a brace {' });
  const { text, ends } = packText(pack);
  // Cut right after an escaped quote inside question 3.
  const cut = text.indexOf('Question 3?') - 1;
  assert.ok(cut > ends[1]);
  const res = loadInput(text.slice(0, cut));
  assert.equal(res.kind, 'pack');
  assert.deepEqual(res.pack.questions, pack.questions.slice(0, 2));
});

test('P7-01 a cut-off pack inside a code fence, after prose, with Windows line endings, still salvages', () => {
  const pack = packObject({ to: 20, total: 20 });
  const { text, ends } = packText(pack, { fence: true });
  const cut = `Here is your quiz:\n${text}`.replace(/\n/g, '\r\n');
  const offset = 'Here is your quiz:\n'.length + 1 /* \r */ + ends[11] + 30 + text.slice(0, ends[11] + 30).split('\n').length - 1;
  const res = loadInput(cut.slice(0, offset));
  assert.equal(res.kind, 'pack');
  assert.equal(res.salvaged.kept, 12);
  assert.deepEqual(numbers(res), range(1, 12));
});

test('P7-01 a trailing comma right after the last complete question is fine', () => {
  const pack = packObject({ to: 5, total: 9 });
  const { text, ends } = packText(pack);
  const res = loadInput(text.slice(0, ends[2] + 1));        // "...question 3 }," then nothing
  assert.equal(res.kind, 'pack');
  assert.equal(res.salvaged.kept, 3);
});

test('P7-01 cut inside meta (or before "questions" starts): nothing to keep, the ordinary "cut off" error', () => {
  const { text } = packText(packObject({ to: 3, total: 3 }));
  for (const cut of [text.indexOf('"title"') + 5, text.indexOf('"questions"') - 2, text.indexOf('"questions"') + 20]) {
    const res = loadInput(text.slice(0, cut));
    assert.equal(res.kind, 'error', `cut ${cut}`);
    assert.equal(res.error.truncated, true, `cut ${cut}`);
    assert.match(res.error.message, /cut off/);
  }
});

test('P7-01 cut inside the FIRST question: no complete question, so still the "cut off" error', () => {
  const { text, ends } = packText(packObject({ to: 3, total: 3 }));
  const res = loadInput(text.slice(0, ends[0] - 30));
  assert.equal(res.kind, 'error');
  assert.equal(res.error.truncated, true);
});

test('P7-01 a "questions" list that is not made of objects is not treated as a cut-off pack', () => {
  assert.equal(salvageTruncatedPack('{"questions": [1, 2, 3'), null);
  assert.equal(salvageTruncatedPack('{"questions": ["a", {"number": 1}'), null);
  assert.equal(salvageTruncatedPack('{"questions": {"x": 1'), null);
  assert.equal(salvageTruncatedPack('[{"number": 1}'), null);
  assert.equal(salvageTruncatedPack(''), null);
  assert.equal(salvageTruncatedPack(undefined), null);
});

test('P7-01 "questions" written before "meta": the questions are kept, and the missing meta is reported as problems, not a crash', () => {
  const q = JSON.stringify(question(1));
  const res = loadInput(`{"format": "quizrunner.quiz", "version": 1, "questions": [${q}, {"number": 2, "ty`);
  assert.equal(res.kind, 'pack');
  assert.equal(res.salvaged.kept, 1);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === 'unknown_topic'));
});

test('P7-01 a "questions" key inside a string or a nested object is not mistaken for the list', () => {
  const q = JSON.stringify(question(1));
  const text = `{"meta": {"notes": ["\\"questions\\": [", "x"], "questions": [{"decoy": 1}]}, "questions": [${q}, {"number": 2`;
  const out = salvageTruncatedPack(text);
  assert.ok(out);
  assert.equal(out.kept, 1);
  assert.equal(out.value.questions[0].number, 1);
});

test('P7-01 text with a real syntax error (not a cut-off) is never "salvaged"', () => {
  const res = loadInput(readSample('broken', '08-smart-quotes.json'));
  assert.equal(res.kind, 'error');
  assert.equal(res.error.truncated, false);
  const q = JSON.stringify(question(1));
  const bad = loadInput(`{"meta": {"quiz_id": "x"}, "questions": [${q}, {"number": 2 "oops": 1}, ${q}`);
  assert.equal(bad.kind, 'error');
});

test('P7-01 a normal pack has salvaged: null; a repaired (trailing comma) cut pack reports repaired', () => {
  assert.equal(loadInput(readSample('sample-pack.json')).salvaged, null);
  const { text, ends } = packText(packObject({ to: 4, total: 4 }));
  const withComma = text.slice(0, ends[1]).replace(/"explanation":"Because 2\."\}$/, '"explanation":"Because 2.",}');
  const res = loadInput(withComma);
  assert.equal(res.kind, 'pack');
  assert.equal(res.salvaged.kept, 2);
  assert.equal(res.repaired, true);
});

test('P7-01 loading a 130-question pack, whole or cut off, stays fast', () => {
  const { text, ends } = packText(packObject());
  const t0 = performance.now();
  loadInput(text);
  loadInput(text.slice(0, ends[96] + 40));
  assert.ok(performance.now() - t0 < 500, 'two loads under half a second on a dev machine');
});

// ============================================================================================================
// P7-02 Missing numbers and the Continue prompt
// ============================================================================================================

test('P7-02 completeness: loaded / total / missing, and an unknown plan', () => {
  assert.deepEqual(completeness(packObject({ to: 97 })), { loaded: 97, total: 130, missing: range(98, 130), complete: false });
  assert.deepEqual(completeness(packObject({ to: 130 })), { loaded: 130, total: 130, missing: [], complete: true });

  const gap = packObject({ to: 10, total: 10 });
  gap.questions = gap.questions.filter((q) => q.number !== 4 && q.number !== 5);
  assert.deepEqual(completeness(gap), { loaded: 8, total: 10, missing: [4, 5], complete: false });

  for (const total of [undefined, null, 'ten', 10.5, 0, -3, MAX_PACK_QUESTIONS + 1]) {
    const p = packObject({ to: 3 });
    p.meta.total_questions = total;
    assert.deepEqual(completeness(p), { loaded: 3, total: null, missing: [], complete: true }, String(total));
  }
  assert.deepEqual(completeness(null), { loaded: 0, total: null, missing: [], complete: true });
  assert.deepEqual(completeness({}), { loaded: 0, total: null, missing: [], complete: true });
});

test('P7-02 completeness ignores numbers outside 1..total and counts a repeated number once', () => {
  const p = packObject({ to: 4, total: 5 });
  p.questions.push(question(4), question(99), question(0), { ...question(1), number: '3' }, 'junk', null);
  assert.deepEqual(completeness(p), { loaded: 4, total: 5, missing: [5], complete: false });
});

test('P7-02 formatRanges', () => {
  assert.equal(formatRanges([1, 2, 3, 7, 9, 10]), '1-3, 7, 9-10');
  assert.equal(formatRanges([5]), '5');
  assert.equal(formatRanges([3, 1, 2, 2]), '1-3');
  assert.equal(formatRanges([]), '');
  assert.equal(formatRanges(undefined), '');
  assert.equal(formatRanges([1, 'x', 3.5, 4]), '1, 4');
});

test('P7-02 Continue prompt for a cut-off reply is the PROMPT_TEMPLATES text, filled from the missing numbers', () => {
  const out = buildContinuePrompt({ total: 130, missing: range(98, 130) });
  assert.equal(out.ok, true);
  assert.equal(out.variant, 'tail');
  assert.equal(
    out.prompt,
    'Your last reply was cut off or incomplete. I received questions 1-97 of 130.\n'
    + 'Continue from question 98 to 130. Use the same quiz pack format with the same "meta" (same quiz_id, total_questions, and topics) '
    + 'and include only the questions from 98 onward, numbered as in the original plan. Output only the JSON as a downloadable file '
    + 'or one code block. Do not reveal answers in the chat.\n',
  );
});

test('P7-02 end to end: cut-off reply -> loaded 97 of 130 -> Continue prompt asks for 98 to 130', () => {
  const { text, ends } = packText(packObject());
  const res = loadInput(text.slice(0, ends[96] + 40));
  const c = completeness(res.pack);
  const prompt = buildContinuePrompt(c);
  assert.equal(prompt.variant, 'tail');
  assert.match(prompt.prompt, /I received questions 1-97 of 130\./);
  assert.match(prompt.prompt, /Continue from question 98 to 130\./);
});

test('P7-02 missing numbers that are not a tail use the "missing numbers" variant', () => {
  const start = buildContinuePrompt({ total: 130, missing: [...range(1, 45), ...range(91, 130)] });
  assert.equal(start.variant, 'ranges');
  assert.equal(
    start.prompt,
    'Your last reply was incomplete. I received 45 of 130 questions. These question numbers are still missing: 1-45, 91-130.\n'
    + 'Send only the missing questions. Use the same quiz pack format with the same "meta" (same quiz_id, total_questions, and topics), '
    + 'numbered as in the original plan. Output only the JSON as a downloadable file or one code block. Do not reveal answers in the chat.\n',
  );
  const middle = buildContinuePrompt({ total: 20, missing: [4, 5, 9] });
  assert.equal(middle.variant, 'ranges');
  assert.match(middle.prompt, /I received 17 of 20 questions\. .* missing: 4-5, 9\./);
  // Question 1 missing and nothing else after it is a gap at the START, not a tail of "1-0".
  assert.equal(buildContinuePrompt({ total: 3, missing: [1, 2, 3] }).variant, 'ranges');
  assert.equal(buildContinuePrompt({ total: 3, missing: [2, 3] }).variant, 'tail');
  assert.equal(buildContinuePrompt({ total: 3, missing: [3] }).variant, 'tail');
});

test('P7-02 no Continue prompt without a usable plan or without missing numbers', () => {
  for (const input of [
    undefined, {}, { total: null, missing: [1] }, { total: 10, missing: [] }, { total: 10 }, { total: 10, missing: 'x' },
    { total: 10, missing: [11] }, { total: 10, missing: [0] }, { total: 10, missing: [1.5] }, { total: MAX_PACK_QUESTIONS + 1, missing: [1] },
  ]) {
    assert.deepEqual(buildContinuePrompt(input), { ok: false, prompt: '', variant: null }, JSON.stringify(input));
  }
});

test('P7-02 the Continue prompt asks for no answers and carries no pack content', () => {
  const out = buildContinuePrompt({ total: 130, missing: range(98, 130) });
  assert.match(out.prompt, /Do not reveal answers in the chat\./);
  assert.ok(!/Question \d+\?/.test(out.prompt));
});

// ============================================================================================================
// P7-03 Repair prompt
// ============================================================================================================

const REPAIR_HEAD = 'The quiz file you gave me could not be loaded. Here are the problems found:\n\n';
const REPAIR_TAIL = `\n\nPlease send the corrected file again, in the same format (Quiz Pack v${SPEC_VERSION}), as a single downloadable file or one code block containing only the JSON. Fix only these problems and keep everything else the same. Do not reveal answers in the chat.\n`;

test('P7-03 Repair prompt from a real validator error list (broken/04-missing-answer.json)', () => {
  const res = loadInput(readSample('broken', '04-missing-answer.json'));
  assert.equal(res.ok, false);
  const out = buildRepairPrompt(res.errors);
  assert.equal(out.ok, true);
  assert.equal(out.prompt, `${REPAIR_HEAD}- Question 3 is missing its "answer".${REPAIR_TAIL}`);
  assert.deepEqual([out.listed, out.total], [1, 1]);
});

test('P7-03 every broken sample with validator errors gets a prompt that lists each message', () => {
  for (const file of ['04-missing-answer', '05-answer-not-in-options', '06-duplicate-numbers', '07-unknown-topic']) {
    const res = loadInput(readSample('broken', `${file}.json`));
    const out = buildRepairPrompt(res.errors);
    assert.equal(out.ok, true, file);
    for (const e of res.errors) assert.ok(out.prompt.includes(`- ${e.message}`), `${file}: ${e.message}`);
    assert.ok(out.prompt.startsWith(REPAIR_HEAD) && out.prompt.endsWith(REPAIR_TAIL), file);
  }
});

test('P7-03 problems are listed pack-level first, then by question number, one per line', () => {
  const errors = [
    { code: 'x', message: 'Question 9 is bad.', number: 9, index: 8 },
    { code: 'x', message: 'Question 2 is bad.', number: 2, index: 1 },
    { code: 'y', message: 'The pack has a pack-level problem.', number: null, index: null },
    { code: 'x', message: 'Question 2 is also\nbad on\ttwo lines.', number: 2, index: 1 },
  ];
  const list = buildRepairPrompt(errors).prompt.slice(REPAIR_HEAD.length, -REPAIR_TAIL.length);
  assert.equal(list, '- The pack has a pack-level problem.\n- Question 2 is bad.\n- Question 2 is also bad on two lines.\n- Question 9 is bad.');
});

test('P7-03 long lists are capped, long lines are cut, and nothing in a message is read as a placeholder', () => {
  const many = Array.from({ length: REPAIR_MAX_LISTED_ERRORS + 7 }, (_, i) => ({ code: 'x', message: `Question ${i + 1} is bad.`, number: i + 1, index: i }));
  const out = buildRepairPrompt(many);
  const lines = out.prompt.slice(REPAIR_HEAD.length, -REPAIR_TAIL.length).split('\n');
  assert.equal(lines.length, REPAIR_MAX_LISTED_ERRORS + 1);
  assert.equal(lines.at(-1), '- …and 7 more problems.');
  assert.equal(out.listed, REPAIR_MAX_LISTED_ERRORS);
  assert.equal(out.total, REPAIR_MAX_LISTED_ERRORS + 7);
  assert.match(buildRepairPrompt([...many.slice(0, REPAIR_MAX_LISTED_ERRORS), { code: 'x', message: 'one more', number: 99, index: 98 }]).prompt, /- …and 1 more problem\./);

  const long = buildRepairPrompt([{ code: 'x', message: `Question 1: ${'z'.repeat(2000)}`, number: 1, index: 0 }]);
  const line = long.prompt.slice(REPAIR_HEAD.length, -REPAIR_TAIL.length);
  assert.equal(line.length, 2 + PROMPT_LINE_MAX_CHARS);
  assert.ok(line.endsWith('…'));

  const sneaky = buildRepairPrompt([{ code: 'x', message: 'Question 1: the topic "{{spec_version}}" and {{error_list}} are unknown', number: 1, index: 0 }]);
  assert.ok(sneaky.prompt.includes('"{{spec_version}}" and {{error_list}} are unknown'), 'values are never scanned for placeholders');
  assert.ok(sneaky.prompt.includes(`Quiz Pack v${SPEC_VERSION})`));
});

test('P7-03 no errors (or junk) means no Repair prompt', () => {
  for (const input of [[], undefined, null, 'x', [{}], [{ message: '   ' }], [null]]) {
    assert.deepEqual(buildRepairPrompt(input), { ok: false, prompt: '', listed: 0, total: 0 }, JSON.stringify(input));
  }
});

// ============================================================================================================
// P7-04 Multi-part merge
// ============================================================================================================

const asResult = (pack, extra = {}) => {
  const { errors, warnings } = validatePack(pack);
  return { kind: 'pack', pack, ok: errors.length === 0, errors, warnings, repaired: false, salvaged: null, ...extra };
};
const parts3 = () => [
  packObject({ from: 1, to: 45, part: 1, totalParts: 3 }),
  packObject({ from: 46, to: 90, part: 2, totalParts: 3 }),
  packObject({ from: 91, to: 130, part: 3, totalParts: 3 }),
];

test('P7-04 three parts, in order: "Parts loaded: 1 of 3", "2 of 3", "3 of 3"; merged by question number', () => {
  const [p1, p2, p3] = parts3();
  let step = addToAssembly(null, asResult(p1));
  assert.equal(step.merged, false);
  assert.deepEqual([step.status.partsLoaded, step.status.totalParts, step.status.multiPart], [1, 3, true]);
  assert.equal(step.status.loaded, 45);

  step = addToAssembly(step.assembly, asResult(p2));
  assert.equal(step.merged, true);
  assert.deepEqual([step.status.partsLoaded, step.status.totalParts], [2, 3]);
  assert.deepEqual([step.status.loaded, step.status.total, step.status.complete], [90, 130, false]);
  assert.deepEqual(step.status.missing, range(91, 130));

  step = addToAssembly(step.assembly, asResult(p3));
  assert.deepEqual([step.status.partsLoaded, step.status.totalParts], [3, 3]);
  assert.deepEqual([step.status.loaded, step.status.complete], [130, true]);
  assert.deepEqual(numbers(step.result), range(1, 130));
  assert.equal(step.result.ok, true);
  assert.deepEqual(step.result.warnings.filter((w) => w.code === 'count_mismatch'), []);
  assert.deepEqual(step.result.pack.questions, packObject().questions, 'the merged pack equals the pack sent in one piece');
});

test('P7-04 parts can arrive in any order', () => {
  const [p1, p2, p3] = parts3();
  let step = addToAssembly(null, asResult(p3));
  step = addToAssembly(step.assembly, asResult(p1));
  assert.deepEqual(step.status.missing, range(46, 90));
  assert.deepEqual([step.status.partsLoaded, step.status.totalParts], [2, 3]);
  step = addToAssembly(step.assembly, asResult(p2));
  assert.deepEqual(numbers(step.result), range(1, 130));
  assert.equal(step.status.complete, true);
  assert.equal(step.status.partsLoaded, 3);
});

test('P7-04 on a conflict the LATER part wins, and the replaced numbers are reported', () => {
  const first = packObject({ from: 1, to: 10, total: 10 });
  const second = packObject({ from: 8, to: 10, total: 10 });
  second.questions[0] = question(8, { question: 'Corrected question 8?', answer: 'D' });
  second.questions[1] = question(9);                    // identical to the earlier copy: not a replacement
  const step = addToAssembly(addToAssembly(null, asResult(first)).assembly, asResult(second));
  assert.deepEqual(numbers(step.result), range(1, 10));
  assert.equal(step.result.pack.questions[7].question, 'Corrected question 8?');
  assert.equal(step.result.pack.questions[7].answer, 'D');
  assert.deepEqual(step.replaced, [8]);
  assert.equal(step.added, 0);
  assert.match(describeAddition(step), /0 new questions\. Replaced the earlier version of question 8\./);
});

test('P7-04 a part pasted twice changes nothing and does not count twice', () => {
  const [p1, p2] = parts3();
  let step = addToAssembly(null, asResult(p1));
  step = addToAssembly(step.assembly, asResult(p2));
  const before = JSON.stringify(step.result.pack);
  step = addToAssembly(step.assembly, asResult(p2));
  assert.equal(JSON.stringify(step.result.pack), before);
  assert.deepEqual(step.replaced, []);
  assert.equal(step.added, 0);
  assert.equal(step.status.partsLoaded, 2);
  step = addToAssembly(step.assembly, asResult(p1));
  assert.equal(JSON.stringify(step.result.pack), before);
  assert.equal(step.status.partsLoaded, 2);
});

test('P7-04 a pack with another quiz_id starts afresh and says it replaced the earlier one', () => {
  const [p1] = parts3();
  const other = packObject({ from: 1, to: 5, total: 5, quizId: 'other-01' });
  const first = addToAssembly(null, asResult(p1));
  const step = addToAssembly(first.assembly, asResult(other));
  assert.equal(step.merged, false);
  assert.equal(step.replacedOther, true);
  assert.deepEqual(numbers(step.result), range(1, 5));
  assert.match(describeAddition(step), /different quiz_id/);
  assert.equal(describeAddition(first), '');
});

test('P7-04 packs without a quiz_id are never merged', () => {
  const a = packObject({ to: 3, total: 3, quizId: '' });
  const b = packObject({ from: 4, to: 6, total: 6, quizId: '' });
  assert.equal(sameQuiz(a, b), false);
  assert.equal(mergePacks(a, b).ok, false);
  const step = addToAssembly(addToAssembly(null, asResult(a)).assembly, asResult(b));
  assert.equal(step.merged, false);
  assert.deepEqual(numbers(step.result), [4, 5, 6]);
});

test('P7-04 a part that was cut off does not count as a loaded part until a whole copy comes', () => {
  const [p1, p2] = parts3();
  const { text, ends } = packText(p2);
  const cutPart2 = loadInput(text.slice(0, ends[29] + 20));            // 30 of part 2's 45 questions arrived
  assert.equal(cutPart2.salvaged.kept, 30);

  let step = addToAssembly(null, asResult(p1));
  step = addToAssembly(step.assembly, cutPart2);
  assert.deepEqual([step.status.partsLoaded, step.status.totalParts], [1, 3], 'the cut-off part 2 is not counted');
  assert.deepEqual([step.status.loaded, step.status.salvaged], [75, true]);

  step = addToAssembly(step.assembly, asResult(p2));                    // the whole part 2 arrives later
  assert.deepEqual([step.status.partsLoaded, step.status.salvaged], [2, false]);
  assert.equal(step.status.loaded, 90);
});

test('P7-04 end to end: cut-off single reply + the continuation it asked for = the complete pack', () => {
  const full = packObject();
  const { text, ends } = packText(full);
  const first = loadInput(text.slice(0, ends[96] + 40));
  let step = addToAssembly(null, first);
  assert.deepEqual([step.status.loaded, step.status.total], [97, 130]);

  const ask = buildContinuePrompt(step.status);
  assert.match(ask.prompt, /Continue from question 98 to 130/);

  const continuation = packObject({ from: 98, to: 130 });               // what a good AI answers: same meta, questions 98 onward
  step = addToAssembly(step.assembly, loadInput(packText(continuation).text));
  assert.equal(step.merged, true);
  assert.equal(step.status.complete, true);
  assert.deepEqual(step.result.pack.questions, full.questions);
  assert.equal(step.result.ok, true);
  assert.deepEqual(step.result.warnings.filter((w) => w.code === 'count_mismatch'), []);
});

test('P7-04 meta: later wins per field, topics are the union by id, part / total_parts become 1 / 1', () => {
  const a = packObject({ to: 3, total: 6, part: 1, totalParts: 2, topics: [TOPICS[0], TOPICS[1], TOPICS[2]] });
  const b = packObject({ from: 4, to: 6, total: 6, part: 2, totalParts: 2, topics: [{ id: 't2', name: 'Two (renamed)', subtopics: ['x'] }, { id: 't4', name: 'Four', subtopics: [] }, TOPICS[0], TOPICS[2]] });
  b.meta.title = 'Big, second part';
  b.questions[0].topic = 't4';
  const merged = mergePacks(a, b);
  assert.equal(merged.ok, true);
  assert.equal(merged.pack.meta.title, 'Big, second part');
  assert.equal(merged.pack.meta.quiz_id, 'big-01');
  assert.deepEqual(merged.pack.meta.topics.map((t) => t.id), ['t1', 't2', 't3', 't4']);
  assert.equal(merged.pack.meta.topics[1].name, 'Two (renamed)');
  assert.deepEqual([merged.pack.meta.part, merged.pack.meta.total_parts], [1, 1]);
  assert.equal(merged.pack.format, 'quizrunner.quiz');
  assert.equal(merged.pack.version, 1);
  assert.deepEqual(validatePack(merged.pack).errors, []);
});

test('P7-04 merging never changes its inputs', () => {
  const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
  const a = deepFreeze(packObject({ to: 5, total: 10 }));
  const b = deepFreeze(packObject({ from: 4, to: 10, total: 10 }));
  const copyA = JSON.stringify(a);
  const copyB = JSON.stringify(b);
  const step = addToAssembly(addToAssembly(null, asResult(a)).assembly, asResult(b));
  assert.equal(step.result.pack.questions.length, 10);
  assert.equal(JSON.stringify(a), copyA);
  assert.equal(JSON.stringify(b), copyB);
});

test('P7-04 questions without a number cannot be matched: they are kept, after the numbered ones', () => {
  const a = packObject({ to: 2, total: 4 });
  const b = packObject({ from: 3, to: 4, total: 4 });
  a.questions.push({ ...question(7), number: undefined });
  const merged = mergePacks(a, b);
  assert.deepEqual(merged.pack.questions.map((q) => q.number), [1, 2, 3, 4, undefined]);
});

test('P7-04 a single pack in one piece is unchanged by going through the assembly', () => {
  const one = packObject({ to: 10, total: 10 });
  const res = asResult(one);
  const step = addToAssembly(null, res);
  assert.equal(step.merged, false);
  assert.equal(step.result.pack, one);
  assert.equal(step.status.multiPart, false);
  assert.equal(step.status.complete, true);
  assert.equal(assemblyStatus(step.assembly).partsLoaded, 1);
});

test('P7-04 sample-pack.json loaded twice is the same pack, not 20 questions', () => {
  const first = loadInput(readSample('sample-pack.json'));
  const second = loadInput(readSample('sample-pack.json'));
  const step = addToAssembly(addToAssembly(null, first).assembly, second);
  assert.equal(step.result.pack.questions.length, 10);
  assert.deepEqual(step.result.warnings, first.warnings);
});
