// P6-01..P6-06: the data behind the Progress screen, and what it takes to open an old exam (P6-02).
// Exams are saved through the real save path (saveFinishedExam), so the stored shapes are the app's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProgress, openPastExam, openProblem, OPEN_PROBLEMS, examDate, trendChart, TREND_CHART,
} from '../js/progress.js';
import { saveFinishedExam } from '../js/history.js';
import { buildSession } from '../js/session.js';
import { gradeExam } from '../js/grader.js';
import { selectOption } from '../js/exam.js';
import { createStore } from '../js/store.js';
import { STORAGE_PREFIX, STORAGE_KEYS, packKey } from '../js/constants.js';
import { basePack } from './helpers.js';

function fakeStorage() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}
const newStore = () => { const storage = fakeStorage(); return { storage, store: createStore({ storage }) }; };

/** basePack answers: 1 B, 2 D, 3 A, 4 C. Topic "One" = questions 1-2, topic "Two" = 3-4. */
const packOf = (quizId, { subject = 'Testing', title = `Exam ${quizId}` } = {}) => {
  const p = basePack();
  p.meta.quiz_id = quizId;
  p.meta.subject = subject;
  p.meta.title = title;
  return p;
};

/** Take and save an exam. `picks` = chosen option per question number; a missing number is skipped. */
function take(store, pack, startedAt, picks) {
  let session = buildSession(pack, new Date(startedAt));
  let responses = session.responses;
  for (const [number, letter] of Object.entries(picks)) responses = selectOption(responses, Number(number), letter);
  session = { ...session, responses, finished: true, finished_at: new Date(Date.parse(startedAt) + 600000).toISOString() };
  assert.deepEqual(saveFinishedExam(store, session, gradeExam(session.pack, session.responses)), { packSaved: true, historySaved: true });
  return `${pack.meta.quiz_id}@${session.started_at}`;
}

/** Three Testing exams and one Biology exam. "Two" is weak in the first two Testing exams. */
function seeded() {
  const ctx = newStore();
  const ids = {
    a: take(ctx.store, packOf('q1'), '2026-10-01T20:00:00.000Z', { 1: 'B', 2: 'A' }),                       // 1/4 = 25%   One: watch, Two: weak
    b: take(ctx.store, packOf('q2'), '2026-10-08T10:00:00.000Z', { 1: 'B', 2: 'D', 3: 'B', 4: 'A' }),       // 2/4 = 50%   One: insufficient, Two: weak
    c: take(ctx.store, packOf('q3', { subject: 'Biology' }), '2026-10-15T10:00:00.000Z', { 1: 'A', 2: 'A' }), // 0/4 = 0%
    d: take(ctx.store, packOf('q4'), '2026-10-22T10:00:00.000Z', { 1: 'B', 2: 'D', 3: 'A', 4: 'C' }),       // 4/4 = 100%  One: insufficient, Two: insufficient
  };
  return { ...ctx, ids };
}

// ---- P6-01: the list of exams ------------------------------------------------------------------------------------

test('P6-01 the list has date, title, score and rating for every stored exam, newest first', () => {
  const { store, ids } = seeded();
  const p = buildProgress(store);
  assert.equal(p.corrupt, false);
  assert.deepEqual(p.exams.map((e) => e.id), [ids.d, ids.c, ids.b, ids.a]);
  assert.deepEqual(
    p.exams.map((e) => [e.title, e.correct, e.total, e.percent, e.rating, e.date]),
    [['Exam q4', 4, 4, 100, 'Excellent', '2026-10-22'], ['Exam q3', 0, 4, 0, 'Needs work', '2026-10-15'],
      ['Exam q2', 2, 4, 50, 'Needs work', '2026-10-08'], ['Exam q1', 1, 4, 25, 'Needs work', '2026-10-01']],
  );
});

test('P6-01 the date is the learner\'s local day, not the UTC day', () => {
  const { store } = seeded();
  const exam = (offset) => buildProgress(store, { tzOffsetMinutes: offset }).exams.find((e) => e.title === 'Exam q1');
  assert.equal(exam(0).date, '2026-10-01');
  assert.equal(exam(480).date, '2026-10-02');   // 20:00Z is already the next morning in UTC+8
  assert.equal(exam(-300).date, '2026-10-01');
  assert.equal(examDate('2026-10-01T20:00:00.000Z', 480), '2026-10-02');
  assert.equal(examDate('not a date', 0), '');
});

