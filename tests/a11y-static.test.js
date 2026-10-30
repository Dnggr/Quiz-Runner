// P8-01 / P8-02 / P8-03 static guards. The project has no DOM test dependency, so these read the source files, like
// exam-dom-guard.test.js. The behaviour itself (roles, focus, shortcuts) was driven in a headless DOM by hand; these tests
// stop the parts that are easy to undo by accident: 16px inputs, safe-area padding, one focus ring, real buttons for options,
// a mark besides colour, and the keyboard hint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const css = read('css/styles.css');
const html = read('index.html');

/** [{ selectors, body }] for every top-level and @media rule in the stylesheet (comments dropped). */
function cssRules(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...clean.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1].trim(), body: m[2] }));
}

// ---- P8-03: 16px inputs and safe-area padding -----------------------------------------------------------------------------
test('P8-03 every rule that styles a text field sets a font size of at least 16px (prevents iOS zoom on focus)', () => {
  const fieldRule = /(^|,)\s*(textarea|select|\.field input[^,]*|input\[type="(text|number)"\][^,]*|\.pb-row input[^,]*)\s*(,|$)/;
  const withSize = [];
  for (const { selectors, body } of cssRules(css)) {
    if (!fieldRule.test(selectors)) continue;
    const size = body.match(/font-size:\s*(\d+(?:\.\d+)?)px/);
    if (size) {
      withSize.push(selectors);
      assert.ok(Number(size[1]) >= 16, `${selectors} has font-size ${size[1]}px`);
    }
  }
  assert.ok(withSize.length >= 3, 'textarea, .field inputs and the Prompt Builder number inputs each set a size');
  const textarea = cssRules(css).find((r) => r.selectors === 'textarea');
  assert.match(textarea.body, /font-size:\s*16px/);
  const fieldInputs = cssRules(css).find((r) => r.selectors.startsWith('.field input[type="text"]'));
  assert.match(fieldInputs.body, /font-size:\s*16px/);
});

test('P8-03 every text field and textarea in index.html is covered by a 16px rule (no inline smaller size)', () => {
  for (const tag of html.match(/<(input|textarea|select)\b[^>]*>/g) || []) {
    const inline = tag.match(/font-size:\s*(\d+)px/);
    if (inline) assert.ok(Number(inline[1]) >= 16, tag);
  }
});

test('P8-03 the page is drawn edge to edge and padded by all four safe-area insets', () => {
  assert.match(html, /<meta name="viewport"[^>]*viewport-fit=cover/);
  for (const side of ['top', 'bottom', 'left', 'right']) {
    assert.match(css, new RegExp(`--safe-${side}:\\s*env\\(safe-area-inset-${side}`), `--safe-${side} is defined`);
  }
  const wrap = cssRules(css).find((r) => r.selectors === '.wrap');
  for (const side of ['top', 'bottom', 'left', 'right']) assert.match(wrap.body, new RegExp(`--safe-${side}`), `.wrap uses --safe-${side}`);
  const backdrop = cssRules(css).find((r) => r.selectors === '.dialog-backdrop');
  for (const side of ['top', 'bottom', 'left', 'right']) assert.match(backdrop.body, new RegExp(`--safe-${side}`), `.dialog-backdrop uses --safe-${side}`);
  const phone = css.slice(css.indexOf('@media (max-width: 420px)'));
  assert.match(phone, /\.wrap\{[^}]*--safe-left[^}]*--safe-right/, 'the small-phone padding keeps the side insets');
});

