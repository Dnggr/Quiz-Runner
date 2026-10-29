// P2-09: runs the REAL loader (loadInput) over every file in samples/ and samples/broken/ and checks the outcome
// documented in samples/README.md. Also checks what the new screens are built from: the error-screen grouping
// (P2-06) and the preview summary (P2-07).
//
// A new file in either folder fails the completeness test until it gets an entry below, so no sample goes untested.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadInput } from '../js/loader.js';
import { groupIssues } from '../js/validator.js';
import { summarizePack } from '../js/packsummary.js';
import { readSample } from './helpers.js';

const samplesDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'samples');
const filesIn = (sub = '') => readdirSync(join(samplesDir, sub)).filter((f) => statSync(join(samplesDir, sub, f)).isFile()).sort();

const canLoad = (r) => r.kind === 'pack' && r.ok;
const KINDS = ['pack', 'legacy', 'error'];

/** Loadable broken files: base 3-question pack (Q1 in t1; Q2, Q3 in t2). */
const base3 = { questions: 3, topicCounts: [1, 2] };

// file (relative to samples/) -> expectation. `check` gets the loadInput result.
const EXPECT = {
  'sample-pack.json': {
    note: 'good pack: loads with no errors or warnings',
    check: (r) => {
      assert.ok(canLoad(r));
      assert.deepEqual(r.warnings, []);
      assert.equal(r.repaired, false);
      assert.equal(summarizePack(r.pack).questionCount, 10);
    },
  },
  'README.md': {
    note: 'plain documentation: not a pack, not questions',
    check: (r) => {
      assert.equal(r.kind, 'error');
      assert.equal(r.error.code, 'unrecognized');
    },
  },
  'sample-receipt.md': {
    note: 'a receipt is not a pack: it must never load as one',
    check: (r) => {
      assert.ok(!canLoad(r));
      assert.notEqual(r.kind, 'legacy');
    },
  },
  'sample-pack-130.prompt.md': {
    note: 'prompt text, not a pack. Characterization only: just prove the loader copes (see hand-off notes)',
    check: () => {},
  },
  'broken/01-code-fenced.json': { note: 'fence stripped', check: (r) => { assert.ok(canLoad(r)); assert.equal(r.repaired, false); assert.deepEqual(r.warnings, []); }, loads: base3 },
  'broken/02-trailing-comma.json': { note: 'retry without trailing commas', check: (r) => { assert.ok(canLoad(r)); assert.equal(r.repaired, true); assert.deepEqual(r.warnings, []); }, loads: base3 },
  'broken/09-bom.json': { note: 'BOM stripped', check: (r) => { assert.ok(canLoad(r)); assert.deepEqual(r.warnings, []); }, loads: base3 },
  'broken/03-truncated.json': {
    note: 'cut off in Q3: the two complete questions are salvaged, \"Loaded 2 of 3\" (P7-01)',
    check: (r) => {
      assert.ok(canLoad(r));
      assert.deepEqual(r.salvaged, { kept: 2 });
      assert.deepEqual(r.pack.questions.map((q) => q.number), [1, 2]);
      assert.equal(r.pack.meta.total_questions, 3);
      assert.ok(r.warnings.some((w) => w.code === 'count_mismatch'));
    },
  },
  'broken/08-smart-quotes.json': {
    note: 'not JSON: error names the curly quotes and the position',
    check: (r) => {
      assert.equal(r.kind, 'error');
      assert.equal(r.error.code, 'invalid_json');
      assert.ok(Number.isInteger(r.error.line));
      assert.match(r.error.message, /Curly quotes/);
    },
  },
  'broken/04-missing-answer.json': { note: 'Q3 has no answer', problem: { code: 'missing_answer', question: 3 } },
  'broken/05-answer-not-in-options.json': { note: 'Q2 answer is E', problem: { code: 'answer_not_in_options', question: 2 } },
  'broken/06-duplicate-numbers.json': { note: 'Q3 is numbered 2', problem: { code: 'duplicate_number', question: 2 } },
  'broken/07-unknown-topic.json': { note: 'Q3 topic is t9', problem: { code: 'unknown_topic', question: 3 } },
};

const everySample = [...filesIn().map((f) => f), ...filesIn('broken').map((f) => `broken/${f}`)];
const load = (file) => loadInput(readSample(...file.split('/')));

test('P2-09 every file in samples/ and samples/broken/ has an expectation (add one when adding a sample)', () => {
  assert.deepEqual(Object.keys(EXPECT).sort(), everySample.sort());
});

for (const [file, exp] of Object.entries(EXPECT)) {
  test(`P2-09 ${file}: ${exp.note}`, () => {
    const result = load(file);                       // must never throw
    assert.ok(KINDS.includes(result.kind), 'a well-formed result');

    if (exp.problem) {
      assert.equal(result.kind, 'pack');
      assert.equal(result.ok, false);
      assert.equal(result.errors.length, 1, 'exactly the one intended flaw');
      assert.equal(result.errors[0].code, exp.problem.code);
      assert.equal(result.errors[0].number, exp.problem.question);
      assert.deepEqual(result.warnings, []);

      // P2-06: the error screen lists it under the right question number, with a readable message.
      const grouped = groupIssues(result.errors);
      assert.deepEqual(grouped.pack, []);
      assert.deepEqual(grouped.questions.map((g) => g.label), [`Question ${exp.problem.question}`]);
      assert.ok(grouped.questions[0].issues[0].message.length > 10);
    } else {
      exp.check(result);
    }

    if (exp.loads) {
      // P2-07: what the Topics preview would show.
      const s = summarizePack(result.pack);
      assert.equal(s.questionCount, exp.loads.questions);
      assert.deepEqual(s.topics.map((t) => t.count), exp.loads.topicCounts);
    }
  });
}

test('P2-08 no sample pack triggers the version warning (all are version 1)', () => {
  for (const file of everySample) {
    const r = load(file);
    if (r.kind === 'pack') assert.ok(!r.warnings.some((w) => w.code === 'version_mismatch'), file);
  }
});

test('P2-09 every sample that cannot load gives a non-empty, human-readable message', () => {
  for (const file of everySample) {
    const r = load(file);
    if (r.kind === 'error') assert.ok(r.error.message.length > 20, file);
    if (r.kind === 'pack' && !r.ok) assert.ok(r.errors.every((e) => e.message.length > 10), file);
  }
});
