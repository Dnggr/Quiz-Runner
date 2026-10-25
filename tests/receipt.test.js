import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_UNSURE,
  summarizeLegacyAnswers,
  legacySummaryText,
  formatLegacyAnswers,
} from '../js/receipt.js';

const questions = [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }];

test('legacy export: answered, unsure and skipped lines (exact v1 wording)', () => {
  const answers = { 1: 'B', 2: LEGACY_UNSURE, 4: 'True' };
  assert.equal(
    formatLegacyAnswers(questions, answers),
    ["1. B", "2. I'm not sure", "3. I don't know", '4. True'].join('\n'),
  );
});

test('legacy summary counts and sentence', () => {
  const answers = { 1: 'B', 2: LEGACY_UNSURE, 4: 'True' };
  const s = summarizeLegacyAnswers(questions, answers);
  assert.deepEqual(s, { answered: 2, unsure: 1, skipped: 1 });
  assert.equal(legacySummaryText(s), '2 answered, 1 marked "not sure", 1 skipped.');
});

test('nothing answered -> everything skipped', () => {
  assert.deepEqual(summarizeLegacyAnswers(questions, {}), { answered: 0, unsure: 0, skipped: 4 });
  assert.equal(formatLegacyAnswers(questions, {}).split('\n').every((l) => l.endsWith("I don't know")), true);
});
