// ui/loadpack.js — the Load screen: paste, file picker, drag-and-drop (P2-01).
// DOM only. All decisions (pack vs legacy vs error, parsing, validation) come from loader.js.
//
// INTERIM: pack results are shown as a short status box and kept in memory. The friendly error
// screen (P2-06), Topics preview (P2-07) and the exam on a pack (Phase 3) replace that later.
import { loadInput } from '../loader.js';
import { ACCEPTED_FILE_EXTENSIONS, LOAD_STATUS_MAX_LISTED } from '../constants.js';

const $ = (id) => document.getElementById(id);

const ACCEPTED_MIME = ['application/json', 'text/plain', 'text/markdown', 'text/x-markdown'];

/** True for a file we can read: right extension, or (mobile browsers often omit it) a text-like MIME type. */
export function isAcceptedFile(file) {
  const name = String((file && file.name) || '').toLowerCase();
  if (ACCEPTED_FILE_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  return !name.includes('.') && ACCEPTED_MIME.includes(file && file.type);
}

/**
 * @param {{
 *   startLegacy: (parsed: object[]) => void,     route to Quick Paste (answers only)
 *   isLoadScreenActive: () => boolean,           drops are ignored on other screens
 * }} options
 * @returns {{ getLoadedPack: () => object | null }}
 */
export function initLoadScreen({ startLegacy, isLoadScreenActive }) {
  let loadedPack = null;   // validated + normalized pack, in memory only (saved to storage in P3-09)

  // ---- messages --------------------------------------------------------------
  function clearMessages() {
    for (const id of ['parseError', 'loadStatus']) {
      const box = $(id);
      box.textContent = '';
      box.style.display = 'none';
    }
  }

  /** @param {'parseError'|'loadStatus'} id  @param {string} heading  @param {{message: string}[]} items */
  function showBox(id, heading, items = []) {
    const box = $(id);
    box.textContent = '';
    const title = document.createElement('div');
    title.textContent = heading;            // pack content is untrusted: textContent only
    box.appendChild(title);
    appendList(box, items);
    box.style.display = 'block';
    return box;
  }

  function appendList(parent, items) {
    if (items.length === 0) return;
    const ul = document.createElement('ul');
    for (const item of items.slice(0, LOAD_STATUS_MAX_LISTED)) {
      const li = document.createElement('li');
      li.textContent = item.message;
      ul.appendChild(li);
    }
    if (items.length > LOAD_STATUS_MAX_LISTED) {
      const li = document.createElement('li');
      li.textContent = `…and ${items.length - LOAD_STATUS_MAX_LISTED} more.`;
      ul.appendChild(li);
    }
    parent.appendChild(ul);
  }

  // ---- the one place text enters the app -----------------------------------------
  /** @param {string} raw  pasted text or file contents */
  function handleText(raw, { fromFile = false } = {}) {
    clearMessages();
    const result = loadInput(raw);

    if (result.kind === 'legacy') {
      loadedPack = null;
      startLegacy(result.questions);         // today's behaviour: Quick Paste (answers only)
      return;
    }

    if (result.kind === 'error') {
      loadedPack = null;
      showBox('parseError', result.error.message);
      return;
    }

    // kind === 'pack'
    if (!result.ok) {
      loadedPack = null;
      const n = result.errors.length;
      showBox('parseError', `This Quiz Pack can't be loaded: ${n} problem${n === 1 ? '' : 's'} found.`, result.errors);
      return;
    }

    loadedPack = result.pack;
    const meta = result.pack.meta || {};
    const count = result.pack.questions.length;
    const topics = Array.isArray(meta.topics) ? meta.topics.length : 0;
    const summary =
      `Quiz Pack loaded${meta.title ? `: ${meta.title}` : ''} — ${count} question${count === 1 ? '' : 's'}, ` +
      `${topics} topic${topics === 1 ? '' : 's'}.` +
      (result.repaired ? ' (Trailing commas were fixed automatically.)' : '');
    const box = showBox('loadStatus', summary);
    if (result.warnings.length > 0) {
      const w = document.createElement('div');
      w.className = 'warn-title';
      w.textContent = `${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'} (the pack still loads):`;
      box.appendChild(w);
      appendList(box, result.warnings);
    }
    // Don't leave the whole pack (answers included) sitting in the paste box.
    if (!fromFile) $('rawInput').value = '';
  }

  // ---- file picker + drag-and-drop ---------------------------------------------------
  async function handleFile(file) {
    clearMessages();
    if (!file) return;
    if (!isAcceptedFile(file)) {
      showBox('parseError', `"${file.name}" isn't a supported file. Choose a ${ACCEPTED_FILE_EXTENSIONS.join(', ')} file.`);
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch {
      showBox('parseError', `Couldn't read "${file.name}". Try again, or paste its contents instead.`);
      return;
    }
    handleText(text, { fromFile: true });
  }

  function hasFiles(event) {
    const types = event.dataTransfer && event.dataTransfer.types;
    return !!types && Array.from(types).includes('Files');
  }

  let dragDepth = 0;   // dragenter/dragleave also fire for child elements
  const setDragging = (on) => $('screen-input').classList.toggle('drag-over', on);

  // Listen on the window so a file dropped slightly off target never makes the browser navigate away from the app.
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    if (isLoadScreenActive()) setDragging(true);
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDragging(false);
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;          // dropped text still goes into the paste box as usual
    e.preventDefault();
    dragDepth = 0;
    setDragging(false);
    if (!isLoadScreenActive()) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 1) {
      handleFile(files[0]).then(() => {
        const box = $('parseError').style.display === 'block' ? $('parseError') : $('loadStatus');
        const note = document.createElement('div');
        note.textContent = `Only the first file (${files[0].name}) was loaded. Load one file at a time.`;
        box.appendChild(note);
        box.style.display = 'block';
      });
    } else {
      handleFile(files[0]);
    }
  });

  // ---- wiring ---------------------------------------------------------------------
  $('loadBtn').addEventListener('click', () => handleText($('rawInput').value));
  $('fileBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';               // lets the same file be chosen again
    handleFile(file);
  });

  return { getLoadedPack: () => loadedPack };
}
