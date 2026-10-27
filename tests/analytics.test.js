// P4-01..P4-06 (+ the cumulative rules of RECEIPT_SPEC §4 that the receipt's History section uses).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  overallRating, topicStatus, topicStats, classifyMiss, splitMisses, rankTopics, sortTopicsForDisplay,
  clampNextTotal, largestRemainder, allocateNextExam, analyzeExam,
  normalizeName, snapshotFromHistoryEntry, cumulativeProfile, scoreDeltaFor,
  priorityTopics, topicMastery, compareWithPrevious,
} from '../js/analytics.js';
import { gradeExam } from '../js/grader.js';
import { DIFFICULTY_MIX_BY_GROUP, NEXT_EXAM_DEFAULT_N } from '../js/constants.js';
import { basePack, readSample } from './helpers.js';

// ---- helpers -----------------------------------------------------------------------------------
const stat = (id, total, correct, { shaky = 0, unsure = shaky, name = `Topic ${id}` } = {}) => {
  const misses = total - correct;
  const accuracy = total === 0 ? 0 : correct / total;
  const shakyRatio = total === 0 ? 0 : shaky / total;
  return { id, name, total, correct, wrong: misses, skipped: 0, unsure, shaky, misses, accuracy, shakyRatio, status: topicStatus({ total, misses, accuracy, shakyRatio }) };
};
const status = (total, correct, shaky = 0) => stat('x', total, correct, { shaky }).status;
const sampleResponses = () => {
  const r = (selected, unsure = false) => ({ selected, unsure });
  return { 1: r('B', true), 2: r('D'), 3: r('A'), 4: r('A'), 5: r('D'), 6: r(null, true), 7: r('C'), 8: r('A'), 9: r('D'), 10: r('B') };
};
const samplePack = () => JSON.parse(readSample('sample-pack.json'));
const counts = (alloc) => alloc.allocations.map((a) => a.count);
const total = (alloc) => alloc.allocations.reduce((n, a) => n + a.count, 0);

// ---- P4-03 -------------------------------------------------------------------------------------
test('P4-03 overall rating uses the percentage bands of RECEIPT_SPEC §2', () => {
  assert.deepEqual([100, 90, 89.9, 75, 74.9, 60, 59.9, 0].map(overallRating),
    ['Excellent', 'Excellent', 'Good', 'Good', 'Fair', 'Fair', 'Needs work', 'Needs work']);
});

// ---- P4-02: topic status, rule by rule ---------------------------------------------------------
test('P4-02 weak: two or more misses AND accuracy below 70%', () => {
  assert.equal(status(4, 2), 'weak');            // 2 misses in a four-question topic (checklist scenario)
  assert.equal(status(3, 1), 'weak');            // 2 misses, 33%
  assert.equal(status(2, 0), 'weak');            // 2 misses in a two-question topic
  assert.equal(status(10, 8), 'developing');     // 2 misses but 80%: not weak
  assert.equal(status(10, 7), 'developing');     // 3 misses at exactly 70%: "below 70%" is strict
  assert.equal(status(10, 6), 'weak');           // 4 misses at 60%
});

test('P4-02 one missed question never makes a topic weak (checklist scenario)', () => {
  for (let n = 1; n <= 60; n++) assert.notEqual(status(n, n - 1), 'weak', `n=${n}`);
  for (let n = 1; n <= 6; n++) assert.equal(status(n, n - 1), 'watch', `n=${n}`);    // under 85% accuracy
  assert.equal(status(7, 6), 'strong');                                              // 86% with one miss: rule 2 (strong) comes before rule 3 (watch)
});

test('P4-02 strong: at least 3 questions, accuracy at least 85%, shaky ratio below 25%', () => {
  assert.equal(status(3, 3), 'strong');
  assert.equal(status(20, 17), 'strong');        // exactly 85%: "at least"
  assert.equal(status(25, 21), 'developing');    // 84% with 4 misses
  assert.equal(status(2, 2), 'insufficient');    // too few questions (checklist scenario)
  assert.equal(status(1, 1), 'insufficient');
});

