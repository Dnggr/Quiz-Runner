// ui/progress.js — the Progress screen (P6-01 exam list, P6-02 Open, P6-03 topic mastery, P6-04 priority topics,
// P6-05 compare with the previous exam, P6-06 trend chart). DOM only.
// Every number and rule comes from progress.js / analytics.js. Titles and topic names come from packs, so they are
// untrusted: everything is written with textContent, and status is always an icon AND a word, never colour alone.
// This screen never shows answers; opening an exam goes to the read-only Results screen.
import { trendChart } from '../progress.js';
import { PRIORITY_MIN_EXAMS } from '../constants.js';
import { TOPIC_STATUS } from './results.js';

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const points = (n) => plural(Math.abs(n), 'point', 'points');
const percentText = (fraction) => `${Math.round(fraction * 100)}%`;
const statusOf = (status) => TOPIC_STATUS[status] || TOPIC_STATUS.insufficient;
const HISTORY_SHOWN = 6;   // how many past statuses one topic row spells out

/** `▲ up 5.1 points`, `▼ down 2 points`, `＝ no change`: a glyph and a word for a signed change. */
function changeText(delta) {
  if (delta > 0) return `▲ up ${points(delta)}`;
  if (delta < 0) return `▼ down ${points(delta)}`;
  return '＝ no change';
}

/**
 * @param {{
 *   onOpen: (examId: string) => void,       open an old exam read-only
 *   onCompare: (examId: string) => void,    compare (and chart) this exam: the screen is shown again with it chosen
 *   onBack: () => void,
 * }} options
 * @returns {{ show: (model: ReturnType<typeof import('../progress.js').buildProgress>) => void }}
 */
