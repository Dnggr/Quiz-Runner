// history.js — saving a graded exam (P3-09). Pure module: no DOM. All storage goes through the store passed in.
//   - `history`          array of graded results, oldest first (docs/PLAN.md §7)
//   - `pack:<quiz_id>`   the full pack, so reviews and receipts can be rebuilt later
// A history entry is identified by quiz_id + the time that attempt started, so saving the same attempt twice
// replaces it instead of adding a duplicate. Retaking a quiz adds a new entry.
import { STORAGE_KEYS, HISTORY_SCHEMA_VERSION, APP_VERSION, SPEC_VERSION, packKey } from './constants.js';

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