test('P4-02 high accuracy with many unsure answers is not strong (checklist scenario)', () => {
  assert.equal(status(4, 4, 2), 'developing');   // 50% shaky
  assert.equal(status(4, 4, 1), 'developing');   // exactly 25% shaky: "below 25%" is strict
  assert.equal(status(5, 5, 1), 'strong');       // 20% shaky
  assert.equal(status(4, 4, 0), 'strong');
});

test('P4-02 watch: exactly one miss (a topic with one miss is watch even when 85%+ with many unsure)', () => {
  assert.equal(status(10, 9, 3), 'watch');
});

test('P4-02 rules are evaluated in the spec order: n < 3 with no misses but many unsure is developing (SPEC GAP)', () => {
  assert.equal(status(2, 2, 1), 'developing');
});

test('P4-02 "insufficient" is only ever what is left after rules 1-4: n < 3 and no misses', () => {
  for (let n = 0; n <= 30; n++) {
    for (let misses = 0; misses <= n; misses++) {
      for (let shaky = 0; shaky <= n - misses; shaky++) {
        const s = topicStatus({ total: n, misses, accuracy: n === 0 ? 0 : (n - misses) / n, shakyRatio: n === 0 ? 0 : shaky / n });
        if (s === 'insufficient') assert.ok(n < 3 && misses === 0, `n=${n} misses=${misses} shaky=${shaky}`);
        if (n >= 3 && misses === 0) assert.notEqual(s, 'insufficient');
      }
    }
  }
});

// ---- P4-01: topic stats ------------------------------------------------------------------------
test('P4-01 topicStats on the sample pack with the sample receipt\'s responses', () => {
  const pack = samplePack();
  const { outcomes } = gradeExam(pack, sampleResponses());
  assert.deepEqual(topicStats(pack, outcomes).map((t) => ({ ...t, accuracy: Math.round(t.accuracy * 1000) / 1000 })), [
    { id: 't1', name: 'Network Basics', total: 4, correct: 3, wrong: 1, skipped: 0, unsure: 1, shaky: 1, misses: 1, accuracy: 0.75, shakyRatio: 0.25, status: 'watch' },
    { id: 't2', name: 'Addressing', total: 3, correct: 1, wrong: 1, skipped: 1, unsure: 1, shaky: 0, misses: 2, accuracy: 0.333, shakyRatio: 0, status: 'weak' },
    { id: 't3', name: 'Protocols and Layers', total: 3, correct: 3, wrong: 0, skipped: 0, unsure: 0, shaky: 0, misses: 0, accuracy: 1, shakyRatio: 0, status: 'strong' },
  ]);
});

test('P4-01 unsure counts every flagged question; shaky only the correct ones', () => {
  const pack = basePack();   // t1: Q1 (B), Q2 (D); t2: Q3 (A), Q4 (C)
  const responses = {
    1: { selected: 'B', unsure: true },   // correct + unsure -> shaky
    2: { selected: 'A', unsure: true },   // wrong + unsure   -> unsure, not shaky
    3: { selected: null, unsure: true },  // skipped + unsure -> unsure, not shaky
    4: { selected: 'C', unsure: false },
  };
  const [t1, t2] = topicStats(pack, gradeExam(pack, responses).outcomes);
  assert.deepEqual([t1.unsure, t1.shaky, t1.misses], [2, 1, 1]);
  assert.deepEqual([t2.unsure, t2.shaky, t2.misses], [1, 0, 1]);
});

test('P4-01 perfect score and zero score (checklist scenarios)', () => {
  const pack = basePack();
  const perfect = topicStats(pack, gradeExam(pack, { 1: { selected: 'B' }, 2: { selected: 'D' }, 3: { selected: 'A' }, 4: { selected: 'C' } }).outcomes);
  assert.deepEqual(perfect.map((t) => [t.accuracy, t.status]), [[1, 'insufficient'], [1, 'insufficient']]);   // 2 questions each
  const zero = topicStats(pack, gradeExam(pack, {}).outcomes);
  assert.deepEqual(zero.map((t) => [t.accuracy, t.misses, t.status]), [[0, 2, 'weak'], [0, 2, 'weak']]);
});

