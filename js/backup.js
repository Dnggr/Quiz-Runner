// backup.js — full backup of what Quiz Runner keeps on this device, and restoring it (P6-09). Pure module: no DOM.
// All storage goes through the store passed in (store.js).
//
// What is in a backup: the `history`, every stored pack (`pack:<quiz_id>`) and the `settings`.
// What is not: an unfinished exam (`session`). Its pack holds the answers of an exam that is still being taken, and a file
// the learner can open must not be a way to read them; it is also not something to bring back onto another device.
//
// Restoring MERGES: it adds what this device does not have yet and never deletes or overwrites anything here. After a
// browser wipe that is the same as a full restore. To make a device match a backup exactly, clear all data first (P6-10).
// SPEC GAP: the specs say "Full backup (download) and restore" and nothing about the file or about merge vs replace.
import { BACKUP_FORMAT, BACKUP_VERSION, APP_VERSION, SPEC_VERSION, STORAGE_KEYS, PACK_KEY_PREFIX, packKey } from './constants.js';
import { readHistory, entryId, findDuplicate } from './history.js';
import { snapshotFromHistoryEntry } from './analytics.js';
import { validatePack } from './validator.js';
import { toOffsetIso, RECEIPT_BEGIN } from './receipt.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** `quiz-runner-backup-YYYYMMDD-HHmm.json`, from the learner's local time. */
export function backupFileName(now = new Date(), tzOffsetMinutes = 0) {
  const stamp = toOffsetIso(now, tzOffsetMinutes).slice(0, 16).replace(/\D/g, '');
  return `quiz-runner-backup-${stamp.slice(0, 8)}-${stamp.slice(8)}.json`;
}

/**
 * P6-09: everything worth keeping, as one JSON file's text.
 * @param {{ get: Function, keys: Function }} store
 * @param {{ now?: Date, tzOffsetMinutes?: number }} [input]
 * @returns {{ ok: true, text: string, fileName: string, exams: number, packs: number, warnings: string[] } | { ok: false, error: string }}
 */
export function buildBackup(store, { now = new Date(), tzOffsetMinutes = 0 } = {}) {
  const warnings = [];
  const { entries, corrupt } = readHistory(store);
  if (corrupt) warnings.push('Your saved history could not be read, so it is not in this backup. The packs and settings are.');

  const packs = {};
  for (const key of store.keys()) {
    if (!key.startsWith(PACK_KEY_PREFIX)) continue;
    const pack = store.get(key, null);
    if (isPlainObject(pack) && Array.isArray(pack.questions)) packs[key.slice(PACK_KEY_PREFIX.length)] = pack;
  }
  const settings = store.get(STORAGE_KEYS.settings, null);
  const exams = corrupt ? [] : entries;
  if (exams.length === 0 && Object.keys(packs).length === 0 && !isPlainObject(settings)) {
    return { ok: false, error: 'There is nothing to back up yet. Finish an exam first.' };
  }

  const file = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    created_at: toOffsetIso(now, tzOffsetMinutes),
    app_version: APP_VERSION,
    spec_version: SPEC_VERSION,
    data: { settings: isPlainObject(settings) ? settings : null, history: exams, packs },
  };
  return { ok: true, text: JSON.stringify(file), fileName: backupFileName(now, tzOffsetMinutes), exams: exams.length, packs: Object.keys(packs).length, warnings };
}

/**
 * Read and check a backup file's text. A pack that fails the pack validator, or an exam that is not a usable history entry,
 * is left out (and counted) instead of being restored: a damaged piece must not damage the device.
 * @param {string} raw
 * @returns {{ ok: boolean, errors: string[], warnings: string[], data: { settings: object | null, history: object[], packs: Record<string, object> } | null,
 *   counts: { exams: number, packs: number, skippedExams: number, skippedPacks: number } }}
 */
