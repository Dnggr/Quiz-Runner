// ui/results.js — Results screen, Overview tab (P3-06): score x/N, percentage, rating and the four counts.
// DOM only; the numbers come from grader.js. Counts carry an icon AND a word, never colour alone.
const $ = (id) => document.getElementById(id);

const STATS = [
  { key: 'correct', icon: '✓', label: 'Correct', cls: 'stat-correct' },
  { key: 'wrong', icon: '✗', label: 'Wrong', cls: 'stat-wrong' },
  { key: 'skipped', icon: '–', label: 'Skipped', cls: 'stat-skipped' },
  { key: 'unsure', icon: '?', label: 'Marked not sure', cls: 'stat-unsure' },
];

/**
 * @param {{ onHome: () => void }} options
 * @returns {{ show: (totals: object, info: { title: string, subject?: string }) => void }}
 */
export function initResults({ onHome }) {
  $('resHomeBtn').addEventListener('click', onHome);

  /** @param {import('../grader.js').Totals} totals */
  function show(totals, { title, subject = '' }) {
    $('resTitle').textContent = title || 'Results';
    $('resSubject').textContent = subject;
    $('resSubject').style.display = subject ? 'block' : 'none';
    $('resScore').textContent = `${totals.correct}/${totals.total}`;
    $('resPercentRating').textContent = `${totals.percent}% · ${totals.rating}`;

    const list = $('resCounts');
    list.textContent = '';
    for (const s of STATS) {
      const li = document.createElement('li');
      li.className = `stat ${s.cls}`;
      li.append(`${s.icon} ${s.label} `);
      const num = document.createElement('span');
      num.className = 'stat-num';
      num.textContent = String(totals[s.key]);
      li.appendChild(num);
      list.appendChild(li);
    }
  }

  return { show };
}
