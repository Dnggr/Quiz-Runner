// ui/results.js — Results screen (P3-06 Overview, P3-07 Review, P3-08 outcome jump grid). DOM only.
// Numbers come from grader.js, review items from review.js. Everything is built with textContent (pack text is
// untrusted) and carries an icon AND a word, never colour alone.
//
// This screen is the only place answers and explanations are shown. It is empty until the exam is finished,
// and `clear()` empties it again whenever the app leaves it, so a later exam never has them in the DOM (P3-10).
import { REVIEW_FILTERS, DEFAULT_REVIEW_FILTER, filterReviewItems, reviewCounts } from '../review.js';

const $ = (id) => document.getElementById(id);

const STATS = [
  { key: 'correct', icon: '✓', label: 'Correct', cls: 'stat-correct' },
  { key: 'wrong', icon: '✗', label: 'Wrong', cls: 'stat-wrong' },
  { key: 'skipped', icon: '–', label: 'Skipped', cls: 'stat-skipped' },
  { key: 'unsure', icon: '?', label: 'Marked not sure', cls: 'stat-unsure' },
];
const OUTCOMES = {
  correct: { icon: '✓', label: 'Correct' },
  wrong: { icon: '✗', label: 'Wrong' },
  skipped: { icon: '–', label: 'Skipped' },
};
const EMPTY_TEXT = {
  wrong: 'No wrong answers.',
  unsure: 'No questions were marked not sure.',
  skipped: 'No skipped questions.',
  all: 'No questions.',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** "B. text" for a letter, just "True" for true/false, "No answer" for nothing. */
function answerLine(value, text, type) {
  if (value === null || value === '') return 'No answer';
  if (type === 'tf' || !text) return value;
  return `${value}. ${text}`;
}

/**
 * @param {{ onHome: () => void }} options
 * @returns {{
 *   show: (totals: object, info: { title: string, subject?: string, items: object[], saveFailed?: boolean }) => void,
 *   clear: () => void,
 * }}
 */
export function initResults({ onHome }) {
  let items = [];
  let filter = DEFAULT_REVIEW_FILTER;

  // ---- tabs ----------------------------------------------------------------------
  function selectTab(name) {
    const review = name === 'review';
    $('resTabOverview').setAttribute('aria-selected', String(!review));
    $('resTabReview').setAttribute('aria-selected', String(review));
    $('resPanelOverview').hidden = review;
    $('resPanelReview').hidden = !review;
  }

  // ---- review: chips, list, jump grid -------------------------------------------------
  function renderFilters() {
    const counts = reviewCounts(items);
    const bar = $('resFilters');
    bar.textContent = '';
    for (const f of REVIEW_FILTERS) {
      const on = f.id === filter;
      const btn = el('button', 'chip-btn', `${on ? '✓ ' : ''}${f.label} ${counts[f.id]}`);
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(on));
      btn.addEventListener('click', () => setFilter(f.id));
      bar.appendChild(btn);
    }
  }

  function renderList() {
    const list = $('resReviewList');
    list.textContent = '';
    const shown = filterReviewItems(items, filter);
    if (shown.length === 0) {
      list.appendChild(el('div', 'review-empty', EMPTY_TEXT[filter] || EMPTY_TEXT.all));
      return;
    }
    for (const item of shown) list.appendChild(renderItem(item));
  }

  function renderItem(item) {
    const out = OUTCOMES[item.outcome] || OUTCOMES.skipped;
    const card = el('article', `review-item res-${item.outcome}`);
    card.id = `review-q-${item.number}`;
    card.tabIndex = -1;

    const head = el('div', 'review-head');
    head.append(el('span', 'review-num', `Question ${item.number}`), el('span', 'review-outcome', `${out.icon} ${out.label}`));
    if (item.unsure) head.appendChild(el('span', 'review-flag', '? Marked not sure'));
    card.appendChild(head);

    const meta = [item.topicName && `Topic: ${item.topicName}`, item.concept && `Concept: ${item.concept}`].filter(Boolean);
    if (meta.length > 0) card.appendChild(el('div', 'review-meta', meta.join(' · ')));

    card.appendChild(el('div', 'review-q', item.question));

    const yours = el('div', 'review-line');
    yours.append(el('span', 'review-label', 'Your answer: '), answerLine(item.selected, item.selectedText, item.type));
    const right = el('div', 'review-line');
    right.append(el('span', 'review-label', 'Correct answer: '), answerLine(item.answer, item.answerText, item.type));
    card.append(yours, right);

    if (item.explanation) {
      const expl = el('div', 'review-expl');
      expl.append(el('span', 'review-label', 'Explanation: '), item.explanation);
      card.appendChild(expl);
    }
    return card;
  }

  function renderJumpGrid() {
    const grid = $('resJumpGrid');
    grid.textContent = '';
    for (const item of items) {
      const out = OUTCOMES[item.outcome] || OUTCOMES.skipped;
      const btn = el('button', `jump res-${item.outcome}`);
      btn.type = 'button';
      btn.append(el('span', 'jump-num', String(item.number)), el('span', 'jump-mark', `${out.icon}${item.unsure ? '?' : ''}`));
      btn.setAttribute('aria-label', `Question ${item.number}, ${out.label.toLowerCase()}${item.unsure ? ', marked not sure' : ''}`);
      btn.addEventListener('click', () => goToQuestion(item.number));
      grid.appendChild(btn);
    }
  }

  function setFilter(id) {
    filter = id;
    renderFilters();
    renderList();
  }

  /** Jump-grid tap: open that question's review, switching the filter to All if it is currently hidden. */
  function goToQuestion(number) {
    selectTab('review');
    if (!filterReviewItems(items, filter).some((i) => i.number === number)) setFilter('all');
    const card = $(`review-q-${number}`);
    if (!card) return;
    if (card.scrollIntoView) card.scrollIntoView({ block: 'start' });
    card.focus({ preventScroll: true });
  }

  // ---- public ----------------------------------------------------------------------------
  function clear() {
    items = [];
    filter = DEFAULT_REVIEW_FILTER;
    for (const id of ['resTitle', 'resSubject', 'resScore', 'resPercentRating', 'resCounts', 'resJumpGrid', 'resFilters', 'resReviewList']) {
      $(id).textContent = '';
    }
    $('resSaveWarn').style.display = 'none';
    selectTab('overview');
  }

  /** @param {import('../grader.js').Totals} totals */
  function show(totals, { title, subject = '', items: reviewItems = [], saveFailed = false }) {
    clear();
    items = reviewItems;

    $('resTitle').textContent = title || 'Results';
    $('resSubject').textContent = subject;
    $('resSubject').style.display = subject ? 'block' : 'none';
    $('resSaveWarn').style.display = saveFailed ? 'block' : 'none';
    $('resScore').textContent = `${totals.correct}/${totals.total}`;
    $('resPercentRating').textContent = `${totals.percent}% · ${totals.rating}`;

    const list = $('resCounts');
    for (const s of STATS) {
      const li = el('li', `stat ${s.cls}`);
      li.append(`${s.icon} ${s.label} `);
      li.appendChild(el('span', 'stat-num', String(totals[s.key])));
      list.appendChild(li);
    }

    renderJumpGrid();
    renderFilters();
    renderList();
  }

  $('resHomeBtn').addEventListener('click', onHome);
  $('resTabOverview').addEventListener('click', () => selectTab('overview'));
  $('resTabReview').addEventListener('click', () => selectTab('review'));

  return { show, clear };
}
