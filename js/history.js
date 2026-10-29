// history.js — saving a graded exam (P3-09). Pure module: no DOM. All storage goes through the store passed in.
//   - `history`          array of graded results, oldest first (docs/PLAN.md §7)
//   - `pack:<quiz_id>`   the full pack, so reviews and receipts can be rebuilt later
// A history entry is identified by quiz_id + the time that attempt started, so saving the same attempt twice
// replaces it instead of adding a duplicate. Retaking a quiz adds a new entry.
// Phase 6 adds the other things that write to `history`: importing a receipt (P6-08), deleting one exam (P6-10) and
// clearing everything (P6-10), and it builds the cumulative profile receipt (P6-07) that feeds the retention check (P6-11).
import { STORAGE_KEYS, HISTORY_SCHEMA_VERSION, APP_VERSION, SPEC_VERSION, STATUS_ORDER, packKey } from './constants.js';
import { snapshotFromHistoryEntry, packTopics, normalizeName } from './analytics.js';
import { ratingForPercent } from './grader.js';
import { buildReceipt, coveredConcepts } from './receipt.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * @typedef {{
 *   entry_version: number, id: string, quiz_id: string, title: string, subject: string,
 *   quiz_type: string, quiz_number: number | null,
 *   started_at: string, finished_at: string,
 *   spec_version: number, app_version: string,
 *   totals: object, outcomes: object[],
 * }} HistoryEntry
 */

/**
 * @param {import('./session.js').Session} session  a finished session
 * @param {{ outcomes: object[], totals: object }} graded  from gradeExam
 * @returns {HistoryEntry}
 */
export function buildHistoryEntry(session, graded) {
  const meta = isPlainObject(session.pack && session.pack.meta) ? session.pack.meta : {};
  return {
    entry_version: HISTORY_SCHEMA_VERSION,
    id: `${session.quiz_id}@${session.started_at}`,
    quiz_id: session.quiz_id,
    title: session.title,
    subject: typeof meta.subject === 'string' ? meta.subject : '',
    quiz_type: typeof meta.quiz_type === 'string' ? meta.quiz_type : '',
    quiz_number: Number.isInteger(meta.quiz_number) ? meta.quiz_number : null,
    started_at: session.started_at,
    finished_at: session.finished_at || '',
    spec_version: SPEC_VERSION,
    app_version: APP_VERSION,
    totals: graded.totals,
    outcomes: graded.outcomes,
  };
}

/**
 * Read the history. `corrupt` is true when something other than an array is stored there: callers must not
 * overwrite it (the reset/repair offer is P7-07).
 * @returns {{ entries: HistoryEntry[], corrupt: boolean }}
 */
export function readHistory(store) {
  const raw = store.get(STORAGE_KEYS.history, null);
  if (raw === null) return { entries: [], corrupt: false };
  if (!Array.isArray(raw)) return { entries: [], corrupt: true };
  return { entries: raw.filter(isPlainObject), corrupt: false };
}

/**
 * Save a finished exam: the pack under `pack:<quiz_id>` and the graded result into `history`.
 * @returns {{ packSaved: boolean, historySaved: boolean }}  false = not in persistent storage (it is lost when the page
 *   closes), or, for `historySaved`, the stored history was unreadable and was left untouched.
 */
export function saveFinishedExam(store, session, graded) {
  const packSaved = store.set(packKey(session.quiz_id), session.pack);

  const { entries, corrupt } = readHistory(store);
  if (corrupt) return { packSaved, historySaved: false };

  const entry = buildHistoryEntry(session, graded);
  const at = entries.findIndex((e) => e.id === entry.id);
  const next = at === -1 ? [...entries, entry] : entries.map((e, i) => (i === at ? entry : e));
  return { packSaved, historySaved: store.set(STORAGE_KEYS.history, next) };
}

