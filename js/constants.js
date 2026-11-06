// constants.js — the ONLY place for versions, thresholds, bands and storage keys.
// Values come from docs/ai/RECEIPT_SPEC.md, QUIZ_PACK_SPEC.md and PROMPT_TEMPLATES.md.
// If you change a value here, change the spec in the same commit (and bump SPEC_VERSION if a format changed).

// ---- Versions ------------------------------------------------------------
export const SPEC_VERSION = 1;            // Quiz Pack + Receipt format version
export const APP_VERSION = '2.0.0';       // release version (P8-06); bump on every release, keep package.json "version" the same

// ---- Storage (see PLAN.md §7) -------------------------------------------
export const STORAGE_PREFIX = 'qr:v1:';
export const STORAGE_KEYS = Object.freeze({
  settings: 'settings',
  session: 'session',
  history: 'history',
});
export const SETTINGS_PROMPT_BUILDER_FIELD = 'promptBuilder';   // field of the `settings` record that holds the last-used Prompt Builder options (P5-08)
export const PROMPT_SETTINGS_VERSION = 1;                      // shape of that field; bump if it changes
export const PACK_KEY_PREFIX = 'pack:';
export const packKey = (quizId) => PACK_KEY_PREFIX + quizId;
export const HISTORY_SCHEMA_VERSION = 2;   // shape of one `history` entry (P3-09); bump if it changes. 2 (BUG-09): entries carry `topics: [{ id, name }]`; version-1 entries are still read

// ---- Receipt import limits (RECEIPT_SPEC §9) -------------------------------
// A date in a receipt is used only inside these limits (BUG-29). The lower one is the start of the Unix epoch: no exam is older.
// The upper one is a day before the end of year 9999, so that even with a time-zone offset of up to 14 hours the date still has
// a normal 4-digit year when it is shown (`toOffsetIso`).
export const RECEIPT_DATE_MIN_MS = Date.UTC(1970, 0, 1);
export const RECEIPT_DATE_MAX_MS = Date.UTC(9999, 11, 30, 23, 59, 59, 999);
// BUG-32: a receipt dated later than the moment of import plus this much is not trusted as the exam date. A day is slack for a
// device whose clock or time zone is a little ahead; more than that is a wrong clock or a hand-edited date.
export const RECEIPT_FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;
// The last moment that `toISOString()` writes as a plain 4-digit year; used for start + duration (BUG-24).
export const ISO_YEAR_9999_END_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
export const SESSION_SCHEMA_VERSION = 1;   // shape of the `session` record (P3-03); bump if it changes

// ---- Backup file (P6-09) --------------------------------------------------
// SPEC GAP: no spec describes the backup file; this is the smallest shape that holds what `qr:v1:` keeps (see backup.js).
export const BACKUP_FORMAT = 'quizrunner.backup';   // `format` field of the backup file
export const BACKUP_VERSION = 1;                    // shape of the backup file; bump if it changes

// ---- Overall rating (RECEIPT_SPEC §2) -----------------------------------
// Evaluated top to bottom; first band whose `min` <= percent wins.
export const RATING_BANDS = Object.freeze([
  Object.freeze({ min: 90, label: 'Excellent' }),
  Object.freeze({ min: 75, label: 'Good' }),
  Object.freeze({ min: 60, label: 'Fair' }),
  Object.freeze({ min: 0, label: 'Needs work' }),
]);

// ---- Topic status (RECEIPT_SPEC §3) -------------------------------------
export const WEAK_MIN_MISSES = 2;
export const WEAK_MAX_ACCURACY = 0.70;     // weak when accuracy is BELOW this
export const STRONG_MIN_N = 3;
export const STRONG_MIN_ACCURACY = 0.85;   // strong when accuracy is AT LEAST this
export const STRONG_MAX_SHAKY = 0.25;      // strong when shakyRatio is BELOW this
export const INSUFFICIENT_BELOW_N = 3;     // "insufficient": n below this and no misses
export const STATUS_ORDER = Object.freeze(['weak', 'developing', 'watch', 'strong', 'insufficient']);

// ---- Cumulative rules (RECEIPT_SPEC §4–5) --------------------------------
export const PRIORITY_MIN_EXAMS = 2;           // weak in >= this many distinct exams
export const IMPROVED_MIN_ACCURACY_GAIN = 15;  // percentage points
export const RETENTION_MIN_QUESTIONS = 10;
export const RETENTION_MAX_QUESTIONS = 15;