test('P6-01 no history: an empty list; unusable entries are skipped and never crash the screen', () => {
  const { store } = newStore();
  const empty = buildProgress(store);
  assert.deepEqual([empty.corrupt, empty.exams, empty.compare, empty.trend, empty.priority, empty.mastery], [false, [], null, null, [], []]);
  store.set(STORAGE_KEYS.history, [null, 5, 'x', {}, { quiz_id: 'x', totals: {} }]);
  assert.deepEqual(buildProgress(store).exams, []);
});

test('P6-01 a history that cannot be read is reported and left untouched', () => {
  const { storage, store } = newStore();
  storage.setItem(STORAGE_PREFIX + STORAGE_KEYS.history, JSON.stringify({ not: 'an array' }));
  const p = buildProgress(store);
  assert.equal(p.corrupt, true);
  assert.deepEqual(p.exams, []);
  assert.equal(storage.data.get(STORAGE_PREFIX + STORAGE_KEYS.history), JSON.stringify({ not: 'an array' }));
});

// ---- P6-02: opening an old exam read-only -----------------------------------------------------------------------

test('P6-02 an exam with its stored pack can be opened: the entry, the pack, the totals and the outcomes come back', () => {
  const { store, ids } = seeded();
  assert.ok(buildProgress(store).exams.every((e) => e.canOpen && e.reason === ''));
  const opened = openPastExam(store, ids.b);
  assert.equal(opened.ok, true);
  assert.equal(opened.pack.meta.quiz_id, 'q2');
  assert.equal(opened.totals.correct, 2);
  assert.deepEqual(opened.outcomes.map((o) => [o.number, o.selected, o.outcome]), [[1, 'B', 'correct'], [2, 'D', 'correct'], [3, 'B', 'wrong'], [4, 'A', 'wrong']]);
});

test('P6-02 opening is read-only: nothing in storage changes', () => {
  const { storage, store, ids } = seeded();
  const before = JSON.stringify([...storage.data.entries()]);
  openPastExam(store, ids.a);
  buildProgress(store, { compareId: ids.c });
  assert.equal(JSON.stringify([...storage.data.entries()]), before);
});

test('P6-02 an exam whose pack is gone is still listed, but cannot be opened, and says why', () => {
  const { store, ids } = seeded();
  store.remove(packKey('q2'));
  const row = buildProgress(store).exams.find((e) => e.id === ids.b);
  assert.equal(row.canOpen, false);
  assert.equal(row.reason, OPEN_PROBLEMS.noPack);
  assert.deepEqual(openPastExam(store, ids.b), { ok: false, reason: OPEN_PROBLEMS.noPack });
  assert.equal(buildProgress(store).exams.length, 4);
});

test('P6-02 a different pack saved under the same quiz id does not pass for the exam that was taken', () => {
  const { store, ids } = seeded();
  const other = packOf('q2');
  other.questions[0].answer = 'C';   // same id, same size, another answer key
  store.set(packKey('q2'), other);
  assert.deepEqual(openPastExam(store, ids.b), { ok: false, reason: OPEN_PROBLEMS.mismatch });
  const longer = packOf('q2');
  longer.questions.push({ ...longer.questions[0], number: 5 });
  store.set(packKey('q2'), longer);
  assert.equal(openPastExam(store, ids.b).reason, OPEN_PROBLEMS.mismatch);
});

test('P6-02 openProblem: no pack, no saved answers, wrong pack, or nothing wrong', () => {
  const pack = packOf('q1');
  const entry = { outcomes: gradeExam(pack, {}).outcomes };
  assert.equal(openProblem(entry, pack), null);
  for (const bad of [null, undefined, 'x', {}, { questions: [] }]) assert.equal(openProblem(entry, bad), OPEN_PROBLEMS.noPack, String(bad));
  for (const noAnswers of [{}, { outcomes: [] }, { outcomes: 'x' }, null]) assert.equal(openProblem(noAnswers, pack), OPEN_PROBLEMS.noAnswers);
  assert.equal(openProblem({ outcomes: [{ number: 99, answer: 'B' }] }, pack), OPEN_PROBLEMS.mismatch);
});

test('P6-02 while an exam of the same quiz is unfinished its old results stay closed (no answers on screen mid-exam)', () => {
  const { store, ids } = seeded();
  const rows = buildProgress(store, { lockedQuizId: 'q2' }).exams;
  assert.deepEqual(rows.map((e) => [e.title, e.canOpen]), [['Exam q4', true], ['Exam q3', true], ['Exam q2', false], ['Exam q1', true]]);
  assert.equal(rows.find((e) => e.id === ids.b).reason, OPEN_PROBLEMS.unfinished);
  assert.deepEqual(openPastExam(store, ids.b, { lockedQuizId: 'q2' }), { ok: false, reason: OPEN_PROBLEMS.unfinished });
  assert.equal(openPastExam(store, ids.a, { lockedQuizId: 'q2' }).ok, true);   // another quiz is not affected
});

