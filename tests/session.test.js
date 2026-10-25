import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSession, parseSession, saveSession, loadSession, clearSession, describeSession } from '../js/session.js';
import { selectOption, pressNotSure } from '../js/exam.js';
import { createStore } from '../js/store.js';
import { STORAGE_KEYS, SESSION_SCHEMA_VERSION, STORAGE_PREFIX } from '../js/constants.js';
import { basePack } from './helpers.js';

function fakeStorage() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}
const NOW = new Date('2026-10-25T10:00:00Z');

test('P3-03 buildSession: new session starts at question 1 with empty responses', () => {
  const s = buildSession(basePack(), NOW);
  assert.equal(s.version, SESSION_SCHEMA_VERSION);
  assert.equal(s.quiz_id, 'test-pack-01');
  assert.equal(s.index, 0);
  assert.equal(s.finished, false);
  assert.equal(s.started_at, '2026-10-25T10:00:00.000Z');
  assert.deepEqual(s.responses[3], { selected: null, unsure: false });
});

test('P3-03 save then load round-trips through the store under qr:v1:session', () => {
  const storage = fakeStorage();
  const store = createStore({ storage });
  const s = buildSession(basePack(), NOW);
  s.responses = pressNotSure(selectOption(s.responses, 2, 'D'), 2).responses;
  s.index = 2;
  assert.equal(saveSession(store, s, new Date('2026-10-25T10:05:00Z')), true);
  assert.ok(storage.data.has(STORAGE_PREFIX + STORAGE_KEYS.session));

  const back = loadSession(createStore({ storage }));     // a "refreshed" app: new store, same storage
  assert.equal(back.index, 2);
  assert.equal(back.updated_at, '2026-10-25T10:05:00.000Z');
  assert.deepEqual(back.responses[2], { selected: 'D', unsure: true });
  assert.deepEqual(back.pack, s.pack);
});

test('P3-03 saveSession reports false when storage is unavailable (memory only)', () => {
  const store = createStore({ storage: null });
  assert.equal(saveSession(store, buildSession(basePack(), NOW)), false);
  assert.ok(loadSession(store), 'still readable for the rest of the page life');
});

test('P3-03 clearSession removes it', () => {
  const store = createStore({ storage: fakeStorage() });
  saveSession(store, buildSession(basePack(), NOW));
  clearSession(store);
  assert.equal(loadSession(store), null);
});

test('P3-03 loadSession with nothing saved is null', () => {
  assert.equal(loadSession(createStore({ storage: fakeStorage() })), null);
});

test('P3-03 parseSession rejects junk, wrong versions and packs that no longer validate; never throws', () => {
  const good = buildSession(basePack(), NOW);
  for (const bad of [null, undefined, 5, 'x', [], {}, { ...good, version: 99 }, { ...good, pack: null }, { ...good, pack: { questions: [] } }]) {
    assert.equal(parseSession(bad), null);
  }
  const broken = JSON.parse(JSON.stringify(good));
  delete broken.pack.questions[0].answer;
  assert.equal(parseSession(broken), null);
});

test('P3-03 parseSession repairs responses and index', () => {
  const s = JSON.parse(JSON.stringify(buildSession(basePack(), NOW)));
  s.responses = {
    1: { selected: 'Z', unsure: true },          // not an option -> null, flag kept
    2: { selected: 'D', unsure: 'yes' },         // flag must be exactly true
    99: { selected: 'A', unsure: false },        // unknown question -> dropped
    // 3 and 4 missing -> added empty
  };
  s.index = 500;
  const r = parseSession(s);
  assert.deepEqual(r.responses, {
    1: { selected: null, unsure: true },
    2: { selected: 'D', unsure: false },
    3: { selected: null, unsure: false },
    4: { selected: null, unsure: false },
  });
  assert.equal(r.index, 3);
  assert.equal(parseSession({ ...s, index: -4 }).index, 0);
  assert.equal(parseSession({ ...s, index: 'x' }).index, 0);
});

test('P3-03 parseSession keeps finished sessions marked finished', () => {
  const s = buildSession(basePack(), NOW);
  s.finished = true;
  s.finished_at = '2026-10-25T10:30:00.000Z';
  const r = parseSession(JSON.parse(JSON.stringify(s)));
  assert.equal(r.finished, true);
  assert.equal(r.finished_at, '2026-10-25T10:30:00.000Z');
});

test('P3-03 describeSession gives counts for the resume banner, and no answers', () => {
  const s = buildSession(basePack(), NOW);
  s.responses = selectOption(s.responses, 1, 'B');
  s.responses = pressNotSure(s.responses, 3).responses;
  s.index = 3;
  assert.deepEqual(describeSession(s), { title: 'Test pack', position: 4, total: 4, answered: 1, unanswered: 3, unsure: 1 });
});
