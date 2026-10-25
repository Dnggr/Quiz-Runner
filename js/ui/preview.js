// ui/preview.js — the Topics preview screen (P2-07/P2-08): what a loaded pack covers, before the exam.
// DOM only; the numbers come from packsummary.js. The pack's answers are never read here.
import { summarizePack } from '../packsummary.js';
import { groupIssues } from '../validator.js';
import { renderIssueGroups } from './issuelist.js';

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
 * @param {{ onChooseAnother: () => void }} options
 * @returns {{ show: (result: object, note?: string) => void, clear: () => void }}
 */
export function initPreview({ onChooseAnother }) {
  $('chooseAnotherBtn').addEventListener('click', onChooseAnother);

  function clear() {
    for (const id of ['previewTitle', 'previewSubject', 'previewCounts', 'topicList', 'difficultyMix', 'previewNotes']) {
      $(id).textContent = '';
    }
    for (const id of ['previewWarnings', 'previewNotice']) {
      $(id).textContent = '';
      $(id).style.display = 'none';
    }
    $('previewNotesWrap').style.display = 'none';
  }

  /** @param {{ pack: object, warnings: object[], repaired: boolean }} result  a loadable pack result from loadInput */
  function show(result, note = '') {
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

    renderWarnings(result.warnings);

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
