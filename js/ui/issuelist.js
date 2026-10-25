// ui/issuelist.js — shared by the error screen (P2-06) and the preview warnings (P2-08): draws
// `groupIssues()` output. DOM only. Pack content is untrusted, so text goes in via textContent.
import { ISSUE_GROUPS_MAX_LISTED } from '../constants.js';

/**
 * @param {HTMLElement} parent
 * @param {ReturnType<typeof import('../validator.js').groupIssues>} grouped
 * @param {{ packLabel?: string, showPack?: boolean }} [options]
 *   `showPack: false` skips the pack-level group (the preview shows those separately).
 */
export function renderIssueGroups(parent, grouped, { packLabel = 'The pack as a whole', showPack = true } = {}) {
  if (showPack && grouped.pack.length > 0) parent.appendChild(group(packLabel, grouped.pack));

  for (const g of grouped.questions.slice(0, ISSUE_GROUPS_MAX_LISTED)) {
    parent.appendChild(group(g.label, g.issues));
  }
  const hidden = grouped.questions.length - ISSUE_GROUPS_MAX_LISTED;
  if (hidden > 0) {
    const more = document.createElement('div');
    more.className = 'issue-more';
    more.textContent = `…and ${hidden} more question${hidden === 1 ? '' : 's'} with problems. Fix the ones above first, then load the pack again.`;
    parent.appendChild(more);
  }
}

function group(label, issues) {
  const box = document.createElement('section');
  box.className = 'issue-group';
  const heading = document.createElement('h3');
  heading.className = 'issue-label';
  heading.textContent = label;
  box.appendChild(heading);
  const ul = document.createElement('ul');
  for (const issue of issues) {
    const li = document.createElement('li');
    li.textContent = issue.message;
    ul.appendChild(li);
  }
  box.appendChild(ul);
  return box;
}
