// receipt.js — result -> receipt text. Pure module: no DOM, no storage.
//   1. The LEGACY "answers only" export (e.g. "1. B"), moved verbatim from the old index.html so Quick Paste keeps
//      working (P4-11).
//   2. The Quiz Pack receipt (P4-08): a Markdown receipt with an embedded JSON block, and the same data as JSON.
//      Layout and rules: docs/ai/RECEIPT_SPEC.md §7-§8. The numbers come from analytics.js; nothing is re-graded here.
import { SPEC_VERSION, APP_VERSION, RECEIPT_FORMAT, CHARS_PER_TOKEN, NEXT_EXAM_DEFAULT_N, PRIORITY_MIN_EXAMS } from './constants.js';
import {
  analyzeExam, buildSnapshot, cumulativeProfile, sortSnapshots, scoreDeltaFor, normalizeName, packTopics,
} from './analytics.js';
import { buildReviewItems } from './review.js';

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

// ============================================================================================================
// Quiz Pack receipt (P4-08)
// ============================================================================================================

export const RECEIPT_BEGIN = '<!-- BEGIN RECEIPT -->';
export const RECEIPT_END = '<!-- END RECEIPT -->';

/**
 * Export toggles (P4-09): section 4 + `missed`, section 7 + `history` + `cumulative`, section 9 + `covered_concepts`,
 * section 10. Everything else is always in the receipt.
 * SPEC GAP: RECEIPT_SPEC §7 says only the "next-quiz format instructions" are "default on". All four start on here,
 * because without the missed-question detail the AI cannot "explain my mistakes" and without the covered concepts it
 * cannot avoid repeats (the "Done when" line of Phase 4).
 */
export const DEFAULT_RECEIPT_OPTIONS = Object.freeze({ missed: true, history: true, concepts: true, formatSpec: true });

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const pad2 = (n) => String(n).padStart(2, '0');

function normalizeOptions(options) {
  const out = { ...DEFAULT_RECEIPT_OPTIONS };
  if (isPlainObject(options)) for (const key of Object.keys(out)) if (typeof options[key] === 'boolean') out[key] = options[key];
  return out;
}

// ---- small text helpers ----------------------------------------------------------------------------
// Pack text is untrusted and ends up inside a Markdown document that is pasted into an AI chat, and later re-imported.
// So single-line fields lose their line breaks, and a comment marker in the text cannot fake the receipt's own markers.

const neutralize = (t) => t.replace(/<!--/g, '&lt;!--').replace(/-->/g, '--&gt;');
const oneLine = (v) => neutralize(String(v ?? '').replace(/\s+/g, ' ').trim());
const cell = (v) => oneLine(v).replace(/\|/g, '\\|');
const percentText = (fraction) => `${Math.round(fraction * 100)}%`;
const listText = (names) => (names.length > 0 ? names.map(oneLine).join(', ') : 'none');
const mixText = (m) => `${percentText(m.easy)} easy / ${percentText(m.moderate)} moderate / ${percentText(m.challenging)} challenging`;
const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * An ISO timestamp rewritten in the learner's local time, e.g. `2026-10-25T14:10:00+08:00`.
 * @param {string | Date} value
 * @param {number} [offsetMinutes]  minutes east of UTC (UTC+8 is 480); use `-new Date().getTimezoneOffset()` in the browser
 * @returns {string}  empty string when `value` is not a date
 */