// ---- Next-exam allocation (RECEIPT_SPEC §6) ------------------------------
export const NEXT_EXAM_DEFAULT_N = 40;
export const NEXT_EXAM_MIN_N = 10;
export const NEXT_EXAM_MAX_N = 130;
export const ALLOCATION_SHARES = Object.freeze({
  withWeak: Object.freeze({ weak: 0.60, middle: 0.25, strong: 0.15 }),   // middle = watch + developing
  noWeak: Object.freeze({ middle: 0.60, strong: 0.40 }),
});
export const ALLOCATION_MIN_PER_WEAK_TOPIC = 2;   // preferred minimum; the weak share (60%) wins when it cannot hold it (BUG-07)
export const ALLOCATION_FLOOR_PER_WEAK_TOPIC = 1; // a weak topic is never left without a question (BUG-07): the share grows at the other groups' cost instead
export const ALLOCATION_MIN_PER_OTHER_TOPIC = 1;
export const DIFFICULTY_MIX_BY_GROUP = Object.freeze({
  weak: Object.freeze({ easy: 0.30, moderate: 0.45, challenging: 0.25 }),
  strong: Object.freeze({ easy: 0.10, moderate: 0.40, challenging: 0.50 }),
  other: Object.freeze({ easy: 0.20, moderate: 0.50, challenging: 0.30 }),
});

// ---- Receipt (RECEIPT_SPEC §7-§8, DEV_CHECKLIST P4-08..P4-10) -----------------
export const RECEIPT_FORMAT = 'quizrunner.receipt';   // `format` field of the JSON receipt
export const CHARS_PER_TOKEN = 4;                      // size estimate shown on the export screen: characters / 4

// ---- Pack validation (QUIZ_PACK_SPEC §7) ---------------------------------
export const ANSWER_SKEW_MAX_SHARE = 0.40;   // warn when any correct letter is ABOVE this share
// BUG-46 (D53): the app spreads the correct letters itself after a pack loads (`balance.js`).
export const ANSWER_MAX_RUN = 3;             // QUIZ_PACK_SPEC rule 6: never more than this many identical correct letters in a row
export const BALANCE_MAX_ATTEMPTS = 400;     // random orderings tried to keep every run within ANSWER_MAX_RUN before taking the best one
export const EXPECTED_OPTION_COUNT = 4;
export const OPTION_LETTERS = Object.freeze(['A', 'B', 'C', 'D']);
export const MIN_QUESTIONS_PER_TOPIC_INITIAL = 3;
export const TRUE_FALSE_VALUES = Object.freeze(['True', 'False']);   // `selected` / `answer` values of a `tf` question
export const DIFFICULTIES = Object.freeze(['easy', 'moderate', 'challenging']);   // QUIZ_PACK_SPEC §3.2
export const QUIZ_TYPES = Object.freeze(['initial', 'targeted', 'retention', 'custom']);   // QUIZ_PACK_SPEC §3.1 `quiz_type` (BUG-20)
export const QUESTION_TYPES = Object.freeze(['mc', 'tf']);                                // QUIZ_PACK_SPEC §3.2 `type` (BUG-15)
// BUG-31: QUIZ_PACK_SPEC §3.1 "required" fields of `meta` besides `quiz_id` (which is an error, BUG-23) and `topics` (checked through the questions).
// A pack without one still loads, with one warning per missing field.
export const META_FIELDS_WARNED_IF_MISSING = Object.freeze(['title', 'subject', 'quiz_type', 'total_questions']);
export const ISSUE_EXAMPLE_NUMBERS = 5;   // pack-level warnings that name questions list this many question numbers, then "…"

// ---- Resilience (DEV_CHECKLIST P7-01..P7-04) -----------------------------
// SPEC GAP: the specs give no limits for these; they only keep a bogus pack or a huge error list from producing a huge prompt.
export const MAX_PACK_QUESTIONS = 1000;          // a larger `meta.total_questions` is treated as unknown (no "missing numbers" list)
export const REPAIR_MAX_LISTED_ERRORS = 50;      // Repair prompt: problems listed before "...and N more"
export const PROMPT_LINE_MAX_CHARS = 300;        // Repair prompt: one problem per line, cut at this length (pack text is untrusted)

// ---- Loading (DEV_CHECKLIST P2-01) --------------------------------------
export const ACCEPTED_FILE_EXTENSIONS = Object.freeze(['.json', '.txt', '.md']);
export const ISSUE_GROUPS_MAX_LISTED = 25;   // error screen (P2-06) and preview warnings (P2-08): questions listed before "…and N more"

// ---- Prompt Builder defaults (PROMPT_TEMPLATES, "Builder options") -------
export const DEFAULT_COUNTS = Object.freeze({ initial: 130, targeted: 40, retention: 12 });
export const DEFAULT_TOPIC_RANGE = Object.freeze({ min: 6, max: 15 });
export const DEFAULT_DIFFICULTY_PCT = Object.freeze({ easy: 30, moderate: 40, challenging: 30 });
export const DEFAULT_PART_SIZE = 45;
export const DEFAULT_LEARNER = 'BSIT student';
export const SKILLS = Object.freeze([
  'definition', 'function', 'structure', 'process', 'comparison', 'sequence', 'application',
]);
