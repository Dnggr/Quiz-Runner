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
import { initProgress } from './ui/progress.js';
import { createNotices } from './ui/notice.js';
import { store } from './store.js';
import { toExamQuestions } from './exam.js';
import { gradeExam } from './grader.js';
import { analyzeExam } from './analytics.js';
import { buildReviewItems } from './review.js';
import { buildReceipt, parseReceipt } from './receipt.js';
import {
  saveFinishedExam, loadSnapshots, rebuildLatestReceipt, prepareProfileReceipt, importReceipt, deleteExam, clearAllData,
} from './history.js';
import { buildBackup, parseBackup, restoreBackup } from './backup.js';
import { buildSession, saveSession, loadSession, clearSession, describeSession } from './session.js';
import { loadPromptSettings, savePromptSettings } from './settings.js';
import { buildProgress, openPastExam, examDate } from './progress.js';
import { addToAssembly, assemblyStatus, describeAddition, formatRanges } from './parts.js';
import { scanStoredData, resetStoredKey, damagedText, describeStorageFailure, prunablePacks, pruneOldestPack } from './storagehealth.js';

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
  profilereceipt: 'screen-receipt',   // the cumulative profile receipt (P6-07): the export screen again, built from storage
  export: 'screen-export',
  builder: 'screen-builder',
  progress: 'screen-progress',
  past: 'screen-results',   // an old exam, read-only (P6-02): the Results screen again, filled from storage
};
const HOME = 'input';

// Notices at the top of the page: storage full (P7-05), damaged saved data (P7-07), a screen that failed.
const notices = createNotices($('noticeHost'));

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
// P7-04: the parts of one quiz_id loaded so far (merged by question number), in memory only. Unlike `packResult` it survives
// a later part that fails validation, so a bad part 2 does not cost the learner part 1. Dropped wherever the pack is dropped.
let assembly = null;
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
    // An old exam opens only when it is in the history with a pack that still fits it, and not while a session of the
    // same quiz is unfinished (its old answers must not be on screen then).
    if (route.name === 'past' && !openPastExam(store, route.args[0] ?? '', { lockedQuizId: unfinishedQuizId() }).ok) return 'progress';
    // The profile receipt needs only stored exams (nothing to show after a refresh once they are deleted).
    if (route.name === 'profilereceipt' && !prepareProfileReceipt(store).ok) return 'progress';
    // results and the receipt export both need a finished exam.
    if (route.name === 'results' || route.name === 'receipt') {
      const session = hydrate();
      if (!session || !session.finished) return HOME;
    }
    return null;
  },
  onRoute: (route) => guarded(() => {
    settleStorageNotice();
    if (route.name === HOME || route.name === 'progress') checkStoredData();
    showScreen(route.name);
    quickPaste.enter(route.name);
    if (route.name === 'exam') mountExam();
    else if (route.name === 'results') mountResults();
    else if (route.name === 'past') mountPast(route.args[0]);
    else if (route.name === 'progress') mountProgress();
    else if (route.name === 'receipt') mountReceipt();
    else if (route.name === 'profilereceipt') mountProfileReceipt();
    else if (route.name === HOME) { resume.show(unfinishedInfo()); showHoldingNote(); }
    else if (route.name === 'builder') promptBuilder.enter();
    // A receipt pasted into the Prompt Builder can hold the answers of an earlier exam (possibly this very quiz):
    // it must not be in the DOM while an exam is on screen (P3-10).
    if (route.name === 'exam') promptBuilder.clearReceipt();
    // The Results screen is the only place with answers on it: empty it as soon as the app leaves it (P3-10).
    if (route.name !== 'results' && route.name !== 'past') results.clear();
    // The receipt export holds answers and explanations too (P4-09): same rule.
    if (route.name !== 'receipt' && route.name !== 'profilereceipt') receiptScreen.clear();
  }),
});

quickPaste = initQuickPaste(router);

const preview = initPreview({
  onChooseAnother: () => {
    packLoaded = false;
    packResult = null;
    assembly = null;
    preview.clear();
    router.navigate(HOME);
  },
  onStart: () => startExam(),
  onAddMore: () => router.navigate(HOME),   // the parts stay loaded: the next pack with the same quiz_id is added to them
});
const problems = initProblems({ onBack: () => router.navigate(HOME) });

function resetPackScreens() {
  packLoaded = false;
  packResult = null;
  packProblems = false;
  preview.clear();
  problems.clear();
}

