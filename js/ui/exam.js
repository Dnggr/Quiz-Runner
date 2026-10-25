// ui/exam.js — the Exam screen for Quiz Packs (P3-01..P3-04). DOM only; the rules live in exam.js.
// It is given question text and options only (see toExamQuestions): answers and explanations never reach this
// file, so they can never be in the DOM during the exam (AGENTS.md; P3-10).
// Every change (answer, "Not sure", moving to another question) is reported through `onChange` so main.js can autosave.
import {
  selectOption, pressNotSure, progressCounts, firstUnansweredIndex, firstUnsureIndex,
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
    wrap.textContent = '';
    for (const opt of q.options) {
      const selected = r.selected === opt.value;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'option' + (selected ? ' selected' : '');
      el.setAttribute('role', 'radio');
      el.setAttribute('aria-checked', String(selected));
      el.addEventListener('click', () => choose(opt.value));
      const circle = document.createElement('div');
      circle.className = 'circle';
      const label = document.createElement('div');
      label.className = 'option-text';
      label.textContent = (q.type === 'mc' ? `${opt.value}. ` : '') + opt.text;
      el.append(circle, label);
      wrap.appendChild(el);
    }

    $('exFlagNote').hidden = !r.unsure;
    $('exUnsureBtn').classList.toggle('active', r.unsure);
    $('exUnsureBtn').setAttribute('aria-pressed', String(r.unsure));
    $('exPrevBtn').disabled = index === 0;
    $('exNextBtn').textContent = index === questions.length - 1 ? 'Finish' : 'Next';

    renderJumpGrid();
  }

  function renderJumpGrid() {
    const grid = $('exJumpGrid');
    grid.textContent = '';
    questions.forEach((q, i) => {
      const r = responses[q.number] || { selected: null, unsure: false };
      const btn = document.createElement('button');
      btn.type = 'button';
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
    if (e.key === 'Escape' && !$('exFinishDialog').hidden) closeFinish();
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