export function toOffsetIso(value, offsetMinutes = 0) {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  const offset = Math.round(Number.isFinite(offsetMinutes) ? offsetMinutes : 0);
  const local = new Date(ms + offset * 60000).toISOString().slice(0, 19);
  const abs = Math.abs(offset);
  return `${local}${offset < 0 ? '-' : '+'}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** `qr-<quiz_id>-<YYYYMMDDHHmm>` from the local creation time. (Pattern read from RECEIPT_SPEC §8 and the sample receipt.) */
export const receiptIdFor = (quizId, createdAtLocal) => `qr-${quizId}-${createdAtLocal.slice(0, 16).replace(/\D/g, '')}`;

export const slugify = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'quiz';

/**
 * Number for the next exam's id: distinct exams (quiz ids) already taken in this subject, plus one.
 * SPEC GAP: PROMPT_TEMPLATES says the builder "increments NN using local history" but not how. This is the receipt's
 * rule until the Prompt Builder (P5) fixes one.
 */
export function nextQuizNumber(snapshots, subject) {
  const key = normalizeName(subject);
  return new Set(snapshots.filter((s) => normalizeName(s.subject) === key).map((s) => s.quiz_id)).size + 1;
}

/** `<subject-slug>-<mode>-<NN>` (PROMPT_TEMPLATES "Builder options"). */
export const nextQuizId = (subject, mode, number) => `${slugify(subject)}-${mode}-${pad2(number)}`;

/** Size estimate shown on the export screen: characters / 4 (P4-10). */
export const estimateTokens = (text) => Math.ceil(String(text).length / CHARS_PER_TOKEN);

/** "≈ 850 tokens", "≈ 4.2k tokens", "≈ 12k tokens". */
export function formatTokenEstimate(text) {
  const tokens = estimateTokens(text);
  if (tokens < 1000) return `≈ ${Math.max(10, Math.round(tokens / 10) * 10)} tokens`;
  const k = tokens / 1000;
  return `≈ ${k < 10 ? Math.round(k * 10) / 10 : Math.round(k)}k tokens`;
}

// ---- section 10: the compact Quiz Pack format (PROMPT_TEMPLATES "FORMAT_SPEC") -----------------------------------
// Keep in sync with docs/ai/PROMPT_TEMPLATES.md. The Prompt Builder (P5) embeds the same block.

/**
 * @param {{ quizId: string, subject: string, quizType: string, quizNumber: number, part?: number, totalParts?: number,
 *           count: number, specVersion?: number }} p
 */
export function buildFormatSpec({ quizId, subject, quizType, quizNumber, part = 1, totalParts = 1, count, specVersion = SPEC_VERSION }) {
  return [
    `OUTPUT FORMAT (Quiz Pack v${specVersion})`,
    'Return one JSON object and nothing else:',
    '',
    '{',
    '  "format": "quizrunner.quiz",',
    `  "version": ${specVersion},`,
    '  "meta": {',
    `    "quiz_id": ${JSON.stringify(quizId)},`,
    '    "title": "…",',
    `    "subject": ${JSON.stringify(subject)},`,
    `    "quiz_type": ${JSON.stringify(quizType)},`,
    `    "quiz_number": ${quizNumber},`,
    `    "part": ${part},`,
    `    "total_parts": ${totalParts},`,
    `    "total_questions": ${count},`,
    '    "generated_by": "…",',
    '    "generated_on": "YYYY-MM-DD",',
    '    "source_note": "which of my files you used",',
    '    "topics": [ { "id": "t1", "name": "…", "subtopics": ["…"] } ],',
    '    "notes": []',
    '  },',
    '  "questions": [',
    '    {',
    '      "number": 1,',
    '      "type": "mc",',
    '      "topic": "t1",',
    '      "concept": "…",',
    '      "difficulty": "easy | moderate | challenging",',
    '      "skill": "definition | function | structure | process | comparison | sequence | application",',
    '      "question": "…",',
    '      "options": { "A": "…", "B": "…", "C": "…", "D": "…" },',
    '      "answer": "B",',
    '      "explanation": "…"',
    '    }',
    '  ]',
    '}',
    '',
    'JSON rules: straight double quotes only, escape inner quotes and line breaks, no comments, no trailing commas, numbers are numbers, plain text inside strings. Number questions 1 to N with no gaps. Every "topic" must match an id in "meta.topics". Every "answer" must be one of that question\'s option letters.',
  ].map(neutralize).join('\n');
}

// ---- the receipt -----------------------------------------------------------------------------------------

const AI_BLOCK = [
  '## FOR THE AI READING THIS',
  'This is a graded exam receipt from Quiz Runner, a study app. The learner took a practice exam built from their own course materials and the app already graded it. Treat all results below as verified: do not re-grade or recalculate.',
  'Do what the learner asks next. Defaults:',
  '- "Explain my mistakes": go through section 4 grouped by topic, in simple student-friendly language: why their answer was wrong and why the correct one is right.',
  '- "Study plan": prioritize the weaknesses in section 3 in the order given; keep strong topics for light review only.',
  '- "Next quiz": follow section 6, new questions only (avoid section 9), and use the quiz format in section 10 if present; otherwise ask the learner to paste a prompt from Quiz Runner\'s Prompt Builder.',
  'Rules: use only the learner\'s course materials as the source of content. If the materials are not available in this chat, say so and ask the learner to attach them. Do not invent course content.',
];

/** `{ topic name: [concepts] }` in pack order, each concept once, topics without concepts left out. */
export function coveredConcepts(pack, topics) {
  const questions = Array.isArray(pack.questions) ? pack.questions.filter(isPlainObject) : [];
  const out = {};
  for (const t of topics) {
    const seen = [];
    for (const q of questions) {
      const concept = typeof q.concept === 'string' ? q.concept.trim() : '';
      if (q.topic === t.id && concept !== '' && !seen.includes(concept)) seen.push(concept);
    }
    if (seen.length > 0) out[t.name] = seen;
  }
  return out;
}

/**
 * Build the receipt (P4-08).
 * @param {{
 *   pack: object,                                  the normalized pack that was taken (it holds the answers)
 *   graded: { outcomes: object[], totals: object }, from gradeExam
 *   startedAt: string, finishedAt?: string | null, ISO timestamps of the session (`taken_at` is the start time)
 *   now?: Date,                                    creation time of the receipt (a fixed value makes it reproducible)
 *   tzOffsetMinutes?: number,                      minutes east of UTC, for the timestamps in the receipt
 *   snapshots?: import('./analytics.js').ExamSnapshot[],  other exams from history (the current one is added or replaced)
 *   options?: Partial<typeof DEFAULT_RECEIPT_OPTIONS>,
 *   nextTotal?: number,                            size of the recommended next exam (default 40)
 *   profile?: { topicList: { id: string, name: string }[], concepts: Record<string, string[]> } | null,
 *     P6-07 cumulative profile: the topic list (section 8, `topic_list`) and the covered concepts (section 9,
 *     `covered_concepts`) of every exam on the device instead of this exam's alone. Everything else is still this exam's.
 * }} input
 * @returns {{ data: object, markdown: string, json: string, receiptId: string }}
 */
export function buildReceipt({
  pack, graded, startedAt, finishedAt = null, now = new Date(), tzOffsetMinutes = 0,
  snapshots = [], options = {}, nextTotal = NEXT_EXAM_DEFAULT_N, profile = null,
}) {
  const opts = normalizeOptions(options);
  const analysis = analyzeExam(pack, graded, { nextTotal });
  const totals = graded.totals;
  const meta = isPlainObject(pack.meta) ? pack.meta : {};
  const quizId = String(meta.quiz_id ?? '');
  const title = String(meta.title ?? '');
  const subject = typeof meta.subject === 'string' ? meta.subject : '';
  const quizType = typeof meta.quiz_type === 'string' ? meta.quiz_type : '';
  const topicList = packTopics(pack);                       // this exam's topics: stats, missed questions, shaky list
  const listedTopics = profile ? profile.topicList : topicList;   // what sections 8 and `topic_list` announce
  const topicName = new Map(topicList.map((t) => [t.id, t.name]));
  const namesOf = (stats) => stats.map((t) => t.name);

  const local = (iso) => toOffsetIso(iso, tzOffsetMinutes);
  const createdAt = local(now);
  const takenAt = local(startedAt);
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(finishedAt);
  const durationSec = Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, Math.round((endMs - startMs) / 1000)) : null;
  const receiptId = receiptIdFor(quizId, createdAt);

  // History and cumulative rules: every other stored exam, plus this one (it may not have reached storage).
  const currentId = `${quizId}@${startedAt}`;
  const current = buildSnapshot({ id: currentId, quizId, title, subject, takenAt: startedAt, totals, stats: analysis.topics });
  const allExams = sortSnapshots([...snapshots.filter((s) => s.id !== currentId), current]);
  const cumulative = cumulativeProfile(allExams, currentId);
  const historyRows = allExams.map((s) => ({ snapshot: s, takenAt: local(s.taken_at), delta: scoreDeltaFor(allExams, s.id) }));

  const review = buildReviewItems(pack, graded.outcomes);
  const missedItems = review.filter((i) => i.outcome !== 'correct');
  const shakyItems = review.filter((i) => i.outcome === 'correct' && i.unsure);
  const nextNumber = nextQuizNumber(allExams, subject);
  const nextId = nextQuizId(subject, 'targeted', nextNumber);

  // ---- JSON receipt (RECEIPT_SPEC §8): key order follows the spec ----
  const data = {
    format: RECEIPT_FORMAT,
    version: SPEC_VERSION,
    receipt_id: receiptId,
    created_at: createdAt,
    app_version: APP_VERSION,
    exam: {
      quiz_id: quizId, title, subject, quiz_type: quizType,
      quiz_number: Number.isInteger(meta.quiz_number) ? meta.quiz_number : null,
      total: totals.total, taken_at: takenAt, duration_sec: durationSec,
    },
    result: {
      correct: totals.correct, wrong: totals.wrong, skipped: totals.skipped, unsure: totals.unsure,
      shaky: analysis.shaky.length, percent: totals.percent, rating: totals.rating,
      gaps: analysis.gaps.length, misconceptions: analysis.misconceptions.length,
    },
    topics: analysis.topics.map((t) => ({
      id: t.id, name: t.name, total: t.total, correct: t.correct, wrong: t.wrong, skipped: t.skipped,
      unsure: t.unsure, shaky: t.shaky, accuracy: round3(t.accuracy), status: t.status,
    })),
    strengths: analysis.strengths.map((t) => t.id),
    weaknesses: analysis.weaknesses.map((t) => t.id),
    watch: analysis.watch.map((t) => t.id),   // SPEC GAP: §3 "Watch list" is watch + developing; the JSON example shows one id
  };
  if (opts.missed) {
    data.missed = missedItems.map((i) => ({
      number: i.number, topic: i.topicId, concept: i.concept, question: i.question,
      selected: i.selected, answer: i.answer, unsure: i.unsure, explanation: i.explanation,
    }));
  }
  data.shaky = shakyItems.map((i) => ({ number: i.number, topic: i.topicId, concept: i.concept }));
  data.next_exam = analysis.nextExam;
  data.topic_list = listedTopics.map((t) => ({ id: t.id, name: t.name }));
  if (opts.history) {
    data.history = historyRows.map((r) => ({
      quiz_id: r.snapshot.quiz_id, title: r.snapshot.title, taken_at: r.takenAt, percent: r.snapshot.percent, rating: r.snapshot.rating,
    }));
    data.cumulative = cumulative;
  }
  const concepts = profile ? profile.concepts : coveredConcepts(pack, topicList);
  if (opts.concepts) data.covered_concepts = concepts;

  const json = JSON.stringify(data, null, 2) + '\n';
  // Inside the Markdown code fence a backtick or "<" in pack text must not end the fence or fake a marker. \u escapes
  // are plain JSON, so the embedded block still parses to exactly the same data.
  const embeddedJson = JSON.stringify(data, null, 2).replace(/`/g, '\\u0060').replace(/</g, '\\u003c');

  // ---- Markdown receipt (RECEIPT_SPEC §7) ----
  const out = [];
  out.push(RECEIPT_BEGIN, '# QUIZ RUNNER RECEIPT');
  out.push(`- Receipt ID: ${oneLine(receiptId)}`);
  out.push(`- Exam: ${oneLine(title)} (${oneLine(quizId)}) · type: ${oneLine(quizType)} · taken: ${takenAt}`);
  out.push(`- App: Quiz Runner ${APP_VERSION} · spec v${SPEC_VERSION}`, '');
  out.push(...AI_BLOCK, '');

  out.push('## 1. Result');
  out.push(`- Score: ${totals.correct}/${totals.total} (${totals.percent}%) · Rating: ${totals.rating}`);
  out.push(`- Correct ${totals.correct} · Wrong ${totals.wrong} · Skipped ${totals.skipped} · Marked unsure ${totals.unsure} · Correct but unsure ${analysis.shaky.length}`);
  out.push(`- Misses: ${analysis.gaps.length} gaps (didn't know) · ${analysis.misconceptions.length} misconceptions (confidently wrong)`, '');

  out.push('## 2. Topic breakdown', '| Topic | Questions | Correct | Accuracy | Status |', '|---|---|---|---|---|');
  for (const t of analysis.topics) out.push(`| ${cell(t.name)} | ${t.total} | ${t.correct} | ${percentText(t.accuracy)} | ${t.status} |`);
  out.push('');

  out.push('## 3. Capability summary');
  out.push(`- Strong in: ${listText(namesOf(analysis.strengths))}`);
  out.push(`- Developing / watch: ${listText(namesOf(analysis.watch))}`);
  out.push(`- Weak (ranked, most missed first): ${listText(namesOf(analysis.weaknesses))}`);
  if (opts.history) {
    const priority = cumulative.priority_topics;
    out.push(`- Priority topics (weak in ${PRIORITY_MIN_EXAMS}+ exams): ${priority.length > 0 ? priority.map(oneLine).join(', ') : 'none yet'}`);
  }
  out.push('');

  if (opts.missed) {
    out.push('## 4. Missed questions (grouped by topic)');
    if (missedItems.length === 0) out.push('- No missed questions.');
    let firstGroup = true;
    for (const t of topicList) {
      const items = missedItems.filter((i) => i.topicId === t.id);
      if (items.length === 0) continue;
      if (!firstGroup) out.push('');   // the sample receipt separates topic groups with a blank line (the spec template shows one group)
      firstGroup = false;
      out.push(`### ${oneLine(t.name)}`);
      for (const i of items) {
        out.push(`- Q${i.number}${i.concept ? ` [${oneLine(i.concept)}]` : ''} — ${oneLine(i.question)}`);
        const yours = `${i.selected === null ? 'no answer' : oneLine(i.selected)}${i.unsure ? ' (unsure)' : ''}`;
        const right = `${oneLine(i.answer)}${i.type === 'tf' || !i.answerText ? '' : ` — ${oneLine(i.answerText)}`}`;
        out.push(`  - Your answer: ${yours} · Correct: ${right}`);
        if (i.explanation.trim() !== '') out.push(`  - Why: ${oneLine(i.explanation)}`);
      }
    }
    out.push('');
  }

  out.push('## 5. Correct but unsure (shaky)');
  if (shakyItems.length === 0) out.push('- none');
  for (const i of shakyItems) out.push(`- Q${i.number}${i.concept ? ` [${oneLine(i.concept)}]` : ''} — topic: ${oneLine(topicName.get(i.topicId) || i.topicId)}`);
  out.push('');

  const next = analysis.nextExam;
  out.push('## 6. Recommended next exam');
  out.push(`- Total questions: ${next.recommended_total} · New questions only`);
  out.push(`- Allocation: ${next.allocations.length > 0
    ? next.allocations.map((a) => `${oneLine(a.name)} × ${a.count} (${a.reason}; difficulty ${mixText(a.difficulty_mix)})`).join(' · ')
    : 'none'}`);
  out.push('- Keep a few questions from strong topics so they are not forgotten.', '');

  if (opts.history) {
    out.push('## 7. History (optional)', '| Date | Exam | Score | Rating | Δ vs previous |', '|---|---|---|---|---|');
    for (const r of historyRows) {
      const s = r.snapshot;
      const delta = r.delta === null ? '—' : `${r.delta > 0 ? '+' : ''}${r.delta.toFixed(1)} pts`;
      out.push(`| ${r.takenAt.slice(0, 10)} | ${cell(s.title)} | ${s.correct}/${s.total} (${s.percent}%) | ${cell(s.rating)} | ${delta} |`);
    }
    out.push(`- Improved: ${listText(cumulative.improved)} · Still weak: ${listText(cumulative.still_weak)}`, '');
  }

  out.push('## 8. Topic list used (reuse these exact ids and names in future quizzes)');
  for (const t of listedTopics) out.push(`- ${oneLine(t.id)}: ${oneLine(t.name)}`);
  out.push('');

  if (opts.concepts) {
    out.push('## 9. Concepts already covered (optional, to avoid repeats)');
    const entries = Object.entries(concepts);
    if (entries.length === 0) out.push('- none');
    for (const [name, list] of entries) out.push(`- ${oneLine(name)}: ${list.map(oneLine).join('; ')}`);
    out.push('');
  }

  if (opts.formatSpec) {
    out.push('## 10. Quiz format for the next quiz (optional)');
    out.push(buildFormatSpec({ quizId: nextId, subject, quizType: 'targeted', quizNumber: nextNumber, count: next.recommended_total }), '');
  }

  out.push('## 11. Machine-readable data', '```json', embeddedJson, '```', RECEIPT_END);

  return { data, markdown: out.join('\n') + '\n', json, receiptId };
}

