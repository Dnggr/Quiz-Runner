// loader.js — turns pasted/uploaded text into questions.
// Phase 1 contents: the LEGACY plain-text parser, moved verbatim from the old index.html.
// The tolerant JSON pipeline (strip BOM/fences, extract {...}, retry without trailing commas)
// arrives in Phase 2 (P2-02). Pure module: no DOM.

/**
 * Parse numbered plain-text questions ("1. ...", "A. ...", True/False without options).
 * Behaviour is intentionally identical to Quiz Runner v1 (tag `v1-legacy`).
 * @param {string} raw
 * @returns {{ number: number, text: string, options: {letter: string, text: string}[], type: 'mc'|'tf' }[]}
 */
export function parseLegacyText(raw) {
  const lines = raw.split(/\r?\n/);
  const qStartRegex = /^\*{0,2}(\d+)\.\*{0,2}\s*(.*)$/;
  const optRegex = /^([A-Da-d])[.)]\s*(.*)$/;
  const parsed = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const qMatch = line.match(qStartRegex);
    if (qMatch) {
      if (current) parsed.push(current);
      current = { number: parseInt(qMatch[1], 10), text: qMatch[2].trim(), options: [] };
      continue;
    }

    const oMatch = line.match(optRegex);
    if (oMatch && current) {
      current.options.push({ letter: oMatch[1].toUpperCase(), text: oMatch[2].trim() });
      continue;
    }

    if (current) {
      if (current.options.length === 0) {
        current.text += (current.text ? ' ' : '') + line;
      }
    }
  }
  if (current) parsed.push(current);

  parsed.forEach((q) => {
    if (q.options.length === 0) {
      q.type = 'tf';
      q.options = [
        { letter: 'True', text: 'True' },
        { letter: 'False', text: 'False' },
      ];
      q.text = q.text.replace(/^true or false:?\s*/i, '').trim();
    } else {
      q.type = 'mc';
    }
  });

  return parsed;
}
