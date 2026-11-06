// Tests for BUG-42 (twelfth pass, 2026-11-06): the Prompt Builder option "Source" (`files` | `web`).
// A learner with no course files pasted the `files` prompt into ChatGPT and got "No files are attached... Please upload your files"
// back, because the prompt says to use only the attached files and not to use general knowledge. The `web` source tells the AI that
// there are no files and to research reliable sources (or use well-established knowledge when it cannot browse).
// The wording lives in docs/ai/PROMPT_TEMPLATES.md ("Source mode"); the tests keep code, doc, settings, HTML and snapshots together.
//
// After an intended wording change, regenerate and review the diff:   UPDATE_SNAPSHOTS=1 node --test tests/bug-fixes-batch8.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  MODES, RECEIPT_MODES, SOURCES, TEMPLATES, defaultOptions, buildPrompt,
} from '../js/promptBuilder.js';
import {
  parseReceipt, buildFormatSpec, SOURCE_NOTE_HINT_FILES, SOURCE_NOTE_HINT_WEB,
} from '../js/receipt.js';
import { sanitizePromptSettings, loadPromptSettings, savePromptSettings } from '../js/settings.js';
import { createStore } from '../js/store.js';
import { loadInput } from '../js/loader.js';
import { SPEC_VERSION } from '../js/constants.js';
import { readSample } from './helpers.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const templatesDoc = read('docs', 'ai', 'PROMPT_TEMPLATES.md');

const opts = (mode, extra = {}) => ({
  ...defaultOptions(mode),
  subject: 'Networking Basics',
  receipt: RECEIPT_MODES.includes(mode) ? parseReceipt(readSample('sample-receipt.md')) : null,
  ...(mode === 'custom' ? { customTask: 'Write 20 questions that compare TCP and UDP.', count: 20 } : {}),
  ...extra,
});
const web = (mode, extra = {}) => {
  const r = buildPrompt(opts(mode, { source: 'web', ...extra }), { snapshots: [] });
  assert.equal(r.ok, true, `${mode}: ${r.errors.join(' ')}`);
  return r.prompt;
};
const files = (mode, extra = {}) => {
  const r = buildPrompt(opts(mode, extra), { snapshots: [] });
  assert.equal(r.ok, true, `${mode}: ${r.errors.join(' ')}`);
  return r.prompt;
};