/** Safe file name stem for downloads: the receipt id with anything odd replaced. */
export const receiptFileStem = (receiptId) => String(receiptId).replace(/[^A-Za-z0-9._-]+/g, '-');

// ============================================================================================================
// Reading a receipt back in (P5-05; RECEIPT_SPEC §9 "Import rules"). Pure: no DOM, no storage.
// The Prompt Builder uses this to check a pasted receipt. Merging receipts into history is P6-08, not here.
// ============================================================================================================

/**
 * Where the JSON block of a Markdown receipt sits (section 11). The generator escapes backticks inside the JSON
 * (`\u0060`), so the first closing fence after the last ```json opener is the real end of the block.
 * @param {string} markdown
 * @returns {{ start: number, end: number, text: string } | null}  `[start, end)` is the JSON text, up to the closing fence
 */
export function findEmbeddedJson(markdown) {
  const open = markdown.lastIndexOf('```json');
  if (open === -1) return null;
  const lineEnd = markdown.indexOf('\n', open);
  if (lineEnd === -1) return null;
  const start = lineEnd + 1;
  const close = markdown.indexOf('```', start);
  if (close === -1) return null;
  return { start, end: close, text: markdown.slice(start, close) };
}

/**
 * Parse and check a pasted receipt: the Markdown form (between the BEGIN / END markers) or the bare JSON form.
 * Errors block use; warnings do not (an unknown `version` is a warning: "warn and try best-effort import").
 * What it requires is what a next-quiz prompt needs: the format tag, the exam id, and the topic list with ids and names.
 * @param {string} text
 * @returns {{ ok: boolean, errors: string[], warnings: string[], data: object | null, markdown: string | null, source: 'markdown' | 'json' | null }}
 */
