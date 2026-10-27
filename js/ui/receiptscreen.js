// ui/receiptscreen.js — the Export receipt screen (P4-09 toggles, P4-10 copy / download / size). DOM only.
// It is given a `build(options)` function by main.js and shows whatever it returns; the receipt itself is made by
// receipt.js. The preview is set with textContent (pack text is untrusted).
//
// The receipt holds answers and explanations, so `clear()` empties this screen whenever the app leaves it, exactly as
// the Results screen does (AGENTS.md "No answers in the DOM during the exam"; P3-10).
import { DEFAULT_RECEIPT_OPTIONS, formatTokenEstimate, receiptFileStem } from '../receipt.js';

const $ = (id) => document.getElementById(id);

// toggle key (receipt.js options) -> checkbox id
const TOGGLES = {
  missed: 'rcOptMissed',
  history: 'rcOptHistory',
  concepts: 'rcOptConcepts',
  formatSpec: 'rcOptFormat',
};

/**
 * @param {{ onBack: () => void, onNextPrompt?: () => void }} options
 * @returns {{
 *   show: (info: { title: string, build: (options: object) => { markdown: string, json: string, receiptId: string } }) => void,
 *   clear: () => void,
 * }}
 */
export function initReceiptScreen({ onBack, onNextPrompt = () => {} }) {
  let build = null;
  let latest = null;   // the receipt currently in the preview: what Copy and Download use

  const currentOptions = () => Object.fromEntries(Object.entries(TOGGLES).map(([key, id]) => [key, $(id).checked]));

  function render() {
    if (!build) return;
    latest = build(currentOptions());
    $('rcPreview').textContent = latest.markdown;
    $('rcSize').textContent = `${formatTokenEstimate(latest.markdown)} · ${latest.markdown.length.toLocaleString('en-US')} characters`;
    $('rcMsg').textContent = '';
  }

  // ---- copy / download -----------------------------------------------------------------------
  function say(text) {
    $('rcMsg').textContent = text;
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      say(ok ? 'Copied to clipboard.' : 'Could not copy automatically — select the text in the preview and copy it.');
    } catch {
      say('Could not copy automatically — select the text in the preview and copy it.');
    }
  }

  function copy() {
    if (!latest) return;
    const text = latest.markdown;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => say('Copied to clipboard.')).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function download(extension, mime, text) {
    if (!latest) return;
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${receiptFileStem(latest.receiptId)}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    say(`Downloaded ${a.download}.`);
  }

  // ---- public --------------------------------------------------------------------------------
  function clear() {
    build = null;
    latest = null;
    for (const id of ['rcSubtitle', 'rcPreview', 'rcSize', 'rcMsg']) $(id).textContent = '';
  }

  function show({ title, build: builder }) {
    clear();
    build = builder;
    for (const [key, id] of Object.entries(TOGGLES)) $(id).checked = DEFAULT_RECEIPT_OPTIONS[key];
    $('rcSubtitle').textContent = title || 'Your graded exam';
    render();
  }

  for (const id of Object.values(TOGGLES)) $(id).addEventListener('change', render);
  $('rcCopyBtn').addEventListener('click', copy);
  $('rcDownloadMdBtn').addEventListener('click', () => latest && download('md', 'text/markdown', latest.markdown));
  $('rcDownloadJsonBtn').addEventListener('click', () => latest && download('json', 'application/json', latest.json));
  $('rcBackBtn').addEventListener('click', onBack);
  $('rcNextPromptBtn').addEventListener('click', onNextPrompt);   // P5-09

  return { show, clear };
}