/** The error screen for a pack that failed validation. Parts loaded earlier stay held (P7-04) and the screen says so. */
function showPackProblems(result, note) {
  resetPackScreens();
  const held = assembly ? assemblyStatus(assembly) : null;
  const keep = held ? `The ${held.loaded} questions loaded earlier are still held. Fix this one and load it again to add it.` : '';
  problems.show(result, [note, keep].filter(Boolean).join(' '));
  packProblems = true;
  router.navigate('problems');
}

/** Load screen: a line about the questions waiting for their missing part (P7-04), else nothing. */
function showHoldingNote() {
  const box = $('holdingNote');
  const status = assembly ? assemblyStatus(assembly) : null;
  if (!status || status.complete) {
    box.style.display = 'none';
    $('holdingText').textContent = '';
    return;
  }
  const parts = status.multiPart ? ` Parts loaded: ${status.partsLoaded} of ${status.totalParts}.` : '';
  $('holdingText').textContent =
    `${status.loaded} of ${status.total} questions are loaded (missing ${formatRanges(status.missing)}).${parts} ` +
    'Paste or choose the missing part to add it to them.';
  box.style.display = 'block';
}
$('holdingDiscardBtn').addEventListener('click', () => {
  assembly = null;
  showHoldingNote();
});

initLoadScreen({
  startLegacy: (parsed) => {
    assembly = null;
    resetPackScreens();
    quickPaste.startLegacy(parsed);
  },
  onPack: (incoming, note) => {
    // P7-04: a pack with the same quiz_id as the one waiting here is merged into it (later wins); anything else starts afresh.
    const step = addToAssembly(assembly, incoming);
    if (!step.result.ok) {
      // Each part was fine alone but the combination is not (cannot happen with the topic union; checked anyway): never start such a pack.
      showPackProblems(step.result, note);
      return;
    }
    assembly = step.assembly;
    resetPackScreens();
    preview.show(step.result, [note, describeAddition(step)].filter(Boolean).join(' '), step.status);
    packLoaded = true;
    packResult = step.result;
    router.navigate('preview');
  },
  onPackProblems: (result, note) => showPackProblems(result, note),
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
  onBackToProgress: () => router.navigate('progress'),
});
// The same screen shows an exam's receipt and the cumulative profile receipt (P6-07); the route tells which.
const onProfileReceipt = () => router.current?.name === 'profilereceipt';
const receiptScreen = initReceiptScreen({
  onBack: () => router.navigate(onProfileReceipt() ? 'progress' : 'results'),
  onNextPrompt: () => (onProfileReceipt() ? openRetentionPrompt() : openNextPrompt()),
});

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
const progress = initProgress({
  onOpen: (id) => router.navigate('past', { args: [id] }),
  onCompare: (id) => mountProgress(id),
  onBack: () => router.navigate(HOME),
  onDelete: (id, title) => deleteOneExam(id, title),
  onExportProfile: () => {
    const prepared = prepareProfileReceipt(store);
    if (!prepared.ok) { progress.report({ ok: false, error: prepared.error }); return; }
    router.navigate('profilereceipt');
  },
  onRetention: () => openRetentionPrompt(),
  onImportReceipt: (text) => importReceiptText(text),
  onBackup: () => downloadBackup(),
  onRestore: (text) => restoreBackupText(text),
  onClearAll: () => clearEverything(),
});
$('builderBtn').addEventListener('click', () => router.navigate('builder'));
$('progressBtn').addEventListener('click', () => router.navigate('progress'));

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

