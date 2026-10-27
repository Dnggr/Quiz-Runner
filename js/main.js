// main.js — bootstrap + screen switching. Everything else lives in its own module.
import { createRouter } from './router.js';
import { initQuickPaste } from './ui/quickpaste.js';
import { initLoadScreen } from './ui/loadpack.js';
import { initProblems } from './ui/problems.js';
import { initPreview } from './ui/preview.js';
import { initExam } from './ui/exam.js';
import { initResults } from './ui/results.js';
import { initReceiptScreen } from './ui/receiptscreen.js';
import { initResume } from './ui/resume.js';
import { initPromptBuilder } from './ui/promptbuilder.js';
import { store } from './store.js';
import { toExamQuestions } from './exam.js';
import { gradeExam } from './grader.js';
import { analyzeExam } from './analytics.js';
import { buildReviewItems } from './review.js';
import { buildReceipt } from './receipt.js';
import { saveFinishedExam, loadSnapshots, rebuildLatestReceipt } from './history.js';
import { buildSession, saveSession, loadSession, clearSession, describeSession } from './session.js';
import { loadPromptSettings, savePromptSettings } from './settings.js';

const $ = (id) => document.getElementById(id);

// route name -> screen element id
const SCREEN_IDS = {
  input: 'screen-input',
  problems: 'screen-problems',
  preview: 'screen-preview',
  quiz: 'screen-quiz',
  exam: 'screen-exam',
  results: 'screen-results',
  receipt: 'screen-receipt',
  export: 'screen-export',
  builder: 'screen-builder',
};
const HOME = 'input';

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(SCREEN_IDS[name]).classList.add('active');
  window.scrollTo(0, 0);
}

// The router object is needed by the screens, and the screens are needed by the router's guard,
// so the guard looks the screens up lazily.
let quickPaste = null;
// The latest Quiz Pack load, in memory only (saved to storage in P3-09). Refreshing the page drops it: go home.
let packLoaded = false;
let packProblems = false;
let packResult = null;   // the loadable pack result behind the Topics preview: what "Start exam" starts
// The exam session (Quiz Pack exams): pack (answers stay here, in memory), responses, index, finished flag.
// It is autosaved to `session` on every change (P3-03) and re-read from storage after a refresh.
let current = null;
// True when the result of the exam just finished could not be saved (shown as a warning on the Results screen).
let saveFailed = false;

/** The session in memory, else the saved one (e.g. after a refresh). Null when there is none. */
function hydrate() {
  if (!current) current = loadSession(store);
  return current;
}

const router = createRouter({
  win: window,
  routes: Object.keys(SCREEN_IDS),
  home: HOME,
  // quiz / export make no sense without loaded questions, preview / problems without a pack result (e.g. a refresh): go home.
  guard: (route) => {
    if ((route.name === 'quiz' || route.name === 'export') && !quickPaste?.hasQuestions()) return HOME;
    if (route.name === 'preview' && !packLoaded) return HOME;
    if (route.name === 'problems' && !packProblems) return HOME;
    // exam needs an unfinished session (a refresh resumes it from storage); results needs a finished one.
    if (route.name === 'exam') {
      const session = hydrate();
      if (!session) return HOME;
      if (session.finished) return 'results';
    }
    // results and the receipt export both need a finished exam.
    if (route.name === 'results' || route.name === 'receipt') {
      const session = hydrate();
      if (!session || !session.finished) return HOME;
    }
    return null;
  },
  onRoute: (route) => {
    showScreen(route.name);
    quickPaste.enter(route.name);
    if (route.name === 'exam') mountExam();
    else if (route.name === 'results') mountResults();
    else if (route.name === 'receipt') mountReceipt();
    else if (route.name === HOME) resume.show(unfinishedInfo());
    else if (route.name === 'builder') promptBuilder.enter();
    // A receipt pasted into the Prompt Builder can hold the answers of an earlier exam (possibly this very quiz):
    // it must not be in the DOM while an exam is on screen (P3-10).
    if (route.name === 'exam') promptBuilder.clearReceipt();
    // The Results screen is the only place with answers on it: empty it as soon as the app leaves it (P3-10).
    if (route.name !== 'results') results.clear();
    // The receipt export holds answers and explanations too (P4-09): same rule.
    if (route.name !== 'receipt') receiptScreen.clear();
  },
});

quickPaste = initQuickPaste(router);

const preview = initPreview({
  onChooseAnother: () => {
    packLoaded = false;
    packResult = null;
    preview.clear();
    router.navigate(HOME);
  },
  onStart: () => startExam(),
});
const problems = initProblems({ onBack: () => router.navigate(HOME) });

function resetPackScreens() {
  packLoaded = false;
  packResult = null;
  packProblems = false;
  preview.clear();
  problems.clear();
}

initLoadScreen({
  startLegacy: (parsed) => {
    resetPackScreens();
    quickPaste.startLegacy(parsed);
  },
  onPack: (result, note) => {
    resetPackScreens();
    preview.show(result, note);
    packLoaded = true;
    packResult = result;
    router.navigate('preview');
  },
  onPackProblems: (result, note) => {
    resetPackScreens();
    problems.show(result, note);
    packProblems = true;
    router.navigate('problems');
  },
  isLoadScreenActive: () => router.current?.name === HOME,
});

