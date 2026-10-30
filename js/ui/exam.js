// ui/exam.js — the Exam screen for Quiz Packs (P3-01..P3-04). DOM only; the rules live in exam.js.
// It is given question text and options only (see toExamQuestions): answers and explanations never reach this
// file, so they can never be in the DOM during the exam (AGENTS.md; P3-10).
// Every change (answer, "Not sure", moving to another question) is reported through `onChange` so main.js can autosave.
// P8-01 / P8-02: options are radio buttons with keyboard-shortcut hints, keyboard focus survives a redraw, and
// A-D / N / P / U work on a desktop keyboard (what each key means is decided by examShortcut in exam.js).
import {
  selectOption, pressNotSure, progressCounts, firstUnansweredIndex, firstUnsureIndex, examShortcut,
} from '../exam.js';

const $ = (id) => document.getElementById(id);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * @param {{
 *   onChange: (state: { responses: object, index: number }) => boolean,   returns false when it could not be saved
 *   onFinish: () => void,                                                  the learner confirmed "Finish exam"
 *   onQuit: () => void,                                                    "Start over" (asks for confirmation itself)
 * }} options
 * @returns {{ load: (state: { questions: object[], responses: object, index: number }) => void }}
 */
export function initExam({ onChange, onFinish, onQuit }) {
  let questions = [];
  let responses = {};
  let index = 0;
  let lastFocus = null;

  // ---- keyboard focus across a redraw (P8-01) ------------------------------------------------------
  // render() rebuilds the option and jump buttons. Without this, pressing Enter on an option would drop focus to the page
  // and a keyboard user would have to Tab in from the top again.
  function focusedValue(container) {
    const active = document.activeElement;
    return active && container.contains(active) && active.dataset ? (active.dataset.value ?? null) : null;
  }

  function restoreFocus(container, value) {
    if (value === null) return;
    const target = [...container.children].find((child) => child.dataset.value === value);
    if (target) target.focus({ preventScroll: true });
  }

  // ---- state changes ---------------------------------------------------------
  function commit() {
    const saved = onChange({ responses, index });
    $('exStorageWarn').style.display = saved === false ? 'block' : 'none';
    render();
  }

  function choose(value) {
    responses = selectOption(responses, questions[index].number, value);
    commit();
  }

  function notSure() {
    const result = pressNotSure(responses, questions[index].number);
    responses = result.responses;
    if (result.advance) goNext(); else commit();
  }

  function goTo(i) {
    index = Math.min(Math.max(i, 0), questions.length - 1);
    commit();
  }

  function goNext() {
    if (index === questions.length - 1) {
      commit();               // save the flag/answer first
      openFinish();
    } else {
      goTo(index + 1);
    }
  }

  // ---- rendering ---------------------------------------------------------------
  function render() {
    const q = questions[index];
    const r = responses[q.number] || { selected: null, unsure: false };

    $('exProgressPill').textContent = `Question ${index + 1} of ${questions.length}`;
    $('exProgressFill').style.width = `${(index / (questions.length - 1 || 1)) * 100}%`;
    $('exQLabel').textContent = `Question ${q.number}`;

    const hint = $('exQHint');
    hint.textContent = '';
    if (q.type === 'tf') {
      const div = document.createElement('div');
      div.className = 'q-hint';
      div.textContent = 'True or false?';
      hint.appendChild(div);
    }

    $('exQText').textContent = q.text;           // pack content is untrusted: textContent only

    const wrap = $('exOptions');
    const refocus = focusedValue(wrap);        // the redraw below replaces every button: put keyboard focus back afterwards
    wrap.textContent = '';
    for (const opt of q.options) {
      const selected = r.selected === opt.value;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'option' + (selected ? ' selected' : '');
      el.dataset.value = opt.value;
      el.setAttribute('role', 'radio');
      el.setAttribute('aria-checked', String(selected));
      if (q.type === 'mc') el.setAttribute('aria-keyshortcuts', opt.value);
      el.addEventListener('click', () => choose(opt.value));
      const circle = document.createElement('div');
      circle.className = 'circle';
      circle.setAttribute('aria-hidden', 'true');   // the radio state is already announced through aria-checked
      const label = document.createElement('div');
      label.className = 'option-text';
      label.textContent = (q.type === 'mc' ? `${opt.value}. ` : '') + opt.text;
      el.append(circle, label);
      wrap.appendChild(el);
    }
    restoreFocus(wrap, refocus);

    $('exFlagNote').hidden = !r.unsure;
    $('exUnsureBtn').classList.toggle('active', r.unsure);
    $('exUnsureBtn').setAttribute('aria-pressed', String(r.unsure));
    $('exPrevBtn').disabled = index === 0;
    $('exNextBtn').textContent = index === questions.length - 1 ? 'Finish' : 'Next';

    renderJumpGrid();
  }

  function renderJumpGrid() {
    const grid = $('exJumpGrid');
    const refocus = focusedValue(grid);
    grid.textContent = '';
    questions.forEach((q, i) => {
      const r = responses[q.number] || { selected: null, unsure: false };
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.value = String(q.number);
      let cls = 'jump';
      if (i === index) cls += ' current';
      else if (r.unsure) cls += ' unsure';
      else if (r.selected !== null) cls += ' answered';
      btn.className = cls;
      btn.textContent = r.unsure ? `${q.number}?` : String(q.number);   // not colour alone
      const state = [r.selected !== null ? 'answered' : 'unanswered', r.unsure ? 'not sure' : null].filter(Boolean).join(', ');
      btn.setAttribute('aria-label', `Question ${q.number}, ${state}`);
      if (i === index) btn.setAttribute('aria-current', 'true');
      btn.addEventListener('click', () => goTo(i));
      grid.appendChild(btn);
    });
    restoreFocus(grid, refocus);
  }

  // ---- finish confirmation (P3-04) ------------------------------------------------
  function openFinish() {
    const counts = progressCounts(questions, responses);
    const list = $('exFinishCounts');
    list.textContent = '';
    for (const text of [
      `${counts.answered} of ${counts.total} answered`,
      `Unanswered: ${counts.unanswered}`,
      `Marked not sure: ${counts.unsure}`,
    ]) {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    }
    $('exGoUnansweredBtn').hidden = counts.unanswered === 0;
    $('exReviewUnsureBtn').hidden = counts.unsure === 0;
    lastFocus = document.activeElement;
    $('exFinishDialog').hidden = false;
    $('exFinishConfirmBtn').focus();
  }

  function closeFinish() {
    $('exFinishDialog').hidden = true;
    if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  function jumpFromDialog(i) {
    if (i < 0) return;
    closeFinish();
    goTo(i);
  }

  /** The dialog is aria-modal: Tab and Shift+Tab stay on its visible buttons instead of reaching the exam behind it. */
  function keepFocusInDialog(e) {
    const buttons = [...$('exFinishDialog').querySelectorAll('button')].filter((b) => !b.hidden);
    if (buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!buttons.includes(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // ---- wiring ------------------------------------------------------------------------
  $('exPrevBtn').addEventListener('click', () => goTo(index - 1));
  $('exNextBtn').addEventListener('click', goNext);
  $('exUnsureBtn').addEventListener('click', notSure);
  $('exQuitBtn').addEventListener('click', onQuit);
  $('exGoUnansweredBtn').addEventListener('click', () => jumpFromDialog(firstUnansweredIndex(questions, responses)));
  $('exReviewUnsureBtn').addEventListener('click', () => jumpFromDialog(firstUnsureIndex(questions, responses)));
  $('exFinishCancelBtn').addEventListener('click', closeFinish);
  $('exFinishConfirmBtn').addEventListener('click', () => {
    $('exFinishDialog').hidden = true;
    onFinish();
  });
  document.addEventListener('keydown', (e) => {
    const dialogOpen = !$('exFinishDialog').hidden;
    if (dialogOpen) {
      if (e.key === 'Escape') closeFinish();
      else if (e.key === 'Tab') keepFocusInDialog(e);
      return;   // no question shortcuts behind the confirmation
    }
    if (!$('screen-exam').classList.contains('active') || questions.length === 0) return;
    const hit = examShortcut(e, questions[index].options.map((o) => o.value));   // P8-02
    if (!hit) return;
    e.preventDefault();
    if (hit.action === 'select') choose(hit.value);
    else if (hit.action === 'next') goNext();
    else if (hit.action === 'prev') { if (index > 0) goTo(index - 1); }
    else if (hit.action === 'unsure') notSure();
  });

  return {
    /** Show an exam (new or resumed). `questions` must come from toExamQuestions: no answers. */
    load(state) {
      questions = state.questions;
      responses = state.responses;
      index = Math.min(Math.max(state.index, 0), questions.length - 1);
      $('exFinishDialog').hidden = true;
      $('exStorageWarn').style.display = 'none';
      render();
    },
  };
}