test('P6-02 an id that is not in the history, or a damaged history, cannot be opened', () => {
  const { store, storage } = seeded();
  for (const id of ['', 'nope', undefined, null, 'q1@']) assert.equal(openPastExam(store, id).ok, false, String(id));
  storage.setItem(STORAGE_PREFIX + STORAGE_KEYS.history, '{"x":1}');
  assert.equal(openPastExam(store, 'q1@2026-10-01T20:00:00.000Z').ok, false);
});

// ---- P6-03 / P6-04: topic mastery and priority topics ------------------------------------------------------------

test('P6-03 topic mastery is built from the stored packs and outcomes, across exams, oldest to newest', () => {
  const { store } = seeded();
  const rows = new Map(buildProgress(store).mastery.map((r) => [r.key, r]));
  assert.deepEqual([...rows.keys()], ['one', 'two']);   // both end "insufficient" at 100%: ties are ordered by name
  // One: q1 1/2 (one miss: watch), q2 2/2 (too few questions: insufficient), q3 0/2 (weak), q4 2/2 (insufficient)
  assert.deepEqual(rows.get('one').history.map((h) => [h.status, h.accuracy]), [['watch', 0.5], ['insufficient', 1], ['weak', 0], ['insufficient', 1]]);
  // Two: weak (0/2) in q1, q2 and q3, then 2/2 in q4
  assert.deepEqual(rows.get('two').history.map((h) => [h.status, h.accuracy]), [['weak', 0], ['weak', 0], ['weak', 0], ['insufficient', 1]]);
  const two = rows.get('two');
  assert.deepEqual([two.exams, two.appearances, two.status, two.accuracy, two.change, two.priority], [4, 4, 'insufficient', 1, 100, true]);
  assert.equal(rows.get('one').priority, false);   // weak in one exam only
});

test('P6-03 a topic is matched by its normalized name even when the packs spell it differently', () => {
  const { store } = newStore();
  const a = packOf('q1'); a.meta.topics[1].name = 'Transport Layer';
  const b = packOf('q2'); b.meta.topics[1].name = '  transport   LAYER ';
  take(store, a, '2026-10-01T10:00:00.000Z', {});
  take(store, b, '2026-10-02T10:00:00.000Z', {});
  const rows = buildProgress(store).mastery.filter((r) => r.key === 'transport layer');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'transport   LAYER');   // the latest exam's spelling (outer spaces trimmed, as for every topic name)
  assert.equal(rows[0].exams, 2);
});

test('P6-04 priority topics: weak in two different exams, with how many', () => {
  const { store } = seeded();
  assert.deepEqual(buildProgress(store).priority, [{ name: 'Two', exams: 3 }]);   // weak in q1, q2 and Biology q3
});

test('P6-04 retaking the same quiz does not make a topic a priority by itself', () => {
  const { store } = newStore();
  take(store, packOf('q1'), '2026-10-01T10:00:00.000Z', {});
  take(store, packOf('q1'), '2026-10-02T10:00:00.000Z', {});
  const p = buildProgress(store);
  assert.equal(p.exams.length, 2);
  assert.deepEqual(p.priority, []);
});

test('P6-04 an exam whose pack is gone adds no topics, so it cannot make anything a priority', () => {
  const { store } = newStore();
  take(store, packOf('q1'), '2026-10-01T10:00:00.000Z', {});
  take(store, packOf('q2'), '2026-10-02T10:00:00.000Z', {});
  assert.equal(buildProgress(store).priority.length, 2);
  store.remove(packKey('q2'));
  const p = buildProgress(store);
  assert.deepEqual(p.priority, []);
  assert.equal(p.exams.length, 2);
});

// ---- P6-05: compare with the previous exam -----------------------------------------------------------------------

test('P6-05 the newest exam is compared by default, against the previous exam of the same subject', () => {
  const { store, ids } = seeded();
  const c = buildProgress(store).compare;
  assert.equal(buildProgress(store).compareId, ids.d);
  assert.deepEqual([c.title, c.percent, c.rating], ['Exam q4', 100, 'Excellent']);
  assert.deepEqual(c.previous, { title: 'Exam q2', percent: 50, date: '2026-10-08' });   // not q3: Biology
  assert.equal(c.scoreDelta, 50);
});