test('P4-01 a topic with no questions is left out; unknown topic ids are ignored; bad input does not throw', () => {
  const pack = basePack();
  pack.meta.topics.push({ id: 't9', name: 'Empty topic' });
  const outcomes = gradeExam(pack, {}).outcomes.concat([{ number: 99, topic: 'zz', outcome: 'wrong', unsure: false }]);
  assert.deepEqual(topicStats(pack, outcomes).map((t) => t.id), ['t1', 't2']);
  assert.deepEqual(topicStats(null, null), []);
});

// ---- P4-04: gaps vs misconceptions -------------------------------------------------------------
test('P4-04 classifyMiss: gap = skipped, or wrong and unsure; misconception = wrong and confident', () => {
  const o = (outcome, unsure) => ({ outcome, unsure });
  assert.equal(classifyMiss(o('correct', false)), null);
  assert.equal(classifyMiss(o('correct', true)), null);
  assert.equal(classifyMiss(o('skipped', false)), 'gap');
  assert.equal(classifyMiss(o('skipped', true)), 'gap');
  assert.equal(classifyMiss(o('wrong', true)), 'gap');
  assert.equal(classifyMiss(o('wrong', false)), 'misconception');
  assert.equal(classifyMiss(null), null);
});

test('P4-04 splitMisses: gaps + misconceptions = wrong + skipped (sample receipt: 1 gap, 2 misconceptions)', () => {
  const graded = gradeExam(samplePack(), sampleResponses());
  const { gaps, misconceptions } = splitMisses(graded.outcomes);
  assert.deepEqual(gaps.map((o) => o.number), [6]);
  assert.deepEqual(misconceptions.map((o) => o.number), [4, 5]);
  assert.equal(gaps.length + misconceptions.length, graded.totals.wrong + graded.totals.skipped);
});

// ---- P4-05: rankings ---------------------------------------------------------------------------
test('P4-05 weaknesses: most misses first, then lowest accuracy; strengths: accuracy desc, then more questions', () => {
  const stats = [
    stat('a', 4, 2), stat('b', 10, 4), stat('c', 3, 1), stat('d', 5, 1),   // all weak: misses 2, 6, 2, 4
    stat('e', 3, 3), stat('f', 10, 10), stat('g', 6, 6),                    // all strong, accuracy 1
    stat('h', 4, 3), stat('i', 10, 8),                                       // watch (75%) and developing (80%)
  ];
  const { weaknesses, strengths, watch } = rankTopics(stats);
  assert.deepEqual(weaknesses.map((t) => t.id), ['b', 'd', 'c', 'a']);   // 6, 4 misses; then the two with 2 misses: c (33%) before a (50%)
  assert.deepEqual(strengths.map((t) => t.id), ['f', 'g', 'e']);         // 100%: 10, 6, 3 questions
  assert.deepEqual(watch.map((t) => t.id), ['h', 'i']);                   // lowest accuracy first, watch and developing together
});

test('P4-05 sortTopicsForDisplay: weak first, then developing, watch, strong, insufficient', () => {
  const stats = [stat('s', 3, 3), stat('i', 2, 2), stat('w', 4, 2), stat('t', 4, 3), stat('d', 10, 8)];
  assert.deepEqual(sortTopicsForDisplay(stats).map((t) => t.status), ['weak', 'developing', 'watch', 'strong', 'insufficient']);
});

// ---- P4-06: next-exam allocation ---------------------------------------------------------------
test('P4-06 sample: weak 60% / watch 25% / strong 15% of 40 = 24 / 10 / 6, with reasons and difficulty mixes', () => {
  const pack = samplePack();
  const stats = topicStats(pack, gradeExam(pack, sampleResponses()).outcomes);
  const alloc = allocateNextExam(stats);
  assert.equal(alloc.recommended_total, NEXT_EXAM_DEFAULT_N);
  assert.deepEqual(alloc.allocations, [
    { topic: 't2', name: 'Addressing', count: 24, reason: 'weak: 2 misses', difficulty_mix: { easy: 0.3, moderate: 0.45, challenging: 0.25 } },
    { topic: 't1', name: 'Network Basics', count: 10, reason: 'watch: 1 miss', difficulty_mix: { easy: 0.2, moderate: 0.5, challenging: 0.3 } },
    { topic: 't3', name: 'Protocols and Layers', count: 6, reason: 'strong: keep fresh', difficulty_mix: { easy: 0.1, moderate: 0.4, challenging: 0.5 } },
  ]);
  assert.deepEqual(alloc.rules, ['new questions only', 'reuse topic ids and names']);
});