// ---- Quiz Pack exam: start, autosave, resume, finish (P3-01..P3-06) ----------------------------
const exam = initExam({
  onChange: ({ responses, index }) => {
    current.responses = responses;
    current.index = index;
    return saveSession(store, current);
  },
  onFinish: () => {
    current.finished = true;
    current.finished_at = new Date().toISOString();
    saveSession(store, current);
    // P3-09: the graded result goes to `history`, the pack to `pack:<quiz_id>`.
    const saved = saveFinishedExam(store, current, gradeExam(current.pack, current.responses));
    saveFailed = !(saved.packSaved && saved.historySaved);
    router.navigate('results');
  },
  onQuit: () => {
    if (!confirm('Start over? This discards your answers for this exam.')) return;
    discardSession();
    router.navigate(HOME, { replace: true });
  },
});

const results = initResults({
  onHome: () => router.navigate(HOME),
  onReceipt: () => router.navigate('receipt'),
  onNextPrompt: () => openNextPrompt(),
});
const receiptScreen = initReceiptScreen({ onBack: () => router.navigate('results'), onNextPrompt: () => openNextPrompt() });

// Prompt Builder (P5-01..P5-09): receipts come from the stored history, the quiz id number from the stored exams,
// the last-used options from `settings` (P5-08).
const promptBuilder = initPromptBuilder({
  onBack: () => router.navigate(HOME),
  getLatestReceipt: () => {
    const now = new Date();
    // Embedded with the missed-question detail off and the concepts on (PROMPT_TEMPLATES "RECEIPT_BLOCK"); the quiz format
    // (section 10) is stripped from a pasted receipt, so it is left out here too. History stays on: retention needs the priority topics.
    return rebuildLatestReceipt(store, {
      now,
      tzOffsetMinutes: -now.getTimezoneOffset(),
      options: { missed: false, history: true, concepts: true, formatSpec: false },
    });
  },
  getSnapshots: () => loadSnapshots(store),
  loadSettings: () => loadPromptSettings(store),
  saveSettings: (options) => savePromptSettings(store, options),
});
$('builderBtn').addEventListener('click', () => router.navigate('builder'));

const resume = initResume({
  onResume: () => router.navigate('exam'),
  onDiscard: () => {
    if (!confirm('Discard your unfinished exam? Your answers will be lost.')) return;
    discardSession();
    resume.show(null);
  },
});

function discardSession() {
  current = null;
  clearSession(store);
}

/** Banner data for an unfinished exam, else null. */
function unfinishedInfo() {
  const session = hydrate();
  return session && !session.finished ? describeSession(session) : null;
}

function startExam() {
  if (!packResult) return;
  const existing = hydrate();
  if (existing && !existing.finished
      && !confirm(`You have an unfinished exam (\u201c${existing.title || 'Untitled Quiz Pack'}\u201d). Starting this one discards it. Continue?`)) {
    return;
  }
  current = buildSession(packResult.pack);
  saveFailed = false;
  saveSession(store, current);
  // P3-10: nothing from the pack may stay in the DOM while the exam runs, hidden screens included.
  // The paste box can still hold pack text, the Topics preview can hold warnings about the answer letters,
  // the error screen can quote answers, and the Results screen can hold the previous exam's review.
  $('rawInput').value = '';
  preview.clear();
  problems.clear();
  results.clear();
  receiptScreen.clear();
  promptBuilder.clearReceipt();
  packLoaded = false;
  packProblems = false;
  packResult = null;
  router.navigate('exam');
}

function mountExam() {
  // Only question text and options go to the exam screen; the pack's answers stay in `current.pack`.
  exam.load({ questions: toExamQuestions(current.pack), responses: current.responses, index: current.index });
}

/**
 * "Next quiz prompt" on Results and on the receipt screen (P5-09): the Prompt Builder in targeted mode, filled with the
 * receipt of the exam just finished. Built from the session in memory, not from storage, so it is always this exam.
 * Same toggles as "Use latest from this device": no missed-question detail, no quiz format (the prompt has its own).
 */
function openNextPrompt() {
  if (!current || !current.finished) return;
  const graded = gradeExam(current.pack, current.responses);
  const now = new Date();
  const receipt = buildReceipt({
    pack: current.pack,
    graded,
    startedAt: current.started_at,
    finishedAt: current.finished_at,
    now,
    tzOffsetMinutes: -now.getTimezoneOffset(),
    snapshots: loadSnapshots(store),
    options: { missed: false, history: true, concepts: true, formatSpec: false },
  });
  promptBuilder.prefillTargeted(receipt.markdown);
  router.navigate('builder');
}

function mountResults() {
  const graded = gradeExam(current.pack, current.responses);
  const meta = current.pack.meta || {};
  results.show(graded.totals, {
    title: current.title,
    subject: typeof meta.subject === 'string' ? meta.subject : '',
    items: buildReviewItems(current.pack, graded.outcomes),
    analysis: analyzeExam(current.pack, graded),
    saveFailed,
  });
}

/** Export receipt (P4-08..P4-10). The screen calls `build` again each time a toggle changes; the clock is read once. */
function mountReceipt() {
  const graded = gradeExam(current.pack, current.responses);
  const now = new Date();
  const snapshots = loadSnapshots(store);
  receiptScreen.show({
    title: current.title,
    build: (options) => buildReceipt({
      pack: current.pack,
      graded,
      startedAt: current.started_at,
      finishedAt: current.finished_at,
      now,
      tzOffsetMinutes: -now.getTimezoneOffset(),
      snapshots,
      options,
    }),
  });
}

router.start();
