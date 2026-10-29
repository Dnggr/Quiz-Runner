// ui/preview.js — the Topics preview screen (P2-07/P2-08): what a loaded pack covers, before the exam.
// DOM only; the numbers come from packsummary.js. The pack's answers are never read here.
import { summarizePack } from '../packsummary.js';
import { groupIssues } from '../validator.js';
import { renderIssueGroups } from './issuelist.js';
import { buildContinuePrompt } from '../promptBuilder.js';
import { formatRanges } from '../parts.js';
import { copyText } from './clipboard.js';

const $ = (id) => document.getElementById(id);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;   // pack content is untrusted: textContent only
  return node;
}

/**
 * @param {{ onChooseAnother: () => void, onStart: () => void, onAddMore: () => void }} options
 * @returns {{ show: (result: object, note?: string, status?: object) => void, clear: () => void }}
 */
export function initPreview({ onChooseAnother, onStart, onAddMore }) {
  $('chooseAnotherBtn').addEventListener('click', onChooseAnother);
  $('startExamBtn').addEventListener('click', onStart);
  $('partialAddBtn').addEventListener('click', onAddMore);
  $('partialCopyBtn').addEventListener('click', () => {
    const text = $('partialPrompt').value;
    if (!text) return;
    copyText(text).then((ok) => {
      $('partialMsg').textContent = ok ? 'Copied to clipboard.' : 'Could not copy automatically. Open \u201cShow the continue prompt\u201d and copy the text.';
    });
  });

  function clear() {
    for (const id of ['previewTitle', 'previewSubject', 'previewCounts', 'topicList', 'difficultyMix', 'previewNotes']) {
      $(id).textContent = '';
    }
    for (const id of ['previewWarnings', 'previewNotice']) {
      $(id).textContent = '';
      $(id).style.display = 'none';
    }
    // The continue panel is static markup (buttons, textarea): hide it and empty its text fields, never its children.
    $('previewPartial').style.display = 'none';
    for (const id of ['partialTitle', 'partialParts', 'partialDetail', 'partialMsg']) $(id).textContent = '';
    $('partialPrompt').value = '';
    $('previewNotesWrap').style.display = 'none';
  }

  /**
   * P7-01 / P7-02 / P7-04: how much of the planned pack is here, and what to do about the rest. Only shown when something is
   * missing, a reply was cut off, or the pack comes in parts. Contains question numbers only, never answers.
   * @param {object | undefined} status  `assemblyStatus` from parts.js
   */
  function renderPartial(status) {
    if (!status || (status.complete && !status.multiPart && !status.salvaged)) return;
    const box = $('previewPartial');
    const total = status.total;
    const plain = (text) => { const d = el('div', '', text); return d; };

    $('partialTitle').textContent = total === null
      ? `Loaded ${plural(status.loaded, 'question')}`
      : `Loaded ${status.loaded} of ${total} questions`;
    if (status.multiPart) $('partialParts').textContent = `Parts loaded: ${status.partsLoaded} of ${status.totalParts}`;

    const detail = $('partialDetail');
    if (status.salvaged) {
      detail.appendChild(plain(
        total === null
          ? 'The AI\u2019s reply was cut off, so the question it was writing at that point was left out. The pack does not say how many questions it should have.'
          : 'The AI\u2019s reply was cut off, so the question it was writing at that point was left out.',
      ));
    }
    if (!status.complete) {
      detail.appendChild(plain(`Missing question numbers: ${formatRanges(status.missing)}.`));
      detail.appendChild(plain('Ask the AI for the rest, then paste it or choose its file to add it to these questions. You can also start the exam with what is loaded.'));
    }

    const prompt = status.complete ? { ok: false, prompt: '' } : buildContinuePrompt({ total, missing: status.missing });
    $('partialPrompt').value = prompt.ok ? prompt.prompt : '';
    $('partialCopyBtn').style.display = prompt.ok ? '' : 'none';
    $('partialPromptWrap').style.display = prompt.ok ? '' : 'none';
    $('partialAddBtn').style.display = status.complete ? 'none' : '';
    box.style.display = 'block';
  }

  /**
   * @param {{ pack: object, warnings: object[], repaired: boolean }} result  a loadable pack result from loadInput
   * @param {string} [note]
   * @param {object} [status]  `assemblyStatus` (parts.js): completeness and parts progress of the pack
   */
  function show(result, note = '', status = undefined) {
    clear();
    const s = summarizePack(result.pack);

    $('previewTitle').textContent = s.title;
    $('previewSubject').textContent = s.subject;
    $('previewSubject').style.display = s.subject ? 'block' : 'none';
    $('previewCounts').append(
      el('span', 'pill', plural(s.questionCount, 'question')),
      el('span', 'pill', plural(s.topics.length, 'topic')),
    );

    const notices = [];
    if (result.repaired) notices.push('Trailing commas in the pack were fixed automatically.');
    if (note) notices.push(note);
    if (notices.length > 0) {
      $('previewNotice').textContent = notices.join(' ');
      $('previewNotice').style.display = 'block';
    }

    // "meta.total_questions says 130 but the pack has 97" is said better by the Loaded x of y box, so it is not repeated.
    const missingShown = Boolean(status) && !status.complete;
    renderWarnings(missingShown ? result.warnings.filter((w) => w.code !== 'count_mismatch') : result.warnings);
    renderPartial(status);

    for (const t of s.topics) {
      const card = el('section', 'topic-card');
      const head = el('div', 'topic-head');
      head.append(el('h3', 'topic-name', t.name), el('span', 'topic-count', plural(t.count, 'question')));
      card.appendChild(head);
      if (t.subtopics.length > 0) {
        const ul = el('ul', 'chips');
        for (const sub of t.subtopics) ul.appendChild(el('li', 'chip', sub));
        card.appendChild(ul);
      }
      $('topicList').appendChild(card);
    }

    for (const d of s.difficulty) {
      const row = el('div', 'mix-row');
      row.appendChild(el('div', 'mix-label', `${capitalize(d.level)}: ${d.count} (${d.percent}%)`));
      const track = el('div', 'mix-track');
      const fill = el('div', 'mix-fill');
      fill.style.width = `${d.percent}%`;
      track.appendChild(fill);
      row.appendChild(track);
      $('difficultyMix').appendChild(row);
    }
    if (s.untaggedDifficulty > 0) {
      $('difficultyMix').appendChild(el('div', 'mix-label mix-untagged', `No difficulty given: ${s.untaggedDifficulty}`));
    }

    if (s.notes.length > 0) {
      for (const n of s.notes) $('previewNotes').appendChild(el('li', '', n));
      $('previewNotesWrap').style.display = 'block';
    }
  }

  /** Warnings never block loading (P2-08). Pack-level ones are always visible; per-question ones fold away. */
  function renderWarnings(warnings) {
    if (warnings.length === 0) return;
    const box = $('previewWarnings');
    const grouped = groupIssues(warnings);
    box.appendChild(el('div', 'warn-title', `${plural(warnings.length, 'warning')}: the pack still loads.`));

    if (grouped.pack.length > 0) {
      const ul = el('ul');
      for (const w of grouped.pack) ul.appendChild(el('li', '', w.message));
      box.appendChild(ul);
    }
    if (grouped.questions.length > 0) {
      const perQuestion = warnings.length - grouped.pack.length;
      const details = el('details', 'warn-details');
      details.appendChild(el('summary', '', `Show ${plural(perQuestion, 'warning')} about individual questions`));
      renderIssueGroups(details, grouped, { showPack: false });
      box.appendChild(details);
    }
    box.style.display = 'block';
  }

  return { show, clear };
}
