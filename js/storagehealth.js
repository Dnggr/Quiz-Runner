// storagehealth.js — what to do when the browser's storage is full (P7-05) or holds damaged data (P7-07). Pure module: no DOM.
// All storage goes through the store passed in (store.js); the screens (ui/notice.js, main.js) only show what this returns.
//
// Full storage (P7-05): `describeStorageFailure` words the message, `pruneOldestPack` makes room. The backup that comes before
// pruning is backup.js (P6-09): it also reads what only lives in memory, so a value that did not fit is still in the file.
// Damaged data (P7-07): `scanStoredData` finds an unusable `session` or `history`; `resetStoredKey` clears just that key,
// and for `history` `damagedText` keeps the unreadable text available for download first.
//
// SPEC GAP: PLAN §7 and the checklist say "prune oldest" without saying what is pruned. This prunes saved question packs
// (`pack:<quiz_id>`), the large part, oldest exam first, and leaves the history entries: an exam's score and date stay, only
// its review and its topic breakdown go (the same state RECEIPT_SPEC §9 already defines for a receipt without a pack).
import { STORAGE_KEYS, PACK_KEY_PREFIX } from './constants.js';
import { parseSession } from './session.js';
import { readHistory } from './history.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ============================================================================================================
// P7-07: damaged session / history
// ============================================================================================================

/**
 * @typedef {{ state: 'missing' | 'ok' | 'unusable', reason: 'unreadable' | 'invalid' | null }} KeyHealth
 *   `unusable` = something is stored but it cannot be used: `unreadable` = the text is not JSON (for example cut off while it
 *   was being written), `invalid` = JSON of the wrong shape or version.
 */

function checkKey(store, key, isUsable) {
  const read = store.inspect(key);
  if (!read.found) return { state: 'missing', reason: null };
  if (!read.readable) return { state: 'unusable', reason: 'unreadable' };
  return isUsable(read.value) ? { state: 'ok', reason: null } : { state: 'unusable', reason: 'invalid' };
}

/**
 * Is what the app keeps for an exam in progress and for the history usable? Reads only; never writes; never throws.
 * A key that is simply missing is fine (nothing saved yet).
 * @returns {{ session: KeyHealth, history: KeyHealth }}
 */
export function scanStoredData(store) {
  return {
    session: checkKey(store, STORAGE_KEYS.session, (value) => parseSession(value) !== null),
    history: checkKey(store, STORAGE_KEYS.history, Array.isArray),
  };
}

/**
 * The damaged text of a key, so the learner can keep it before resetting. Only the history: an unfinished exam's session holds
 * the answers of an exam still being taken, and backup.js keeps those out of every file for the same reason.
 * @returns {string | null}  null when there is nothing damaged to offer
 */
export function damagedText(store, key) {
  if (key !== STORAGE_KEYS.history) return null;
  const read = store.inspect(key);
  if (!read.found) return null;
  if (!read.readable) return read.raw;
  return Array.isArray(read.value) ? null : JSON.stringify(read.value);
}