export function parseBackup(raw) {
  const out = { ok: false, errors: [], warnings: [], data: null, counts: { exams: 0, packs: 0, skippedExams: 0, skippedPacks: 0 } };
  const text = String(raw ?? '').replace(/^\uFEFF/, '').trim();
  if (text === '') { out.errors.push('The file is empty.'); return out; }

  if (text.includes(RECEIPT_BEGIN)) {
    out.errors.push('This is a receipt, not a backup. Use “Import receipt” to add it to your history.');
    return out;
  }
  let file;
  try {
    file = JSON.parse(text);
  } catch (err) {
    out.errors.push(`The file could not be read (${err instanceof SyntaxError ? err.message : 'invalid JSON'}). It may be cut off or edited.`);
    return out;
  }
  if (!isPlainObject(file) || file.format !== BACKUP_FORMAT) {
    out.errors.push(`This is not a Quiz Runner backup (its "format" should be "${BACKUP_FORMAT}"). To add a receipt, use "Import receipt".`);
    return out;
  }
  if (!Number.isFinite(file.version)) out.warnings.push('The backup has no version number; reading it as best as possible.');
  else if (file.version !== BACKUP_VERSION) out.warnings.push(`The backup is version ${file.version}, this app writes version ${BACKUP_VERSION}. Reading it as best as possible.`);
  if (!isPlainObject(file.data)) { out.errors.push('The backup has no data section.'); return out; }

  const history = [];
  for (const e of Array.isArray(file.data.history) ? file.data.history : []) {
    if (isPlainObject(e) && snapshotFromHistoryEntry(e, null) !== null) history.push(e);
    else out.counts.skippedExams++;
  }
  const packs = {};
  for (const [quizId, pack] of Object.entries(isPlainObject(file.data.packs) ? file.data.packs : {})) {
    if (quizId.trim() !== '' && validatePack(pack).errors.length === 0) packs[quizId] = pack;
    else out.counts.skippedPacks++;
  }
  const settings = isPlainObject(file.data.settings) ? file.data.settings : null;

  out.counts.exams = history.length;
  out.counts.packs = Object.keys(packs).length;
  if (out.counts.skippedExams > 0) out.warnings.push(`${plural(out.counts.skippedExams, 'exam', 'exams')} in the file could not be used and will be left out.`);
  if (out.counts.skippedPacks > 0) out.warnings.push(`${plural(out.counts.skippedPacks, 'question pack', 'question packs')} in the file did not pass the pack check and will be left out.`);
  if (history.length === 0 && out.counts.packs === 0 && settings === null) {
    out.errors.push('The backup has nothing that can be restored.');
    return out;
  }
  out.ok = true;
  out.data = { settings, history, packs };
  return out;
}

/**
 * Merge a parsed backup into this device: exams that are not here yet (see `findDuplicate`), packs for quiz ids that have
 * none, and the settings if there are none. Packs are written first and the history last, so an exam never points at a pack
 * that failed to save; if the history cannot be written the old one is put back.
 * @param {{ get: Function, set: Function, remove: Function }} store
 * @param {ReturnType<typeof parseBackup>} parsed  an ok result
 * @returns {{ ok: true, message: string, addedExams: number, existingExams: number, addedPacks: number, keptPacks: number, settingsRestored: boolean }
 *   | { ok: false, error: string }}
 */
export function restoreBackup(store, parsed) {
  if (!parsed || !parsed.ok || !parsed.data) return { ok: false, error: (parsed && parsed.errors && parsed.errors[0]) || 'Choose a Quiz Runner backup first.' };
  const { entries, corrupt } = readHistory(store);
  if (corrupt) return { ok: false, error: 'The history saved on this device could not be read, so the backup was not merged into it. Use “Clear all data” first, then restore.' };

  const { history, packs, settings } = parsed.data;
  const known = [...entries];
  const additions = [];
  let existingExams = 0;
  for (const e of history) {
    const candidate = { ...e, id: entryId(e) };
    if (findDuplicate(known, candidate)) { existingExams++; continue; }
    known.push(e);
    additions.push(e);
  }

  const written = [];
  let keptPacks = 0;
  for (const [quizId, pack] of Object.entries(packs)) {
    if (isPlainObject(store.get(packKey(quizId), null))) { keptPacks++; continue; }
    if (!store.set(packKey(quizId), pack)) {
      store.remove(packKey(quizId));   // a failed write leaves a copy in memory only: do not keep a phantom
      for (const key of written) store.remove(key);
      return { ok: false, error: 'There is not enough room on this device (or the browser blocks storage), so nothing was restored.' };
    }
    written.push(packKey(quizId));
  }

  const hadHistory = store.get(STORAGE_KEYS.history, null) !== null;
  if (additions.length > 0 && !store.set(STORAGE_KEYS.history, [...entries, ...additions])) {
    // Best effort: put the old state back, which also drops the in-memory copy.
    if (hadHistory) store.set(STORAGE_KEYS.history, entries);
    else store.remove(STORAGE_KEYS.history);
    for (const key of written) store.remove(key);
    return { ok: false, error: 'There is not enough room on this device (or the browser blocks storage), so nothing was restored.' };
  }

  let settingsRestored = false;
  if (settings !== null && store.get(STORAGE_KEYS.settings, null) === null) settingsRestored = store.set(STORAGE_KEYS.settings, settings);

  const bits = [`${plural(additions.length, 'exam', 'exams')} added`];
  if (existingExams > 0) bits.push(`${existingExams} already here`);
  bits.push(`${plural(written.length, 'question pack', 'question packs')} added`);
  if (keptPacks > 0) bits.push(`${keptPacks} already here (kept as they are)`);
  if (settingsRestored) bits.push('settings restored');
  return {
    ok: true, addedExams: additions.length, existingExams, addedPacks: written.length, keptPacks, settingsRestored,
    message: `Backup restored: ${bits.join(', ')}.`,
  };
}
