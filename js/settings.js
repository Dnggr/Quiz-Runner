// settings.js — the last-used Prompt Builder options, kept in the `settings` record (P5-08; docs/PLAN.md §7).
// Pure module: no DOM. All storage goes through the store passed in (store.js), so tests can inject a fake one.
//
// What is remembered: mode, subject, learner, question count, difficulty mix, skills, delivery, part size, custom task.
// What is not: the pasted receipt and the per-topic counts (they belong to one exam and can hold its details), and the
// topic range (the screen has no field for it).
// Every field is checked on the way in and on the way out. A stored value that is missing or wrong is left out, so the
// screen falls back to its default for that field and a damaged `settings` record can never crash it.
import {
  STORAGE_KEYS, SETTINGS_PROMPT_BUILDER_FIELD, PROMPT_SETTINGS_VERSION, SKILLS,
} from './constants.js';
import { MODES, DELIVERIES } from './promptBuilder.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A whole number from a number or a plain digit string; NaN for anything else. */
const whole = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
  if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) return Number(v);
  return NaN;
};

/**
 * Keep only the fields of `raw` that are valid, in their stored form. `raw` may be the options the screen sends to the
 * builder (numbers as digit strings) or something read back from storage.
 * @param {unknown} raw
 * @returns {{ mode?: string, subject?: string, learner?: string, count?: number,
 *   difficulty?: { easy: number, moderate: number, challenging: number }, skills?: string[], delivery?: string,
 *   partSize?: number, customTask?: string }}
 */
export function sanitizePromptSettings(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;

  if (MODES.includes(raw.mode)) out.mode = raw.mode;
  if (typeof raw.subject === 'string') out.subject = raw.subject.replace(/\s+/g, ' ').trim();
  if (typeof raw.learner === 'string' && raw.learner.trim() !== '') out.learner = raw.learner.replace(/\s+/g, ' ').trim();
  if (whole(raw.count) >= 1) out.count = whole(raw.count);

  if (isPlainObject(raw.difficulty)) {
    const d = { easy: whole(raw.difficulty.easy), moderate: whole(raw.difficulty.moderate), challenging: whole(raw.difficulty.challenging) };
    const values = Object.values(d);
    if (values.every((v) => v >= 0 && v <= 100) && values.reduce((a, b) => a + b, 0) === 100) out.difficulty = d;
  }
  if (Array.isArray(raw.skills)) {
    const skills = SKILLS.filter((s) => raw.skills.includes(s));
    if (skills.length > 0) out.skills = skills;
  }
  if (DELIVERIES.includes(raw.delivery)) out.delivery = raw.delivery;
  if (whole(raw.partSize) >= 1) out.partSize = whole(raw.partSize);
  if (typeof raw.customTask === 'string') out.customTask = raw.customTask;
  return out;
}

/**
 * The remembered options, checked. Never throws; `{}` when nothing usable is stored.
 * @param {{ get: Function }} store
 */
export function loadPromptSettings(store) {
  const settings = store.get(STORAGE_KEYS.settings, null);
  return isPlainObject(settings) ? sanitizePromptSettings(settings[SETTINGS_PROMPT_BUILDER_FIELD]) : {};
}

/**
 * Remember the options the learner is using. Only the valid fields are written; a field that is not valid right now
 * (a half-typed number, say) keeps its last good value. Other fields of `settings` are left as they are.
 * @param {{ get: Function, set: Function }} store
 * @param {object} options  as sent to `buildPrompt` (the receipt and per-topic counts in it are ignored)
 * @returns {boolean} true when it reached persistent storage; false when it is only in memory or when a `settings`
 *   record that is not an object was found and left untouched (the reset offer for damaged data is P7-07)
 */
export function savePromptSettings(store, options) {
  const stored = store.get(STORAGE_KEYS.settings, null);
  if (stored !== null && !isPlainObject(stored)) return false;
  const settings = stored ?? {};
  const previous = sanitizePromptSettings(settings[SETTINGS_PROMPT_BUILDER_FIELD]);
  const next = { ...settings, [SETTINGS_PROMPT_BUILDER_FIELD]: { version: PROMPT_SETTINGS_VERSION, ...previous, ...sanitizePromptSettings(options) } };
  return store.set(STORAGE_KEYS.settings, next);
}