// ---- the doc and the code say the same thing ---------------------------------------------------------------------
function templateBlocks() {
  const out = new Map();
  let heading = null;
  let inside = false;
  let buffer = [];
  for (const line of templatesDoc.split('\n')) {
    if (!inside && /^#{2,3} /.test(line)) heading = line.replace(/^#+ /, '').trim();
    else if (line.startsWith('```')) {
      if (inside) { if (heading && !out.has(heading)) out.set(heading, buffer.join('\n')); buffer = []; }
      inside = !inside;
    } else if (inside) buffer.push(line);
  }
  return out;
}

test('BUG-42 every web template in promptBuilder.js is the text in docs/ai/PROMPT_TEMPLATES.md', () => {
  const doc = templateBlocks();
  const pairs = {
    'ROLE_BLOCK (web)': TEMPLATES.roleWeb,
    'initial (web)': TEMPLATES.initialWeb,
    'SOURCE_RULES (web)': TEMPLATES.sourceRulesWeb,
    'SOURCE_RULES receipt note (web, targeted and retention)': TEMPLATES.sourceRulesWebReceiptNote,
    'CONTENT_RULES (web)': TEMPLATES.contentRulesWeb,
    'SELF_CHECK (web)': TEMPLATES.selfCheckWeb,
  };
  for (const [heading, text] of Object.entries(pairs)) {
    assert.ok(doc.has(heading), `PROMPT_TEMPLATES.md has no block under "${heading}"`);
    assert.equal(text, doc.get(heading), heading);
  }
});

test('BUG-42 the doc names the new option and the changelog line; SPEC_VERSION did not move', () => {
  assert.match(templatesDoc, /\| Source \|/);
  assert.match(templatesDoc, /- v1 \(BUG-42\)/);
  assert.equal(SPEC_VERSION, 1);
});

// ---- the files prompt is untouched -------------------------------------------------------------------------------
test('BUG-42 source "files" is the default, and giving it explicitly changes nothing (the snapshots pin the text)', () => {
  assert.equal(defaultOptions('initial').source, 'files');
  for (const mode of MODES) assert.equal(files(mode, { source: 'files' }), files(mode), mode);
  assert.deepEqual([...SOURCES], ['files', 'web']);
});

test('BUG-42 a files prompt still says what it said (attached files, no general knowledge)', () => {
  const p = files('initial');
  assert.match(p, /Use the files I attached in this chat as the main and only source/);
  assert.doesNotMatch(p, /SOURCE RULES/);
  assert.match(p, /"source_note": "which of my files you used"/);
});

test('BUG-42 buildFormatSpec keeps the files hint by default (the receipt section 10 uses it)', () => {
  const spec = buildFormatSpec({ quizId: 'x-initial-01', subject: 'X', quizType: 'initial', quizNumber: 1, count: 10 });
  assert.ok(spec.includes(`"source_note": ${JSON.stringify(SOURCE_NOTE_HINT_FILES)}`));
  const webSpec = buildFormatSpec({ quizId: 'x-initial-01', subject: 'X', quizType: 'initial', quizNumber: 1, count: 10, sourceNote: SOURCE_NOTE_HINT_WEB });
  assert.ok(webSpec.includes(`"source_note": ${JSON.stringify(SOURCE_NOTE_HINT_WEB)}`));
  assert.doesNotMatch(webSpec, /my files/);
});

// ---- the web prompt ----------------------------------------------------------------------------------------------
test('BUG-42 a web prompt never asks for files or tells the AI to use only attached files', () => {
  for (const mode of MODES) {
    const p = web(mode);
    assert.doesNotMatch(p, /files I attached/i, mode);
    assert.doesNotMatch(p, /from my files|my files\b|of my files/i, mode);
    assert.doesNotMatch(p, /supplement them with general knowledge/i, mode);
    assert.doesNotMatch(p, /everything comes from my files/i, mode);
    assert.match(p, /I do not have course files or notes for this, so nothing is attached to this chat\./, mode);
    assert.match(p, /Do not ask me for files or for more details before you start\. Build the quiz now\./, mode);
    assert.doesNotMatch(p, /\{\{\w+\}\}/, `${mode}: a placeholder was left unfilled`);
    assert.ok(p.endsWith('\n'), mode);
  }
});

test('BUG-42 a web prompt asks for reliable sources, a fallback without browsing, no invention and named sources', () => {
  const p = web('initial');
  assert.match(p, /SOURCE RULES \(I have no course files\)/);
  assert.match(p, /If you can browse or search the web, do it before writing\./);
  assert.match(p, /official documentation and standards/);
  assert.match(p, /Do not use forums, social media, anonymous blogs, content farms/);
  assert.match(p, /If you cannot browse, use only well-established knowledge/);
  assert.match(p, /Never invent facts, numbers, commands, names, or sources\. Never make up a link\./);
  assert.match(p, /"meta\.source_note"/);
  assert.ok(p.includes(`"source_note": ${JSON.stringify(SOURCE_NOTE_HINT_WEB)}`));
  assert.match(p, /"meta\.source_note" names the sources used/);
});

test('BUG-42 the web initial task is built on the subject, with the same topic, difficulty and skill rules', () => {
  const p = web('initial', { topicMin: 8, topicMax: 12, difficulty: { easy: 20, moderate: 50, challenging: 30 }, skills: ['definition', 'application'] });
  assert.match(p, /TASK: Build a practice exam of exactly 130 multiple-choice questions on Networking Basics\./);
  assert.match(p, /define 8-12 topics \(each with subtopics\) that a standard course on Networking Basics covers/);
  assert.match(p, /Every topic must have at least 3 questions\./);
  assert.match(p, /about 20% easy, 50% moderate, 30% challenging/);
  assert.match(p, /Cover these skills: definition, application\./);
});

test('BUG-42 block order: role, task, [receipt, topic list], source rules, content rules, format, delivery, self-check', () => {
  const at = (p, needle) => { const i = p.indexOf(needle); assert.ok(i >= 0, `missing: ${needle}`); return i; };
  const initial = web('initial');
  const a = ['I am a BSIT student studying Networking Basics.', 'TASK: Build a practice exam', 'SOURCE RULES (I have no course files)', 'CONTENT RULES', 'OUTPUT FORMAT (Quiz Pack v1)', 'DELIVERY', 'BEFORE YOU REPLY'].map((n) => at(initial, n));
  assert.deepEqual(a, [...a].sort((x, y) => x - y));
  const targeted = web('targeted');
  const b = ['I am a BSIT student', 'TASK: Build a targeted follow-up exam', '=== RECEIPT START ===', '=== RECEIPT END ===', 'TOPIC LIST', 'SOURCE RULES (I have no course files)', 'CONTENT RULES', 'OUTPUT FORMAT', 'DELIVERY', 'BEFORE YOU REPLY'].map((n) => at(targeted, n));
  assert.deepEqual(b, [...b].sort((x, y) => x - y));
});

test('BUG-42 receipt modes: the receipt note overrides the receipt\'s own "attach your files" rule; other modes have no such note', () => {
  const note = TEMPLATES.sourceRulesWebReceiptNote;
  for (const mode of RECEIPT_MODES) {
    const p = web(mode);
    assert.ok(p.includes(note), mode);
    assert.ok(p.indexOf(note) > p.indexOf('=== RECEIPT END ==='), `${mode}: the note comes after the receipt`);
  }
  for (const mode of ['initial', 'custom']) assert.ok(!web(mode).includes(note), mode);
  // the sample receipt really does carry the rule the note overrides
  assert.match(web('targeted'), /ask the learner to attach them/);
});

test('BUG-42 web keeps the rest of each mode: topic reuse, allocation, quiz type, delivery and parts', () => {
  const targeted = web('targeted');
  assert.match(targeted, /Reuse the exact topic ids and names from the receipt's topic list\./);
  assert.match(targeted, /Set "quiz_type" to "targeted"/);
  assert.match(targeted, /TOPIC LIST/);
  const retention = web('retention');
  assert.match(retention, /Set "quiz_type" to "retention"\./);
  const custom = web('custom');
  assert.match(custom, /TASK: Write 20 questions that compare TCP and UDP\./);
  const parts = web('initial', { delivery: 'parts', partSize: 45 });
  assert.match(parts, /Deliver the exam in 3 parts of at most 45 questions\./);
});

test('BUG-42 split delivery still works with the web rules: the source rules do not forbid waiting for "next"', () => {
  const p = web('initial', { delivery: 'parts', partSize: 45 });
  assert.match(p, /After part 1, wait for me to say "next"/);
  assert.doesNotMatch(p, /do not wait for anything/i);
});

test('BUG-42 a web prompt differs from the files prompt only in the source blocks (same ids, count, format, delivery)', () => {
  for (const mode of MODES) {
    const f = buildPrompt(opts(mode), { snapshots: [] });
    const w = buildPrompt(opts(mode, { source: 'web' }), { snapshots: [] });
    assert.deepEqual(w.meta, f.meta, mode);
    const after = (p) => p.slice(p.indexOf('DELIVERY'), p.indexOf('BEFORE YOU REPLY'));
    assert.equal(after(w.prompt), after(f.prompt), `${mode}: delivery block`);
  }
});

test('BUG-42 text a learner typed is never read as a placeholder in the web blocks either', () => {
  const p = web('initial', { subject: '{{count}} and {{subject}}' });
  assert.match(p, /studying \{\{count\}\} and \{\{subject\}\}\./);
});

test('BUG-42 an unknown source is an error and builds nothing; a missing one means files', () => {
  const bad = buildPrompt(opts('initial', { source: 'internet' }), { snapshots: [] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /where the questions come from/i.test(e)), bad.errors.join(' | '));
  assert.equal(bad.prompt, '');
  const { source: _drop, ...noSource } = opts('initial');
  const r = buildPrompt(noSource, { snapshots: [] });
  assert.equal(r.ok, true);
  assert.equal(r.prompt, files('initial'));
  // an explicit undefined (an options object spread from another one) counts as missing; null and other values do not
  assert.equal(buildPrompt(opts('initial', { source: undefined }), { snapshots: [] }).prompt, files('initial'));
  for (const value of [null, '', 7, {}, [], 'WEB', true]) {
    assert.equal(buildPrompt(opts('initial', { source: value }), { snapshots: [] }).ok, false, String(JSON.stringify(value)));
  }
});

test('BUG-42 the reply a web prompt asks for is an ordinary pack: a pack with source_note and source_ref loads', () => {
  const pack = {
    format: 'quizrunner.quiz', version: 1,
    meta: {
      quiz_id: 'networking-basics-initial-01', title: 'Networking Basics', subject: 'Networking Basics', quiz_type: 'initial', total_questions: 1,
      source_note: 'RFC 791; Cisco Networking Academy (public pages)', notes: ['No files, so the topics follow a standard course outline.'],
      topics: [{ id: 't1', name: 'IP', subtopics: [] }],
    },
    questions: [{
      number: 1, type: 'mc', topic: 't1', concept: 'IPv4 address length', difficulty: 'easy', skill: 'definition', source_ref: 'RFC 791 §3.2',
      question: 'How many bits are in an IPv4 address?', options: { A: '16', B: '32', C: '48', D: '128' }, answer: 'B', explanation: 'IPv4 uses 32 bits.',
    }],
  };
  const loaded = loadInput(JSON.stringify(pack));
  assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
});

// ---- web prompt snapshots (read the exact text a learner without files would paste) -----------------------------------
const update = process.env.UPDATE_SNAPSHOTS === '1';
const snapDir = join(root, 'tests', 'snapshots', 'web');
const snapFile = (mode) => join(snapDir, `prompt-${mode}.md`);

for (const mode of MODES) {
  test(`BUG-42 snapshot: the web ${mode} prompt is exactly tests/snapshots/web/prompt-${mode}.md`, () => {
    const prompt = web(mode);
    if (update) { mkdirSync(snapDir, { recursive: true }); writeFileSync(snapFile(mode), prompt, 'utf8'); }
    assert.ok(existsSync(snapFile(mode)), `no snapshot for web "${mode}". Create it with: UPDATE_SNAPSHOTS=1 node --test tests/bug-fixes-batch8.test.js`);
    assert.equal(prompt, readFileSync(snapFile(mode), 'utf8'));
  });
}

test('BUG-42 the web snapshots cover exactly the modes the builder has', () => {
  assert.deepEqual(readdirSync(snapDir).sort(), MODES.map((m) => `prompt-${m}.md`).sort());
});

// ---- settings --------------------------------------------------------------------------------------------------------
function workingStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, removeItem: (k) => { data.delete(k); } };
}

