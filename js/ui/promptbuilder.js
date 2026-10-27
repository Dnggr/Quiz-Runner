// ui/promptbuilder.js — the Prompt Builder screen (P5-01 fields, P5-02 presets, P5-05 receipt input, P5-07 live preview /
// Copy / Download / length, P5-08 remembered options, P5-09 prefill from a finished exam). DOM only.
// Every decision (validation, per-topic allocation, the prompt itself) comes from promptBuilder.js and receipt.js;
// what is remembered is decided by settings.js.
// All text from a receipt is untrusted: it only goes into the DOM with textContent / `.value`.
import {
  MODES, RECEIPT_MODES, presetCount, defaultOptions, buildPrompt, receiptInfo, defaultTopicRows, summarizeTarget,
} from '../promptBuilder.js';
import { parseReceipt, formatTokenEstimate } from '../receipt.js';
import { SKILLS } from '../constants.js';

const $ = (id) => document.getElementById(id);

const MODE_HELP = {
  initial: 'A first practice exam built from your course files. The AI also writes the topic list.',
  targeted: 'New questions that focus on the weak topics in the receipt of an earlier exam, plus some from topics you already know.',
  retention: 'A short check across all the topics in a receipt, to test long-term memory.',
  custom: 'Your own task. The quiz format and delivery rules are still added so the app can load the result.',
};
const COUNT_HELP_RECEIPT = 'Changing this spreads the questions across topics again. Editing a topic below changes this total.';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A whole number from the text of an input, else NaN. */
const wholeNumber = (text) => (/^\s*\d+\s*$/.test(String(text)) ? Number(text) : NaN);

/**
 * @param {{
 *   onBack: () => void,
 *   getLatestReceipt: () => ({ ok: true, text: string } | { ok: false, error: string }),   the newest stored exam as a receipt
 *   getSnapshots: () => object[],                                                         stored exams, for the quiz id number
 *   loadSettings?: () => object,                                                          the remembered options (settings.js), checked
 *   saveSettings?: (options: object) => void,                                             remember the options in use (settings.js)
 * }} options
 * @returns {{
 *   enter: () => void, clearReceipt: () => void, prefillTargeted: (receiptText: string) => void,
 *   getOptions: () => object, getResult: () => ReturnType<typeof buildPrompt>,
 * }}
 */
