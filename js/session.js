// session.js — the in-progress exam record saved under `session` (P3-03). Pure module: no DOM.
// All persistence goes through the store that is passed in (store.js), so this is testable with node --test.
//
// A session holds the pack itself (answers included; localStorage only, never the DOM), the responses, the
// current question index and a `finished` flag. See docs/PLAN.md §7.
import { SESSION_SCHEMA_VERSION, STORAGE_KEYS } from './constants.js';
import { toExamQuestions, createResponses, progressCounts } from './exam.js';
import { validatePack } from './validator.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nowIso = (now) => (now instanceof Date ? now : new Date()).toISOString();

/**
 * @typedef {{
 *   version: number, quiz_id: string, title: string, pack: object,
 *   responses: Record<string, { selected: string | null, unsure: boolean }>,
 *   index: number, finished: boolean, started_at: string, updated_at: string, finished_at: string | null,
 * }} Session
 */

/** A new session for a loaded pack: nothing answered, at question 1. @param {object} pack @param {Date} [now] */
export function buildSession(pack, now) {
  const stamp = nowIso(now);
  const meta = isPlainObject(pack.meta) ? pack.meta : {};
  return {
    version: SESSION_SCHEMA_VERSION,
    quiz_id: String(meta.quiz_id ?? ''),
    title: String(meta.title ?? ''),
    pack,
    responses: createResponses(toExamQuestions(pack)),
    index: 0,
    finished: false,
    started_at: stamp,
    updated_at: stamp,
    finished_at: null,
  };
}

/**
 * Check and clean a value read from storage. Never throws.
 * Returns null when it is not a usable session (wrong shape or version, or a pack that no longer validates),
 * so the app starts clean instead of crashing. Responses are rebuilt from the pack: unknown question numbers
 * are dropped, missing ones are added empty, and a `selected` value that is not one of that question's options
 * becomes null. The index is clamped to the question range.
 * @returns {Session | null}
 */
export function parseSession(raw) {
  try {
    if (!isPlainObject(raw) || raw.version !== SESSION_SCHEMA_VERSION) return null;
    if (!isPlainObject(raw.pack) || !Array.isArray(raw.pack.questions)) return null;
    if (validatePack(raw.pack).errors.length > 0) return null;

    const questions = toExamQuestions(raw.pack);
    if (questions.length === 0) return null;

    const saved = isPlainObject(raw.responses) ? raw.responses : {};
    const responses = createResponses(questions);
    for (const q of questions) {
      const r = saved[q.number];
      if (!isPlainObject(r)) continue;
      const valid = q.options.some((o) => o.value === r.selected);
      responses[q.number] = { selected: valid ? r.selected : null, unsure: r.unsure === true };
    }

    const lastIndex = questions.length - 1;
    const index = Number.isInteger(raw.index) ? Math.min(Math.max(raw.index, 0), lastIndex) : 0;
    const meta = isPlainObject(raw.pack.meta) ? raw.pack.meta : {};
    return {
      version: SESSION_SCHEMA_VERSION,
      quiz_id: String(meta.quiz_id ?? ''),
      title: String(meta.title ?? ''),
      pack: raw.pack,
      responses,
      index,
      finished: raw.finished === true,
      started_at: typeof raw.started_at === 'string' ? raw.started_at : '',
      updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : '',
      finished_at: typeof raw.finished_at === 'string' ? raw.finished_at : null,
    };
  } catch {
    return null;
  }
}

/**
 * Save the session (stamps `updated_at`).
 * @returns {boolean} true if it reached persistent storage; false if it is only held in memory
 *   (private mode, quota) and a refresh would lose it.
 */
export function saveSession(store, session, now) {
  session.updated_at = nowIso(now);
  return store.set(STORAGE_KEYS.session, session);
}

/** @returns {Session | null} the saved session, or null when there is none or it is unusable */
export function loadSession(store) {
  return parseSession(store.get(STORAGE_KEYS.session, null));
}

export function clearSession(store) {
  store.remove(STORAGE_KEYS.session);
}

/** What the resume banner shows. Counts only: no answers. @param {Session} session */
export function describeSession(session) {
  const questions = toExamQuestions(session.pack);
  const counts = progressCounts(questions, session.responses);
  return { title: session.title, position: session.index + 1, ...counts };
}
