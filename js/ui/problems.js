// ui/problems.js — the friendly error screen (P2-06): a pack that parsed but failed validation,
// with every problem listed under its question number. DOM only; grouping comes from validator.js.
import { groupIssues } from '../validator.js';
import { renderIssueGroups } from './issuelist.js';

const $ = (id) => document.getElementById(id);

/**
 * @param {{ onBack: () => void }} options
 * @returns {{ show: (result: { errors: object[] }, note?: string) => void, clear: () => void }}
 */
export function initProblems({ onBack }) {
  $('problemsBackBtn').addEventListener('click', onBack);

  function clear() {
    $('problemsSummary').textContent = '';
    $('problemsNote').textContent = '';
    $('problemsNote').style.display = 'none';
    $('problemsList').textContent = '';
  }

  function show(result, note = '') {
    clear();
    const n = result.errors.length;
    $('problemsSummary').textContent =
      `${n} problem${n === 1 ? '' : 's'} found, so nothing was loaded. ` +
      'Each one is listed under the question it belongs to.';
    if (note) {
      $('problemsNote').textContent = note;
      $('problemsNote').style.display = 'block';
    }
    renderIssueGroups($('problemsList'), groupIssues(result.errors));
  }

  return { show, clear };
}
