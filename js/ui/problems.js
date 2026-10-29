// ui/problems.js — the friendly error screen (P2-06): a pack that parsed but failed validation,
// with every problem listed under its question number. DOM only; grouping comes from validator.js.
import { groupIssues } from '../validator.js';
import { renderIssueGroups } from './issuelist.js';
import { buildRepairPrompt } from '../promptBuilder.js';
import { copyText } from './clipboard.js';

const $ = (id) => document.getElementById(id);

/**
 * @param {{ onBack: () => void }} options
 * @returns {{ show: (result: { errors: object[] }, note?: string) => void, clear: () => void }}
 */
export function initProblems({ onBack }) {
  $('problemsBackBtn').addEventListener('click', onBack);
  $('repairCopyBtn').addEventListener('click', () => {
    const text = $('repairPrompt').value;
    if (!text) return;
    copyText(text).then((ok) => {
      $('repairMsg').textContent = ok ? 'Copied to clipboard.' : 'Could not copy automatically. Open \u201cShow the prompt\u201d and copy the text.';
    });
  });

  function clear() {
    $('problemsSummary').textContent = '';
    $('problemsNote').textContent = '';
    $('problemsNote').style.display = 'none';
    $('problemsList').textContent = '';
    // The repair prompt quotes the pack's own answers in its problem lines: it must not outlive this screen (P3-10).
    $('repairPrompt').value = '';
    $('repairMsg').textContent = '';
    $('repairBox').hidden = true;
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

    // P7-03: the Repair prompt, built from the same error list.
    const repair = buildRepairPrompt(result.errors);
    if (repair.ok) {
      $('repairPrompt').value = repair.prompt;
      $('repairBox').hidden = false;
    }
  }

  return { show, clear };
}
