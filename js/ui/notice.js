// ui/notice.js — notices at the top of the page for things the learner must know about and can act on (P7-05, P7-07):
// storage is full, saved data is damaged, a screen failed. DOM only; the words and the decisions come from the caller.
// A notice holds text and buttons only: never questions or answers (P3-10), and everything is set with textContent.

const TONE_CLASS = { warn: 'warn-box', error: 'error-box', ok: 'ok-box' };

/**
 * @param {HTMLElement} host  the element the notices are placed in (empty, always in the page)
 * @returns {{
 *   show(id: string, notice: { tone?: 'warn' | 'error' | 'ok', title: string, message: string,
 *     actions?: { label: string, primary?: boolean, danger?: boolean, onClick: () => void }[] }): void,
 *   hide(id: string): void,
 *   has(id: string): boolean,
 * }}
 *   `show` with an id that is already on screen replaces that notice in place (so a repeated failure never stacks copies).
 */
export function createNotices(host) {
  const byId = new Map();

  function hide(id) {
    const el = byId.get(id);
    if (!el) return;
    el.remove();
    byId.delete(id);
  }

  function show(id, { tone = 'warn', title, message, actions = [] }) {
    const el = document.createElement('section');
    el.className = TONE_CLASS[tone] ?? TONE_CLASS.warn;
    el.style.display = 'block';
    el.setAttribute('role', tone === 'ok' ? 'status' : 'alert');
    el.dataset.noticeId = id;

    const heading = document.createElement('div');
    heading.className = 'warn-title';
    heading.textContent = title;
    el.appendChild(heading);

    const body = document.createElement('div');
    body.className = 'notice-message';
    body.textContent = message;
    el.appendChild(body);

    if (actions.length > 0) {
      const row = document.createElement('div');
      row.className = 'notice-actions';
      for (const action of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `btn${action.primary ? ' btn-primary' : ''}${action.danger ? ' btn-danger' : ''}`;
        button.textContent = action.label;
        button.addEventListener('click', () => action.onClick());
        row.appendChild(button);
      }
      el.appendChild(row);
    }

    const old = byId.get(id);
    if (old) old.replaceWith(el); else host.appendChild(el);
    byId.set(id, el);
  }

  return { show, hide, has: (id) => byId.has(id) };
}
