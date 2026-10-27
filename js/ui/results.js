// ui/results.js — Results screen (P3-06 Overview, P3-07 Review, P3-08 outcome jump grid, P4-07 Topics and Next steps,
// P6-02 read-only view of an old exam). DOM only.
// Numbers come from grader.js, review items from review.js, topic analysis from analytics.js. Everything is built with
// textContent (pack text is untrusted) and carries an icon AND a word, never colour alone.
//
// This screen is the only place answers and explanations are shown. It is empty until the exam is finished,
// and `clear()` empties it again whenever the app leaves it, so a later exam never has them in the DOM (P3-10).
import { REVIEW_FILTERS, DEFAULT_REVIEW_FILTER, filterReviewItems, reviewCounts } from '../review.js';
import { sortTopicsForDisplay } from '../analytics.js';

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

// Topic status (RECEIPT_SPEC §3): a glyph AND a word on every chip.
export const TOPIC_STATUS = {
  weak: { icon: '▼', label: 'Weak' },
  developing: { icon: '◐', label: 'Developing' },
  watch: { icon: '◉', label: 'Watch' },
  strong: { icon: '▲', label: 'Strong' },
  insufficient: { icon: '·', label: 'Not enough data' },
};
const TABS = ['overview', 'topics', 'review', 'next'];
const TAB_IDS = { overview: 'resTabOverview', topics: 'resTabTopics', review: 'resTabReview', next: 'resTabNext' };
const PANEL_IDS = { overview: 'resPanelOverview', topics: 'resPanelTopics', review: 'resPanelReview', next: 'resPanelNext' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const percentText = (fraction) => `${Math.round(fraction * 100)}%`;
const mixText = (m) => `${percentText(m.easy)} easy / ${percentText(m.moderate)} moderate / ${percentText(m.challenging)} challenging`;

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
 * @param {{ onHome: () => void, onReceipt: () => void, onNextPrompt?: () => void, onBackToProgress?: () => void }} options
 * @returns {{
 *   show: (totals: object, info: { title: string, subject?: string, items: object[], analysis?: object, saveFailed?: boolean,
 *     readOnly?: boolean, note?: string }) => void,
 *   clear: () => void,
 * }}
 */
export function initResults({ onHome, onReceipt, onNextPrompt = () => {}, onBackToProgress = () => {} }) {
  let items = [];
  let filter = DEFAULT_REVIEW_FILTER;
  // P6-02: an old exam opened from Progress. Export receipt and Next quiz prompt act on the exam just finished (the
  // session in memory), so they are hidden here: they would act on the wrong exam.
  let readOnly = false;

  // ---- tabs ----------------------------------------------------------------------
  function selectTab(name) {
    const chosen = TABS.includes(name) ? name : 'overview';
    for (const tab of TABS) {
      $(TAB_IDS[tab]).setAttribute('aria-selected', String(tab === chosen));
      $(PANEL_IDS[tab]).hidden = tab !== chosen;
    }
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

  // ---- topics: bar + status chip per topic (P4-07) ---------------------------------------------------------
  function renderTopics(analysis) {
    const list = $('resTopicList');
    list.textContent = '';
    const topics = analysis ? sortTopicsForDisplay(analysis.topics) : [];
    if (topics.length === 0) {
      list.appendChild(el('div', 'review-empty', 'No topic data for this exam.'));
      return;
    }
    for (const t of topics) {
      const st = TOPIC_STATUS[t.status] || TOPIC_STATUS.insufficient;
      const row = el('article', `topic-row topic-${t.status}`);
      const head = el('div', 'topic-head');
      head.append(el('span', 'topic-name', t.name), el('span', `status-chip status-${t.status}`, `${st.icon} ${st.label}`));
      const track = el('div', 'bar-track');
      track.setAttribute('aria-hidden', 'true');
      const fill = el('div', 'bar-fill');
      fill.style.width = `${Math.round(t.accuracy * 100)}%`;
      track.appendChild(fill);
      const bits = [`${percentText(t.accuracy)} correct`, `${t.correct} of ${t.total}`];
      if (t.misses > 0) bits.push(`${t.misses} missed`);
      if (t.unsure > 0) bits.push(`${t.unsure} marked not sure`);
      row.append(head, track, el('div', 'topic-meta', bits.join(' · ')));
      list.appendChild(row);
    }
  }

  // ---- next steps: what to study, what to take next (P4-07) -------------------------------------------------
  function section(parent, heading) {
    parent.appendChild(el('h2', null, heading));
    const ul = el('ul', 'step-list');
    parent.appendChild(ul);
    return ul;
  }

  function renderNextSteps(analysis) {   // uses `readOnly`
    const root = $('resNextSteps');
    root.textContent = '';
    if (!analysis) return;
    const nameOf = new Map(analysis.topics.map((t) => [t.id, t.name]));

    const study = section(root, 'What to study');
    if (analysis.gaps.length + analysis.misconceptions.length === 0) {
      study.appendChild(el('li', null, 'No missed questions in this exam.'));
    } else {
      study.appendChild(el('li', null, `${plural(analysis.misconceptions.length, 'misconception', 'misconceptions')}: answered confidently but wrong. Fix these first.`));
      study.appendChild(el('li', null, `${plural(analysis.gaps.length, 'gap', 'gaps')}: skipped, or wrong and marked not sure. These are things you knew you did not know.`));
    }
    if (analysis.weaknesses.length > 0) {
      for (const t of analysis.weaknesses) {
        const li = el('li', 'step-weak');
        li.append(el('strong', null, `▼ ${t.name}`), ` — ${plural(t.misses, 'miss', 'misses')}, ${percentText(t.accuracy)} correct. Study this first.`);
        study.appendChild(li);
      }
    } else {
      study.appendChild(el('li', null, 'No weak topics. One missed question is not a pattern yet.'));
    }
    for (const t of analysis.watch) {
      const st = TOPIC_STATUS[t.status];
      const li = el('li');
      li.append(el('strong', null, `${st.icon} ${t.name}`), ` — ${st.label.toLowerCase()}: ${t.misses > 0 ? `${plural(t.misses, 'miss', 'misses')}, ` : ''}${percentText(t.accuracy)} correct. Keep an eye on it.`);
      study.appendChild(li);
    }
    if (analysis.shaky.length > 0) {
      const shaky = analysis.shaky.map((o) => `Q${o.number} (${nameOf.get(o.topic) || o.topic})`).join(', ');
      study.appendChild(el('li', null, `Correct but not sure (could be lucky guesses): ${shaky}.`));
    }
    if (analysis.strengths.length > 0) {
      study.appendChild(el('li', null, `Strong: ${analysis.strengths.map((t) => t.name).join(', ')}. Light review is enough.`));
    }

    const next = analysis.nextExam;
    const take = section(root, 'What to take next');
    take.appendChild(el('li', null, `A follow-up exam of ${next.recommended_total} new questions.`));
    for (const a of next.allocations) {
      const li = el('li');
      li.append(el('strong', null, `${a.name} × ${a.count}`), ` — ${a.reason}; ${mixText(a.difficulty_mix)}`);
      take.appendChild(li);
    }
    if (!readOnly) root.appendChild(el('div', 'note', 'Export the receipt and paste it into an AI chat with your course files attached. It carries these numbers and the format for the next quiz.'));
  }

  // ---- public ----------------------------------------------------------------------------
  function clear() {
    items = [];
    filter = DEFAULT_REVIEW_FILTER;
    for (const id of ['resTitle', 'resSubject', 'resScore', 'resPercentRating', 'resCounts', 'resJumpGrid', 'resFilters', 'resReviewList', 'resTopicList', 'resNextSteps']) {
      $(id).textContent = '';
    }
    $('resSaveWarn').style.display = 'none';
    readOnly = false;
    $('resReadOnly').textContent = '';
    $('resReadOnly').hidden = true;
    $('resReceiptBtn').hidden = false;
    $('resNextPromptBtn').hidden = false;
    $('resHomeBtn').textContent = 'Back to start';
    selectTab('overview');
  }

  /** @param {import('../grader.js').Totals} totals */
  function show(totals, { title, subject = '', items: reviewItems = [], analysis = null, saveFailed = false, readOnly: isReadOnly = false, note = '' }) {
    clear();
    items = reviewItems;
    readOnly = isReadOnly;
    $('resReadOnly').textContent = note;
    $('resReadOnly').hidden = !(readOnly && note !== '');
    $('resReceiptBtn').hidden = readOnly;
    $('resNextPromptBtn').hidden = readOnly;
    $('resHomeBtn').textContent = readOnly ? 'Back to progress' : 'Back to start';

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
    renderTopics(analysis);
    renderNextSteps(analysis);
  }

  $('resHomeBtn').addEventListener('click', () => (readOnly ? onBackToProgress() : onHome()));
  $('resReceiptBtn').addEventListener('click', onReceipt);
  $('resNextPromptBtn').addEventListener('click', onNextPrompt);   // P5-09
  for (const tab of TABS) $(TAB_IDS[tab]).addEventListener('click', () => selectTab(tab));

  return { show, clear };
}