const SCENARIOS = {
  'weak + watch + strong': [stat('w1', 4, 1), stat('w2', 5, 3), stat('m1', 4, 3), stat('m2', 10, 8), stat('s1', 5, 5), stat('s2', 3, 3)],
  'no weak topics': [stat('m1', 4, 3), stat('s1', 5, 5), stat('s2', 3, 3)],
  'only weak': [stat('w1', 4, 1), stat('w2', 5, 2), stat('w3', 3, 0)],
  'only watch/developing': [stat('m1', 4, 3), stat('m2', 10, 8)],
  'only strong': [stat('s1', 5, 5), stat('s2', 3, 3), stat('s3', 8, 8)],
  'weak + strong (no middle)': [stat('w1', 4, 1), stat('s1', 5, 5)],
  'weak + watch (no strong)': [stat('w1', 4, 1), stat('m1', 4, 3)],
  'only insufficient': [stat('i1', 2, 2), stat('i2', 1, 1)],
  'six weak topics': ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => stat(id, 4, 2)),
};

test('P4-06 the allocation adds up to exactly N for every N from 10 to 130 in every shape (checklist scenario)', () => {
  for (const [name, stats] of Object.entries(SCENARIOS)) {
    for (let n = 10; n <= 130; n++) {
      const alloc = allocateNextExam(stats, n);
      assert.equal(alloc.recommended_total, n);
      assert.equal(total(alloc), n, `${name}, N=${n}`);
      assert.ok(alloc.allocations.every((a) => Number.isInteger(a.count) && a.count > 0), `${name}, N=${n}: counts are positive whole numbers`);
    }
  }
});

test('P4-06 N is a whole number kept inside 10-130, default 40', () => {
  assert.deepEqual([undefined, NaN, 5, 500, 33.4, 130, 10].map(clampNextTotal), [40, 40, 10, 130, 33, 130, 10]);
  assert.equal(allocateNextExam(SCENARIOS['no weak topics'], 5).recommended_total, 10);
});

test('P4-06 no weak topics: watch + developing 60%, strong 40%', () => {
  const alloc = allocateNextExam(SCENARIOS['no weak topics'], 40);
  assert.equal(total({ allocations: alloc.allocations.filter((a) => a.reason.startsWith('watch')) }), 24);
  assert.equal(total({ allocations: alloc.allocations.filter((a) => a.reason.startsWith('strong')) }), 16);
});

test('P4-06 an empty group hands its share to the next group down, else up; a lone group gets 100%', () => {
  const by = (alloc, prefix) => total({ allocations: alloc.allocations.filter((a) => a.reason.startsWith(prefix)) });
  const noMiddle = allocateNextExam(SCENARIOS['weak + strong (no middle)'], 40);
  assert.deepEqual([by(noMiddle, 'weak'), by(noMiddle, 'strong')], [24, 16]);   // 25% goes down to strong
  const noStrong = allocateNextExam(SCENARIOS['weak + watch (no strong)'], 40);
  assert.deepEqual([by(noStrong, 'weak'), by(noStrong, 'watch')], [24, 16]);    // 15% has nothing below: goes up (SPEC GAP)
  assert.deepEqual(counts(allocateNextExam([stat('w', 4, 1)], 40)), [40]);
  assert.deepEqual(counts(allocateNextExam([stat('s', 5, 5)], 40)), [40]);
  assert.deepEqual(counts(allocateNextExam([stat('m', 4, 3)], 40)), [40]);
});