/**
 * Stored exams as snapshots for the receipt's History section (P4-09): totals plus per-topic status, the latter
 * rebuilt from the stored outcomes and `pack:<quiz_id>`. An exam whose pack is gone still appears, without topics.
 * Unusable entries are skipped. Reads only; never writes.
 * @returns {import('./analytics.js').ExamSnapshot[]}  in stored order (oldest first)
 */
export function loadSnapshots(store) {
  const { entries } = readHistory(store);
  return entries
    .map((e) => snapshotFromHistoryEntry(e, typeof e.quiz_id === 'string' ? store.get(packKey(e.quiz_id), null) : null))
    .filter((s) => s !== null);
}

/**
 * "Use latest from this device" (P5-05): rebuild the receipt of the most recently finished stored exam, from its stored
 * outcomes and its stored pack. Reads only; never writes.
 * @param {{ get: Function }} store
 * @param {{ now?: Date, tzOffsetMinutes?: number, options?: object }} [input]  `options` = receipt export toggles (receipt.js)
 * @returns {{ ok: true, text: string, receiptId: string, title: string } | { ok: false, error: string }}
 */
export function rebuildLatestReceipt(store, { now = new Date(), tzOffsetMinutes = 0, options = {} } = {}) {
  const { entries } = readHistory(store);
  const usable = entries.filter((e) => typeof e.quiz_id === 'string' && isPlainObject(e.totals) && Array.isArray(e.outcomes));
  if (usable.length === 0) return { ok: false, error: 'No finished exam is stored on this device yet. Finish an exam, or paste a receipt instead.' };

  const when = (e) => { const ms = Date.parse(e.finished_at || e.started_at); return Number.isFinite(ms) ? ms : 0; };
  const latest = usable.reduce((best, e) => (when(e) >= when(best) ? e : best));   // ties: the one stored later
  if (latest.outcomes.length === 0) {
    // Imported from a receipt (P6-08): the receipt kept the totals, not the answers, so a new receipt cannot be rebuilt from it.
    return { ok: false, error: `The latest exam (“${latest.title || latest.quiz_id}”) was imported from a receipt, so its receipt cannot be rebuilt here. Paste that receipt instead.` };
  }

  const pack = store.get(packKey(latest.quiz_id), null);
  if (!isPlainObject(pack) || !Array.isArray(pack.questions)) {
    return { ok: false, error: `The latest exam (“${latest.title || latest.quiz_id}”) is stored, but its question pack is gone, so its receipt cannot be rebuilt. Paste a receipt instead.` };
  }
  const receipt = buildReceipt({
    pack,
    graded: { outcomes: latest.outcomes, totals: latest.totals },
    startedAt: latest.started_at,
    finishedAt: latest.finished_at || null,
    now,
    tzOffsetMinutes,
    snapshots: loadSnapshots(store),
    options,
  });
  return { ok: true, text: receipt.markdown, receiptId: receipt.receiptId, title: String(latest.title || latest.quiz_id) };
}

// ============================================================================================================
// P6-07 / P6-11: the cumulative profile
// ============================================================================================================

/** Id of a stored entry: the same one `snapshotFromHistoryEntry` gives the exam (`<quiz_id>@<started_at>` when none is stored). */
export const entryId = (e) => String(e.id ?? `${e.quiz_id}@${e.started_at ?? ''}`);

