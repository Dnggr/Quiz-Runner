import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
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

// ---- P6-02: an old exam is addressed by its id in the hash ------------------------------------------------------------
test('P6-02 an exam id (quiz id, "@", an ISO time with colons) survives the trip through the hash', () => {
  const known = ['input', 'progress', 'past'];
  for (const id of ['test-pack-01@2026-10-25T10:00:00.000Z', 'a b/c@d?e#f', 'ünï@x']) {
    const hash = buildHash('past', [id], 'input');
    assert.match(hash, /^#\/past\/[^/]+$/, 'one path segment, even when the id has a slash');
    assert.deepEqual(parseHash(hash, known, 'input'), { name: 'past', args: [id], known: true });
  }
});

// ---- BUG-05: one Back press after finishing an exam must reach the start screen ---------------------------------------
// A finished exam has no exam screen to return to: the guard sends #/exam straight on to #/results. So the route that
// finishes the exam has to REPLACE the exam's history entry. Pushing Results on top leaves a dead step that Back lands on
// (it bounces to Results again), and only the second Back reaches the start screen.
function examLikeSetup() {
  let finished = false;
  const ctx = setup({
    allowed: (r) => (r.name === 'quiz' && finished ? 'export' : null),   // 'quiz' plays the exam, 'export' plays Results
  });
  return { ...ctx, finish: () => { finished = true; } };
}

test('BUG-05 finishing with replace: Back from Results reaches the start screen in one press', () => {
  const { router, win, finish } = examLikeSetup();
  router.start();
  router.navigate('quiz');                              // start the exam
  finish();
  router.navigate('export', { replace: true });         // what main.js onFinish does now
  assert.deepEqual(win.stack, ['', '#/export']);
  win.back();
  assert.equal(router.current.name, 'input', 'one Back is enough');
});

test('BUG-05 (why) finishing with a plain push leaves a dead history step: the first Back stays on Results', () => {
  const { router, win, finish } = examLikeSetup();
  router.start();
  router.navigate('quiz');
  finish();
  router.navigate('export');                            // the old behaviour
  win.back();                                           // lands on #/quiz, which the guard bounces to Results
  assert.equal(router.current.name, 'export', 'the first Back appears to do nothing');
  win.back();
  assert.equal(router.current.name, 'input', 'only the second Back reaches the start screen');
});

test('BUG-05 main.js finishes the exam by replacing the exam entry with Results', () => {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const main = readFileSync(join(root, 'js/main.js'), 'utf8').replace(/\/\/.*$/gm, '');
  const onFinish = main.slice(main.indexOf('onFinish:'), main.indexOf('onQuit:'));
  assert.match(onFinish, /router\.navigate\('results',\s*\{\s*replace:\s*true\s*\}\)/);
});
