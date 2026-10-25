import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';

/** Minimal localStorage double. `failOn` makes chosen methods throw, like a blocked/full storage. */
function fakeStorage({ failOn = [], quotaAfter = Infinity } = {}) {
  const data = new Map();
  const calls = [];
  const boom = (name) => {
    const e = new Error(name);
    e.name = name === 'setItem' ? 'QuotaExceededError' : 'SecurityError';
    return e;
  };
  return {
    data,
    calls,
    getItem(k) { calls.push(['get', k]); if (failOn.includes('getItem')) throw boom('getItem'); return data.has(k) ? data.get(k) : null; },
    setItem(k, v) {
      calls.push(['set', k]);
      if (failOn.includes('setItem') || data.size >= quotaAfter) throw boom('setItem');
      data.set(k, String(v));
    },
    removeItem(k) { calls.push(['remove', k]); if (failOn.includes('removeItem')) throw boom('removeItem'); data.delete(k); },
  };
}

test('keys are namespaced with qr:v1:', () => {
  const storage = fakeStorage();
  const s = createStore({ storage });
  assert.equal(s.set('settings', { learner: 'BSIT student' }), true);
  assert.deepEqual([...storage.data.keys()], ['qr:v1:settings']);
  assert.deepEqual(s.get('settings'), { learner: 'BSIT student' });
});

test('get returns the fallback for missing keys', () => {
  const s = createStore({ storage: fakeStorage() });
  assert.equal(s.get('nope'), null);
  assert.deepEqual(s.get('nope', []), []);
});

test('remove deletes the persistent value', () => {
  const storage = fakeStorage();
  const s = createStore({ storage });
  s.set('session', { i: 3 });
  s.remove('session');
  assert.equal(storage.data.size, 0);
  assert.equal(s.get('session'), null);
});

test('values with pack: keys round-trip', () => {
  const s = createStore({ storage: fakeStorage() });
  s.set('pack:abc', { meta: { quiz_id: 'abc' }, questions: [] });
  assert.equal(s.get('pack:abc').meta.quiz_id, 'abc');
});

test('storage = null: everything works in memory and set() reports false', () => {
  const s = createStore({ storage: null });
  assert.equal(s.isPersistent(), false);
  assert.equal(s.set('history', [1, 2]), false);
  assert.deepEqual(s.get('history'), [1, 2]);
  s.remove('history');
  assert.equal(s.get('history'), null);
});

test('every access is guarded: a storage whose methods all throw never throws out of the store', () => {
  const storage = fakeStorage({ failOn: ['getItem', 'setItem', 'removeItem'] });
  const s = createStore({ storage });
  assert.equal(s.isPersistent(), false);
  assert.equal(s.set('settings', { a: 1 }), false);        // falls back to memory
  assert.deepEqual(s.get('settings'), { a: 1 });            // memory copy is readable
  assert.equal(s.get('missing', 'fb'), 'fb');
  assert.doesNotThrow(() => s.remove('settings'));
  assert.equal(s.get('settings'), null);
  assert.ok(s.lastError);                                   // diagnostics recorded
});

test('quota error on write falls back to memory; the newest value wins on read', () => {
  const storage = fakeStorage({ quotaAfter: 1 });
  const s = createStore({ storage });
  assert.equal(s.set('a', 1), true);
  assert.equal(s.set('b', 2), false);        // quota hit
  assert.equal(s.get('b'), 2);
  assert.equal(s.lastError, 'QuotaExceededError');
  // A later successful write of the same key clears the memory copy.
  storage.data.clear();
  assert.equal(s.set('b', 3), true);
  assert.equal(s.get('b'), 3);
});

test('corrupted JSON returns the fallback instead of throwing', () => {
  const storage = fakeStorage();
  storage.data.set('qr:v1:session', '{not json');
  const s = createStore({ storage });
  assert.equal(s.get('session', 'fallback'), 'fallback');
});

test('non-serialisable values never throw', () => {
  const s = createStore({ storage: fakeStorage() });
  const circular = {}; circular.self = circular;
  assert.equal(s.set('x', circular), false);
  assert.equal(s.get('x'), circular);        // kept in memory
  assert.equal(s.set('y', undefined), false);
});

test('default provider: a globalThis.localStorage getter that throws is survivable', () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    const s = createStore();                 // no storage option -> uses the default provider
    assert.equal(s.isPersistent(), false);
    assert.equal(s.set('k', 'v'), false);
    assert.equal(s.get('k'), 'v');
  } finally {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
    else delete globalThis.localStorage;
  }
});

test('isPersistent probe leaves no residue', () => {
  const storage = fakeStorage();
  const s = createStore({ storage });
  assert.equal(s.isPersistent(), true);
  assert.equal(storage.data.size, 0);
});