const timeOf = (e) => { const ms = Date.parse(e.finished_at || e.started_at); return Number.isFinite(ms) ? ms : 0; };
const isPack = (p) => isPlainObject(p) && Array.isArray(p.questions) && p.questions.length > 0;
/** An exam that can be turned back into a receipt: its pack is stored and so are its graded outcomes. */
const rebuildable = (e, pack) => isPack(pack) && Array.isArray(e.outcomes) && e.outcomes.length > 0 && isPlainObject(e.totals);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * Every topic and every covered concept of every stored exam, for the profile receipt.
 * Topics are matched across exams by normalized name (RECEIPT_SPEC §4, PLAN D9). An exam taken here contributes its pack's
 * topics; an exam imported from a receipt contributes the topics that receipt listed.
 * Ids: the AI invents topic ids per pack, so two different topics can share one id across exams. The anchor exam keeps its
 * own ids (the receipt's per-topic stats refer to them), then the others come newest first; a topic whose id is already
 * taken by another topic gets a free `t<N>`. Names are what link a topic across exams, so this changes no matching.
 * SPEC GAP: RECEIPT_SPEC §8 says the topic list is the one "used" in the exam, so a list that spans exams is new.
 * @param {object[]} entries  stored history entries
 * @param {(quizId: string) => object | null} readPack
 * @param {object} anchor  the entry the receipt is about (it comes first)
 * @returns {{ topicList: { id: string, name: string }[], concepts: Record<string, string[]> }}
 */
export function profileTopics(entries, readPack, anchor) {
  const order = entries.map((e, at) => ({ e, at })).filter(({ e }) => typeof e.quiz_id === 'string')
    .sort((a, b) => timeOf(b.e) - timeOf(a.e) || b.at - a.at).map(({ e }) => e);   // newest first, ties: stored later first
  const sequence = [anchor, ...order.filter((e) => e !== anchor)];

  const byKey = new Map();   // normalized name -> { id, name, concepts: string[] }
  const usedIds = new Set();
  const freshId = () => { let n = 1; while (usedIds.has(`t${n}`)) n++; return `t${n}`; };
  const take = (id, name) => {
    const key = normalizeName(name);
    if (key === '' || byKey.has(key)) return byKey.get(key) ?? null;
    const chosen = nonEmpty(id) && !usedIds.has(id.trim()) ? id.trim() : freshId();
    usedIds.add(chosen);
    const topic = { id: chosen, name: String(name).replace(/\s+/g, ' ').trim(), concepts: [] };
    byKey.set(key, topic);
    return topic;
  };
  const addConcepts = (topic, list) => {
    for (const c of list) if (nonEmpty(c) && !topic.concepts.includes(c.trim())) topic.concepts.push(c.trim());
  };

  for (const e of sequence) {
    const imported = isPlainObject(e.imported) ? e.imported : null;
    if (imported && Array.isArray(imported.topics)) {
      for (const t of imported.topics) if (isPlainObject(t)) take(t.id, t.name);
      const covered = isPlainObject(imported.covered_concepts) ? imported.covered_concepts : {};
      for (const [name, list] of Object.entries(covered)) {
        const topic = take(undefined, name);
        if (topic && Array.isArray(list)) addConcepts(topic, list);
      }
      continue;
    }
    const pack = readPack(e.quiz_id);
    if (!isPack(pack)) continue;
    const topics = packTopics(pack);
    for (const t of topics) take(t.id, t.name);
    for (const [name, list] of Object.entries(coveredConcepts(pack, topics))) {
      const topic = take(undefined, name);
      if (topic) addConcepts(topic, list);
    }
  }

  const topicList = [...byKey.values()].map((t) => ({ id: t.id, name: t.name }));
  const concepts = {};
  for (const t of byKey.values()) if (t.concepts.length > 0) concepts[t.name] = t.concepts;
  return { topicList, concepts };
}

/**
 * P6-07: the cumulative profile receipt, ready to export. It is the receipt of the newest exam taken on this device whose
 * pack is stored, with the history and the cumulative rules always on, no missed-question detail (a profile is not a
 * review of one exam), and the topic list and covered concepts of every exam on the device (`profileTopics`).
 * The format is exactly the v1 receipt, so a profile receipt reads back like any other (parseReceipt, the Prompt Builder,
 * `importReceipt`). SPEC GAP: the specs do not define a profile receipt (see the hand-off notes).
 * Reads only; never writes. The device is read once here, so `build` can be called on every toggle.
 * @param {{ get: Function }} store
 * @param {{ now?: Date, tzOffsetMinutes?: number }} [input]
 * @returns {{ ok: true, title: string, exams: number, topics: number, build: (options?: object) => ReturnType<typeof buildReceipt> }
 *   | { ok: false, error: string }}
 */
export function prepareProfileReceipt(store, { now = new Date(), tzOffsetMinutes = 0 } = {}) {
  const { entries, corrupt } = readHistory(store);
  if (corrupt) return { ok: false, error: 'Your saved history could not be read, so a profile receipt cannot be made. It has not been changed.' };

  const packs = new Map();
  const readPack = (quizId) => { if (!packs.has(quizId)) packs.set(quizId, store.get(packKey(quizId), null)); return packs.get(quizId); };
  const candidates = entries.filter((e) => typeof e.quiz_id === 'string' && rebuildable(e, readPack(e.quiz_id)))
    .map((e, at) => ({ e, at })).sort((a, b) => timeOf(b.e) - timeOf(a.e) || b.at - a.at);
  if (candidates.length === 0) {
    return { ok: false, error: 'A profile receipt needs at least one exam taken on this device whose questions are still stored. Finish an exam first.' };
  }
  const anchor = candidates[0].e;
  const profile = profileTopics(entries, readPack, anchor);
  const snapshots = loadSnapshots(store);

  return {
    ok: true,
    title: `Profile · ${snapshots.length} ${snapshots.length === 1 ? 'exam' : 'exams'}`,
    exams: snapshots.length,
    topics: profile.topicList.length,
    build: (options = {}) => buildReceipt({
      pack: readPack(anchor.quiz_id),
      graded: { outcomes: anchor.outcomes, totals: anchor.totals },
      startedAt: anchor.started_at,
      finishedAt: anchor.finished_at || null,
      now,
      tzOffsetMinutes,
      snapshots,
      options: { ...options, missed: false, history: true },
      profile,
    }),
  };
}

// ============================================================================================================
// P6-08: importing a receipt
// ============================================================================================================

const secondOf = (iso) => { const ms = Date.parse(iso); return Number.isFinite(ms) ? Math.floor(ms / 1000) : null; };

/**
 * Is `candidate` already in `entries`? RECEIPT_SPEC §9: same `receipt_id`. Also the same entry id, and the same exam taken at
 * the same second: a receipt exported from this very device has an id nobody stored, and its time was written without
 * milliseconds, so it would otherwise count a second time. SPEC GAP: the spec names only `receipt_id`.
 * @returns {{ by: 'receipt_id' | 'id' | 'exam', entry: object } | null}
 */
export function findDuplicate(entries, candidate) {
  const second = secondOf(candidate.started_at);
  for (const e of entries) {
    if (nonEmpty(candidate.receipt_id) && e.receipt_id === candidate.receipt_id) return { by: 'receipt_id', entry: e };
    if (entryId(e) === candidate.id) return { by: 'id', entry: e };
    if (second !== null && e.quiz_id === candidate.quiz_id && secondOf(e.started_at) === second) return { by: 'exam', entry: e };
  }
  return null;
}

const text = (v, max = 2000) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

/** The receipt's `missed` list, kept as the receipt gave it (RECEIPT_SPEC §9 "keep the receipt's data"), every field checked. */
function keptMissed(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(isPlainObject).map((m) => ({
    number: Number.isInteger(m.number) ? m.number : null, topic: text(m.topic, 100), concept: text(m.concept, 300),
    question: text(m.question), selected: typeof m.selected === 'string' ? text(m.selected, 20) : null, answer: text(m.answer, 20),
    unsure: m.unsure === true, explanation: text(m.explanation),
  }));
}

/** The receipt's per-topic status and accuracy, for the Progress screen's topic mastery. */
function keptTopics(list) {
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    if (!isPlainObject(t) || !nonEmpty(t.name) || !STATUS_ORDER.includes(t.status) || !Number.isFinite(t.accuracy)) continue;
    out.push({ id: text(t.id, 100), name: text(t.name, 300), status: t.status, accuracy: Math.min(1, Math.max(0, t.accuracy)) });
  }
  return out;
}