export function initProgress({ onOpen, onCompare, onBack }) {
  // ---- P6-01 / P6-02: the list ------------------------------------------------------------------------------
  function renderExams(model) {
    const list = $('pgExams');
    list.textContent = '';
    model.exams.forEach((exam, i) => {
      const chosen = exam.id === model.compareId;
      const row = el('article', `exam-row${chosen ? ' exam-chosen' : ''}`);

      const head = el('div', 'exam-head');
      head.append(el('span', 'exam-title', exam.title || 'Untitled quiz'), el('span', 'exam-score', `${exam.correct}/${exam.total} · ${exam.percent}%`));
      const meta = [exam.date, exam.rating, exam.subject].filter(Boolean).join(' · ');
      row.append(head, el('div', 'exam-meta', meta));

      const buttons = el('div', 'row exam-actions');
      const open = el('button', 'btn', 'Open');
      open.type = 'button';
      open.disabled = !exam.canOpen;
      open.setAttribute('aria-label', `Open ${exam.title || 'untitled quiz'}, read only`);
      open.addEventListener('click', () => onOpen(exam.id));
      const compare = el('button', 'btn', chosen ? '✓ Comparing' : 'Compare');
      compare.type = 'button';
      compare.setAttribute('aria-pressed', String(chosen));
      compare.setAttribute('aria-label', `Compare ${exam.title || 'untitled quiz'} with the previous exam`);
      compare.addEventListener('click', () => {
        onCompare(exam.id);
        $('pgCompareTitle').scrollIntoView?.({ block: 'start' });
        $('pgCompare').focus({ preventScroll: true });
      });
      buttons.append(open, compare);
      row.appendChild(buttons);

      if (!exam.canOpen) {
        const why = el('div', 'exam-reason', exam.reason);
        why.id = `pg-reason-${i}`;
        open.setAttribute('aria-describedby', why.id);
        row.appendChild(why);
      }
      list.appendChild(row);
    });
  }

  // ---- P6-05: compare with the previous exam ----------------------------------------------------------------
  function renderCompare(model) {
    const box = $('pgCompare');
    box.textContent = '';
    const c = model.compare;
    if (!c) return;
    const ul = el('ul', 'step-list');
    const item = (text, className) => ul.appendChild(el('li', className, text));

    const first = el('li');
    first.append(el('strong', null, c.title || 'Untitled quiz'), ` — ${c.percent}% · ${c.rating}`);
    ul.appendChild(first);

    if (c.previous && c.scoreDelta !== null) {
      const when = c.previous.date ? `, ${c.previous.date}` : '';
      item(`Score: ${changeText(c.scoreDelta)} since “${c.previous.title || 'untitled quiz'}” (${c.previous.percent}%${when}).`);
    } else {
      item(`Score: no earlier exam in ${c.subject ? `“${c.subject}”` : 'this subject'} to compare with.`);
    }
    item(c.improved.length > 0 ? `▲ Improved: ${c.improved.join(', ')}.` : 'No topics have improved yet.');
    item(c.stillWeak.length > 0 ? `▼ Still weak: ${c.stillWeak.join(', ')}.` : 'No weak topics.', c.stillWeak.length > 0 ? 'step-weak' : undefined);
    box.appendChild(ul);
  }

  // ---- P6-06: trend chart (inline SVG, no library) ----------------------------------------------------------------
  function renderTrend(model) {
    const box = $('pgTrend');
    box.textContent = '';
    const trend = model.trend;
    if (!trend) return;
    const subject = trend.subject ? `“${trend.subject}”` : 'this subject';
    if (trend.points.length < 2) {
      box.appendChild(el('div', 'review-empty', `A trend needs at least two exams in ${subject}. Take another one and it will appear here.`));
      return;
    }
    const chart = trendChart(trend.points, model.compareId);
    const root = svg('svg', {
      viewBox: `0 0 ${chart.width} ${chart.height}`, class: 'trend-chart', role: 'img',
      'aria-label': `Score trend for ${subject}, oldest to newest: ${trend.points.map((p) => `${p.percent}%`).join(', ')}.`,
    });
    for (const g of chart.grid) {
      root.append(
        svg('line', { x1: chart.plot.left, x2: chart.plot.right, y1: g.y, y2: g.y, class: 'trend-grid' }),
        svg('text', { x: chart.plot.left - 6, y: g.y + 3, 'text-anchor': 'end' }, String(g.value)),
      );
    }
    root.appendChild(svg('path', { d: chart.path, class: 'trend-line' }));
    for (const p of chart.points) {
      root.appendChild(svg('circle', { cx: p.x, cy: p.y, r: p.selected ? 6 : 4, class: p.selected ? 'trend-dot trend-dot-selected' : 'trend-dot' }));
      if (p.labelled) {
        const anchor = p.x < chart.plot.left + 14 ? 'start' : p.x > chart.plot.right - 14 ? 'end' : 'middle';
        root.appendChild(svg('text', { x: p.x, y: Math.max(10, p.y - 9), 'text-anchor': anchor, class: 'trend-value' }, `${p.percent}%`));
      }
    }
    if (chart.firstDate) root.appendChild(svg('text', { x: chart.plot.left, y: chart.height - 8, 'text-anchor': 'start' }, chart.firstDate));
    if (chart.lastDate) root.appendChild(svg('text', { x: chart.plot.right, y: chart.height - 8, 'text-anchor': 'end' }, chart.lastDate));
    box.appendChild(root);
    box.appendChild(el('div', 'note', `Exams in ${subject}, oldest to newest. The larger dot is the exam being compared. Lines mark the rating bands.`));
  }

  // ---- P6-04: priority topics ---------------------------------------------------------------------------------
  function renderPriority(model) {
    const box = $('pgPriority');
    box.textContent = '';
    if (model.priority.length === 0) {
      box.appendChild(el('div', 'review-empty', `No priority topics yet. A topic becomes a priority when it is weak in ${PRIORITY_MIN_EXAMS} different exams.`));
      return;
    }
    const ul = el('ul', 'step-list');
    for (const p of model.priority) {
      const li = el('li', 'step-weak');
      li.append(el('strong', null, `★ ${p.name}`), ` — weak in ${plural(p.exams, 'exam', 'exams')}. Study this first.`);
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }

  // ---- P6-03: topic mastery across exams ----------------------------------------------------------------------
  function renderMastery(model) {
    const box = $('pgMastery');
    box.textContent = '';
    if (model.mastery.length === 0) {
      box.appendChild(el('div', 'review-empty', 'No topic data yet. Topics come from the question packs, so an exam whose pack is no longer stored adds none.'));
      return;
    }
    for (const t of model.mastery) {
      const st = statusOf(t.status);
      const row = el('article', `topic-row topic-${t.status}`);
      const head = el('div', 'topic-head');
      head.append(el('span', 'topic-name', t.name), el('span', `status-chip status-${t.status}`, `${st.icon} ${st.label}`));
      const track = el('div', 'bar-track');
      track.setAttribute('aria-hidden', 'true');
      const fill = el('div', 'bar-fill');
      fill.style.width = `${Math.round(t.accuracy * 100)}%`;
      track.appendChild(fill);

      const bits = [`${percentText(t.accuracy)} correct in the latest exam`, `seen in ${plural(t.exams, 'exam', 'exams')}`];
      if (t.change !== null) bits.push(`${changeText(t.change)} since the exam before`);
      if (t.priority) bits.push('★ priority');
      row.append(head, track, el('div', 'topic-meta', bits.join(' · ')));

      if (t.history.length >= 2) {
        const shown = t.history.slice(-HISTORY_SHOWN).map((h) => statusOf(h.status).label);
        row.appendChild(el('div', 'topic-meta', `History: ${t.history.length > HISTORY_SHOWN ? '… → ' : ''}${shown.join(' → ')}`));
      }
      box.appendChild(row);
    }
  }

  // ---- public -----------------------------------------------------------------------------------------------
  function show(model) {
    $('pgCorrupt').style.display = model.corrupt ? 'block' : 'none';
    const empty = !model.corrupt && model.exams.length === 0;
    $('pgEmpty').hidden = !empty;
    $('pgBody').hidden = model.corrupt || empty;
    if (model.corrupt || empty) return;
    renderExams(model);
    renderCompare(model);
    renderTrend(model);
    renderPriority(model);
    renderMastery(model);
  }

  $('pgBackBtn').addEventListener('click', onBack);
  return { show };
}