// ---- P8-01: roles, labels, focus, never colour alone ------------------------------------------------------------------------
test('P8-01 both exam screens draw each option as a <button role="radio"> with aria-checked, inside a named radiogroup', () => {
  for (const file of ['js/ui/exam.js', 'js/ui/quickpaste.js']) {
    const src = code(file);
    assert.match(src, /createElement\('button'\)[\s\S]{0,200}el\.type = 'button'/, `${file}: options are buttons`);
    assert.match(src, /setAttribute\('role', 'radio'\)/, file);
    assert.match(src, /setAttribute\('aria-checked'/, file);
    assert.ok(!/innerHTML|insertAdjacentHTML/.test(src), `${file}: pack text is untrusted, textContent only`);
  }
  assert.match(html, /id="exOptions" role="radiogroup" aria-labelledby="exQLabel exQText"/);
  assert.match(html, /id="optionsWrap" role="radiogroup" aria-labelledby="qLabel qText"/);
});

test('P8-01 the jump cells on both exam screens are buttons with an aria-label that names the state', () => {
  for (const file of ['js/ui/exam.js', 'js/ui/quickpaste.js']) {
    const src = code(file);
    assert.match(src, /btn\.type = 'button'/, file);
    assert.match(src, /btn\.setAttribute\('aria-label', `Question \$\{q\.number\}, /, file);
    assert.match(src, /aria-current/, file);
    assert.match(src, /`\$\{q\.number\}\?`/, `${file}: "not sure" cells show a "?"`);
  }
});

test('P8-01 one focus-visible ring covers buttons, summaries, inputs, textareas and focusable elements, and no rule removes it for keyboard users', () => {
  const ring = cssRules(css).find((r) => /button:focus-visible/.test(r.selectors) && /textarea:focus-visible/.test(r.selectors));
  assert.ok(ring, 'a shared focus-visible rule exists');
  assert.match(ring.body, /outline:\s*2px solid var\(--accent\)/);
  for (const sel of ['summary:focus-visible', 'input:focus-visible', 'select:focus-visible', '[tabindex]:focus-visible']) assert.ok(ring.selectors.includes(sel), sel);
  assert.ok(css.indexOf('button:focus-visible,summary:focus-visible') > css.indexOf('textarea:focus{outline:none'), 'the shared ring comes after the rule that hides the default one');
  assert.ok(!/:focus-visible\s*\{[^}]*outline:\s*none/.test(css), 'nothing turns the ring off');
});

test('P8-01 colour is never the only signal: the jump grid and the results carry a mark or a word as well', () => {
  assert.match(css, /\.jump\.answered::after\{content:"\\2713"/, 'answered cells show a check');
  assert.match(css, /\.jump\.current\{[^}]*(underline|font-weight:700)/, 'the current cell is not only a different colour');
  const results = code('js/ui/results.js');
  for (const mark of ["icon: '✓', label: 'Correct'", "icon: '✗', label: 'Wrong'", "icon: '–', label: 'Skipped'"]) assert.ok(results.includes(mark), mark);
  assert.match(results, /icon: '▼', label: 'Weak'/);
  assert.match(results, /\? Marked not sure/);
});

test('P8-01 the progress pill is a status region, so a screen reader hears the new question number', () => {
  assert.match(html, /id="exProgressPill" role="status"/);
  assert.match(html, /id="progressPill" role="status"/);
});

// ---- P8-02: shortcuts ----------------------------------------------------------------------------------------------------
test('P8-02 both exam screens route key presses through examShortcut and only while their own screen is showing', () => {
  const exam = code('js/ui/exam.js');
  assert.match(exam, /examShortcut\(e, /);
  assert.match(exam, /\$\('screen-exam'\)\.classList\.contains\('active'\)/);
  assert.match(exam, /if \(dialogOpen\) \{[\s\S]*?return;/, 'no question shortcuts while the finish confirmation is open');
  const quick = code('js/ui/quickpaste.js');
  assert.match(quick, /examShortcut\(e, /);
  assert.match(quick, /\$\('screen-quiz'\)\.classList\.contains\('active'\)/);
});

test('P8-02 the shortcuts are announced: aria-keyshortcuts on the buttons and a hint shown only with a mouse and keyboard', () => {
  for (const [id, key] of [['exPrevBtn', 'P'], ['exUnsureBtn', 'U'], ['exNextBtn', 'N'], ['prevBtn', 'P'], ['unsureBtn', 'U'], ['nextBtn', 'N']]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-keyshortcuts="${key}"`), id);
  }
  assert.equal((html.match(/class="kbd-hint"/g) || []).length, 2);
  assert.match(css, /\.kbd-hint\{display:none/);
  assert.match(css, /@media \(hover:hover\) and \(pointer:fine\)\{\s*\.kbd-hint\{display:block/);
});