test('P6-05 any exam can be chosen; an unknown id falls back to the newest', () => {
  const { store, ids } = seeded();
  const b = buildProgress(store, { compareId: ids.b });
  assert.equal(b.compareId, ids.b);
  assert.equal(b.compare.scoreDelta, 25);
  assert.equal(b.compare.previous.title, 'Exam q1');
  assert.equal(buildProgress(store, { compareId: 'nope' }).compareId, ids.d);
  assert.equal(buildProgress(store, { compareId: ids.c }).compare.previous, null);   // the only Biology exam
});

test('P6-05 improved and still-weak topics as they stood on the chosen exam\'s day', () => {
  const { store, ids } = seeded();
  const atB = buildProgress(store, { compareId: ids.b }).compare;
  // One went 1/2 -> 2/2 (+50 points); Two was weak (0/2) both times, so it is still weak.
  assert.deepEqual([atB.improved, atB.stillWeak], [['One'], ['Two']]);
  const atD = buildProgress(store, { compareId: ids.d }).compare;
  assert.deepEqual(atD.stillWeak, []);               // 2/2 in its most recent exam: not weak any more
  assert.deepEqual(atD.improved, ['One', 'Two']);    // both rose by 100 points since the Biology exam
});

// ---- P6-06: the trend chart --------------------------------------------------------------------------------------

test('P6-06 the trend is the compared exam\'s subject, oldest first: scores of different courses are not mixed', () => {
  const { store, ids } = seeded();
  const t = buildProgress(store).trend;
  assert.equal(t.subject, 'Testing');
  assert.deepEqual(t.points.map((p) => [p.title, p.percent, p.date]), [['Exam q1', 25, '2026-10-01'], ['Exam q2', 50, '2026-10-08'], ['Exam q4', 100, '2026-10-22']]);
  const bio = buildProgress(store, { compareId: ids.c }).trend;
  assert.equal(bio.subject, 'Biology');
  assert.deepEqual(bio.points.map((p) => p.percent), [0]);
});

test('P6-06 chart geometry: percent runs 0 (bottom) to 100 (top), exams are spaced evenly, bands are drawn', () => {
  const pts = [{ id: 'a', title: 'A', percent: 50, date: 'd1' }, { id: 'b', title: 'B', percent: 62.5, date: 'd2' }, { id: 'c', title: 'C', percent: 75, date: 'd3' }];
  const c = trendChart(pts, 'b');
  assert.deepEqual([c.width, c.height], [TREND_CHART.width, TREND_CHART.height]);
  assert.deepEqual(c.plot, { left: 36, right: 306, top: 16, bottom: 170 });
  assert.deepEqual(c.points.map((p) => [p.x, p.y]), [[36, 93], [171, 73.8], [306, 54.5]]);
  assert.equal(c.path, 'M36 93 L171 73.8 L306 54.5');
  assert.deepEqual(c.grid.map((g) => g.value), [0, 60, 75, 90, 100]);   // 0, 100 and the rating thresholds from constants.js
  assert.deepEqual(c.grid.map((g) => g.y), [170, 77.6, 54.5, 31.4, 16]);
  assert.deepEqual(c.points.map((p) => p.selected), [false, true, false]);
  assert.deepEqual([c.firstDate, c.lastDate], ['d1', 'd3']);
});

test('P6-06 chart: one point sits in the middle and has no line; no points, nothing; scores are kept inside 0-100', () => {
  const one = trendChart([{ id: 'a', title: 'A', percent: 80, date: 'd' }]);
  assert.deepEqual([one.points[0].x, one.path], [171, '']);
  const none = trendChart([]);
  assert.deepEqual([none.points, none.path, none.firstDate], [[], '', '']);
  const wild = trendChart([{ id: 'a', title: 'A', percent: 140, date: '' }, { id: 'b', title: 'B', percent: -5, date: '' }]);
  assert.deepEqual(wild.points.map((p) => p.y), [16, 170]);
});

test('P6-06 chart: with many exams only the first, the last and the selected one carry a number', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, title: `E${i}`, percent: 40 + i, date: '' }));
  assert.deepEqual(trendChart(many, 'e5').points.filter((p) => p.labelled).map((p) => p.id), ['e0', 'e5', 'e11']);
  assert.equal(trendChart(many.slice(0, 8)).points.every((p) => p.labelled), true);
});
