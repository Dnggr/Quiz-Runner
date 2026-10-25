// Checks that the Phase 0 sample files are what P0-05 / P0-07 / P0-08 say they are.
// This is NOT the loader/validator test suite (that is P2-09, driven by the real loader).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SPEC_VERSION, ANSWER_SKEW_MAX_SHARE } from '../js/constants.js';

const samples = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'samples');
const read = (...p) => readFileSync(join(samples, ...p), 'utf8');

test('P0-05 sample-pack.json: 10 questions, 3 topics, one True/False, spec-conformant', () => {
  const pack = JSON.parse(read('sample-pack.json'));
  assert.equal(pack.format, 'quizrunner.quiz');
  assert.equal(pack.version, SPEC_VERSION);
  assert.equal(pack.questions.length, 10);
  assert.equal(pack.meta.total_questions, 10);
  assert.equal(pack.meta.topics.length, 3);
  assert.equal(pack.questions.filter((q) => q.type === 'tf').length, 1);
  assert.deepEqual(pack.questions.map((q) => q.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  const ids = new Set(pack.meta.topics.map((t) => t.id));
  const perTopic = {};
  for (const q of pack.questions) {
    assert.ok(ids.has(q.topic), `Q${q.number} topic`);
    perTopic[q.topic] = (perTopic[q.topic] || 0) + 1;
    assert.ok(q.explanation && q.concept && q.difficulty && q.skill, `Q${q.number} fields`);
    assert.ok(q.concept.split(/\s+/).length <= 8, `Q${q.number} concept length`);
    if (q.type === 'mc') {
      assert.deepEqual(Object.keys(q.options), ['A', 'B', 'C', 'D']);
      assert.ok(q.answer in q.options, `Q${q.number} answer in options`);
    } else {
      assert.equal(q.options, undefined);
      assert.ok(['True', 'False'].includes(q.answer));
    }
  }
  for (const id of ids) assert.ok(perTopic[id] >= 3, `topic ${id} has >= 3 questions (initial exam rule)`);

  // letter spread: no letter above 40% (of all questions) and no run longer than 3
  const mc = pack.questions.filter((q) => q.type === 'mc');
  const counts = {};
  mc.forEach((q) => { counts[q.answer] = (counts[q.answer] || 0) + 1; });
  assert.ok(Math.max(...Object.values(counts)) / pack.questions.length <= ANSWER_SKEW_MAX_SHARE);
  let run = 1;
  for (let i = 1; i < mc.length; i++) { run = mc[i].answer === mc[i - 1].answer ? run + 1 : 1; assert.ok(run <= 3); }
});

const BROKEN = {
  '01-code-fenced.json': (t) => /^```/.test(t.trim()),
  '02-trailing-comma.json': (t) => /,\s*[}\]]/.test(t),
  '03-truncated.json': (t) => { try { JSON.parse(t); return false; } catch { return !t.trimEnd().endsWith('}'); } },
  '04-missing-answer.json': (t) => { const p = JSON.parse(t); return p.questions.some((q) => q.answer === undefined); },
  '05-answer-not-in-options.json': (t) => { const p = JSON.parse(t); return p.questions.some((q) => q.options && !(q.answer in q.options)); },
  '06-duplicate-numbers.json': (t) => { const n = JSON.parse(t).questions.map((q) => q.number); return new Set(n).size < n.length; },
  '07-unknown-topic.json': (t) => { const p = JSON.parse(t); const ids = p.meta.topics.map((x) => x.id); return p.questions.some((q) => !ids.includes(q.topic)); },
  '08-smart-quotes.json': (t) => t.includes('\u201c') && !t.includes('"format"'),
  '09-bom.json': (t) => t.charCodeAt(0) === 0xfeff,
};

test('P0-07 samples/broken/ has exactly the nine required files, each with its flaw', () => {
  assert.deepEqual(readdirSync(join(samples, 'broken')).sort(), Object.keys(BROKEN).sort());
  for (const [file, hasFlaw] of Object.entries(BROKEN)) {
    assert.ok(hasFlaw(read('broken', file)), `${file} should contain its intended flaw`);
  }
});

test('P0-07 each non-truncated broken file is only broken in that one way (cleanup recovers them)', () => {
  const strip = (t) => t.replace(/^\uFEFF/, '').replace(/^```json\n/, '').replace(/```\s*$/, '').replace(/,(\s*[}\]])/g, '$1');
  for (const f of ['01-code-fenced.json', '02-trailing-comma.json', '09-bom.json']) {
    const p = JSON.parse(strip(read('broken', f)));
    assert.equal(p.questions.length, 3, f);
  }
});

test('P0-08 sample-receipt.md: markers, sections 1-11, embedded JSON agrees with the text', () => {
  const md = read('sample-receipt.md');
  assert.ok(md.startsWith('<!-- BEGIN RECEIPT -->'));
  assert.ok(md.trimEnd().endsWith('<!-- END RECEIPT -->'));
  for (let i = 1; i <= 11; i++) assert.match(md, new RegExp(`^## ${i}\\. `, 'm'), `section ${i}`);
  assert.match(md, /^## FOR THE AI READING THIS/m);

  const json = JSON.parse(md.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(json.format, 'quizrunner.receipt');
  assert.equal(json.version, SPEC_VERSION);
  const r = json.result;
  assert.equal(r.correct + r.wrong + r.skipped, json.exam.total);
  assert.equal(r.percent, (100 * r.correct) / json.exam.total);
  assert.match(md, new RegExp(`Score: ${r.correct}/${json.exam.total} \\(${r.percent}%\\) · Rating: ${r.rating}`));
  assert.equal(json.next_exam.allocations.reduce((n, a) => n + a.count, 0), json.next_exam.recommended_total);
  assert.equal(r.gaps + r.misconceptions, json.missed.length);

  const pack = JSON.parse(read('sample-pack.json'));
  assert.equal(json.exam.quiz_id, pack.meta.quiz_id);
  assert.deepEqual(json.topic_list.map((t) => t.id), pack.meta.topics.map((t) => t.id));
  for (const m of json.missed) assert.equal(m.answer, pack.questions[m.number - 1].answer);
});
