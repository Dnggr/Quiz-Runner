// router.js — tiny hash-based screen router (P1-05).
// Hash routes keep the phone's back button working with no server config.
//   #/            -> "input"
//   #/quiz        -> "quiz"
// `parseHash` / `buildHash` are pure; `createRouter` takes an injected window-like object
// so it can be tested in Node without a DOM.

/**
 * @param {string} hash          e.g. "#/quiz" or ""
 * @param {string[]} known       route names that exist
 * @param {string} fallback      route name to use when the hash is empty or unknown
 * @returns {{ name: string, args: string[], known: boolean }}
 */
export function parseHash(hash, known, fallback) {
  const clean = String(hash || '').replace(/^#\/?/, '').split('?')[0];
  const parts = clean.split('/').filter(Boolean).map(decodeSafe);
  if (parts.length === 0) return { name: fallback, args: [], known: true };
  const [name, ...args] = parts;
  if (known.includes(name)) return { name, args, known: true };
  return { name: fallback, args: [], known: false };
}

function decodeSafe(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** Inverse of parseHash. The home route ("fallback") is just "#/". */
export function buildHash(name, args = [], fallback = '') {
  if (name === fallback && args.length === 0) return '#/';
  return '#/' + [name, ...args].map(encodeURIComponent).join('/');
}

/**
 * @param {{
 *   win: { location: { hash: string, pathname?: string, search?: string },
 *          history: { replaceState: Function },
 *          addEventListener: Function },
 *   routes: string[],
 *   home: string,
 *   onRoute: (route: { name: string, args: string[] }) => void,
 *   guard?: (route: { name: string, args: string[] }) => string | null,
 * }} options
 *   `guard` may return another route name to redirect to (e.g. "quiz" without questions -> "input").
 */
export function createRouter({ win, routes, home, onRoute, guard = () => null }) {
  let current = null;

  function resolve() {
    const route = parseHash(win.location.hash, routes, home);
    const redirect = guard(route);
    if (redirect && redirect !== route.name) return { name: redirect, args: [], redirected: true };
    return { name: route.name, args: route.args, redirected: !route.known };
  }

  function sync() {
    const route = resolve();
    const target = buildHash(route.name, route.args, home);
    if (route.redirected && win.location.hash !== target) {
      // Keep the address bar honest without adding a history entry.
      win.history.replaceState(null, '', `${win.location.pathname ?? ''}${win.location.search ?? ''}${target}`);
    }
    current = { name: route.name, args: route.args };
    onRoute(current);
  }

  function navigate(name, { args = [], replace = false } = {}) {
    const target = buildHash(name, args, home);
    if (replace) {
      win.history.replaceState(null, '', `${win.location.pathname ?? ''}${win.location.search ?? ''}${target}`);
      sync();
    } else if (win.location.hash === target || (target === '#/' && !win.location.hash)) {
      sync();                    // same place: just re-render, no new history entry
    } else {
      win.location.hash = target; // the "hashchange" listener calls sync()
    }
  }

  function start() {
    win.addEventListener('hashchange', sync);
    sync();
  }

  return { start, navigate, get current() { return current; } };
}