function keptConcepts(map) {
  const out = {};
  if (!isPlainObject(map)) return out;
  for (const [name, list] of Object.entries(map)) {
    if (Array.isArray(list)) out[text(name, 300)] = list.map((c) => text(c, 300)).filter((c) => c !== '');
  }
  return out;
}

/**
 * Turn a parsed receipt (`parseReceipt`) into the history entry it stands for. The receipt has the totals and the topic
 * statuses but not the answers, so the entry has no `outcomes`: it counts in the list, the trend, the mastery and the history
 * table, and it cannot be opened for review.
 * @returns {{ ok: true, entry: HistoryEntry, warnings: string[], otherExams: number } | { ok: false, error: string }}
 */
export function receiptToEntry(parsed, { now = new Date() } = {}) {
  if (!parsed || !parsed.ok || !isPlainObject(parsed.data)) return { ok: false, error: (parsed && parsed.errors && parsed.errors[0]) || 'Choose a Quiz Runner receipt first.' };
  const d = parsed.data;
  const warnings = Array.isArray(parsed.warnings) ? [...parsed.warnings] : [];
  const exam = isPlainObject(d.exam) ? d.exam : {};
  const result = isPlainObject(d.result) ? d.result : {};

  const total = count(exam.total);
  const nums = ['correct', 'wrong', 'skipped', 'unsure'].map((k) => count(result[k]));
  if (total === null || total < 1 || nums.some((n) => n === null) || !Number.isFinite(result.percent)) {
    return { ok: false, error: 'The receipt has no usable result (the score and the counts are missing or not numbers), so it cannot be added to your history.' };
  }
  const startedMs = [exam.taken_at, d.created_at].map((v) => Date.parse(v)).find(Number.isFinite);
  if (startedMs === undefined) return { ok: false, error: 'The receipt does not say when the exam was taken, so it cannot be placed in your history.' };
  if (!Number.isFinite(Date.parse(exam.taken_at))) warnings.push('The receipt has no valid exam date; its creation time was used.');

  const [correct, wrong, skipped, unsure] = nums;
  if (correct + wrong + skipped !== total) {
    return { ok: false, error: `The receipt's numbers do not add up (${correct} correct + ${wrong} wrong + ${skipped} skipped is not ${total}), so it was not imported. It may have been edited.` };
  }
  const startedAt = new Date(startedMs).toISOString();
  const durationSec = Number.isFinite(exam.duration_sec) && exam.duration_sec >= 0 ? exam.duration_sec : null;
  const quizId = text(exam.quiz_id, 200);
  const entry = {
    entry_version: HISTORY_SCHEMA_VERSION,
    id: `${quizId}@${startedAt}`,
    quiz_id: quizId,
    title: text(exam.title, 300),
    subject: text(exam.subject, 300),
    quiz_type: text(exam.quiz_type, 50),
    quiz_number: Number.isInteger(exam.quiz_number) ? exam.quiz_number : null,
    started_at: startedAt,
    finished_at: durationSec === null ? '' : new Date(startedMs + durationSec * 1000).toISOString(),
    spec_version: Number.isFinite(d.version) ? d.version : SPEC_VERSION,
    app_version: text(d.app_version, 50),
    totals: {
      total, correct, wrong, skipped, unsure, percent: result.percent,
      rating: nonEmpty(result.rating) ? text(result.rating, 50) : ratingForPercent(result.percent),
    },
    outcomes: [],
    receipt_id: text(d.receipt_id, 300),
    imported: {
      at: now.toISOString(),
      topics: keptTopics(d.topics),
      missed: keptMissed(d.missed),
      covered_concepts: keptConcepts(d.covered_concepts),
    },
  };

  // A profile receipt lists the other exams too, but only as a date and a percentage: nothing a history entry can be built from.
  const second = secondOf(startedAt);
  const otherExams = (Array.isArray(d.history) ? d.history : []).filter((h) => isPlainObject(h) && !(h.quiz_id === quizId && secondOf(h.taken_at) === second)).length;
  return { ok: true, entry, warnings, otherExams };
}

