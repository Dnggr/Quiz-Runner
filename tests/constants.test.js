import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/constants.js';

test('versions are set', () => {
  assert.equal(C.SPEC_VERSION, 1);
  assert.match(C.APP_VERSION, /^\d+\.\d+\.\d+/);
});

test('storage keys are namespaced qr:v1: and pack keys use pack:<id>', () => {
  assert.equal(C.STORAGE_PREFIX, 'qr:v1:');
  assert.deepEqual(Object.values(C.STORAGE_KEYS).sort(), ['history', 'session', 'settings']);
  assert.equal(C.packKey('networks-initial-01'), 'pack:networks-initial-01');
});

test('rating bands match RECEIPT_SPEC §2 and cover 0-100', () => {
  const rate = (pct) => C.RATING_BANDS.find((b) => pct >= b.min).label;
  assert.equal(rate(100), 'Excellent');
  assert.equal(rate(90), 'Excellent');
  assert.equal(rate(89.9), 'Good');
  assert.equal(rate(75), 'Good');
  assert.equal(rate(74.9), 'Fair');
  assert.equal(rate(60), 'Fair');
  assert.equal(rate(59.9), 'Needs work');
  assert.equal(rate(0), 'Needs work');
  const mins = C.RATING_BANDS.map((b) => b.min);
  assert.deepEqual(mins, [...mins].sort((a, b) => b - a), 'bands must be ordered high to low');
});

test('topic status thresholds match RECEIPT_SPEC §3', () => {
  assert.equal(C.WEAK_MIN_MISSES, 2);
  assert.equal(C.WEAK_MAX_ACCURACY, 0.70);
  assert.equal(C.STRONG_MIN_N, 3);
  assert.equal(C.STRONG_MIN_ACCURACY, 0.85);
  assert.equal(C.STRONG_MAX_SHAKY, 0.25);
});

test('allocation shares sum to 1 and difficulty mixes sum to 1', () => {
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum(C.ALLOCATION_SHARES.withWeak) - 1) < 1e-9);
  assert.ok(Math.abs(sum(C.ALLOCATION_SHARES.noWeak) - 1) < 1e-9);
  for (const mix of Object.values(C.DIFFICULTY_MIX_BY_GROUP)) assert.ok(Math.abs(sum(mix) - 1) < 1e-9);
  assert.equal(sum(C.DEFAULT_DIFFICULTY_PCT), 100);
});

test('constants are frozen where they are objects', () => {
  assert.ok(Object.isFrozen(C.STORAGE_KEYS));
  assert.ok(Object.isFrozen(C.RATING_BANDS));
  assert.ok(Object.isFrozen(C.RATING_BANDS[0]));
  assert.ok(Object.isFrozen(C.ALLOCATION_SHARES.withWeak));
  assert.ok(Object.isFrozen(C.DEFAULT_COUNTS));
});

test('prompt-builder defaults match PROMPT_TEMPLATES', () => {
  assert.deepEqual({ ...C.DEFAULT_COUNTS }, { initial: 130, targeted: 40, retention: 12 });
  assert.equal(C.DEFAULT_PART_SIZE, 45);
  assert.equal(C.SKILLS.length, 7);
});