/**
 * Clear one damaged key: `session` or `history`, nothing else. Saved packs and settings are not touched.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function resetStoredKey(store, key) {
  if (key !== STORAGE_KEYS.session && key !== STORAGE_KEYS.history) return { ok: false, error: 'Only the saved exam in progress and the history can be reset here.' };
  store.remove(key);
  if (store.inspect(key).found) return { ok: false, error: 'The browser would not remove it. Try again, or clear this site\u2019s data in the browser settings.' };
  return { ok: true };
}

// ============================================================================================================
// P7-05: full storage
// ============================================================================================================

/** Keys of what could not be saved -> "your exam progress, your exam history and the questions of a finished exam". */
function describeWhat(keys) {
  const parts = [];
  for (const key of keys) {
    let part = 'some data';
    if (key === STORAGE_KEYS.session) part = 'your exam progress';
    else if (key === STORAGE_KEYS.history) part = 'your exam history';
    else if (key.startsWith(PACK_KEY_PREFIX)) part = 'the questions of a finished exam';
    else if (key === STORAGE_KEYS.settings) part = 'your Prompt Builder options';
    if (!parts.includes(part)) parts.push(part);
  }
  if (parts.length <= 1) return parts[0] ?? 'some data';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The message for a value that did not reach storage (store.js `onWriteFailure`).
 * @param {{ reason: 'quota' | 'blocked' | 'unavailable', keys: string[] }} failure
 * @returns {{ title: string, message: string, canMakeRoom: boolean }}  `canMakeRoom`: removing saved packs can help (only when full)
 */
export function describeStorageFailure({ reason, keys }) {
  const what = describeWhat(keys);
  const keep = 'It is only held in this page for now: refreshing or closing the page would lose it.';
  const exam = keys.includes(STORAGE_KEYS.session)
    ? ' A backup does not include an exam in progress, so finish it before you refresh, or make room first.'
    : '';
  if (reason === 'quota') {
    return {
      title: 'Your browser has no room left to save',
      message: `Quiz Runner could not save ${what}. ${keep} Download a backup first, then make room by removing the oldest saved questions.${exam}`,
      canMakeRoom: true,
    };
  }
  if (reason === 'blocked') {
    return {
      title: 'Your browser would not save',
      message: `Quiz Runner could not save ${what}: the browser refused the write. ${keep} Download a backup to keep what you have.${exam}`,
      canMakeRoom: false,
    };
  }
  return {
    title: 'Saving is turned off in this browser',
    message: `Quiz Runner cannot save ${what} because the browser does not allow it here (private browsing or blocked site data). ${keep} Download a backup to keep what you have.${exam}`,
    canMakeRoom: false,
  };
}

/**
 * How much Quiz Runner keeps on this device, in characters of stored text (what browsers count their limit in).
 * @returns {{ chars: number, packs: number, packChars: number }}
 */
export function storageUsage(store) {
  let chars = 0;
  let packs = 0;
  let packChars = 0;
  for (const key of store.keys()) {
    const n = store.size(key);
    chars += n;
    if (key.startsWith(PACK_KEY_PREFIX)) { packs++; packChars += n; }
  }
  return { chars, packs, packChars };
}

const timeOf = (e) => { const ms = Date.parse(e.finished_at || e.started_at); return Number.isFinite(ms) ? ms : 0; };

/**
 * The saved packs that can be removed, oldest first. "Oldest" = the date of the newest exam of that quiz; a pack no exam in
 * the history uses any more comes first. A pack that only lives in memory is never listed: removing it would destroy the
 * only copy. Reads only.
 * @returns {{ ok: true, packs: { key: string, quizId: string, chars: number, title: string, orphan: boolean }[] }
 *   | { ok: false, reason: 'history-unreadable' }}  without a readable history the app cannot tell which pack is oldest
 */
export function prunablePacks(store) {
  const { entries, corrupt } = readHistory(store);
  if (corrupt) return { ok: false, reason: 'history-unreadable' };

  const lastUse = new Map();   // quiz id -> { at, title } of its newest exam
  for (const e of entries) {
    if (typeof e.quiz_id !== 'string') continue;
    const at = timeOf(e);
    const known = lastUse.get(e.quiz_id);
    if (!known || at >= known.at) lastUse.set(e.quiz_id, { at, title: String(e.title || e.quiz_id) });
  }

  const inMemory = new Set(store.pendingKeys());
  const packs = [];
  for (const key of store.keys()) {
    if (!key.startsWith(PACK_KEY_PREFIX) || inMemory.has(key)) continue;
    const quizId = key.slice(PACK_KEY_PREFIX.length);
    const use = lastUse.get(quizId);
    packs.push({ key, quizId, chars: store.size(key), at: use ? use.at : 0, title: use ? use.title : '', orphan: !use });
  }
  packs.sort((a, b) => Number(b.orphan) - Number(a.orphan) || a.at - b.at || (a.quizId < b.quizId ? -1 : a.quizId > b.quizId ? 1 : 0));
  return { ok: true, packs: packs.map(({ at, ...rest }) => rest) };
}

/**
 * Remove the oldest saved pack to make room (P7-05). The history stays: the exam keeps its score and date, and loses its
 * review and topic breakdown. The caller downloads a backup first and asks for confirmation.
 * @returns {{ ok: true, quizId: string, title: string, freedChars: number, orphan: boolean, remaining: number }
 *   | { ok: false, error: string }}
 */
export function pruneOldestPack(store) {
  const plan = prunablePacks(store);
  if (!plan.ok) {
    return { ok: false, error: 'Your saved history could not be read, so the app cannot tell which saved questions are the oldest. Reset the damaged history first (see the notice above), or use \u201cClear all data\u201d on the Progress screen.' };
  }
  if (plan.packs.length === 0) {
    return { ok: false, error: 'There are no saved questions left to remove. To free more space, delete exams on the Progress screen, or clear all data (download a backup first).' };
  }
  const victim = plan.packs[0];
  const pack = store.get(victim.key, null);
  const packTitle = isPlainObject(pack) && isPlainObject(pack.meta) && typeof pack.meta.title === 'string' ? pack.meta.title : '';

  store.remove(victim.key);
  if (store.inspect(victim.key).found) return { ok: false, error: 'The browser would not remove it. Try again, or clear this site\u2019s data in the browser settings.' };
  return {
    ok: true,
    quizId: victim.quizId,
    title: victim.title || packTitle || victim.quizId,
    freedChars: victim.chars,
    orphan: victim.orphan,
    remaining: plan.packs.length - 1,
  };
}