test('P4-06 weak topics split in proportion to misses, at least 2 each', () => {
  // misses 6 and 2, only weak topics so quota 24 -> 18 and 6
  const alloc = allocateNextExam([stat('a', 8, 2), stat('b', 4, 2)], 24);   // a: 6 misses, b: 2 misses; only weak topics: quota 24
  assert.deepEqual(alloc.allocations.map((x) => [x.topic, x.count]), [['a', 18], ['b', 6]]);
  // a topic whose proportional share is under the minimum is lifted to 2, and the rest share what is left
  const lifted = allocateNextExam([stat('a', 22, 2), stat('b', 4, 2), stat('c', 4, 2)], 10);   // misses 20, 2, 2; quota 10
  assert.deepEqual(lifted.allocations.map((x) => [x.topic, x.count]), [['a', 6], ['b', 2], ['c', 2]]);
});

test('P4-06 other groups split evenly, at least 1 each; extra goes to the earlier (lower accuracy) topic', () => {
  const alloc = allocateNextExam([stat('m1', 4, 3), stat('m2', 10, 8), stat('m3', 5, 4)], 10);   // 100% middle, 3 topics
  assert.deepEqual(counts(alloc), [4, 3, 3]);
  assert.equal(alloc.allocations[0].topic, 'm1');   // lowest accuracy first (75%)
});

test('P4-06 when the minimums cannot fit, they are dropped and the total still equals N (SPEC GAP)', () => {
  const alloc = allocateNextExam(SCENARIOS['six weak topics'], 10);   // 6 weak topics x 2 = 12 > 10
  assert.equal(total(alloc), 10);
  assert.deepEqual(counts(alloc), [2, 2, 2, 2, 1, 1]);
});

test('P4-06 insufficient topics get questions only when nothing else exists (SPEC GAP)', () => {
  const mixed = allocateNextExam([stat('w', 4, 1), stat('i', 2, 2)], 40);
  assert.deepEqual(mixed.allocations.map((a) => a.topic), ['w']);
  const only = allocateNextExam(SCENARIOS['only insufficient'], 40);
  assert.deepEqual(counts(only), [20, 20]);
  assert.ok(only.allocations.every((a) => a.reason.startsWith('insufficient') && a.difficulty_mix.moderate === 0.5));
  assert.deepEqual(allocateNextExam([], 40), { recommended_total: 40, allocations: [], rules: ['new questions only', 'reuse topic ids and names'] });
});

test('P4-06 reasons follow the spec examples; developing with no misses says why', () => {
  const alloc = allocateNextExam([stat('w', 4, 2), stat('m', 4, 3), stat('d1', 10, 8), stat('d2', 4, 4, { shaky: 2 }), stat('s', 5, 5)], 100);
  const reason = (id) => alloc.allocations.find((a) => a.topic === id).reason;
  assert.deepEqual(['w', 'm', 'd1', 'd2', 's'].map(reason),
    ['weak: 2 misses', 'watch: 1 miss', 'developing: 2 misses', 'developing: 2 correct but unsure', 'strong: keep fresh']);
});

test('P4-06 the returned difficulty mixes are copies: changing one cannot change the constants', () => {
  const alloc = allocateNextExam(SCENARIOS['weak + watch + strong'], 40);
  alloc.allocations[0].difficulty_mix.easy = 99;
  assert.equal(DIFFICULTY_MIX_BY_GROUP.weak.easy, 0.3);
});

test('P4-06 largestRemainder: exact totals, ties to the earlier item, zero weights treated as equal', () => {
  assert.deepEqual(largestRemainder(10, [1, 1, 1]), [4, 3, 3]);
  assert.deepEqual(largestRemainder(33, [0.6, 0.25, 0.15]), [20, 8, 5]);
  assert.deepEqual(largestRemainder(7, [0, 0]), [4, 3]);
  assert.deepEqual(largestRemainder(5, []), []);
  for (let t = 0; t <= 60; t++) assert.equal(largestRemainder(t, [3, 5, 7, 11]).reduce((a, b) => a + b, 0), t);
});

// ---- analyzeExam ---------------------------------------------------------------------------------
test('analyzeExam bundles everything the Results tabs and the receipt need', () => {
  const pack = samplePack();
  const graded = gradeExam(pack, sampleResponses());
  const a = analyzeExam(pack, graded);
  assert.equal(a.rating, 'Fair');
  assert.deepEqual([a.weaknesses, a.strengths, a.watch].map((l) => l.map((t) => t.id)), [['t2'], ['t3'], ['t1']]);
  assert.deepEqual([a.gaps.length, a.misconceptions.length, a.shaky.map((o) => o.number)], [1, 2, [1]]);
  assert.equal(total(a.nextExam), 40);
  assert.equal(analyzeExam(pack, graded, { nextTotal: 60 }).nextExam.recommended_total, 60);
});