/** Quiz id of the unfinished exam, else null. Its old results stay closed while it runs (P6-02). */
function unfinishedQuizId() {
  const session = hydrate();
  return session && !session.finished ? session.quiz_id : null;
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
  checkStoredData();   // a damaged saved exam was just replaced by this one: its notice goes
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
  assembly = null;
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

/**
 * P6-11: the retention check. The Prompt Builder in retention mode, filled with the cumulative profile receipt: every topic
 * in the history, 1 question each and 1 extra for each priority topic (RECEIPT_SPEC §5). Same embed toggles as the other
 * prompts: no missed-question detail, concepts on, no quiz format (the prompt has its own).
 */
function openRetentionPrompt() {
  const now = new Date();
  const prepared = prepareProfileReceipt(store, { now, tzOffsetMinutes: -now.getTimezoneOffset() });
  if (!prepared.ok) { progress.report({ ok: false, error: prepared.error }); return; }
  promptBuilder.prefillRetention(prepared.build({ concepts: true, formatSpec: false }).markdown);
  router.navigate('builder');
}

/** P6-07: the export screen, filled with the cumulative profile receipt. */
function mountProfileReceipt() {
  const now = new Date();
  const prepared = prepareProfileReceipt(store, { now, tzOffsetMinutes: -now.getTimezoneOffset() });
  if (!prepared.ok) { router.navigate('progress', { replace: true }); return; }
  receiptScreen.show({ title: prepared.title, build: prepared.build, profile: true });
}

/** P6-08: add a receipt (.json or .md, read from a file) to the history. */
function importReceiptText(text) {
  const parsed = parseReceipt(text);
  if (!parsed.ok) { progress.report({ ok: false, error: parsed.errors.join(' ') }); return; }
  const res = importReceipt(store, parsed);
  mountProgress();
  if (!res.ok) { progress.report(res); return; }
  const warnings = [...res.warnings];
  if (!res.saved) warnings.push('The browser could not save it (storage is unavailable or full), so it will be lost when you close this page. Download a backup or free some space.');
  progress.report({ ok: true, message: res.message, warnings });
}

function downloadText(fileName, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** P6-09: build the backup and start its download. Also used by the storage notice (P7-05). */
function runBackupDownload() {
  const now = new Date();
  const backup = buildBackup(store, { now, tzOffsetMinutes: -now.getTimezoneOffset() });
  if (!backup.ok) return { ok: false, error: backup.error };
  try {
    downloadText(backup.fileName, 'application/json', backup.text);
  } catch {
    return { ok: false, error: 'The browser would not start the download.' };
  }
  return {
    ok: true, warnings: backup.warnings,
    message: `Downloaded ${backup.fileName}: ${backup.exams} ${backup.exams === 1 ? 'exam' : 'exams'} and ${backup.packs} question ${backup.packs === 1 ? 'pack' : 'packs'}. Keep it somewhere safe.`,
  };
}

/** P6-09: download everything worth keeping as one file. */
function downloadBackup() {
  progress.report(runBackupDownload());
}

/** P6-09: merge a backup file into this device. */
function restoreBackupText(text) {
  const parsed = parseBackup(text);
  if (!parsed.ok) { progress.report({ ok: false, error: parsed.errors.join(' ') }); return; }
  const res = restoreBackup(store, parsed);
  mountProgress();
  progress.report(res.ok ? { ok: true, message: res.message, warnings: parsed.warnings } : res);
}

/** P6-10: delete one exam, after asking. */
function deleteOneExam(id, title) {
  if (!confirm(`Delete \u201c${title}\u201d from your history?\n\nIts score leaves your trend and topic progress, and its saved questions are removed. This cannot be undone. A backup or a receipt can bring it back.`)) return;
  const res = deleteExam(store, id);
  mountProgress();
  if (!res.ok) { progress.report(res); return; }
  progress.report({
    ok: true,
    message: `Deleted \u201c${res.title}\u201d.`,
    warnings: res.saved ? [] : ['The browser could not save the change (storage is unavailable), so the exam may come back when you reload.'],
  });
}

/** P6-10: delete everything Quiz Runner keeps on this device, after asking. */
function clearEverything() {
  const unfinished = unfinishedInfo();
  const extra = unfinished ? ' Your unfinished exam will be lost too.' : '';
  if (!confirm(`Delete ALL Quiz Runner data on this device?\n\nThis removes your exam history, saved question packs and settings.${extra} It cannot be undone. Cancel and download a backup first if you might want it back.`)) return;
  const res = clearAllData(store);
  // Nothing that was in memory may outlive the data: the exam in progress, the loaded pack screens and the pasted receipt.
  current = null;
  saveFailed = false;
  assembly = null;
  resetPackScreens();
  results.clear();
  receiptScreen.clear();
  promptBuilder.clearReceipt();
  mountProgress();
  progress.report(res.remaining > 0
    ? { ok: false, error: `The browser would not remove ${res.remaining} saved ${res.remaining === 1 ? 'item' : 'items'}. Try again, or clear this site's data in the browser settings.` }
    : { ok: true, message: `All data cleared (${res.removed} saved ${res.removed === 1 ? 'item' : 'items'} removed).` });
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

/** Progress screen (P6-01..P6-06): the history on this device. `compareId` is the exam to compare and chart. */
function mountProgress(compareId = null) {
  const now = new Date();
  progress.show(buildProgress(store, { tzOffsetMinutes: -now.getTimezoneOffset(), compareId, lockedQuizId: unfinishedQuizId() }));
}

/** An old exam, read-only (P6-02): from the stored history entry and pack, not from the session in memory. */
function mountPast(id) {
  const opened = openPastExam(store, id ?? '', { lockedQuizId: unfinishedQuizId() });
  if (!opened.ok) { router.navigate('progress', { replace: true }); return; }
  const { entry, pack, totals, outcomes } = opened;
  const when = examDate(entry.started_at, -new Date().getTimezoneOffset());
  results.show(totals, {
    title: entry.title,
    subject: typeof entry.subject === 'string' ? entry.subject : '',
    items: buildReviewItems(pack, outcomes),
    analysis: analyzeExam(pack, { outcomes, totals }),
    readOnly: true,
    note: `Read-only view of an earlier exam${when ? `, taken on ${when}` : ''}.`,
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

// ---------------------------------------------------------------------------------------------------------
// P7-05: the browser has no room (or refuses) to save
// ---------------------------------------------------------------------------------------------------------
const failedKeys = new Set();          // what did not reach storage since the notice was last cleared
let failureReason = null;              // the worst reason seen: quota > blocked > unavailable
let storageNoticeDismissed = false;
let backupDownloaded = false;
const REASON_RANK = { unavailable: 0, blocked: 1, quota: 2 };

store.onWriteFailure(({ key, reason }) => {
  const isNew = !failedKeys.has(key);
  failedKeys.add(key);
  if (failureReason === null || REASON_RANK[reason] > REASON_RANK[failureReason]) failureReason = reason;
  if (storageNoticeDismissed && !isNew) return;   // dismissed: autosave failing again must not nag on every answer
  storageNoticeDismissed = false;
  showStorageNotice();
});

function showStorageNotice(status = '') {
  const info = describeStorageFailure({ reason: failureReason, keys: [...failedKeys] });
  const actions = [{ label: 'Download backup', primary: true, onClick: () => {
    const res = runBackupDownload();
    backupDownloaded = res.ok;
    showStorageNotice(res.ok ? res.message : `The backup failed: ${res.error}`);
  } }];
  if (info.canMakeRoom) actions.push({ label: 'Make room: remove oldest saved questions\u2026', onClick: makeRoom });
  actions.push({ label: 'Dismiss', onClick: () => { storageNoticeDismissed = true; notices.hide('storage'); } });
  notices.show('storage', { tone: 'warn', title: info.title, message: status ? `${info.message}\n\n${status}` : info.message, actions });
}

/** Everything that was waiting got saved some other way (e.g. an exam was deleted): the notice has nothing left to say. */
function settleStorageNotice() {
  if (failedKeys.size === 0 || store.pendingKeys().length > 0) return;
  failedKeys.clear();
  failureReason = null;
  backupDownloaded = false;
  notices.hide('storage');
}

/** P7-05: remove the oldest saved pack after asking, then save what was waiting. The backup is offered first, not forced. */
function makeRoom() {
  const plan = prunablePacks(store);
  if (!plan.ok || plan.packs.length === 0) { showStorageNotice(pruneOldestPack(store).error); return; }
  const label = plan.packs[0].title || plan.packs[0].quizId;
  const noBackup = backupDownloaded ? '' : '\n\nYou have not downloaded a backup yet. Cancel and use \u201cDownload backup\u201d first if you might want these questions back.';
  if (!confirm(`Remove the saved questions of \u201c${label}\u201d?\n\nIts score and date stay in your history, but you will no longer be able to open it for review, and it stops counting toward topic progress. This cannot be undone.${noBackup}`)) return;
  const res = pruneOldestPack(store);
  if (!res.ok) { showStorageNotice(res.error); return; }
  store.flush();
  if (router.current?.name === 'progress') mountProgress();
  const freed = `Removed the saved questions of \u201c${res.title}\u201d (about ${Math.max(1, Math.round(res.freedChars / 1024))} KB).`;
  if (store.pendingKeys().length === 0) {
    failedKeys.clear();
    failureReason = null;
    backupDownloaded = false;
    notices.show('storage', { tone: 'ok', title: 'Room made', message: `${freed} Everything that was waiting has been saved.`,
      actions: [{ label: 'Dismiss', onClick: () => notices.hide('storage') }] });
  } else {
    showStorageNotice(`${freed} There is still not enough room.${res.remaining > 0 ? ' You can remove the next oldest.' : ''}`);
  }
}

// ---------------------------------------------------------------------------------------------------------
// P7-07: damaged saved data, and a screen that fails
// ---------------------------------------------------------------------------------------------------------
const dismissedDamage = new Set();

/** Look for a saved exam or history that cannot be used; offer a reset for each. Cheap enough to run on every Home visit. */
function checkStoredData() {
  const scan = scanStoredData(store);
  if (scan.session.state === 'unusable' && !dismissedDamage.has('bad-session')) {
    notices.show('bad-session', {
      tone: 'warn',
      title: 'Your saved exam can\u2019t be resumed',
      message: 'The exam that was in progress in this browser is damaged, so it can\u2019t be continued. Your finished exams are not affected. Nothing has been deleted yet: you can discard it and start again.',
      actions: [
        { label: 'Discard it', danger: true, onClick: discardDamagedSession },
        { label: 'Not now', onClick: () => { dismissedDamage.add('bad-session'); notices.hide('bad-session'); } },
      ],
    });
  } else if (scan.session.state !== 'unusable') {
    notices.hide('bad-session');
  }
  if (scan.history.state === 'unusable' && !dismissedDamage.has('bad-history')) {
    notices.show('bad-history', {
      tone: 'warn',
      title: 'Your saved history can\u2019t be read',
      message: 'The history stored in this browser is damaged, so finished exams can\u2019t be listed or added to it until it is reset. Nothing has been deleted yet, and your saved questions and settings are not affected. After a reset you can import a backup or receipts.',
      actions: [
        { label: 'Download the damaged data', onClick: downloadDamagedHistory },
        { label: 'Reset history\u2026', danger: true, onClick: resetDamagedHistory },
        { label: 'Not now', onClick: () => { dismissedDamage.add('bad-history'); notices.hide('bad-history'); } },
      ],
    });
  } else if (scan.history.state !== 'unusable') {
    notices.hide('bad-history');
  }
  return scan;
}

function showDone(title, message) {
  notices.show('done', { tone: 'ok', title, message, actions: [{ label: 'Dismiss', onClick: () => notices.hide('done') }] });
}

function downloadDamagedHistory() {
  const text = damagedText(store, 'history');
  if (text === null) { showDone('Nothing to download', 'The history can no longer be read as damaged data.'); return; }
  try {
    downloadText('quiz-runner-damaged-history.txt', 'text/plain', text);
  } catch {
    showDone('Download failed', 'The browser would not start the download.');
  }
}

function resetDamagedHistory() {
  if (!confirm('Reset your saved history?\n\nThe stored history is damaged and cannot be used here. This removes it from this browser. Your saved questions and settings stay. It cannot be undone: download the damaged data first if you want to keep a copy, and import a backup or receipts afterwards.')) return;
  const res = resetStoredKey(store, 'history');
  if (!res.ok) { showDone('Could not reset', res.error); return; }
  dismissedDamage.delete('bad-history');
  notices.hide('bad-history');
  if (router.current?.name === 'progress') mountProgress();
  showDone('History reset', 'The damaged history was removed. New exams are saved again.');
}

function discardDamagedSession() {
  if (!confirm('Discard the damaged exam that was in progress?\n\nIt cannot be resumed. Your finished exams are not affected. This cannot be undone.')) return;
  current = null;
  const res = resetStoredKey(store, 'session');
  if (!res.ok) { showDone('Could not discard it', res.error); return; }
  dismissedDamage.delete('bad-session');
  notices.hide('bad-session');
  resume.show(unfinishedInfo());
  showDone('Exam discarded', 'The damaged exam was removed. You can start a new one.');
}

let goingHome = false;

/** A screen failed to build or an event handler threw: say so and go to the start screen, instead of a blank page. */
function reportCrash(error) {
  console.error(error);
  notices.show('crash', {
    tone: 'error',
    title: 'Something went wrong',
    message: 'Quiz Runner hit an unexpected problem, most likely because some saved data is damaged. Nothing has been deleted.',
    actions: [
      { label: 'Back to start', primary: true, onClick: () => { notices.hide('crash'); router.navigate(HOME); } },
      { label: 'Check saved data', onClick: () => {
        const scan = checkStoredData();
        if (scan.session.state !== 'unusable' && scan.history.state !== 'unusable') {
          showDone('Saved data looks fine', 'The saved exam and history can be read. If this keeps happening, download a backup from the Progress screen and reload the page.');
        }
      } },
      { label: 'Reload the page', onClick: () => window.location.reload() },
    ],
  });
  if (goingHome || router.current?.name === HOME) return;   // never loop if the start screen is what fails
  goingHome = true;
  try { router.navigate(HOME, { replace: true }); } catch (err) { console.error(err); } finally { goingHome = false; }
}

function guarded(fn) {
  try { fn(); } catch (error) { reportCrash(error); }
}

// Errors that escape a handler (a click, a timer, a promise) are shown too, but only our own: a browser extension's
// error must not scare anyone.
window.addEventListener('error', (event) => {
  if (event.error instanceof Error && String(event.filename).includes('/js/')) reportCrash(event.error);
});
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason instanceof Error) reportCrash(event.reason);
});

guarded(() => {
  checkStoredData();
  router.start();
});
