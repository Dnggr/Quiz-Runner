// constants.js — the ONLY place for versions, thresholds, bands and storage keys.
// Values come from docs/ai/RECEIPT_SPEC.md, QUIZ_PACK_SPEC.md and PROMPT_TEMPLATES.md.
// If you change a value here, change the spec in the same commit (and bump SPEC_VERSION if a format changed).

// ---- Versions ------------------------------------------------------------
export const SPEC_VERSION = 1;            // Quiz Pack + Receipt format version
export const APP_VERSION = '2.0.0-dev';   // bumped at release (P8-06)

// ---- Storage (see PLAN.md §7) -------------------------------------------
export const STORAGE_PREFIX = 'qr:v1:';
export const STORAGE_KEYS = Object.freeze({
  settings: 'settings',
  session: 'session',
  history: 'history',
});
export const PACK_KEY_PREFIX = 'pack:';
export const packKey = (quizId) => PACK_KEY_PREFIX + quizId;

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
export const ALLOCATION_MIN_PER_WEAK_TOPIC = 2;
export const ALLOCATION_MIN_PER_OTHER_TOPIC = 1;
export const DIFFICULTY_MIX_BY_GROUP = Object.freeze({
  weak: Object.freeze({ easy: 0.30, moderate: 0.45, challenging: 0.25 }),
  strong: Object.freeze({ easy: 0.10, moderate: 0.40, challenging: 0.50 }),
  other: Object.freeze({ easy: 0.20, moderate: 0.50, challenging: 0.30 }),
});

// ---- Pack validation (QUIZ_PACK_SPEC §7) ---------------------------------
export const ANSWER_SKEW_MAX_SHARE = 0.40;   // warn when any correct letter is ABOVE this share
export const EXPECTED_OPTION_COUNT = 4;
export const OPTION_LETTERS = Object.freeze(['A', 'B', 'C', 'D']);
export const MIN_QUESTIONS_PER_TOPIC_INITIAL = 3;

// ---- Loading (DEV_CHECKLIST P2-01) --------------------------------------
export const ACCEPTED_FILE_EXTENSIONS = Object.freeze(['.json', '.txt', '.md']);
export const LOAD_STATUS_MAX_LISTED = 10;   // interim load-screen list; replaced by the error screen in P2-06

// ---- Prompt Builder defaults (PROMPT_TEMPLATES, "Builder options") -------
export const DEFAULT_COUNTS = Object.freeze({ initial: 130, targeted: 40, retention: 12 });
export const DEFAULT_TOPIC_RANGE = Object.freeze({ min: 6, max: 15 });
export const DEFAULT_DIFFICULTY_PCT = Object.freeze({ easy: 30, moderate: 40, challenging: 30 });
export const DEFAULT_PART_SIZE = 45;
export const DEFAULT_LEARNER = 'BSIT student';
export const SKILLS = Object.freeze([
  'definition', 'function', 'structure', 'process', 'comparison', 'sequence', 'application',
]);