// ---- cumulative rules (RECEIPT_SPEC §4) -----------------------------------------------------------
const snap = (id, quizId, takenAt, percent, topics, subject = 'Networks') => ({
  id, quiz_id: quizId, title: `Exam ${quizId}`, subject, taken_at: takenAt, correct: 0, total: 10, percent, rating: overallRating(percent),
  topics: topics.map(([name, st, accuracy]) => ({ key: normalizeName(name), name, status: st, accuracy })),
});

test('normalizeName: lowercase, trimmed, collapsed spaces', () => {
  assert.equal(normalizeName('  Transport   LAYER '), 'transport layer');
  assert.equal(normalizeName(null), '');
});

test('priority topic: weak in 2+ distinct exams, matched by normalized name; a retake of the same quiz is one exam (SPEC GAP)', () => {
  const a = snap('a@1', 'q1', '2026-10-01T00:00:00Z', 50, [['Transport Layer', 'weak', 0.3], ['Basics', 'strong', 1]]);
  const b = snap('b@2', 'q2', '2026-10-08T00:00:00Z', 60, [['TRANSPORT LAYER', 'weak', 0.4], ['Basics', 'strong', 1]]);
  assert.deepEqual(cumulativeProfile([a, b], 'b@2').priority_topics, ['TRANSPORT LAYER']);   // the latest exam's spelling is shown
  const retake = snap('a@3', 'q1', '2026-10-09T00:00:00Z', 55, [['Transport Layer', 'weak', 0.35]]);
  assert.deepEqual(cumulativeProfile([a, retake], 'a@3').priority_topics, []);
  assert.deepEqual(cumulativeProfile([a], 'a@1').priority_topics, []);
});

test('improved: status moved up between the two most recent exams, or accuracy rose by 15+ points', () => {
  const t = (name, st, acc) => [name, st, acc];
  const first = snap('a@1', 'q1', '2026-10-01T00:00:00Z', 50, [t('A', 'weak', 0.3), t('B', 'watch', 0.75), t('C', 'developing', 0.8), t('D', 'watch', 0.60), t('E', 'strong', 1), t('F', 'watch', 0.75)]);
  const second = snap('b@2', 'q2', '2026-10-08T00:00:00Z', 70, [t('A', 'developing', 0.65), t('B', 'strong', 0.9), t('C', 'watch', 0.8), t('D', 'watch', 0.75), t('E', 'watch', 0.8), t('F', 'developing', 0.75)]);
  // A weak->developing (up) · B watch->strong (up) · C developing->watch (not up, same accuracy) · D +15 points (counts) · E down · F watch->developing (not up)
  assert.deepEqual(cumulativeProfile([first, second], 'b@2').improved, ['A', 'B', 'D']);
});

test('still weak: weak in the most recent exam that included the topic', () => {
  const a = snap('a@1', 'q1', '2026-10-01T00:00:00Z', 50, [['A', 'weak', 0.3], ['B', 'weak', 0.3]]);
  const b = snap('b@2', 'q2', '2026-10-08T00:00:00Z', 60, [['A', 'strong', 1], ['C', 'weak', 0.2]]);
  assert.deepEqual(cumulativeProfile([a, b], 'b@2').still_weak, ['B', 'C']);   // B was not retested, A recovered
});

test('score delta: against the previous exam of the same subject only, one decimal', () => {
  const a = snap('a@1', 'q1', '2026-10-01T00:00:00Z', 60, [], 'Networks');
  const other = snap('o@2', 'q9', '2026-10-05T00:00:00Z', 95, [], 'Databases');
  const b = snap('b@3', 'q2', '2026-10-08T00:00:00Z', 72.3, [], ' networks ');
  assert.equal(scoreDeltaFor([a, other, b], 'b@3'), 12.3);
  assert.equal(scoreDeltaFor([a, other, b], 'o@2'), null);   // first Databases exam
  assert.equal(scoreDeltaFor([a], 'a@1'), null);
  assert.equal(scoreDeltaFor([a, b], 'missing'), null);
  assert.equal(cumulativeProfile([a, other, b], 'b@3').score_delta, 12.3);
});

