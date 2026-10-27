// P5-11: one snapshot (golden file) of the whole prompt for each mode, in tests/snapshots/prompt-<mode>.md.
// A snapshot is the exact text a learner would paste into an AI chat, so any change to a template, to the assembly order,
// or to the embedded receipt shows up here as a diff to read and approve.
//
// After an intended change, regenerate and review the diff:   UPDATE_SNAPSHOTS=1 node --test tests/prompt-snapshots.test.js
// A missing snapshot fails the test (it is never created by a normal run, or the test could not fail).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { MODES, RECEIPT_MODES, defaultOptions, buildPrompt } from '../js/promptBuilder.js';
import { parseReceipt } from '../js/receipt.js';
import { readSample } from './helpers.js';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'snapshots');
const update = process.env.UPDATE_SNAPSHOTS === '1';
const fileFor = (mode) => join(dir, `prompt-${mode}.md`);

/** Fixed input per mode: the sample receipt, the defaults, a fixed subject, no exams on the device (so quiz number 1). */
function promptFor(mode) {
  const options = {
    ...defaultOptions(mode),
    subject: 'Computer Networks',
    receipt: RECEIPT_MODES.includes(mode) ? parseReceipt(readSample('sample-receipt.md')) : null,
    ...(mode === 'custom' ? { customTask: 'Write 20 questions that compare TCP and UDP, for a quick quiz before class.', count: 20 } : {}),
  };
  const result = buildPrompt(options, { snapshots: [] });
  assert.equal(result.ok, true, `${mode}: ${result.errors.join(' ')}`);
  return result.prompt;
}

for (const mode of MODES) {
  test(`P5-11 snapshot: the ${mode} prompt is exactly tests/snapshots/prompt-${mode}.md`, () => {
    const prompt = promptFor(mode);
    if (update) writeFileSync(fileFor(mode), prompt, 'utf8');
    assert.ok(existsSync(fileFor(mode)), `no snapshot for "${mode}". Create it with: UPDATE_SNAPSHOTS=1 node --test tests/prompt-snapshots.test.js`);
    assert.equal(prompt, readFileSync(fileFor(mode), 'utf8'));
  });
}

test('P5-11 the snapshots cover exactly the modes the builder has, and the prompt is reproducible', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  assert.deepEqual(files, MODES.map((m) => `prompt-${m}.md`).sort());
  for (const mode of MODES) assert.equal(promptFor(mode), promptFor(mode), mode);
});
