// analytics.js — topic stats, status, rating, gaps vs misconceptions, rankings, next-exam allocation and the
// cumulative rules (P4-01..P4-06). Pure module: no DOM, no storage. Rules: docs/ai/RECEIPT_SPEC.md §1, §3, §4, §6.
// Every threshold comes from constants.js. Where the spec is silent the code says "SPEC GAP" and takes the most
// conservative reading; those places are listed in the hand-off notes for the owner to decide.
import {
  WEAK_MIN_MISSES, WEAK_MAX_ACCURACY, STRONG_MIN_N, STRONG_MIN_ACCURACY, STRONG_MAX_SHAKY,
  PRIORITY_MIN_EXAMS, IMPROVED_MIN_ACCURACY_GAIN, STATUS_ORDER,
  NEXT_EXAM_DEFAULT_N, NEXT_EXAM_MIN_N, NEXT_EXAM_MAX_N,
  ALLOCATION_SHARES, ALLOCATION_MIN_PER_WEAK_TOPIC, ALLOCATION_MIN_PER_OTHER_TOPIC, DIFFICULTY_MIX_BY_GROUP,
} from './constants.js';
import { ratingForPercent } from './grader.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const sum = (list) => list.reduce((a, b) => a + b, 0);

/** P4-03: overall rating from the percentage bands. The bands live in constants.js; grader.js applies them. */
export const overallRating = ratingForPercent;

/**
 * @typedef {'weak' | 'developing' | 'watch' | 'strong' | 'insufficient'} Status
 * @typedef {{
 *   id: string, name: string, total: number, correct: number, wrong: number, skipped: number,
 *   unsure: number, shaky: number, misses: number, accuracy: number, shakyRatio: number, status: Status,
 * }} TopicStat   `accuracy` and `shakyRatio` are exact fractions (0-1); round only when displaying.
 */

// ---- P4-02: topic status ---------------------------------------------------------------------------

/**
 * RECEIPT_SPEC §3, evaluated in the order the spec gives.
 * `misses` = wrong + skipped, `accuracy` = correct / total, `shakyRatio` = shaky / total.
 * One missed question never makes a topic weak (the first rule needs at least WEAK_MIN_MISSES).
 * What is left after rules 1-4 is rule 5 (`total < 3` and no misses): `insufficient`.
 * SPEC GAP: a topic with `total < 3`, no misses and shakyRatio >= 0.25 matches rule 4 (developing) before rule 5
 * (insufficient). The spec says "evaluate in this order", so this follows the order.
 * @returns {Status}
 */
export function topicStatus({ total, misses, accuracy, shakyRatio }) {
  if (misses >= WEAK_MIN_MISSES && accuracy < WEAK_MAX_ACCURACY) return 'weak';
  if (total >= STRONG_MIN_N && accuracy >= STRONG_MIN_ACCURACY && shakyRatio < STRONG_MAX_SHAKY) return 'strong';
  if (misses === 1) return 'watch';
  if (misses >= WEAK_MIN_MISSES || (accuracy >= STRONG_MIN_ACCURACY && shakyRatio >= STRONG_MAX_SHAKY)) return 'developing';
  return 'insufficient';
}

// ---- P4-01: topic stats ----------------------------------------------------------------------------

/** `[{ id, name }]` from `pack.meta.topics`, in pack order. Name falls back to the id. */
export function packTopics(pack) {
  const list = isPlainObject(pack) && isPlainObject(pack.meta) && Array.isArray(pack.meta.topics) ? pack.meta.topics : [];
  return list.filter(isPlainObject).map((t) => ({ id: str(t.id), name: str(t.name) || str(t.id) })).filter((t) => t.id !== '');
}

/**
 * Per-topic counts, accuracy and status (P4-01, P4-02).
 * `unsure` counts every flagged question; `shaky` = correct AND unsure.
 * Topics come back in `meta.topics` order. SPEC GAP: a topic with no questions in this exam has no accuracy,
 * so it is left out (it is still in the receipt's topic list).
 * @param {object} pack  a normalized, valid pack
 * @param {{ topic: string, outcome: string, unsure: boolean }[]} outcomes  from gradeExam
 * @returns {TopicStat[]}
 */