test('snapshotFromHistoryEntry: topic status rebuilt from stored outcomes and pack; no pack means no topics; junk is null', () => {
  const pack = samplePack();
  const graded = gradeExam(pack, sampleResponses());
  const entry = { id: 'sample-networks-01@2026-10-25T06:10:00.000Z', quiz_id: 'sample-networks-01', title: 'T', subject: 'S', started_at: '2026-10-25T06:10:00.000Z', totals: graded.totals, outcomes: graded.outcomes };
  const withPack = snapshotFromHistoryEntry(entry, pack);
  assert.deepEqual(withPack.topics.map((t) => [t.key, t.status]), [['network basics', 'watch'], ['addressing', 'weak'], ['protocols and layers', 'strong']]);
  assert.deepEqual([withPack.taken_at, withPack.percent, withPack.rating], ['2026-10-25T06:10:00.000Z', 70, 'Fair']);
  assert.deepEqual(snapshotFromHistoryEntry(entry, null).topics, []);
  for (const junk of [null, 5, {}, { quiz_id: 'x', totals: {} }, { totals: graded.totals }]) assert.equal(snapshotFromHistoryEntry(junk, pack), null);
});

// ---- Phase 6: the same rules, for the Progress screen ----------------------------------------------------
// Four exams. Networks: a (Oct 1), b (Oct 8), d (Oct 22). Biology: c (Oct 15).
const history = () => [
  snap('a@1', 'q1', '2026-10-01T00:00:00Z', 50, [['Transport Layer', 'weak', 0.3], ['Basics', 'strong', 1], ['Routing', 'watch', 0.8]]),
  snap('b@2', 'q2', '2026-10-08T00:00:00Z', 62.5, [['TRANSPORT LAYER', 'weak', 0.4], ['Basics', 'strong', 1], ['Routing', 'strong', 0.9]]),
  snap('c@3', 'q3', '2026-10-15T00:00:00Z', 30, [['Cells', 'weak', 0.2]], 'Biology'),
  snap('d@4', 'q4', '2026-10-22T00:00:00Z', 75, [['Transport layer', 'developing', 0.6], ['Routing', 'strong', 1]]),
];

test('P6-04 priorityTopics: weak in 2+ distinct exams, with the count, latest spelling, most exams first then by name', () => {
  assert.deepEqual(priorityTopics(history()), [{ name: 'Transport layer', exams: 2 }]);   // weak in a and b, now developing: still a priority
  const more = [...history(), snap('e@5', 'q5', '2026-10-25T00:00:00Z', 20, [['Cells', 'weak', 0.1], ['Zebra', 'weak', 0.1], ['Alpha', 'weak', 0.1]], 'Biology'),
    snap('f@6', 'q6', '2026-10-26T00:00:00Z', 20, [['Zebra', 'weak', 0.1], ['Alpha', 'weak', 0.1], ['Cells', 'weak', 0.1]], 'Biology')];
  assert.deepEqual(priorityTopics(more).map((p) => [p.name, p.exams]), [['Cells', 3], ['Alpha', 2], ['Transport layer', 2], ['Zebra', 2]]);
  assert.deepEqual(priorityTopics([]), []);
});

test('P6-04 priorityTopics agrees with the receipt\'s priority_topics, and the order the exams are given in does not matter', () => {
  const all = history();
  assert.deepEqual(priorityTopics(all).map((p) => p.name), cumulativeProfile(all, 'd@4').priority_topics);
  assert.deepEqual(priorityTopics([...all].reverse()), priorityTopics(all));
});

test('P6-03 topicMastery: one row per topic matched by normalized name, latest status first, weak topics on top', () => {
  const rows = topicMastery(history());
  assert.deepEqual(rows.map((r) => [r.name, r.status]), [['Cells', 'weak'], ['Transport layer', 'developing'], ['Basics', 'strong'], ['Routing', 'strong']]);
  const transport = rows.find((r) => r.key === 'transport layer');
  assert.deepEqual(
    { exams: transport.exams, appearances: transport.appearances, accuracy: transport.accuracy, change: transport.change, improved: transport.improved, priority: transport.priority },
    { exams: 3, appearances: 3, accuracy: 0.6, change: 20, improved: true, priority: true },
  );
  assert.deepEqual(transport.history.map((h) => h.status), ['weak', 'weak', 'developing']);   // oldest first
});

