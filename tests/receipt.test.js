import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_UNSURE,
  summarizeLegacyAnswers,
  legacySummaryText,
  formatLegacyAnswers,
  buildReceipt,
  buildFormatSpec,
  toOffsetIso,
  receiptIdFor,
  slugify,
  nextQuizId,
  nextQuizNumber,
  estimateTokens,
  formatTokenEstimate,
  receiptFileStem,
  RECEIPT_BEGIN,
  RECEIPT_END,
  DEFAULT_RECEIPT_OPTIONS,
} from '../js/receipt.js';
import { gradeExam } from '../js/grader.js';
import { SPEC_VERSION, RECEIPT_FORMAT } from '../js/constants.js';
import { readSample, basePack } from './helpers.js';

const questions = [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }];

test('legacy export: answered, unsure and skipped lines (exact v1 wording)', () => {
  const answers = { 1: 'B', 2: LEGACY_UNSURE, 4: 'True' };
  assert.equal(
    formatLegacyAnswers(questions, answers),
    ["1. B", "2. I'm not sure", "3. I don't know", '4. True'].join('\n'),
  );
});

test('legacy summary counts and sentence', () => {
  const answers = { 1: 'B', 2: LEGACY_UNSURE, 4: 'True' };
  const s = summarizeLegacyAnswers(questions, answers);
  assert.deepEqual(s, { answered: 2, unsure: 1, skipped: 1 });
  assert.equal(legacySummaryText(s), '2 answered, 1 marked "not sure", 1 skipped.');
});

test('nothing answered -> everything skipped', () => {
  assert.deepEqual(summarizeLegacyAnswers(questions, {}), { answered: 0, unsure: 0, skipped: 4 });
  assert.equal(formatLegacyAnswers(questions, {}).split('\n').every((l) => l.endsWith("I don't know")), true);
});

// ============================================================================================================
// P4-08..P4-12: the Quiz Pack receipt
// ============================================================================================================

const samplePack = () => JSON.parse(readSample('sample-pack.json'));
const r = (selected, unsure = false) => ({ selected, unsure });
// The exact responses behind samples/sample-receipt.md: 7/10, Q4 and Q5 wrong, Q6 skipped and unsure, Q1 correct but unsure.
const SAMPLE_RESPONSES = { 1: r('B', true), 2: r('D'), 3: r('A'), 4: r('A'), 5: r('D'), 6: r(null, true), 7: r('C'), 8: r('A'), 9: r('D'), 10: r('B') };
const CLOCK = {
  startedAt: '2026-10-25T06:10:00.000Z',   // 14:10 in UTC+8
  finishedAt: '2026-10-25T06:19:00.000Z',  // 9 minutes later: duration_sec 540
  now: new Date('2026-10-25T06:30:00.000Z'), // 14:30 in UTC+8
  tzOffsetMinutes: 480,
};
const build = (extra = {}, pack = samplePack(), responses = SAMPLE_RESPONSES) =>
  buildReceipt({ pack, graded: gradeExam(pack, responses), ...CLOCK, ...extra });
const embedded = (md) => JSON.parse(md.match(/```json\n([\s\S]*?)\n```/)[1]);
const sections = (md) => [...md.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]));
const trimEnd = (t) => t.replace(/\s+$/, '');

test('P4-12 golden file: sample pack + fixed responses reproduce samples/sample-receipt.md exactly', () => {
  const { markdown } = build();
  assert.equal(markdown, trimEnd(readSample('sample-receipt.md')) + '\n');
});

test('P4-12 the golden receipt is reproducible: the same input gives the same text, twice', () => {
  assert.equal(build().markdown, build().markdown);
  assert.equal(build().json, build().json);
});

