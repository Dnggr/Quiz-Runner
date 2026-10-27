// P5-08: the Prompt Builder remembers its last-used options in `settings`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePromptSettings, loadPromptSettings, savePromptSettings } from '../js/settings.js';
import { defaultOptions, buildPrompt } from '../js/promptBuilder.js';
import { parseReceipt } from '../js/receipt.js';
import { createStore } from '../js/store.js';
import { readSample } from './helpers.js';

/** A localStorage stand-in that works. */
function workingStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    dump: () => Object.fromEntries(data),
  };
}
const newStore = () => { const storage = workingStorage(); return { storage, store: createStore({ storage }) }; };

/** The options the screen sends to the builder: numbers are digit strings. */
const SCREEN_OPTIONS = {
  mode: 'initial', subject: 'Computer Networks', learner: 'nursing student', count: '90',
  difficulty: { easy: '20', moderate: '50', challenging: '30' }, skills: ['definition', 'application'],
  delivery: 'parts', partSize: '30', customTask: '', receipt: null, topicCounts: null,
};

test('P5-08 sanitize keeps every valid field, turning digit strings into numbers', () => {
  assert.deepEqual(sanitizePromptSettings(SCREEN_OPTIONS), {
    mode: 'initial', subject: 'Computer Networks', learner: 'nursing student', count: 90,
    difficulty: { easy: 20, moderate: 50, challenging: 30 }, skills: ['definition', 'application'],
    delivery: 'parts', partSize: 30, customTask: '',
  });
});

test('P5-08 sanitize drops each invalid field and keeps the rest', () => {
  const bad = {
    mode: 'exam', subject: 7, learner: '   ', count: '4.5', difficulty: { easy: 50, moderate: 50, challenging: 50 },
    skills: ['juggling'], delivery: 'carrier pigeon', partSize: 0, customTask: null,
  };
  assert.deepEqual(sanitizePromptSettings(bad), {});
  assert.deepEqual(sanitizePromptSettings({ ...bad, mode: 'retention', count: 12 }), { mode: 'retention', count: 12 });
  for (const notAnObject of [null, undefined, 'text', 5, [], true]) assert.deepEqual(sanitizePromptSettings(notAnObject), {}, String(notAnObject));
});

test('P5-08 sanitize: counts must be whole numbers of 1 or more; the mix must be whole numbers adding up to 100', () => {
  for (const count of ['', '0', '-3', '1e3', 0, 2.5, NaN, '12abc']) assert.equal('count' in sanitizePromptSettings({ count }), false, String(count));
  assert.equal(sanitizePromptSettings({ count: ' 7 ' }).count, 7);
  for (const difficulty of [{ easy: 30, moderate: 40, challenging: 31 }, { easy: -10, moderate: 60, challenging: 50 }, { easy: '30', moderate: '40' }, { easy: 'a', moderate: 'b', challenging: 'c' }]) {
    assert.equal('difficulty' in sanitizePromptSettings({ difficulty }), false, JSON.stringify(difficulty));
  }
  assert.deepEqual(sanitizePromptSettings({ difficulty: { easy: 100, moderate: 0, challenging: 0 } }).difficulty, { easy: 100, moderate: 0, challenging: 0 });
});

test('P5-08 sanitize: skills come back in the app\'s order, without duplicates or unknown names', () => {
  assert.deepEqual(sanitizePromptSettings({ skills: ['application', 'definition', 'definition', 'nope'] }).skills, ['definition', 'application']);
});

test('P5-08 save, then load: the options come back, under settings.promptBuilder with a version', () => {
  const { storage, store } = newStore();
  assert.deepEqual(loadPromptSettings(store), {});
  assert.equal(savePromptSettings(store, SCREEN_OPTIONS), true);
  assert.deepEqual(loadPromptSettings(store), sanitizePromptSettings(SCREEN_OPTIONS));
  const stored = JSON.parse(storage.dump()['qr:v1:settings']);
  assert.equal(stored.promptBuilder.version, 1);
  assert.equal(stored.promptBuilder.learner, 'nursing student');
  // a new store on the same storage (a page refresh) still has them
  assert.deepEqual(loadPromptSettings(createStore({ storage })), sanitizePromptSettings(SCREEN_OPTIONS));
});

test('P5-08 the receipt and the per-topic counts are never stored', () => {
  const { storage, store } = newStore();
  const receipt = parseReceipt(readSample('sample-receipt.md'));
  savePromptSettings(store, { ...SCREEN_OPTIONS, mode: 'targeted', receipt, topicCounts: [{ id: 't1', count: 5 }], receiptText: 'RECEIPT TEXT' });
  const raw = storage.dump()['qr:v1:settings'];
  assert.doesNotMatch(raw, /receipt|topicCounts|RECEIPT TEXT|Network Basics|sample-networks/i);
  assert.equal(loadPromptSettings(store).mode, 'targeted');
});

test('P5-08 saving keeps the other fields of settings, and a field that is invalid right now keeps its last good value', () => {
  const { store } = newStore();
  store.set('settings', { theme: 'dark', promptBuilder: { version: 1, count: 55, learner: 'BSIT student' } });
  assert.equal(savePromptSettings(store, { ...SCREEN_OPTIONS, count: '', learner: 'nursing student' }), true);
  const settings = store.get('settings');
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.promptBuilder.count, 55);               // '' is half-typed: the last good count stays
  assert.equal(settings.promptBuilder.learner, 'nursing student');
});

test('P5-08 a damaged settings record never throws: nothing is loaded, and nothing is overwritten', () => {
  for (const damaged of ['oops', [1, 2], 42, true]) {
    const { store } = newStore();
    store.set('settings', damaged);
    assert.deepEqual(loadPromptSettings(store), {});
    assert.equal(savePromptSettings(store, SCREEN_OPTIONS), false);
    assert.deepEqual(store.get('settings'), damaged);
  }
  const { store } = newStore();
  store.set('settings', { promptBuilder: 'not an object' });
  assert.deepEqual(loadPromptSettings(store), {});
  assert.equal(savePromptSettings(store, SCREEN_OPTIONS), true);   // an object with a bad field is repaired by the save
  assert.equal(loadPromptSettings(store).count, 90);
});

test('P5-08 values stored by hand with bad fields load as defaults for those fields only', () => {
  const { store } = newStore();
  store.set('settings', { promptBuilder: { version: 1, mode: 'targeted', count: 'lots', delivery: 'parts', skills: [] } });
  assert.deepEqual(loadPromptSettings(store), { mode: 'targeted', delivery: 'parts' });
});

test('P5-08 with no usable storage the options still last for the page, and save says it is not persistent', () => {
  const store = createStore({ storage: null });
  assert.equal(savePromptSettings(store, SCREEN_OPTIONS), false);
  assert.equal(loadPromptSettings(store).learner, 'nursing student');
});

test('P5-08 remembered options go straight into a prompt', () => {
  const { store } = newStore();
  savePromptSettings(store, SCREEN_OPTIONS);
  const remembered = loadPromptSettings(store);
  const r = buildPrompt({ ...defaultOptions('initial'), ...remembered });
  assert.equal(r.ok, true, r.errors.join(' '));
  assert.match(r.prompt, /^I am a nursing student studying Computer Networks\./);
  assert.match(r.prompt, /exactly 90 multiple-choice/);
  assert.match(r.prompt, /about 20% easy, 50% moderate, 30% challenging/);
  assert.match(r.prompt, /Cover these skills: definition, application\./);
  assert.equal(r.meta.totalParts, 3);
});
