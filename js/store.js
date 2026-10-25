// store.js — the ONLY door to persistence (AGENTS.md "Tech rules").
// - Every key is namespaced with STORAGE_PREFIX ("qr:v1:").
// - Every localStorage access is wrapped in try/catch.
// - If localStorage is unavailable (private mode, blocked, quota), values live in memory
//   for the rest of the page's life and the caller is told via the return value.
// No DOM access: unit-tested with `node --test` by injecting a fake storage.
import { STORAGE_PREFIX } from './constants.js';

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
  let lastError = null;

  const ns = (key) => prefix + key;

  function fail(err) {
    lastError = err && err.name ? err.name : String(err);
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
   * unreadable or corrupted (corruption handling UI arrives in P7-07).
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
    if (backend) {
      try {
        backend.setItem(ns(key), text);
        memory.delete(key);   // persistent copy is now the truth
        return true;
      } catch (err) {
        fail(err);            // quota exceeded, storage disabled, ...
      }
    }
    memory.set(key, value);
    return false;
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

  return {
    get,
    set,
    remove,
    isPersistent,
    get lastError() { return lastError; },
  };
}

/** App-wide instance. Everything in the app imports this one. */
export const store = createStore();
