// ui/loadpack.js — the Load screen: paste, file picker, drag-and-drop (P2-01).
// DOM only. All decisions (pack vs legacy vs error, parsing, validation) come from loader.js.
//
// What happens to the result is decided by the caller: a loadable pack goes to the Topics preview (P2-07),
// a pack with errors goes to the error screen (P2-06), legacy text goes to Quick Paste. Text that is not a
// pack at all (empty, unrecognized, invalid JSON) stays on this screen as a short message with a position.
import { loadInput } from '../loader.js';
import { ACCEPTED_FILE_EXTENSIONS } from '../constants.js';

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
 *   startLegacy: (parsed: object[]) => void,                     route to Quick Paste (answers only)
 *   onPack: (result: object, note?: string) => void,             a loadable pack (errors: none); warnings may be present
 *   onPackProblems: (result: object, note?: string) => void,     a pack that failed validation (result.errors is not empty)
 *   isLoadScreenActive: () => boolean,                           drops are ignored on other screens
 * }} options
 */
export function initLoadScreen({ startLegacy, onPack, onPackProblems, isLoadScreenActive }) {
  // ---- messages --------------------------------------------------------------
  function clearMessages() {
    const box = $('parseError');
    box.textContent = '';
    box.style.display = 'none';
  }

  /** Short message on the Load screen. @param {string} message  @param {string} [note] */
  function showError(message, note = '') {
    const box = $('parseError');
    box.textContent = '';
    for (const line of [message, note]) {
      if (!line) continue;
      const div = document.createElement('div');
      div.textContent = line;               // pack content is untrusted: textContent only
      box.appendChild(div);
    }
    box.style.display = 'block';
  }

  // ---- the one place text enters the app -----------------------------------------
  /** @param {string} raw  pasted text or file contents  @param {{ fromFile?: boolean, note?: string }} [options] */
  function handleText(raw, { fromFile = false, note = '' } = {}) {
    clearMessages();
    const result = loadInput(raw);

    if (result.kind === 'legacy') {
      startLegacy(result.questions);         // today's behaviour: Quick Paste (answers only)
      return;
    }

    if (result.kind === 'error') {
      showError(result.error.message, note);
      return;
    }

    // kind === 'pack'. Keep the pasted text when it has problems so it can be fixed and loaded again.
    if (!result.ok) {
      onPackProblems(result, note);
      return;
    }

    // Don't leave the whole pack (answers included) sitting in the paste box.
    if (!fromFile) $('rawInput').value = '';
    onPack(result, note);
  }

  // ---- file picker + drag-and-drop ---------------------------------------------------
  async function handleFile(file, { note = '' } = {}) {
    clearMessages();
    if (!file) return;
    if (!isAcceptedFile(file)) {
      showError(`"${file.name}" isn't a supported file. Choose a ${ACCEPTED_FILE_EXTENSIONS.join(', ')} file.`, note);
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch {
      showError(`Couldn't read "${file.name}". Try again, or paste its contents instead.`, note);
      return;
    }
    handleText(text, { fromFile: true, note });
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
    const note = files.length > 1 ? `Only the first file (${files[0].name}) was loaded. Load one file at a time.` : '';
    handleFile(files[0], { note });
  });

  // ---- wiring ---------------------------------------------------------------------
  $('loadBtn').addEventListener('click', () => handleText($('rawInput').value));
  $('fileBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';               // lets the same file be chosen again
    handleFile(file);
  });
}