test('P4-08 markers, section order, and the embedded JSON equals the .json receipt', () => {
  const { markdown, data, json } = build();
  assert.ok(markdown.startsWith(RECEIPT_BEGIN + '\n# QUIZ RUNNER RECEIPT'));
  assert.ok(markdown.endsWith(RECEIPT_END + '\n'));
  assert.equal(markdown.split(RECEIPT_BEGIN).length - 1, 1);
  assert.equal(markdown.split(RECEIPT_END).length - 1, 1);
  assert.deepEqual(sections(markdown), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.match(markdown, /^## FOR THE AI READING THIS$/m);
  assert.deepEqual(embedded(markdown), data);
  assert.deepEqual(JSON.parse(json), data);
  assert.ok(json.endsWith('}\n'));
});

test('P4-08 JSON receipt: format, version, ids, exam block, result block, and key order follow RECEIPT_SPEC §8', () => {
  const { data, receiptId } = build();
  assert.deepEqual(Object.keys(data), [
    'format', 'version', 'receipt_id', 'created_at', 'app_version', 'exam', 'result', 'topics', 'strengths', 'weaknesses',
    'watch', 'missed', 'shaky', 'next_exam', 'topic_list', 'history', 'cumulative', 'covered_concepts',
  ]);
  assert.equal(data.format, RECEIPT_FORMAT);
  assert.equal(data.version, SPEC_VERSION);
  assert.equal(receiptId, 'qr-sample-networks-01-202610251430');
  assert.equal(data.receipt_id, receiptId);
  assert.equal(data.created_at, '2026-10-25T14:30:00+08:00');
  assert.deepEqual(data.exam, {
    quiz_id: 'sample-networks-01', title: 'Computer Networks — Sample Exam', subject: 'Computer Networks', quiz_type: 'initial',
    quiz_number: 1, total: 10, taken_at: '2026-10-25T14:10:00+08:00', duration_sec: 540,
  });
  assert.deepEqual(data.result, { correct: 7, wrong: 2, skipped: 1, unsure: 2, shaky: 1, percent: 70, rating: 'Fair', gaps: 1, misconceptions: 2 });
  assert.equal(data.result.gaps + data.result.misconceptions, data.missed.length);
  assert.deepEqual([data.strengths, data.weaknesses, data.watch], [['t3'], ['t2'], ['t1']]);
});

test('P4-09 each toggle controls exactly its own section and JSON block; sections 1-3, 5, 6, 8, 11 are always there', () => {
  const ALWAYS = [1, 2, 3, 5, 6, 8, 11];
  const off = { missed: false, history: false, concepts: false, formatSpec: false };
  const none = build({ options: off });
  assert.deepEqual(sections(none.markdown), ALWAYS);
  for (const key of ['missed', 'history', 'cumulative', 'covered_concepts']) assert.ok(!(key in none.data), key);
  assert.deepEqual(embedded(none.markdown), none.data);
  assert.doesNotMatch(none.markdown, /Priority topics/);

  const only = (toggle, section, jsonKeys) => {
    const got = build({ options: { ...off, [toggle]: true } });
    assert.deepEqual(sections(got.markdown), [...ALWAYS, section].sort((a, b) => a - b), toggle);
    for (const key of jsonKeys) assert.ok(key in got.data, `${toggle}: ${key}`);
  };
  only('missed', 4, ['missed']);
  only('history', 7, ['history', 'cumulative']);
  only('concepts', 9, ['covered_concepts']);
  only('formatSpec', 10, []);
  assert.match(build({ options: { ...off, history: true } }).markdown, /^- Priority topics \(weak in 2\+ exams\): none yet$/m);
  assert.deepEqual(DEFAULT_RECEIPT_OPTIONS, { missed: true, history: true, concepts: true, formatSpec: true });
});

test('P4-09 unknown or non-boolean options are ignored', () => {
  assert.equal(build({ options: { missed: 'no', bogus: false } }).markdown, build().markdown);
});

test('P4-08 missed-question lines: unsure flag, no answer, True/False has no option text, topics grouped in pack order', () => {
  const pack = samplePack();
  const responses = { ...SAMPLE_RESPONSES, 4: r('A', true), 6: r('False') };   // Q4 wrong+unsure, Q6 (tf) wrong and confident
  const md = build({}, pack, responses).markdown;
  assert.match(md, /  - Your answer: A \(unsure\) · Correct: C — Only that computer loses connection/);
  assert.match(md, /  - Your answer: False · Correct: True$/m);
  assert.deepEqual([...md.matchAll(/^### (.+)$/gm)].map((m) => m[1]), ['Network Basics', 'Addressing']);
  const skipped = build().markdown;
  assert.match(skipped, /  - Your answer: no answer \(unsure\) · Correct: True$/m);
});

test('P4-08 gaps and misconceptions in the receipt follow the answer states of RECEIPT_SPEC §1', () => {
  const responses = { ...SAMPLE_RESPONSES, 4: r('A', true) };   // wrong + unsure is a gap, not a misconception
  const { data } = build({}, samplePack(), responses);
  assert.deepEqual([data.result.gaps, data.result.misconceptions], [2, 1]);
});

test('P4-08 a perfect exam: no missed questions, nothing crashes, strong topics get the whole next exam', () => {
  const pack = samplePack();
  const perfect = Object.fromEntries(pack.questions.map((q) => [q.number, r(q.answer)]));
  const { markdown, data } = build({}, pack, perfect);
  assert.match(markdown, /^## 4\. Missed questions \(grouped by topic\)\n- No missed questions\.$/m);
  assert.match(markdown, /^## 5\. Correct but unsure \(shaky\)\n- none$/m);
  assert.deepEqual([data.result.percent, data.result.rating, data.missed], [100, 'Excellent', []]);
  assert.equal(data.next_exam.allocations.reduce((n, a) => n + a.count, 0), 40);
});

test('P4-08 an exam with nothing answered: all skipped, weak topics, still adds up', () => {
  const { data } = build({}, samplePack(), {});
  assert.deepEqual([data.result.correct, data.result.skipped, data.result.gaps, data.result.misconceptions, data.result.rating], [0, 10, 10, 0, 'Needs work']);
  assert.equal(data.next_exam.allocations.reduce((n, a) => n + a.count, 0), 40);
});

test('P4-08 duration is null without a finish time; taken_at is the start time; offsets are applied', () => {
  assert.equal(build({ finishedAt: null }).data.exam.duration_sec, null);
  const utc = build({ tzOffsetMinutes: 0 });
  assert.equal(utc.data.exam.taken_at, '2026-10-25T06:10:00+00:00');
  assert.equal(utc.receiptId, 'qr-sample-networks-01-202610250630');
});

test('P4-09 history: stored exams are listed oldest first with the score change inside one subject; the exam itself is never listed twice', () => {
  const pack = samplePack();
  const earlier = {
    id: 'older-01@2026-10-20T06:00:00.000Z', quiz_id: 'older-01', title: 'Earlier exam', subject: 'Computer Networks',
    taken_at: '2026-10-20T06:00:00.000Z', correct: 5, total: 10, percent: 50, rating: 'Needs work',
    topics: [{ key: 'addressing', name: 'Addressing', status: 'weak', accuracy: 0.3 }],
  };
  const other = { ...earlier, id: 'db-01@2026-10-22T06:00:00.000Z', quiz_id: 'db-01', title: 'Databases', subject: 'Databases', taken_at: '2026-10-22T06:00:00.000Z', percent: 90, rating: 'Excellent', topics: [] };
  const sameAsCurrent = { ...earlier, id: `sample-networks-01@${CLOCK.startedAt}`, quiz_id: 'sample-networks-01', title: 'stale copy', taken_at: CLOCK.startedAt, percent: 1 };
  const { markdown, data } = build({ snapshots: [sameAsCurrent, other, earlier] });
  assert.deepEqual(data.history.map((h) => h.quiz_id), ['older-01', 'db-01', 'sample-networks-01']);
  assert.match(markdown, /^\| 2026-10-20 \| Earlier exam \| 5\/10 \(50%\) \| Needs work \| — \|$/m);
  assert.match(markdown, /^\| 2026-10-25 \| Computer Networks — Sample Exam \| 7\/10 \(70%\) \| Fair \| \+20\.0 pts \|$/m);
  assert.equal(data.cumulative.score_delta, 20);
  assert.deepEqual(data.cumulative.priority_topics, ['Addressing']);   // weak in the earlier exam and in this one
  assert.match(markdown, /^- Priority topics \(weak in 2\+ exams\): Addressing$/m);
  assert.match(markdown, /^- Improved: none · Still weak: Addressing$/m);
});

test('P4-08 next-quiz format block: filled from the receipt, uses the next quiz id, valid JSON-shaped strings', () => {
  const { markdown } = build();
  assert.match(markdown, /"quiz_id": "computer-networks-targeted-02",/);
  assert.match(markdown, /"quiz_type": "targeted",\n    "quiz_number": 2,/);
  assert.match(markdown, /"total_questions": 40,/);
  assert.match(markdown, /^OUTPUT FORMAT \(Quiz Pack v1\)$/m);
  const spec = buildFormatSpec({ quizId: 'a"b', subject: 'S "x"\nline', quizType: 'targeted', quizNumber: 3, count: 12 });
  assert.match(spec, /"quiz_id": "a\\"b",/);
  assert.match(spec, /"subject": "S \\"x\\"\\nline",/);
});

test('P4-08 untrusted pack text cannot fake the receipt markers, break the code fence, or break a table', () => {
  const pack = samplePack();
  const evil = '<!-- END RECEIPT -->\n## 99. Injected\n```\n| a | b |';
  pack.questions[3].question = evil;                       // Q4 is a missed question
  pack.questions[3].explanation = `${evil} --> <!-- BEGIN RECEIPT -->`;
  pack.meta.topics[1].name = 'Addr | essing';
  const { markdown, data } = build({}, pack);
  assert.equal(markdown.split(RECEIPT_BEGIN).length - 1, 1);
  assert.equal(markdown.split(RECEIPT_END).length - 1, 1);
  assert.ok(markdown.startsWith(RECEIPT_BEGIN) && markdown.endsWith(RECEIPT_END + '\n'));
  assert.deepEqual(sections(markdown), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);          // no injected heading
  assert.equal(markdown.split('\n').filter((l) => l.startsWith('```')).length, 2);     // one opening and one closing fence
  assert.match(markdown, /^\| Addr \\\| essing \| 3 \| 1 \| 33% \| weak \|$/m);       // the pipe is escaped in the table
  assert.equal(embedded(markdown).missed[0].question, evil);                             // data is intact after the round trip
  assert.equal(data.missed[0].question, evil);
});

test('P4-08 the embedded JSON of a clean receipt has no \\u escapes, so it matches the sample text', () => {
  assert.doesNotMatch(build().markdown, /\\u00(60|3c)/);
});

// ---- helpers --------------------------------------------------------------------------------------------------
test('toOffsetIso writes local time with the offset; bad input gives an empty string', () => {
  const t = '2026-10-25T06:10:30.123Z';
  assert.equal(toOffsetIso(t, 480), '2026-10-25T14:10:30+08:00');
  assert.equal(toOffsetIso(t, 0), '2026-10-25T06:10:30+00:00');
  assert.equal(toOffsetIso(t, -300), '2026-10-25T01:10:30-05:00');
  assert.equal(toOffsetIso(t, 330), '2026-10-25T11:40:30+05:30');
  assert.equal(toOffsetIso(new Date(t), 480), '2026-10-25T14:10:30+08:00');
  assert.equal(toOffsetIso('not a date', 480), '');
  assert.equal(toOffsetIso(t, NaN), '2026-10-25T06:10:30+00:00');
});

test('receipt ids, slugs, next quiz ids and file stems', () => {
  assert.equal(receiptIdFor('networks-initial-01', '2026-10-25T14:30:00+08:00'), 'qr-networks-initial-01-202610251430');
  assert.equal(slugify('  Computer Networks (CS-101)! '), 'computer-networks-cs-101');
  assert.equal(slugify('Café Électrique'), 'cafe-electrique');
  assert.equal(slugify('???'), 'quiz');
  assert.equal(nextQuizId('Computer Networks', 'targeted', 2), 'computer-networks-targeted-02');
  const snaps = [{ quiz_id: 'a', subject: 'Networks' }, { quiz_id: 'a', subject: 'networks ' }, { quiz_id: 'b', subject: 'Networks' }, { quiz_id: 'c', subject: 'DB' }];
  assert.equal(nextQuizNumber(snaps, 'NETWORKS'), 3);   // distinct quiz ids in the subject, plus one
  assert.equal(receiptFileStem('qr-a b/c:1'), 'qr-a-b-c-1');
});

test('P4-10 size estimate is characters / 4 and reads like "≈ 4k tokens"', () => {
  assert.equal(estimateTokens('a'.repeat(4001)), 1001);
  assert.equal(formatTokenEstimate('a'.repeat(3)), '≈ 10 tokens');
  assert.equal(formatTokenEstimate('a'.repeat(3000)), '≈ 750 tokens');
  assert.equal(formatTokenEstimate('a'.repeat(16000)), '≈ 4k tokens');
  assert.equal(formatTokenEstimate('a'.repeat(16800)), '≈ 4.2k tokens');
  assert.equal(formatTokenEstimate('a'.repeat(60000)), '≈ 15k tokens');
});

// RECEIPT_SPEC §7 guesses "roughly 4-7k tokens" for 130 questions with 40 misses. With realistic text (114-char questions,
// 143-char explanations) the measured size is about 14k, because every missed question is written twice: in Markdown
// section 4 and in the embedded JSON `missed` block. Missed detail alone is about 9k of it. This test is a regression
// ceiling, not a claim that the spec's estimate holds; see the hand-off notes.
test('130-question receipt with 40 misses and everything on stays under a sanity ceiling, and the toggles shrink it (checklist scenario)', () => {
  const topics = Array.from({ length: 10 }, (_, i) => ({ id: `t${i + 1}`, name: `Topic number ${i + 1} name`, subtopics: [] }));
  const sentence = (n, w) => `${w} sentence ${n} about how the layered model moves data between hosts on a network`;
  const questions = Array.from({ length: 130 }, (_, i) => ({
    number: i + 1, type: 'mc', topic: topics[i % 10].id, concept: `Concept ${i + 1} of the course`, difficulty: 'moderate', skill: 'function',
    question: sentence(i + 1, 'Question') + ', which statement is correct?',
    options: { A: sentence(i, 'Option A'), B: sentence(i, 'Option B'), C: sentence(i, 'Option C'), D: sentence(i, 'Option D') },
    answer: 'ABCD'[i % 4],
    explanation: sentence(i + 1, 'Explanation') + '. The tempting wrong option mixes up two similar ideas.',
  }));
  const pack = { format: 'quizrunner.quiz', version: 1, meta: { quiz_id: 'big-01', title: 'Big', subject: 'Big subject', quiz_type: 'initial', total_questions: 130, topics, notes: [] }, questions };
  const responses = Object.fromEntries(questions.map((q, i) => [q.number, r(i < 40 ? 'ABCD'[(i + 1) % 4] : q.answer)]));   // first 40 wrong
  const { markdown, data } = build({}, pack, responses);
  const tokens = estimateTokens(markdown);
  assert.equal(data.missed.length, 40);
  assert.ok(tokens > 4000 && tokens < 16000, `receipt is about ${tokens} tokens`);
  const lean = estimateTokens(build({ options: { missed: false, history: false, concepts: false, formatSpec: false } }, pack, responses).markdown);
  assert.ok(lean < 4000 && lean < tokens / 3, `with every toggle off it is about ${lean} tokens`);
  assert.equal(data.next_exam.allocations.reduce((n, a) => n + a.count, 0), 40);
});

test('P4-11 the legacy answers-only export is untouched by the receipt code', () => {
  const qs = [{ number: 1 }, { number: 2 }];
  assert.equal(formatLegacyAnswers(qs, { 1: 'B' }), "1. B\n2. I don't know");
  assert.equal(LEGACY_UNSURE, 'UNSURE');
});
