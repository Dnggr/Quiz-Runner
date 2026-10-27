// progress.js — everything the Progress screen shows (P6-01 list, P6-03 mastery, P6-04 priority topics, P6-05 compare,
// P6-06 trend chart) and what it takes to open an old exam read-only (P6-02). Pure module: no DOM.
// Storage is read through the store passed in (store.js), never written. The rules themselves (status, priority,
// improved, score delta) live in analytics.js, shared with the receipt's History block so the two cannot disagree.
import { packKey, RATING_BANDS } from './constants.js';
import { readHistory } from './history.js';
import {
  snapshotFromHistoryEntry, sortSnapshots, normalizeName, priorityTopics, topicMastery, compareWithPrevious,
} from './analytics.js';
import { toOffsetIso } from './receipt.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const round1 = (x) => Math.round(x * 10) / 10;

/** Why an exam cannot be opened. Shown next to the disabled Open button. */
export const OPEN_PROBLEMS = Object.freeze({
  noPack: 'The question pack for this exam is not stored on this device.',
  noAnswers: 'The answers of this exam were not saved.',
  mismatch: 'The stored pack no longer matches this exam (another pack was saved under the same quiz id).',
  unfinished: 'You have an unfinished exam of this quiz. Finish it first, so the answers stay hidden.',
});

/** `YYYY-MM-DD` of a timestamp in the learner's local time; empty when it is not a date. */
export const examDate = (takenAt, tzOffsetMinutes = 0) => toOffsetIso(takenAt, tzOffsetMinutes).slice(0, 10);

/**
 * P6-02: can this stored exam be shown again? It needs its pack (for the question text, options and explanations)
 * and its saved outcomes, and the pack must be the one the exam was taken on: `pack:<quiz_id>` is keyed by quiz id
 * only, so a later pack with the same id would silently replace it. Same number of questions and the same correct
 * answer for each number is the check.
 * @returns {string | null}  null when it can be opened, else one of `OPEN_PROBLEMS`
 */
export function openProblem(entry, pack) {
  if (!isPlainObject(pack) || !Array.isArray(pack.questions) || pack.questions.length === 0) return OPEN_PROBLEMS.noPack;
  if (!isPlainObject(entry) || !Array.isArray(entry.outcomes) || entry.outcomes.length === 0) return OPEN_PROBLEMS.noAnswers;
  if (entry.outcomes.length !== pack.questions.length) return OPEN_PROBLEMS.mismatch;
  const answers = new Map(pack.questions.filter(isPlainObject).map((q) => [q.number, q.answer]));
  const fits = entry.outcomes.every((o) => isPlainObject(o) && answers.has(o.number) && answers.get(o.number) === o.answer);
  return fits ? null : OPEN_PROBLEMS.mismatch;
}

/**
 * Load one stored exam for the read-only view.
 * @param {{ get: Function }} store
 * @param {string} id  the exam's id (`<quiz_id>@<started_at>`)
 * @param {{ lockedQuizId?: string | null }} [options]  quiz id of an unfinished session: its old results stay closed
 * @returns {{ ok: true, entry: object, pack: object, totals: object, outcomes: object[] } | { ok: false, reason: string }}
 */
export function openPastExam(store, id, { lockedQuizId = null } = {}) {
  const { entries, corrupt } = readHistory(store);
  const entry = corrupt ? undefined : entries.find((e) => { const s = snapshotFromHistoryEntry(e, null); return s !== null && s.id === id; });
  if (!entry) return { ok: false, reason: 'This exam is not in your history.' };
  if (lockedQuizId !== null && entry.quiz_id === lockedQuizId) return { ok: false, reason: OPEN_PROBLEMS.unfinished };
  const pack = store.get(packKey(entry.quiz_id), null);
  const problem = openProblem(entry, pack);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, entry, pack, totals: entry.totals, outcomes: entry.outcomes };
}

/**
 * @typedef {{
 *   id: string, quizId: string, title: string, subject: string, takenAt: string, date: string,
 *   correct: number, total: number, percent: number, rating: string, canOpen: boolean, reason: string,
 * }} ExamRow
 */

/**
 * Everything the Progress screen needs, in one pass over the stored history (each pack is read once).
 * @param {{ get: Function }} store
 * @param {{ tzOffsetMinutes?: number, compareId?: string | null, lockedQuizId?: string | null }} [options]
 *   `compareId`: the exam to compare and chart; the newest exam when missing or unknown.
 *   `lockedQuizId`: quiz id of an unfinished session (see `openPastExam`).
 * @returns {{
 *   corrupt: boolean, exams: ExamRow[], compareId: string | null,
 *   compare: null | { examId: string, title: string, subject: string, percent: number, rating: string,
 *     previous: null | { title: string, percent: number, date: string }, scoreDelta: number | null,
 *     improved: string[], stillWeak: string[] },
 *   trend: null | { subject: string, points: { id: string, title: string, percent: number, rating: string, date: string }[] },
 *   priority: { name: string, exams: number }[],
 *   mastery: import('./analytics.js').TopicMastery[],
 * }}
 */