test('BUG-42 the chosen source is remembered; an invalid stored source is ignored', () => {
  assert.equal(sanitizePromptSettings({ source: 'web' }).source, 'web');
  assert.equal(sanitizePromptSettings({ source: 'files' }).source, 'files');
  assert.equal('source' in sanitizePromptSettings({ source: 'internet' }), false);
  assert.equal('source' in sanitizePromptSettings({ source: 7 }), false);
  const store = createStore({ storage: workingStorage() });
  assert.equal(savePromptSettings(store, { mode: 'initial', source: 'web', subject: 'Networking Basics' }), true);
  assert.equal(loadPromptSettings(store).source, 'web');
  // a half-written options object without a source keeps the last good one
  savePromptSettings(store, { mode: 'initial', subject: 'Networking Basics' });
  assert.equal(loadPromptSettings(store).source, 'web');
});

// ---- screen: static checks (the project has no DOM test dependency) ------------------------------------------------------
test('BUG-42 index.html has the two source radios in a labelled group, and the screen sends and restores `source`', () => {
  const html = read('index.html');
  assert.match(html, /<fieldset class="toggle-group" id="pbSourceWrap">\s*<legend>Where should the questions come from\?<\/legend>/);
  assert.match(html, /<input type="radio" name="pbSource" id="pbSourceFiles" value="files" checked>/);
  assert.match(html, /<input type="radio" name="pbSource" id="pbSourceWeb" value="web">/);
  assert.match(html, /id="pbSourceHelp"/);
  // each radio sits inside its own <label>, like the delivery radios
  assert.equal([...html.matchAll(/<label class="toggle"><input type="radio" name="pbSource"/g)].length, 2);
  const ui = read('js', 'ui', 'promptbuilder.js');
  assert.match(ui, /source: state\.source,/);
  assert.match(ui, /source: saved\.source \?\? d\.source,/);
  assert.match(ui, /input\[name="pbSource"\]/);
  assert.match(ui, /\$\('pbSourceWeb'\)\.checked = state\.source === 'web'/);
});
