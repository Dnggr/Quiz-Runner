// P3-10 guard. The exam screen must never be handed answers, so it can never put them in the DOM.
// This is a cheap static check on the source (the project has no DOM test dependency): the real DOM check was run
// by hand in a headless DOM (see the hand-off notes). It fails if someone wires answer data into the exam screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');   // drop comments (whole-line and trailing)

test('P3-10 ui/exam.js imports only exam.js (no grader, session, loader, validator, review, history, store)', () => {
  const imports = [...code('js/ui/exam.js').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports, ['../exam.js']);
});

test('P3-10 ui/exam.js never mentions answers, explanations, concepts or the pack', () => {
  const src = code('js/ui/exam.js');
  for (const word of ['answer', 'explanation', 'concept', 'pack', 'outcome']) {
    assert.ok(!new RegExp(`\\b${word}\\b`, 'i').test(src.replace(/aria-label|Answer options/g, '')), `ui/exam.js mentions "${word}"`);
  }
});

test('P3-10 main.js gives the exam screen toExamQuestions(...) and nothing taken from the pack directly', () => {
  const main = code('js/main.js');
  assert.match(main, /exam\.load\(\{\s*questions:\s*toExamQuestions\(current\.pack\)/);
});

test('P3-10 starting an exam clears every screen that could still hold the pack\'s answers', () => {
  const main = code('js/main.js');
  const start = main.slice(main.indexOf('function startExam'), main.indexOf('function mountExam'));
  for (const call of ["rawInput').value = ''", 'preview.clear()', 'problems.clear()', 'results.clear()']) {
    assert.ok(start.includes(call), `startExam must call ${call}`);
  }
});
