// store.js — the ONLY door to persistence (AGENTS.md "Tech rules").
// - Every key is namespaced with STORAGE_PREFIX ("qr:v1:").
// - Every localStorage access is wrapped in try/catch.
// - If localStorage is unavailable (private mode, blocked, quota), values live in memory
//   for the rest of the page's life and the caller is told via the return value.
// No DOM access: unit-tested with `node --test` by injecting a fake storage.
// P7-05 / P7-07 add: `isQuotaError`, a write-failure hook (`onWriteFailure`) so the app can tell the learner instead of failing
// silently, `pendingKeys` / `flush` to retry what only lives in memory, and `inspect` to tell a missing key from an unreadable one.
import { STORAGE_PREFIX } from './constants.js';

/**
 * Did this error come from a full storage? Browsers disagree on the name and the code:
 * `QuotaExceededError` (Chrome, Safari, Edge), `NS_ERROR_DOM_QUOTA_REACHED` (Firefox), legacy codes 22 and 1014.
 */
export function isQuotaError(err) {
  if (!err) return false;
  return err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014;
}

function defaultStorageProvider() {
  // Accessing `localStorage` can itself throw (SecurityError), so even this is guarded.
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {{ storage?: Storage | null, prefix?: string }} [options]
 *   `storage` — a localStorage-like object, or null to force memory-only mode.
 *   When omitted, the browser's localStorage is used if reachable.
 */
export function createStore({ storage, prefix = STORAGE_PREFIX } = {}) {
  const backend = storage === undefined ? defaultStorageProvider() : storage;
  const memory = new Map();       // fallback values, keyed by the un-namespaced key
  const failureListeners = new Set();
  let lastError = null;

  const ns = (key) => prefix + key;

  function fail(err) {
    lastError = err && err.name ? err.name : String(err);
  }

  /** Tell the listeners that a value could not reach persistent storage. A listener that throws never breaks a save. */
  function notifyWriteFailure(key, reason) {
    for (const listener of [...failureListeners]) {
      try {
        listener({ key, reason });
      } catch { /* a faulty listener must not turn a failed save into a crash */ }
    }
  }

  /** Is the backend reachable right now? (write + read + remove probe, never throws) */
  function isPersistent() {
    if (!backend) return false;
    const probe = ns('__probe__');
    try {
      backend.setItem(probe, '1');
      const ok = backend.getItem(probe) === '1';
      backend.removeItem(probe);
      return ok;
    } catch (err) {
      fail(err);
      return false;
    }
  }

  /**
   * Read and JSON-parse a value. Returns `fallback` when the key is missing,
   * unreadable or corrupted. It cannot tell those cases apart; `inspect` can (P7-07).
   */
  function get(key, fallback = null) {
    if (memory.has(key)) return memory.get(key);
    if (!backend) return fallback;
    try {
      const raw = backend.getItem(ns(key));
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      fail(err);
      return fallback;
    }
  }

  /**
   * JSON-serialise and store a value.
   * @returns {boolean} true if it reached persistent storage, false if it is only held in memory.
   */
  function set(key, value) {
    let text;
    try {
      text = JSON.stringify(value);
      if (text === undefined) throw new TypeError('Value is not JSON-serialisable');
    } catch (err) {
      fail(err);
      memory.set(key, value);
      return false;
    }
    let reason = 'unavailable';   // no localStorage at all (private mode, blocked)
    if (backend) {
      try {
        backend.setItem(ns(key), text);
        memory.delete(key);   // persistent copy is now the truth
        return true;
      } catch (err) {
        fail(err);            // quota exceeded, storage disabled, ...
        reason = isQuotaError(err) ? 'quota' : 'blocked';
      }
    }
    memory.set(key, value);
    notifyWriteFailure(key, reason);   // P7-05: the app tells the learner; the value stays usable in memory meanwhile
    return false;
  }

  /**
   * P7-07: read one key and say what is wrong with it. `get` returns the fallback for a missing key and for an unreadable
   * one alike; callers that must not overwrite damaged data (and must offer a reset) need the difference.
   * Never throws.
   * @returns {{ found: boolean, readable: boolean, value: any, raw: string | null, pending: boolean }}
   *   `found` = something is stored under the key; `readable` = it parses as JSON (always true when not found);
   *   `raw` = the stored text of an unreadable value (so it can be offered for download); `pending` = only in memory.
   */
  function inspect(key) {
    if (memory.has(key)) return { found: true, readable: true, value: memory.get(key), raw: null, pending: true };
    if (!backend) return { found: false, readable: true, value: null, raw: null, pending: false };
    let raw;
    try {
      raw = backend.getItem(ns(key));
    } catch (err) {
      fail(err);   // storage could not be accessed: that is not damaged data, so it is reported as not found
      return { found: false, readable: true, value: null, raw: null, pending: false };
    }
    if (raw === null || raw === undefined) return { found: false, readable: true, value: null, raw: null, pending: false };
    try {
      return { found: true, readable: true, value: JSON.parse(raw), raw: null, pending: false };
    } catch (err) {
      fail(err);
      return { found: true, readable: false, value: null, raw: String(raw), pending: false };
    }
  }

  /** Keys whose latest value is only in memory: it did not fit, or storage is unavailable. A refresh would lose them. */
  function pendingKeys() {
    return [...memory.keys()].sort();
  }

  /**
   * Try again to persist everything that is only in memory (after space was freed). Never throws.
   * @returns {{ saved: string[], failed: string[] }}
   */
  function flush() {
    const saved = [];
    const failed = [];
    for (const key of [...memory.keys()]) (set(key, memory.get(key)) ? saved : failed).push(key);
    return { saved, failed };
  }

  /**
   * Approximate size of one key in characters: the stored text, or the JSON text of a value held in memory. 0 when missing.
   * (localStorage limits are counted in characters of text, which is what this returns.) Never throws.
   */
  function size(key) {
    if (memory.has(key)) {
      try { return (JSON.stringify(memory.get(key)) ?? '').length; } catch { return 0; }
    }
    if (!backend) return 0;
    try {
      const raw = backend.getItem(ns(key));
      return raw === null || raw === undefined ? 0 : String(raw).length;
    } catch (err) {
      fail(err);
      return 0;
    }
  }

  /** Be told about every value that could not be saved. @returns {() => void} unsubscribe */
  function onWriteFailure(listener) {
    failureListeners.add(listener);
    return () => { failureListeners.delete(listener); };
  }

  /** Remove a key everywhere (persistent copy and memory copy). Never throws. */
  function remove(key) {
    memory.delete(key);
    if (!backend) return;
    try {
      backend.removeItem(ns(key));
    } catch (err) {
      fail(err);
    }
  }

  /**
   * Every key this store holds, without the namespace (P6-09 backup, P6-10 clear all): the ones in persistent storage
   * plus the ones that only live in memory. Other apps' keys on the same origin are not listed. Never throws.
   * @returns {string[]}  sorted, no duplicates
   */
  function keys() {
    const found = new Set(memory.keys());
    if (backend && typeof backend.length === 'number' && typeof backend.key === 'function') {
      try {
        for (let i = 0; i < backend.length; i++) {
          const name = backend.key(i);
          if (typeof name === 'string' && name.startsWith(prefix)) found.add(name.slice(prefix.length));
        }
      } catch (err) {
        fail(err);
      }
    }
    found.delete('__probe__');
    return [...found].sort();
  }

  return {
    get,
    set,
    remove,
    keys,
    inspect,
    pendingKeys,
    flush,
    size,
    onWriteFailure,
    isPersistent,
    get lastError() { return lastError; },
  };
}

/** App-wide instance. Everything in the app imports this one. */
export const store = createStore();