export function buildProgress(store, { tzOffsetMinutes = 0, compareId = null, lockedQuizId = null } = {}) {
  const empty = { corrupt: false, exams: [], compareId: null, compare: null, trend: null, priority: [], mastery: [] };
  const { entries, corrupt } = readHistory(store);
  if (corrupt) return { ...empty, corrupt: true };

  const packs = new Map();
  const readPack = (quizId) => {
    if (!packs.has(quizId)) packs.set(quizId, store.get(packKey(quizId), null));
    return packs.get(quizId);
  };
  const snapshots = [];
  const openState = new Map();   // snapshot id -> reason it cannot be opened ('' when it can)
  for (const entry of entries) {
    const pack = typeof entry.quiz_id === 'string' ? readPack(entry.quiz_id) : null;
    const snapshot = snapshotFromHistoryEntry(entry, pack);
    if (snapshot === null) continue;
    snapshots.push(snapshot);
    const locked = lockedQuizId !== null && snapshot.quiz_id === lockedQuizId;
    openState.set(snapshot.id, locked ? OPEN_PROBLEMS.unfinished : openProblem(entry, pack) ?? '');
  }

  const newestFirst = sortSnapshots(snapshots).reverse();
  const exams = newestFirst.map((s) => ({
    id: s.id, quizId: s.quiz_id, title: s.title, subject: s.subject, takenAt: s.taken_at, date: examDate(s.taken_at, tzOffsetMinutes),
    correct: s.correct, total: s.total, percent: s.percent, rating: s.rating,
    canOpen: openState.get(s.id) === '', reason: openState.get(s.id) ?? '',
  }));
  if (exams.length === 0) return empty;

  const chosen = exams.some((e) => e.id === compareId) ? compareId : exams[0].id;
  const cmp = compareWithPrevious(snapshots, chosen);
  const date = (s) => examDate(s.taken_at, tzOffsetMinutes);
  const subjectKey = normalizeName(cmp.exam.subject);
  return {
    corrupt: false,
    exams,
    compareId: chosen,
    compare: {
      examId: chosen, title: cmp.exam.title, subject: cmp.exam.subject, percent: cmp.exam.percent, rating: cmp.exam.rating,
      previous: cmp.previous ? { title: cmp.previous.title, percent: cmp.previous.percent, date: date(cmp.previous) } : null,
      scoreDelta: cmp.scoreDelta, improved: cmp.improved, stillWeak: cmp.stillWeak,
    },
    // P6-06: the score trend of the compared exam's subject. Scores of different courses are not one story.
    trend: {
      subject: cmp.exam.subject,
      points: sortSnapshots(snapshots).filter((s) => normalizeName(s.subject) === subjectKey)
        .map((s) => ({ id: s.id, title: s.title, percent: s.percent, rating: s.rating, date: date(s) })),
    },
    priority: priorityTopics(snapshots),
    mastery: topicMastery(snapshots),
  };
}

// ---- P6-06: the trend chart, as numbers. The screen only turns this into SVG elements. -------------------------------

export const TREND_CHART = Object.freeze({ width: 320, height: 200, left: 36, right: 14, top: 16, bottom: 30 });
const MAX_LABELLED_POINTS = 8;   // above this only the first, the last and the selected point carry a number

/**
 * Geometry of a score-over-time line chart: percent from 0 at the bottom to 100 at the top, exams evenly spaced left to
 * right in the order given (oldest first). Grid lines sit at 0, 100 and the rating thresholds (`RATING_BANDS`).
 * @param {{ id: string, title: string, percent: number, date: string }[]} points
 * @param {string | null} [selectedId]
 */
export function trendChart(points, selectedId = null, size = TREND_CHART) {
  const { width, height, left, right, top, bottom } = size;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const n = points.length;
  const yOf = (percent) => round1(top + plotH * (1 - Math.min(100, Math.max(0, percent)) / 100));
  const xOf = (i) => round1(n <= 1 ? left + plotW / 2 : left + (plotW * i) / (n - 1));
  const values = [...new Set([0, ...RATING_BANDS.map((b) => b.min), 100])].sort((a, b) => a - b);
  const placed = points.map((p, i) => ({
    id: p.id, title: p.title, date: p.date, percent: p.percent, x: xOf(i), y: yOf(p.percent),
    selected: p.id === selectedId,
    labelled: n <= MAX_LABELLED_POINTS || i === 0 || i === n - 1 || p.id === selectedId,
  }));
  return {
    width, height, plot: { left, right: width - right, top, bottom: height - bottom },
    grid: values.map((value) => ({ value, y: yOf(value) })),
    points: placed,
    path: n >= 2 ? placed.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ') : '',
    firstDate: n > 0 ? points[0].date : '',
    lastDate: n > 0 ? points[n - 1].date : '',
  };
}