export function parseReceipt(text) {
  const out = { ok: false, errors: [], warnings: [], data: null, markdown: null, source: null };
  const raw = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (raw === '') {
    out.errors.push('Paste a receipt first.');
    return out;
  }

  let jsonText = null;
  const begin = raw.indexOf(RECEIPT_BEGIN);
  if (begin !== -1) {
    const end = raw.lastIndexOf(RECEIPT_END);
    if (end < begin) {
      out.errors.push(`The receipt is cut off: the end marker (${RECEIPT_END}) is missing. Copy the whole receipt.`);
      return out;
    }
    out.markdown = raw.slice(begin, end + RECEIPT_END.length);
    out.source = 'markdown';
    const block = findEmbeddedJson(out.markdown);
    if (!block) {
      out.errors.push('The receipt has no machine-readable data block (section 11). Export it again from Quiz Runner.');
      return out;
    }
    jsonText = block.text;
  } else if (raw.startsWith('{')) {
    out.source = 'json';
    jsonText = raw;
  } else {
    out.errors.push('This does not look like a Quiz Runner receipt. Paste the whole receipt (.md or .json) exported from Quiz Runner.');
    return out;
  }

  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    out.errors.push(`The receipt's data could not be read (${err instanceof SyntaxError ? err.message : 'invalid JSON'}). It may be cut off or edited.`);
    return out;
  }
  if (!isPlainObject(data) || data.format !== RECEIPT_FORMAT) {
    out.errors.push(`This is not a Quiz Runner receipt (its "format" should be "${RECEIPT_FORMAT}").`);
    return out;
  }

  if (!Number.isFinite(data.version)) out.warnings.push('The receipt has no version number; reading it as best as possible.');
  else if (data.version !== SPEC_VERSION) out.warnings.push(`The receipt is spec v${data.version}, this app writes v${SPEC_VERSION}. Reading it as best as possible.`);

  const exam = isPlainObject(data.exam) ? data.exam : null;
  if (!exam || typeof exam.quiz_id !== 'string' || exam.quiz_id.trim() === '') out.errors.push('The receipt does not say which exam it is for (exam.quiz_id is missing).');
  const list = Array.isArray(data.topic_list) ? data.topic_list : null;
  const usable = list ? list.filter((t) => isPlainObject(t) && typeof t.id === 'string' && t.id.trim() !== '' && typeof t.name === 'string' && t.name.trim() !== '') : [];
  if (usable.length === 0) out.errors.push('The receipt has no topic list (topic_list), so the next quiz cannot reuse your topics.');
  else if (usable.length < list.length) out.warnings.push(`${list.length - usable.length} entr${list.length - usable.length === 1 ? 'y' : 'ies'} of the receipt's topic list had no id or name and will be ignored.`);

  if (out.errors.length > 0) return out;
  out.ok = true;
  out.data = data;
  return out;
}
