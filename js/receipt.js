// receipt.js — result -> receipt text.
// Phase 1 contents: only the LEGACY "answers only" export (e.g. "1. B"), moved verbatim from the
// old index.html so Quick Paste keeps working (P4-11 keeps it alive later).
// The Markdown/JSON receipt (P4-08) will be added here. Pure module: no DOM.

/** Legacy answer sentinel: the learner pressed "Not sure". */
export const LEGACY_UNSURE = 'UNSURE';

/**
 * Counts shown on the legacy export screen.
 * @param {{number:number}[]} questions
 * @param {Record<string|number, string>} answers   keyed by question number
 */
export function summarizeLegacyAnswers(questions, answers) {
  const allKeys = Object.keys(answers);
  const unsure = allKeys.filter((k) => answers[k] === LEGACY_UNSURE).length;
  const answered = allKeys.length - unsure;
  const skipped = questions.length - allKeys.length;
  return { answered, unsure, skipped };
}

export function legacySummaryText({ answered, unsure, skipped }) {
  return `${answered} answered, ${unsure} marked "not sure", ${skipped} skipped.`;
}

/** The pasteable list: "1. B" / "2. I'm not sure" / "3. I don't know". */
export function formatLegacyAnswers(questions, answers) {
  return questions
    .map((q) => {
      const ans = answers[q.number];
      if (ans === undefined) return `${q.number}. I don't know`;
      if (ans === LEGACY_UNSURE) return `${q.number}. I'm not sure`;
      return `${q.number}. ${ans}`;
    })
    .join('\n');
}
