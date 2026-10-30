// ui/quickpaste.js — the three legacy screens (paste -> answer -> export) as "Quick Paste (answers only)".
// DOM only. Parsing lives in loader.js, export text in receipt.js.
// Kept as ONE file in Phase 1 because the three screens share state and are replaced together
// by the real Load / Exam / Results screens in Phases 2-3.
import {
  LEGACY_UNSURE,
  summarizeLegacyAnswers,
  legacySummaryText,
  formatLegacyAnswers,
} from '../receipt.js';
import { examShortcut } from '../exam.js';

const $ = (id) => document.getElementById(id);

/**
 * @param {{ navigate: (name: string, opts?: { replace?: boolean }) => void }} router
 * @returns {{ startLegacy: (parsed: object[]) => void, hasQuestions: () => boolean, enter: (screenName: string) => void }}
 */
export function initQuickPaste(router) {
  let questions = [];
  let answers = {};
  let currentIndex = 0;

  // ---- Screen 1: start from legacy text ------------------------------------
  // Reading the paste box / file and choosing legacy vs Quiz Pack now happens in ui/loadpack.js.
  // This is the "Quick Paste (answers only)" entry: `loadInput` has already decided the text is legacy.
  /** @param {object[]} parsed  output of parseLegacyText */
  function startLegacy(parsed) {
    questions = parsed;
    answers = {};
    currentIndex = 0;
    router.navigate('quiz');
  }

  // ---- Screen 2: exam ----------------------------------------------------
  function renderQuestion() {
    const q = questions[currentIndex];
    $('progressPill').textContent = `Question ${currentIndex + 1} of ${questions.length}`;
    $('progressFill').style.width = `${(currentIndex / (questions.length - 1 || 1)) * 100}%`;
    $('qLabel').textContent = `Question ${q.number}`;

    const hintWrap = $('qHintWrap');
    hintWrap.textContent = '';
    if (q.type === 'tf') {
      const hint = document.createElement('div');
      hint.className = 'q-hint';
      hint.textContent = 'True or false?';
      hintWrap.appendChild(hint);
    }

    $('qText').textContent = q.text;

    const optionsWrap = $('optionsWrap');
    const refocus = focusedValue(optionsWrap);   // the redraw below replaces every button: put keyboard focus back afterwards (P8-01)
    optionsWrap.textContent = '';
    q.options.forEach((opt) => {
      const selected = answers[q.number] === opt.letter;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'option' + (selected ? ' selected' : '');
      el.dataset.value = opt.letter;
      el.setAttribute('role', 'radio');
      el.setAttribute('aria-checked', String(selected));
      if (/^[A-D]$/.test(opt.letter)) el.setAttribute('aria-keyshortcuts', opt.letter);
      el.addEventListener('click', () => selectAnswer(q.number, opt.letter));

      const circle = document.createElement('div');
      circle.className = 'circle';
      circle.setAttribute('aria-hidden', 'true');
      const label = document.createElement('div');
      label.className = 'option-text';
      // Pack/pasted content is untrusted: textContent only, never innerHTML.
      label.textContent = (opt.letter !== 'True' && opt.letter !== 'False' ? opt.letter + '. ' : '') + opt.text;
      el.append(circle, label);
      optionsWrap.appendChild(el);
    });
    restoreFocus(optionsWrap, refocus);

    $('prevBtn').disabled = currentIndex === 0;
    $('nextBtn').textContent = currentIndex === questions.length - 1 ? 'Finish' : 'Next';
    $('unsureBtn').classList.toggle('active', answers[q.number] === LEGACY_UNSURE);
    $('unsureBtn').setAttribute('aria-pressed', String(answers[q.number] === LEGACY_UNSURE));

    renderJumpGrid();
  }

  function selectAnswer(qNumber, letter) {
    answers[qNumber] = letter;
    renderQuestion();
  }

  function markUnsure() {
    const q = questions[currentIndex];
    answers[q.number] = LEGACY_UNSURE;
    goNext();
  }

  function goNext() {
    if (currentIndex === questions.length - 1) {
      router.navigate('export');
    } else {
      currentIndex++;
      renderQuestion();
    }
  }

  function goPrev() {
    if (currentIndex > 0) {
      currentIndex--;
      renderQuestion();
    }
  }

  function renderJumpGrid() {
    const grid = $('jumpGrid');
    const refocus = focusedValue(grid);
    grid.textContent = '';
    questions.forEach((q, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.value = String(q.number);
      const unsure = answers[q.number] === LEGACY_UNSURE;
      const answered = answers[q.number] !== undefined && !unsure;
      let cls = 'jump';
      if (i === currentIndex) cls += ' current';
      else if (unsure) cls += ' unsure';
      else if (answered) cls += ' answered';
      btn.className = cls;
      btn.textContent = unsure ? `${q.number}?` : String(q.number);   // not colour alone (P8-01); answered cells get a check from the CSS
      btn.setAttribute('aria-label', `Question ${q.number}, ${unsure ? 'not sure' : answered ? 'answered' : 'unanswered'}`);
      if (i === currentIndex) btn.setAttribute('aria-current', 'true');
      btn.addEventListener('click', () => {
        currentIndex = i;
        renderQuestion();
      });
      grid.appendChild(btn);
    });
    restoreFocus(grid, refocus);
  }

  /** Keyboard focus across a redraw (P8-01): the value of the button holding focus inside `container`, else null. */
  function focusedValue(container) {
    const active = document.activeElement;
    return active && container.contains(active) && active.dataset ? (active.dataset.value ?? null) : null;
  }

  function restoreFocus(container, value) {
    if (value === null) return;
    const target = [...container.children].find((child) => child.dataset.value === value);
    if (target) target.focus({ preventScroll: true });
  }

  // ---- Screen 3: export --------------------------------------------------
  function renderExport() {
    $('exportSummary').textContent = legacySummaryText(summarizeLegacyAnswers(questions, answers));
    $('exportBox').textContent = formatLegacyAnswers(questions, answers);
    $('copiedMsg').textContent = '';
  }

  function copyExport() {
    const text = $('exportBox').textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          $('copiedMsg').textContent = 'Copied to clipboard.';
        })
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      $('copiedMsg').textContent = 'Copied to clipboard.';
    } catch {
      $('copiedMsg').textContent = 'Could not copy automatically — select the text manually.';
    }
  }

  function downloadExport() {
    const text = $('exportBox').textContent;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quiz-answers.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function confirmReset() {
    if (confirm('Start over? This will clear the current question set and your answers.')) {
      questions = [];
      answers = {};
      currentIndex = 0;
      $('rawInput').value = '';
      router.navigate('input', { replace: true });
    }
  }

  // ---- Wiring ------------------------------------------------------------
  $('resetBtn').addEventListener('click', confirmReset);
  $('prevBtn').addEventListener('click', goPrev);
  $('unsureBtn').addEventListener('click', markUnsure);
  $('nextBtn').addEventListener('click', goNext);
  $('copyBtn').addEventListener('click', copyExport);
  $('downloadBtn').addEventListener('click', downloadExport);
  $('backBtn').addEventListener('click', () => router.navigate('quiz'));
  $('newQuizBtn').addEventListener('click', confirmReset);

  // P8-02: A-D choose, N next, P previous, U not sure (what a key means is decided by examShortcut in exam.js).
  document.addEventListener('keydown', (e) => {
    if (!$('screen-quiz').classList.contains('active') || questions.length === 0) return;
    const hit = examShortcut(e, questions[currentIndex].options.map((o) => o.letter));
    if (!hit) return;
    e.preventDefault();
    if (hit.action === 'select') selectAnswer(questions[currentIndex].number, hit.value);
    else if (hit.action === 'next') goNext();
    else if (hit.action === 'prev') goPrev();
    else if (hit.action === 'unsure') markUnsure();
  });

  return {
    startLegacy,
    hasQuestions: () => questions.length > 0,
    /** Called by main.js each time a screen becomes visible. */
    enter(screenName) {
      if (screenName === 'quiz') renderQuestion();
      else if (screenName === 'export') renderExport();
    },
  };
}