export function topicStats(pack, outcomes) {
  const byId = new Map(packTopics(pack).map((t) => [t.id, {
    id: t.id, name: t.name, total: 0, correct: 0, wrong: 0, skipped: 0, unsure: 0, shaky: 0,
  }]));
  for (const o of Array.isArray(outcomes) ? outcomes : []) {
    const t = byId.get(o.topic);
    if (!t) continue;
    t.total++;
    if (o.outcome === 'correct') t.correct++;
    else if (o.outcome === 'wrong') t.wrong++;
    else t.skipped++;
    if (o.unsure === true) {
      t.unsure++;
      if (o.outcome === 'correct') t.shaky++;
    }
  }
  return [...byId.values()]
    .filter((t) => t.total > 0)
    .map((t) => {
      const misses = t.wrong + t.skipped;
      const accuracy = t.correct / t.total;
      const shakyRatio = t.shaky / t.total;
      return { ...t, misses, accuracy, shakyRatio, status: topicStatus({ total: t.total, misses, accuracy, shakyRatio }) };
    });
}

// ---- P4-04: gaps vs misconceptions -----------------------------------------------------------------

/**
 * RECEIPT_SPEC §1. Gap = skipped, or wrong and unsure (the learner knew they did not know).
 * Misconception = wrong and not unsure (confidently wrong). A correct answer is not a miss.
 * @returns {'gap' | 'misconception' | null}
 */
export function classifyMiss(outcome) {
  if (!isPlainObject(outcome)) return null;
  if (outcome.outcome === 'skipped') return 'gap';
  if (outcome.outcome === 'wrong') return outcome.unsure === true ? 'gap' : 'misconception';
  return null;
}

/** Splits the misses of an exam. `gaps.length + misconceptions.length` = wrong + skipped. */
export function splitMisses(outcomes) {
  const gaps = [];
  const misconceptions = [];
  for (const o of Array.isArray(outcomes) ? outcomes : []) {
    const kind = classifyMiss(o);
    if (kind === 'gap') gaps.push(o);
    else if (kind === 'misconception') misconceptions.push(o);
  }
  return { gaps, misconceptions };
}

// ---- P4-05: rankings -------------------------------------------------------------------------------

/**
 * RECEIPT_SPEC §3 "Rankings".
 *  - weaknesses: `weak` topics, most misses first, then lowest accuracy first.
 *  - strengths: `strong` topics, highest accuracy first, then most questions first.
 *  - watch: `watch` + `developing` topics, lowest accuracy first.
 * Ties keep pack order (the sort is stable).
 * @param {TopicStat[]} stats
 */
export function rankTopics(stats) {
  const list = Array.isArray(stats) ? stats : [];
  return {
    weaknesses: list.filter((t) => t.status === 'weak').sort((a, b) => b.misses - a.misses || a.accuracy - b.accuracy),
    strengths: list.filter((t) => t.status === 'strong').sort((a, b) => b.accuracy - a.accuracy || b.total - a.total),
    watch: list.filter((t) => t.status === 'watch' || t.status === 'developing').sort((a, b) => a.accuracy - b.accuracy),
  };
}

/**
 * Order for the Topics tab: by `STATUS_ORDER` (weak first), then most misses, then lowest accuracy. Ties keep pack order.
 * Display only; the receipt keeps pack order in its table and uses `rankTopics` for its summaries.
 */
export function sortTopicsForDisplay(stats) {
  const rung = (t) => STATUS_ORDER.indexOf(t.status);
  return (Array.isArray(stats) ? stats : []).slice().sort((a, b) => rung(a) - rung(b) || b.misses - a.misses || a.accuracy - b.accuracy);
}

// ---- P4-06: next-exam recommendation ---------------------------------------------------------------

const GROUP_ORDER = ['weak', 'middle', 'strong'];   // "middle" = watch + developing
const EPS = 1e-9;

/** Whole number of questions for the next exam: default 40, kept inside 10-130. */
export function clampNextTotal(n) {
  const value = Number.isFinite(n) ? Math.round(n) : NEXT_EXAM_DEFAULT_N;
  return Math.min(NEXT_EXAM_MAX_N, Math.max(NEXT_EXAM_MIN_N, value));
}

/**
 * Largest-remainder rounding (RECEIPT_SPEC §6 step 5): whole numbers proportional to `weights` that add up to
 * exactly `total`. Equal remainders go to the earlier item. All-zero weights count as equal weights.
 */