export function initPromptBuilder({ onBack, getLatestReceipt, getSnapshots, loadSettings = () => ({}), saveSettings = () => {} }) {
  const d = defaultOptions('initial');
  const saved = loadSettings();   // P5-08: only valid fields are in it; anything missing keeps its default
  const savedMode = saved.mode ?? 'initial';
  const state = {
    mode: savedMode,
    subject: saved.subject ?? '',
    learner: saved.learner ?? d.learner,
    count: String(saved.count ?? presetCount(savedMode)),
    easy: String((saved.difficulty ?? d.difficulty).easy),
    moderate: String((saved.difficulty ?? d.difficulty).moderate),
    challenging: String((saved.difficulty ?? d.difficulty).challenging),
    skills: new Set(saved.skills ?? d.skills),
    delivery: saved.delivery ?? d.delivery,
    partSize: String(saved.partSize ?? d.partSize),
    customTask: saved.customTask ?? '',
    receiptText: '',
    receipt: null,   // parseReceipt() result for `receiptText`, or null when the box is empty
    rows: null,      // per-topic counts: [{ id, name, status, reason, mix, raw }]; `raw` is the text of the number box
  };

  let latest = null;   // the prompt currently in the preview ({ prompt, quizId }): what Copy and Download use; null when there is none

  const isReceiptMode = () => RECEIPT_MODES.includes(state.mode);
  const info = () => {
    const read = receiptInfo(state.receipt);
    return read.ok ? read.info : null;
  };

  // ---- options for promptBuilder.js ---------------------------------------------------------------------
  function getOptions() {
    return {
      mode: state.mode,
      subject: state.subject,
      learner: state.learner,
      count: state.count,
      difficulty: { easy: state.easy, moderate: state.moderate, challenging: state.challenging },
      skills: [...state.skills],
      delivery: state.delivery,
      partSize: state.partSize,
      customTask: state.customTask,
      receipt: isReceiptMode() ? state.receipt : null,
      topicCounts: isReceiptMode() && state.rows ? state.rows.map((r) => ({ id: r.id, count: r.raw })) : null,
    };
  }
  const getResult = () => buildPrompt(getOptions(), { snapshots: getSnapshots() });

  /** A change the learner made: remember the options (P5-08), then redraw. */
  function changed() {
    saveSettings(getOptions());
    render();
  }

  // ---- per-topic rows (P5-05) ---------------------------------------------------------------------------
  /** Start the rows again from the receipt and the current question count. Manual edits are replaced: the count changed. */
  function resetRows() {
    const receipt = info();
    const n = wholeNumber(state.count);
    if (!isReceiptMode() || !receipt || !(n >= 1)) return;
    state.rows = defaultTopicRows(receipt, state.mode, n).map((r) => ({ ...r, raw: String(r.count) }));
  }

  function rowsTotal() {
    const counts = (state.rows ?? []).map((r) => wholeNumber(r.raw));
    return counts.every((n) => n >= 0) ? counts.reduce((a, b) => a + b, 0) : null;
  }

  function renderRows() {
    const box = $('pbRows');
    box.textContent = '';
    const receipt = info();
    if (!isReceiptMode() || !receipt || !state.rows) {
      $('pbRowsTotal').textContent = '';
      return;
    }
    state.rows.forEach((row, i) => {
      const wrap = el('div', 'pb-row');
      const label = el('label', 'pb-row-label');
      label.htmlFor = `pbRow${i}`;
      const name = el('span', 'topic-name', row.name);
      if (row.status) name.appendChild(el('span', `status-chip status-${row.status}`, row.status));
      label.append(name, el('span', 'pb-row-reason', row.reason));
      const input = el('input');
      input.type = 'number';
      input.id = `pbRow${i}`;
      input.inputMode = 'numeric';
      input.min = '0';
      input.step = '1';
      input.value = row.raw;
      input.addEventListener('input', () => {
        row.raw = input.value;
        const total = rowsTotal();
        if (total !== null) {
          state.count = String(total);
          $('pbCount').value = state.count;
        }
        renderRowsTotal();
        changed();
      });
      wrap.append(label, input);
      box.appendChild(wrap);
    });
    renderRowsTotal();
  }

  function renderRowsTotal() {
    const total = rowsTotal();
    const used = (state.rows ?? []).filter((r) => wholeNumber(r.raw) > 0).length;
    $('pbRowsTotal').textContent = total === null
      ? 'Every topic needs a whole number, 0 or more.'
      : `Total: ${plural(total, 'question', 'questions')} across ${plural(used, 'topic', 'topics')}.`;
  }

  // ---- the receipt box (P5-05) --------------------------------------------------------------------------
  function listBox(box, title, items) {
    box.textContent = '';
    if (items.length === 0) {
      box.style.display = 'none';
      return;
    }
    if (title) box.appendChild(el('div', 'warn-title', title));
    const ul = el('ul');
    for (const text of items) ul.appendChild(el('li', '', text));
    box.appendChild(ul);
    box.style.display = 'block';
  }

  function renderReceipt() {
    const read = receiptInfo(state.receipt);
    // Nothing is shown as an error before something has been pasted.
    listBox($('pbReceiptErrors'), '', state.receipt && !read.ok ? read.errors : []);
    listBox($('pbReceiptWarnings'), 'Check this receipt', read.ok ? read.warnings : []);

    const summary = $('pbSummary');
    summary.textContent = '';
    if (!read.ok) {
      $('pbRows').textContent = '';
      $('pbRowsTotal').textContent = '';
      return;
    }
    const target = summarizeTarget(read.info, (state.rows ?? []).map((r) => ({ ...r, count: Math.max(0, wholeNumber(r.raw) || 0) })));
    const box = el('div', 'pb-summary');
    box.appendChild(el('div', 'pb-summary-head', target.headline));
    for (const g of target.groups) {
      const line = el('div', 'pb-summary-line');
      line.append(el('b', '', `${g.label}: `), document.createTextNode(g.names.join(', ')));
      box.appendChild(line);
    }
    box.appendChild(el('div', 'pb-summary-line', state.mode === 'retention'
      ? 'The check covers every topic below, with an extra question for each priority topic. Change the numbers if you like.'
      : 'The questions are spread over the topics below, weak topics first. Change the numbers if you like.'));
    if (read.info.hasMissedDetail) {
      box.appendChild(el('div', 'pb-summary-line', 'Your missed questions and their answers are not put in the prompt.'));
    }
    summary.appendChild(box);
    renderRows();
  }

  function setReceiptText(text) {
    state.receiptText = text;
    state.receipt = text.trim() === '' ? null : parseReceipt(text);
    const receipt = info();
    if (receipt && state.subject.trim() === '' && receipt.exam.subject !== '') {
      state.subject = receipt.exam.subject;
      $('pbSubject').value = state.subject;
    }
    state.rows = null;
    resetRows();
    renderReceipt();
    changed();
  }

  function useLatest() {
    const latest = getLatestReceipt();
    if (!latest.ok) {
      state.receiptText = '';
      state.receipt = null;
      state.rows = null;
      $('pbReceiptText').value = '';
      renderReceipt();
      listBox($('pbReceiptErrors'), '', [latest.error]);
      render();
      return;
    }
    $('pbReceiptText').value = latest.text;
    setReceiptText(latest.text);
  }

  /** Empties the pasted receipt. It can hold the answers of an earlier exam, so no exam may start (or resume) with it on screen. */
  function clearReceipt() {
    state.receiptText = '';
    state.receipt = null;
    state.rows = null;
    $('pbReceiptText').value = '';
    renderReceipt();
    render();
  }

  /**
   * P5-09: open the builder ready for the next quiz after an exam. Targeted mode, that exam's receipt in the box, its
   * subject, and the preset count; the learner, difficulty, skills and delivery stay as last used. The rows start from
   * the receipt's own allocation, exactly as after "Use latest from this device".
   * @param {string} receiptText  a receipt as `buildReceipt` writes it (missed-question detail off, see main.js)
   */
  function prefillTargeted(receiptText) {
    state.mode = 'targeted';
    state.count = String(presetCount('targeted'));
    $('pbCount').value = state.count;
    state.receiptText = receiptText;
    $('pbReceiptText').value = receiptText;
    state.receipt = receiptText.trim() === '' ? null : parseReceipt(receiptText);
    const receipt = info();
    if (receipt && receipt.exam.subject !== '') {
      state.subject = receipt.exam.subject;
      $('pbSubject').value = state.subject;
    }
    state.rows = null;
    resetRows();
    renderReceipt();
    changed();
  }

  // ---- the whole form -----------------------------------------------------------------------------------
  function mixTotal() {
    const parts = [state.easy, state.moderate, state.challenging].map(wholeNumber);
    return parts.every((n) => n >= 0) ? parts.reduce((a, b) => a + b, 0) : null;
  }

  function render() {
    const mode = state.mode;
    for (const btn of $('pbModes').querySelectorAll('[data-mode]')) btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
    $('pbModeHelp').textContent = MODE_HELP[mode];
    $('pbCountHelp').textContent = isReceiptMode() ? COUNT_HELP_RECEIPT : '';

    const usesMix = mode === 'initial' || mode === 'targeted';
    $('pbCustomWrap').hidden = mode !== 'custom';
    $('pbDifficultyWrap').hidden = !usesMix;
    $('pbSkillsWrap').hidden = !usesMix;
    $('pbReceiptWrap').hidden = !isReceiptMode();
    $('pbPartWrap').hidden = state.delivery !== 'parts';

    const total = mixTotal();
    $('pbMixTotal').textContent = mode === 'targeted'
      ? `${total === null ? 'Enter whole numbers.' : `Total ${total}%${total === 100 ? '' : ' (must be 100%)'}.`} Used only when the receipt gives no mix for a topic.`
      : (total === null ? 'Enter whole numbers.' : `Total ${total}%${total === 100 ? '' : ' (must be 100%)'}.`);

    const result = getResult();
    listBox($('pbErrors'), 'Still needed', result.errors);
    listBox($('pbWarnings'), 'Heads-up', result.warnings);
    const ready = $('pbReady');
    if (result.ok) {
      const m = result.meta;
      ready.textContent = `Ready: ${plural(m.count, 'question', 'questions')}, ${plural(m.totalParts, 'part', 'parts')}. Quiz id: ${m.quizId}.`;
      ready.style.display = 'block';
    } else {
      ready.textContent = '';
      ready.style.display = 'none';
    }
    renderPreview(result);
  }

  // ---- live preview, Copy, Download (P5-07) ----------------------------------------------------------------
  /** The preview follows the form: it shows the prompt while the form has no problems, and is hidden otherwise. */
  function renderPreview(result) {
    latest = result.ok ? { prompt: result.prompt, quizId: result.meta.quizId } : null;
    $('pbOutput').hidden = latest === null;
    $('pbPreview').textContent = latest ? latest.prompt : '';
    // PROMPT_TEMPLATES "Rules for the builder": an approximate length, characters / 4.
    $('pbSize').textContent = latest ? `${formatTokenEstimate(latest.prompt)} · ${latest.prompt.length.toLocaleString('en-US')} characters` : '';
    $('pbMsg').textContent = '';
  }

  const say = (text) => { $('pbMsg').textContent = text; };

  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      say(ok ? 'Copied to clipboard.' : 'Could not copy automatically — select the text in the preview and copy it.');
    } catch {
      say('Could not copy automatically — select the text in the preview and copy it.');
    }
  }

  function copy() {
    if (!latest) return;
    const text = latest.prompt;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => say('Copied to clipboard.')).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function download() {
    if (!latest) return;
    const blob = new Blob([latest.prompt], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${latest.quizId}.prompt.md`;   // like samples/sample-pack-130.prompt.md
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    say(`Downloaded ${a.download}.`);
  }

  // ---- events ---------------------------------------------------------------------------------------------
  function setMode(mode) {
    if (!MODES.includes(mode) || mode === state.mode) return;
    state.mode = mode;
    state.count = String(presetCount(mode));   // P5-02: each mode starts at its own count; the learner may change it
    $('pbCount').value = state.count;
    state.rows = null;
    resetRows();
    renderReceipt();
    changed();
  }

  for (const btn of $('pbModes').querySelectorAll('[data-mode]')) btn.addEventListener('click', () => setMode(btn.dataset.mode));

  const bindText = (id, key, after) => $(id).addEventListener('input', (e) => {
    state[key] = e.target.value;
    if (after) after();
    changed();
  });
  bindText('pbSubject', 'subject');
  bindText('pbLearner', 'learner');
  bindText('pbEasy', 'easy');
  bindText('pbModerate', 'moderate');
  bindText('pbChallenging', 'challenging');
  bindText('pbPartSize', 'partSize');
  bindText('pbCustomTask', 'customTask');
  $('pbCount').addEventListener('input', (e) => {
    state.count = e.target.value;
    if (isReceiptMode()) {
      resetRows();
      renderReceipt();
    }
    changed();
  });

  // skill checkboxes
  const skillBox = $('pbSkills');
  for (const skill of SKILLS) {
    const label = el('label', 'toggle');
    const input = el('input');
    input.type = 'checkbox';
    input.id = `pbSkill-${skill}`;
    input.checked = state.skills.has(skill);
    input.addEventListener('change', () => {
      if (input.checked) state.skills.add(skill);
      else state.skills.delete(skill);
      changed();
    });
    const text = el('span');
    text.appendChild(el('span', 'toggle-title', cap(skill)));
    label.append(input, text);
    skillBox.appendChild(label);
  }

  for (const radio of document.querySelectorAll('input[name="pbDelivery"]')) {
    radio.addEventListener('change', () => {
      if (radio.checked) state.delivery = radio.value;
      changed();
    });
  }

  $('pbReceiptText').addEventListener('input', (e) => setReceiptText(e.target.value));
  $('pbLatestBtn').addEventListener('click', useLatest);
  $('pbClearReceiptBtn').addEventListener('click', clearReceipt);
  $('pbBackBtn').addEventListener('click', onBack);
  $('pbCopyBtn').addEventListener('click', copy);
  $('pbDownloadBtn').addEventListener('click', download);

  // ---- first paint ----------------------------------------------------------------------------------------
  $('pbSubject').value = state.subject;
  $('pbLearner').value = state.learner;
  $('pbCustomTask').value = state.customTask;
  $('pbCount').value = state.count;
  $('pbEasy').value = state.easy;
  $('pbModerate').value = state.moderate;
  $('pbChallenging').value = state.challenging;
  $('pbPartSize').value = state.partSize;
  $('pbDeliveryFile').checked = state.delivery === 'file-or-code';
  $('pbDeliveryParts').checked = state.delivery === 'parts';
  render();

  return {
    /** Called each time the screen is opened: stored exams may have changed, which changes the quiz id. */
    enter: render,
    clearReceipt,
    prefillTargeted,
    getOptions,
    getResult,
  };
}
