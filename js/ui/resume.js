// ui/resume.js — "Resume your exam" banner on the Load screen (P3-03). DOM only; shows counts, never answers.
const $ = (id) => document.getElementById(id);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * @param {{ onResume: () => void, onDiscard: () => void }} options
 * @returns {{ show: (info: object | null) => void }}   info = describeSession(...) of an unfinished exam, or null to hide
 */
export function initResume({ onResume, onDiscard }) {
  $('resumeBtn').addEventListener('click', onResume);
  $('resumeDiscardBtn').addEventListener('click', onDiscard);

  function show(info) {
    const banner = $('resumeBanner');
    if (!info) {
      banner.hidden = true;
      return;
    }
    $('resumeTitle').textContent = `Exam in progress: ${info.title || 'Untitled Quiz Pack'}`;   // textContent: pack text is untrusted
    $('resumeDetail').textContent =
      `Question ${info.position} of ${info.total} · ${info.answered} answered · ${plural(info.unsure, 'question')} marked not sure`;
    banner.hidden = false;
  }

  return { show };
}