export function largestRemainder(total, weights) {
  if (weights.length === 0) return [];
  const weightSum = sum(weights);
  const w = weightSum > 0 ? weights : weights.map(() => 1);
  const wSum = weightSum > 0 ? weightSum : w.length;
  const exact = w.map((x) => Math.round(((total * x) / wSum) * 1e9) / 1e9);   // rounded so 23.999999999 counts as 24
  const counts = exact.map(Math.floor);
  const left = total - sum(counts);
  const order = exact.map((x, i) => ({ i, r: x - counts[i] })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; k < left; k++) counts[order[k].i]++;
  return counts;
}

/**
 * Splits `quota` questions across topics in proportion to `weights`, with at least `min` per topic (§6 step 4).
 * Topics whose proportional share is below `min` are set to `min`, and the rest share what is left.
 * SPEC GAP: when `quota < min * topics` the minimums cannot all be met without going over the group's share
 * (and then over N), so the minimum is dropped and the quota is split proportionally.
 */
function splitWithMinimum(quota, weights, min) {
  if (quota <= 0) return weights.map(() => 0);
  if (quota < min * weights.length) return largestRemainder(quota, weights);
  const counts = weights.map(() => null);   // null = still shared proportionally
  for (;;) {
    const active = counts.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
    const remaining = quota - sum(counts.filter((c) => c !== null));
    const weightSum = sum(active.map((i) => weights[i]));
    const share = (i) => (weightSum > 0 ? (remaining * weights[i]) / weightSum : remaining / active.length);
    const below = active.filter((i) => share(i) < min - EPS);
    if (below.length === 0) {
      const part = largestRemainder(remaining, active.map((i) => weights[i]));
      active.forEach((i, j) => { counts[i] = part[j]; });
      return counts;
    }
    below.forEach((i) => { counts[i] = min; });
  }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Short reason shown next to an allocation. The spec only gives examples ("weak: 6 misses"); the rest follows them. */
function reasonFor(t) {
  if (t.status === 'strong') return 'strong: keep fresh';
  if (t.status === 'insufficient') return 'insufficient: too few questions to judge';
  if (t.misses > 0) return `${t.status}: ${plural(t.misses, 'miss', 'misses')}`;
  return `${t.status}: ${t.shaky} correct but unsure`;   // developing with no misses (many unsure answers)
}

const mixFor = (key) => ({ ...DIFFICULTY_MIX_BY_GROUP[key] });

/**
 * RECEIPT_SPEC §6, deterministic.
 *  1. Group shares of N: weak 60% · watch + developing 25% · strong 15%.
 *  2. No weak topics: watch + developing 60% · strong 40%.
 *  3. An empty group gives its share to the next group down (weak, then middle, then strong). If nothing is below,
 *     it goes to the nearest group above. With a single group that group gets 100%.
 *  4. Weak: split by misses, at least 2 per topic. Other groups: even split, at least 1 per topic.
 *  5. Largest-remainder rounding, so the total is exactly N.
 *  6. Difficulty mix per group from constants.js.
 * SPEC GAP: `insufficient` topics belong to no group, so they get questions only when no topic has any other status
 * (then every topic is treated as one group). "Any topic" in step 3 is read that way.
 * SPEC GAP: step 3 does not say where the strong share goes when strong is empty and nothing is below it. It goes up.
 * @param {TopicStat[]} stats
 * @param {number} [n]  default 40, kept inside 10-130
 * @returns {{ recommended_total: number, allocations: { topic: string, name: string, count: number, reason: string, difficulty_mix: object }[], rules: string[] }}
 */
export function allocateNextExam(stats, n = NEXT_EXAM_DEFAULT_N) {
  const total = clampNextTotal(n);
  const ranked = rankTopics(stats);
  const groups = { weak: ranked.weaknesses, middle: ranked.watch, strong: ranked.strengths };
  const rules = ['new questions only', 'reuse topic ids and names'];

  let present = GROUP_ORDER.filter((k) => groups[k].length > 0);
  if (present.length === 0) {
    const everyTopic = Array.isArray(stats) ? stats.slice() : [];
    if (everyTopic.length === 0) return { recommended_total: total, allocations: [], rules };
    groups.middle = everyTopic;   // "any topic": evenly, min 1 each
    present = ['middle'];
  }

  // Effective share of each group after empty groups hand theirs on (steps 1-3).
  const base = groups.weak.length > 0 ? ALLOCATION_SHARES.withWeak : ALLOCATION_SHARES.noWeak;
  const share = { weak: 0, middle: 0, strong: 0 };
  GROUP_ORDER.forEach((key, at) => {
    const own = base[key] ?? 0;
    if (own === 0) return;
    if (groups[key].length > 0) { share[key] += own; return; }
    const below = GROUP_ORDER.slice(at + 1).find((k) => groups[k].length > 0);
    const above = GROUP_ORDER.slice(0, at).reverse().find((k) => groups[k].length > 0);
    share[below || above] += own;   // `present` is not empty, so one of them exists
  });

  const quotas = largestRemainder(total, present.map((k) => share[k]));
  const allocations = [];
  present.forEach((key, i) => {
    const topics = groups[key];
    const weights = key === 'weak' ? topics.map((t) => t.misses) : topics.map(() => 1);
    const min = key === 'weak' ? ALLOCATION_MIN_PER_WEAK_TOPIC : ALLOCATION_MIN_PER_OTHER_TOPIC;
    const counts = splitWithMinimum(quotas[i], weights, min);
    const mixKey = key === 'weak' ? 'weak' : key === 'strong' ? 'strong' : 'other';
    topics.forEach((t, j) => {
      if (counts[j] > 0) allocations.push({ topic: t.id, name: t.name, count: counts[j], reason: reasonFor(t), difficulty_mix: mixFor(mixKey) });
    });
  });
  return { recommended_total: total, allocations, rules };
}

// ---- Everything the Results tabs and the receipt need ----------------------------------------------

/**
 * One call for the whole analysis of a graded exam.
 * @param {object} pack  normalized, valid pack
 * @param {{ outcomes: object[], totals: object }} graded  from gradeExam
 * @param {{ nextTotal?: number }} [options]
 */
export function analyzeExam(pack, graded, { nextTotal = NEXT_EXAM_DEFAULT_N } = {}) {
  const outcomes = Array.isArray(graded && graded.outcomes) ? graded.outcomes : [];
  const topics = topicStats(pack, outcomes);
  const { gaps, misconceptions } = splitMisses(outcomes);
  return {
    totals: graded.totals,
    rating: overallRating(graded.totals.percent),
    topics,
    ...rankTopics(topics),
    gaps,
    misconceptions,
    shaky: outcomes.filter((o) => o.outcome === 'correct' && o.unsure === true),
    nextExam: allocateNextExam(topics, nextTotal),
  };
}

// ---- Cumulative rules (RECEIPT_SPEC §4) --------------------------------------------------------------
// The receipt's History toggle and the Progress screen (Phase 6) both use these, so they cannot disagree.

/** Lowercase, trimmed, collapsed spaces: how topics (and subjects) are matched across exams. */
export const normalizeName = (s) => String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * @typedef {{
 *   id: string, quiz_id: string, title: string, subject: string, taken_at: string,
 *   correct: number, total: number, percent: number, rating: string,
 *   topics: { key: string, name: string, status: Status, accuracy: number }[],
 * }} ExamSnapshot   `topics` is empty when the pack is no longer stored: such an exam still counts in the history table.
 */

/** @returns {ExamSnapshot['topics']} */
const snapshotTopics = (stats) => stats.map((t) => ({ key: normalizeName(t.name), name: t.name, status: t.status, accuracy: t.accuracy }));

/** Snapshot of the exam being exported. @returns {ExamSnapshot} */
export function buildSnapshot({ id, quizId, title, subject, takenAt, totals, stats }) {
  return {
    id, quiz_id: quizId, title, subject, taken_at: takenAt,
    correct: totals.correct, total: totals.total, percent: totals.percent, rating: totals.rating,
    topics: snapshotTopics(stats),
  };
}

/**
 * Snapshot of a stored `history` entry (history.js). `pack` is the stored `pack:<quiz_id>` or null.
 * @returns {ExamSnapshot | null}  null when the entry is unusable
 */
export function snapshotFromHistoryEntry(entry, pack) {
  if (!isPlainObject(entry) || !isPlainObject(entry.totals)) return null;
  const t = entry.totals;
  if (![t.correct, t.total, t.percent].every(Number.isFinite) || typeof entry.quiz_id !== 'string') return null;
  const stats = pack && Array.isArray(entry.outcomes) ? topicStats(pack, entry.outcomes) : [];
  return {
    id: String(entry.id ?? `${entry.quiz_id}@${entry.started_at ?? ''}`),
    quiz_id: entry.quiz_id,
    title: String(entry.title ?? ''),
    subject: String(entry.subject ?? ''),
    taken_at: String(entry.started_at ?? ''),
    correct: t.correct, total: t.total, percent: t.percent,
    rating: typeof t.rating === 'string' ? t.rating : overallRating(t.percent),
    topics: snapshotTopics(stats),
  };
}

const timeOf = (s) => { const ms = Date.parse(s.taken_at); return Number.isFinite(ms) ? ms : 0; };
/** Oldest first. Equal times keep their given order. */
export const sortSnapshots = (snapshots) => snapshots.slice().sort((a, b) => timeOf(a) - timeOf(b));

const STATUS_RUNG = { weak: 0, developing: 1, watch: 1, strong: 2 };   // insufficient has no rung: it never counts as "moved up"
const movedUp = (from, to) => STATUS_RUNG[from] !== undefined && STATUS_RUNG[to] !== undefined && STATUS_RUNG[to] > STATUS_RUNG[from];
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The exam taken just before `sorted[at]` in the same subject (subjects match by normalized name), or null.
 * @param {ExamSnapshot[]} sorted  oldest first, as `sortSnapshots` returns
 * @param {number} at  index of the exam in `sorted`
 * @returns {ExamSnapshot | null}
 */
function previousInSubject(sorted, at) {
  if (at <= 0) return null;
  const subject = normalizeName(sorted[at].subject);
  for (let i = at - 1; i >= 0; i--) if (normalizeName(sorted[i].subject) === subject) return sorted[i];
  return null;
}

/**
 * Score change of the exam `currentId` against the previous exam of the same subject: percentage points, one decimal.
 * @returns {number | null}  null when there is no earlier exam in that subject
 */
export function scoreDeltaFor(snapshots, currentId) {
  const sorted = sortSnapshots(snapshots);
  const at = sorted.findIndex((s) => s.id === currentId);
  const previous = previousInSubject(sorted, at);
  return previous ? Math.round((sorted[at].percent - previous.percent) * 10) / 10 : null;
}

/**
 * Every topic across the given exams, matched by normalized name: normalized name -> appearances, oldest first.
 * @param {ExamSnapshot[]} sorted  oldest first
 */
function topicTimeline(sorted) {
  const timeline = new Map();
  for (const s of sorted) {
    for (const t of s.topics) {
      if (!timeline.has(t.key)) timeline.set(t.key, []);
      timeline.get(t.key).push({ quiz_id: s.quiz_id, name: t.name, status: t.status, accuracy: t.accuracy });
    }
  }
  return timeline;
}

/** Accuracy change between two appearances of a topic, in percentage points, one decimal. */
const accuracyGain = (prev, last) => Math.round((last.accuracy - prev.accuracy) * 1000) / 10;
/** RECEIPT_SPEC §4 "improved": the status moved up, or accuracy rose by at least IMPROVED_MIN_ACCURACY_GAIN points. */
const isImproved = (prev, last) => movedUp(prev.status, last.status) || accuracyGain(prev, last) >= IMPROVED_MIN_ACCURACY_GAIN;
/** Distinct exams (distinct quiz ids) in which a topic was `weak`. */
const weakExamCount = (rows) => new Set(rows.filter((r) => r.status === 'weak').map((r) => r.quiz_id)).size;

/**
 * RECEIPT_SPEC §4 "priority": topics that were `weak` in at least PRIORITY_MIN_EXAMS distinct exams, most exams first,
 * then by name. Same rule the receipt's History block uses.
 * @param {ExamSnapshot[]} snapshots
 * @returns {{ name: string, exams: number }[]}  `name` is the topic's name in its most recent exam
 */
export function priorityTopics(snapshots) {
  const priority = [];
  for (const rows of topicTimeline(sortSnapshots(snapshots)).values()) {
    const exams = weakExamCount(rows);
    if (exams >= PRIORITY_MIN_EXAMS) priority.push({ name: rows[rows.length - 1].name, exams });
  }
  return priority.sort((a, b) => b.exams - a.exams || byName(a.name, b.name));
}

/**
 * @typedef {{
 *   key: string, name: string, exams: number, appearances: number, status: Status, accuracy: number,
 *   change: number | null, improved: boolean, priority: boolean,
 *   history: { status: Status, accuracy: number }[],
 * }} TopicMastery   `status` and `accuracy` are from the topic's most recent exam; `change` is the accuracy gain in
 *   percentage points since the exam before (null when it appeared once); `history` is oldest first.
 */

/**
 * P6-03: one row per topic across all exams, matched by normalized topic name. Weak topics first, then by status
 * (`STATUS_ORDER`), lowest latest accuracy first, then name.
 * @param {ExamSnapshot[]} snapshots
 * @returns {TopicMastery[]}
 */
export function topicMastery(snapshots) {
  const rows = [];
  for (const [key, appearances] of topicTimeline(sortSnapshots(snapshots))) {
    const last = appearances[appearances.length - 1];
    const prev = appearances.length >= 2 ? appearances[appearances.length - 2] : null;
    rows.push({
      key, name: last.name,
      exams: new Set(appearances.map((a) => a.quiz_id)).size,
      appearances: appearances.length,
      status: last.status, accuracy: last.accuracy,
      change: prev ? accuracyGain(prev, last) : null,
      improved: prev ? isImproved(prev, last) : false,
      priority: weakExamCount(appearances) >= PRIORITY_MIN_EXAMS,
      history: appearances.map((a) => ({ status: a.status, accuracy: a.accuracy })),
    });
  }
  const rung = (r) => STATUS_ORDER.indexOf(r.status);
  return rows.sort((a, b) => rung(a) - rung(b) || a.accuracy - b.accuracy || byName(a.name, b.name));
}

/**
 * RECEIPT_SPEC §4 over every exam given (the exam being exported included).
 *  - priority: `weak` in at least PRIORITY_MIN_EXAMS distinct exams (distinct `quiz_id`s).
 *  - improved: between a topic's two most recent exams the status moved up, or accuracy rose by at least
 *    IMPROVED_MIN_ACCURACY_GAIN percentage points.
 *  - stillWeak: `weak` in the most recent exam that included the topic.
 *  - scoreDelta: against the previous exam in the same subject.
 * SPEC GAP: topics are matched by name across all subjects (the spec only restricts the score delta to one subject),
 * so two courses that both have a topic called "Introduction" count as one topic. "Distinct exams" is read as distinct
 * quiz ids, so retaking the same quiz does not make a topic a priority by itself.
 * @param {ExamSnapshot[]} snapshots
 * @param {string} currentId  `id` of the exam being exported
 */
export function cumulativeProfile(snapshots, currentId) {
  const timeline = topicTimeline(sortSnapshots(snapshots));
  const improved = [];
  const stillWeak = [];
  for (const rows of timeline.values()) {
    const last = rows[rows.length - 1];
    if (last.status === 'weak') stillWeak.push(last.name);
    if (rows.length >= 2 && isImproved(rows[rows.length - 2], last)) improved.push(last.name);
  }
  return {
    priority_topics: priorityTopics(snapshots).map((p) => p.name),
    improved: improved.sort(byName),
    still_weak: stillWeak.sort(byName),
    score_delta: scoreDeltaFor(snapshots, currentId),
  };
}

/**
 * P6-05: exam `examId` set against the exam before it. Everything is worked out as it stood when that exam was
 * taken: later exams are ignored, so an old exam compares the way it would have the day it was finished.
 *  - scoreDelta / previous: the previous exam in the same subject (RECEIPT_SPEC §4).
 *  - improved / stillWeak / priority: the receipt's cumulative rules over the exams up to and including this one.
 * @param {ExamSnapshot[]} snapshots
 * @param {string} examId
 * @returns {{ exam: ExamSnapshot, previous: ExamSnapshot | null, scoreDelta: number | null,
 *   improved: string[], stillWeak: string[], priority: string[] } | null}  null when there is no such exam
 */
export function compareWithPrevious(snapshots, examId) {
  const sorted = sortSnapshots(snapshots);
  const at = sorted.findIndex((s) => s.id === examId);
  if (at < 0) return null;
  const upTo = sorted.slice(0, at + 1);
  const profile = cumulativeProfile(upTo, examId);
  return {
    exam: sorted[at],
    previous: previousInSubject(sorted, at),
    scoreDelta: profile.score_delta,
    improved: profile.improved,
    stillWeak: profile.still_weak,
    priority: profile.priority_topics,
  };
}
