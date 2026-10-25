import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, buildHash, createRouter } from '../js/router.js';

const ROUTES = ['input', 'quiz', 'export'];

test('parseHash: empty and "#/" go home', () => {
  assert.deepEqual(parseHash('', ROUTES, 'input'), { name: 'input', args: [], known: true });
  assert.deepEqual(parseHash('#', ROUTES, 'input'), { name: 'input', args: [], known: true });
  assert.deepEqual(parseHash('#/', ROUTES, 'input'), { name: 'input', args: [], known: true });
});

test('parseHash: known routes, with and without leading slash, args decoded', () => {
  assert.equal(parseHash('#/quiz', ROUTES, 'input').name, 'quiz');
  assert.equal(parseHash('#quiz', ROUTES, 'input').name, 'quiz');
  assert.deepEqual(parseHash('#/export/a%20b/c', ROUTES, 'input'), { name: 'export', args: ['a b', 'c'], known: true });
});

test('parseHash: unknown route falls back and says so; bad escapes do not throw', () => {
  assert.deepEqual(parseHash('#/nope', ROUTES, 'input'), { name: 'input', args: [], known: false });
  assert.doesNotThrow(() => parseHash('#/quiz/%E0%A4%A', ROUTES, 'input'));
});

test('parseHash ignores a query string', () => {
  assert.equal(parseHash('#/quiz?x=1', ROUTES, 'input').name, 'quiz');
});

test('buildHash is the inverse of parseHash', () => {
  assert.equal(buildHash('input', [], 'input'), '#/');
  assert.equal(buildHash('quiz', [], 'input'), '#/quiz');
  assert.equal(buildHash('export', ['a b'], 'input'), '#/export/a%20b');
  for (const h of ['#/quiz', '#/export/a%20b']) {
    const r = parseHash(h, ROUTES, 'input');
    assert.equal(buildHash(r.name, r.args, 'input'), h);
  }
});

/** A window double with a working hash + history model. */
function fakeWindow(initialHash = '') {
  let hash = initialHash;
  const listeners = [];
  const stack = [initialHash];               // browser history entries
  return {
    stack,
    location: {
      pathname: '/', search: '',
      get hash() { return hash; },
      set hash(v) { hash = v; stack.push(v); listeners.forEach((fn) => fn()); },   // like a real hashchange
    },
    history: {
      replaceState(_state, _title, url) { hash = url.slice(url.indexOf('#')); stack[stack.length - 1] = hash; },
    },
    addEventListener(type, fn) { if (type === 'hashchange') listeners.push(fn); },
    back() { stack.pop(); hash = stack[stack.length - 1]; listeners.forEach((fn) => fn()); },
  };
}

function setup({ initialHash = '', allowed = () => null } = {}) {
  const win = fakeWindow(initialHash);
  const seen = [];
  const router = createRouter({
    win, routes: ROUTES, home: 'input',
    guard: (route) => allowed(route),
    onRoute: (r) => seen.push(r.name),
  });
  return { win, router, seen };
}

test('start renders the route in the hash (empty -> home)', () => {
  const { router, seen } = setup();
  router.start();
  assert.deepEqual(seen, ['input']);
  assert.equal(router.current.name, 'input');
});

test('navigate pushes a history entry and the hashchange listener renders it', () => {
  const { router, seen, win } = setup();
  router.start();
  router.navigate('quiz');
  assert.equal(win.location.hash, '#/quiz');
  assert.deepEqual(seen, ['input', 'quiz']);
  assert.equal(win.stack.length, 2);
});

test('back button returns to the previous screen', () => {
  const { router, seen, win } = setup();
  router.start();
  router.navigate('quiz');
  router.navigate('export');
  win.back();
  assert.equal(router.current.name, 'quiz');
  win.back();
  assert.equal(router.current.name, 'input');
  assert.deepEqual(seen, ['input', 'quiz', 'export', 'quiz', 'input']);
});

test('navigating to the current route re-renders without a new history entry', () => {
  const { router, seen, win } = setup();
  router.start();
  router.navigate('quiz');
  const before = win.stack.length;
  router.navigate('quiz');
  assert.equal(win.stack.length, before);
  assert.deepEqual(seen, ['input', 'quiz', 'quiz']);
});

test('replace navigation does not add a history entry', () => {
  const { router, win } = setup();
  router.start();
  router.navigate('quiz');
  router.navigate('input', { replace: true });
  assert.equal(win.stack.length, 2);
  assert.equal(win.location.hash, '#/');
  assert.equal(router.current.name, 'input');
});

test('guard redirects (e.g. refresh on #/quiz with nothing loaded) and fixes the address bar', () => {
  const { router, seen, win } = setup({
    initialHash: '#/quiz',
    allowed: (r) => (r.name === 'quiz' || r.name === 'export' ? 'input' : null),
  });
  router.start();
  assert.deepEqual(seen, ['input']);
  assert.equal(win.location.hash, '#/');
});

test('unknown hash goes home and is rewritten', () => {
  const { router, win } = setup({ initialHash: '#/garbage' });
  router.start();
  assert.equal(router.current.name, 'input');
  assert.equal(win.location.hash, '#/');
});

test('guard lets a route through once its precondition is met', () => {
  let loaded = false;
  const { router, win } = setup({ allowed: (r) => (r.name === 'quiz' && !loaded ? 'input' : null) });
  router.start();
  router.navigate('quiz');                 // blocked -> stays on input
  assert.equal(router.current.name, 'input');
  loaded = true;
  router.navigate('quiz');
  assert.equal(router.current.name, 'quiz');
  assert.equal(win.location.hash, '#/quiz');
});