test('P6-03 topicMastery: change and "improved" follow the receipt rule (status up, or +15 points), not just any rise', () => {
  const rows = new Map(topicMastery(history()).map((r) => [r.key, r]));
  assert.equal(rows.get('basics').change, 0);
  assert.equal(rows.get('basics').improved, false);
  assert.equal(rows.get('routing').change, 10);            // 0.9 -> 1.0, strong -> strong: a rise, but below 15 points
  assert.equal(rows.get('routing').improved, false);
  assert.equal(rows.get('cells').change, null);            // seen once: nothing to compare with
  assert.equal(rows.get('cells').improved, false);
  assert.equal(rows.get('cells').priority, false);
  const improvedNames = topicMastery(history()).filter((r) => r.improved).map((r) => r.name);
  assert.deepEqual(improvedNames, cumulativeProfile(history(), 'd@4').improved);
});

test('P6-03 topicMastery: ties on status and accuracy are ordered by name; no exams, no rows', () => {
  const rows = topicMastery([snap('a@1', 'q1', '2026-10-01T00:00:00Z', 50, [['Zeta', 'watch', 0.5], ['Alpha', 'watch', 0.5], ['Low', 'watch', 0.2]])]);
  assert.deepEqual(rows.map((r) => r.name), ['Low', 'Alpha', 'Zeta']);
  assert.deepEqual(topicMastery([]), []);
  assert.deepEqual(topicMastery([snap('x@1', 'q1', '2026-10-01T00:00:00Z', 50, [])]), []);   // an exam whose pack is gone has no topics
});

test('P6-05 compareWithPrevious: score change against the previous exam of the same subject, topics as they stood that day', () => {
  const c = compareWithPrevious(history(), 'd@4');
  assert.equal(c.exam.id, 'd@4');
  assert.equal(c.previous.id, 'b@2');                       // not c: Biology is another subject
  assert.equal(c.scoreDelta, 12.5);                         // 75 - 62.5
  assert.deepEqual(c.improved, ['Transport layer']);
  assert.deepEqual(c.stillWeak, ['Cells']);                 // weak where it was last tested, and not retested since
  assert.deepEqual(c.priority, ['Transport layer']);
});

test('P6-05 compareWithPrevious: an older exam is compared as of its own day; later exams are ignored', () => {
  const c = compareWithPrevious(history(), 'b@2');
  assert.equal(c.previous.id, 'a@1');
  assert.equal(c.scoreDelta, 12.5);                         // 62.5 - 50
  assert.deepEqual(c.improved, ['Routing']);                // watch -> strong; Transport layer has not improved yet
  assert.deepEqual(c.stillWeak, ['TRANSPORT LAYER']);
  assert.deepEqual(c.priority, ['TRANSPORT LAYER']);
  assert.equal(compareWithPrevious(history(), 'd@4').exam.percent, 75);   // the full history is not changed by asking
});

test('P6-05 compareWithPrevious: a first exam has nothing to compare with; an unknown id is null', () => {
  const first = compareWithPrevious(history(), 'a@1');
  assert.equal(first.previous, null);
  assert.equal(first.scoreDelta, null);
  assert.deepEqual(first.improved, []);
  assert.deepEqual(first.stillWeak, ['Transport Layer']);
  assert.equal(compareWithPrevious(history(), 'c@3').previous, null);    // the only Biology exam
  assert.equal(compareWithPrevious(history(), 'nope'), null);
});

test('P6-05 compareWithPrevious: the previous exam is the one before in time, whatever order the list comes in', () => {
  const shuffled = [history()[3], history()[0], history()[2], history()[1]];
  assert.equal(compareWithPrevious(shuffled, 'd@4').previous.id, 'b@2');
  assert.equal(compareWithPrevious(shuffled, 'd@4').scoreDelta, 12.5);
});