/**
 * P6-08: add a receipt to the history, unless it is already there (see `findDuplicate`). The receipt must come from
 * `parseReceipt`, which already read the `.json` or the Markdown form and checked the format.
 * @param {{ get: Function, set: Function }} store
 * @param {ReturnType<import('./receipt.js').parseReceipt>} parsed
 * @param {{ now?: Date }} [input]
 * @returns {{ ok: true, status: 'imported' | 'duplicate', saved: boolean, message: string, warnings: string[], entry: HistoryEntry }
 *   | { ok: false, error: string }}  `saved: false` = it only lives in memory until the page closes
 */
export function importReceipt(store, parsed, { now = new Date() } = {}) {
  const made = receiptToEntry(parsed, { now });
  if (!made.ok) return made;
  const { entries, corrupt } = readHistory(store);
  if (corrupt) return { ok: false, error: 'Your saved history could not be read, so nothing was imported. It has not been changed.' };

  const { entry, warnings, otherExams } = made;
  const label = `“${entry.title || entry.quiz_id}”`;
  const duplicate = findDuplicate(entries, entry);
  if (duplicate) {
    const why = duplicate.by === 'receipt_id' ? 'this receipt was already imported' : 'that exam is already in your history';
    return { ok: true, status: 'duplicate', saved: true, message: `Skipped ${label}: ${why}.`, warnings, entry };
  }
  const saved = store.set(STORAGE_KEYS.history, [...entries, entry]);
  const extra = otherExams > 0
    ? ` The receipt also lists ${otherExams} other ${otherExams === 1 ? 'exam' : 'exams'}; ${otherExams === 1 ? 'it was' : 'they were'} not imported, because a receipt carries the details of one exam only. Import ${otherExams === 1 ? 'its' : 'their'} own receipt to add ${otherExams === 1 ? 'it' : 'them'}.`
    : '';
  return {
    ok: true, status: 'imported', saved, entry, warnings,
    message: `Imported ${label}: ${entry.totals.correct}/${entry.totals.total} (${entry.totals.percent}%). It counts in your progress, but it cannot be opened for review because a receipt does not carry your answers.${extra}`,
  };
}

// ============================================================================================================
// P6-10: deleting
// ============================================================================================================

/**
 * Delete one exam from the history. Its pack (`pack:<quiz_id>`) goes too, unless another stored exam of the same quiz
 * still needs it. An unfinished exam (`session`) is not touched: it keeps its own copy of the pack.
 * @param {{ get: Function, set: Function, remove: Function }} store
 * @param {string} id  the exam's id (`<quiz_id>@<started_at>`)
 * @returns {{ ok: true, saved: boolean, packRemoved: boolean, title: string } | { ok: false, error: string }}
 */
export function deleteExam(store, id) {
  const { entries, corrupt } = readHistory(store);
  if (corrupt) return { ok: false, error: 'Your saved history could not be read, so nothing was deleted. It has not been changed.' };
  const gone = entries.find((e) => entryId(e) === id && snapshotFromHistoryEntry(e, null) !== null);
  if (!gone) return { ok: false, error: 'This exam is not in your history.' };

  const rest = entries.filter((e) => e !== gone);
  const saved = store.set(STORAGE_KEYS.history, rest);
  let packRemoved = false;
  if (typeof gone.quiz_id === 'string' && !rest.some((e) => e.quiz_id === gone.quiz_id)) {
    store.remove(packKey(gone.quiz_id));
    packRemoved = true;
  }
  return { ok: true, saved, packRemoved, title: String(gone.title || gone.quiz_id || '') };
}

/**
 * Delete everything Quiz Runner keeps on this device: the history, every pack, the settings and any unfinished exam.
 * @param {{ keys: Function, remove: Function }} store
 * @returns {{ removed: number, remaining: number }}  `remaining` > 0 means the browser refused to remove something
 */
export function clearAllData(store) {
  const keys = store.keys();
  for (const key of keys) store.remove(key);
  return { removed: keys.length, remaining: store.keys().length };
}
