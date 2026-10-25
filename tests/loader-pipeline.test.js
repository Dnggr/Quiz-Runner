// P2-02 (pipeline), P2-03 (legacy detection), P2-05 (normalization) and the load entry point.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stripBom, extractJsonObject, removeTrailingCommas, findJsonSyntaxError, indexToLineCol,
  parseJsonTolerant, normalizePack, detectInputKind, loadInput,
} from '../js/loader.js';
import { basePack, readSample } from './helpers.js';

const json = (o) => JSON.stringify(o, null, 2);
const firstQuestion = (res) => res.pack.questions[0];

// ---------------------------------------------------------------- P2-02 pipeline steps

test('stripBom removes one leading U+FEFF and nothing else', () => {
  assert.equal(stripBom('\uFEFF{"a":1}'), '{"a":1}');
  assert.equal(stripBom('{"a":"\uFEFF"}'), '{"a":"\uFEFF"}');
  assert.equal(stripBom(undefined), '');
});

test('extractJsonObject: plain object, fenced, prose before and after, braces inside strings', () => {
  assert.equal(extractJsonObject('{"a":1}').text, '{"a":1}');
  assert.equal(extractJsonObject('```json\n{"a":1}\n```').text, '{"a":1}');
  assert.equal(extractJsonObject('Sure! Here is your quiz:\n{"a":1}\nHope that helps.').text, '{"a":1}');
  assert.equal(extractJsonObject('{"a":"} not the end {","b":{"c":2}} trailing').text, '{"a":"} not the end {","b":{"c":2}}');
  assert.equal(extractJsonObject('{"a":"say \\"}\\" now"}').text, '{"a":"say \\"}\\" now"}');
});

test('extractJsonObject: prose containing a brace before a fence is skipped; only the first object is taken', () => {
  assert.equal(extractJsonObject('Note {draft}:\n```json\n{"a":1}\n```').text, '{"a":1}');
  assert.equal(extractJsonObject('{"a":1}\n{"b":2}').text, '{"a":1}');
});

test('extractJsonObject: no object -> null; unclosed object -> complete:false', () => {
  assert.equal(extractJsonObject('no braces here'), null);
  const cut = extractJsonObject('{"a":[1,2');
  assert.equal(cut.complete, false);
  assert.equal(cut.text, '{"a":[1,2');
});

test('extractJsonObject: unterminated fence still works (reply cut off after the opening fence)', () => {
  assert.equal(extractJsonObject('```json\n{"a":1}').text, '{"a":1}');
});

test('removeTrailingCommas: blanks them (same length), leaves commas in strings and normal commas', () => {
  const src = '{"a":[1,2,],"b":"x,}","c":{"d":1,\n},}';
  const out = removeTrailingCommas(src);
  assert.equal(out.length, src.length);
  assert.deepEqual(JSON.parse(out), { a: [1, 2], b: 'x,}', c: { d: 1 } });
  assert.equal(removeTrailingCommas('{"a":1,"b":2}'), '{"a":1,"b":2}');
});

test('parseJsonTolerant: valid, repaired (trailing commas), and failed', () => {
  assert.deepEqual(parseJsonTolerant('{"a":1}'), { ok: true, value: { a: 1 }, repaired: false });
  assert.deepEqual(parseJsonTolerant('{"a":[1,],}'), { ok: true, value: { a: [1] }, repaired: true });
  const bad = parseJsonTolerant('{"a":1 "b":2}');
  assert.equal(bad.ok, false);
  assert.equal(bad.index, 7);
});

test('findJsonSyntaxError finds the right offset for common mistakes', () => {
  assert.equal(findJsonSyntaxError('{"a":1}'), null);
  assert.equal(findJsonSyntaxError('{"a":1 "b":2}').index, 7);                 // missing comma
  assert.equal(findJsonSyntaxError("{'a':1}").index, 1);                       // single quotes
  assert.equal(findJsonSyntaxError('{"a":1,}').index, 7);                      // trailing comma
  assert.equal(findJsonSyntaxError('{"a":tru}').index, 5);                     // bad literal
  assert.equal(findJsonSyntaxError('{"a":"x\ny"}').index, 7);                  // raw newline in string
  assert.equal(findJsonSyntaxError('{"a":"\\q"}').index, 6);                   // bad escape
  assert.equal(findJsonSyntaxError('{"a":01}').index, 6);                      // leading zero
  assert.equal(findJsonSyntaxError('{"a":1} x').index, 8);                     // junk after the end
  assert.equal(findJsonSyntaxError('{"a":[1,2').index, 9);                      // ends early -> at end of text
});

test('findJsonSyntaxError agrees with JSON.parse on valid and invalid inputs', () => {
  const cases = ['{}', '{"a":[]}', '{"a":-1.5e+3}', '{"a":"\\u00e9"}', '{"a":null,"b":true,"c":false}',
    '{"a":}', '{"a":[1 2]}', '{a:1}', '{"a":1,,}', '{"a":"\\u12"}', '{"a":1', '{"a":.5}', '{"a":+1}', '[1,2]'];
  for (const c of cases) {
    let engineOk = true;
    try { JSON.parse(c); } catch { engineOk = false; }
    assert.equal(findJsonSyntaxError(c) === null, engineOk, c);
  }
});

test('indexToLineCol is 1-based and handles CRLF', () => {
  assert.deepEqual(indexToLineCol('abc', 0), { line: 1, column: 1 });
  assert.deepEqual(indexToLineCol('ab\ncd', 4), { line: 2, column: 2 });
  assert.deepEqual(indexToLineCol('ab\r\ncd', 5), { line: 2, column: 2 });
});

// ---------------------------------------------------------------- loadInput: good inputs

test('plain pack loads with no errors and no warnings (samples/sample-pack.json)', () => {
  const res = loadInput(readSample('sample-pack.json'));
  assert.equal(res.kind, 'pack');
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.pack.questions.length, 10);
  assert.equal(res.repaired, false);
});

test('code-fenced, trailing-comma and BOM samples load (01, 02, 09)', () => {
  for (const f of ['01-code-fenced.json', '02-trailing-comma.json', '09-bom.json']) {
    const res = loadInput(readSample('broken', f));
    assert.equal(res.kind, 'pack', f);
    assert.equal(res.ok, true, f);
    assert.equal(res.pack.questions.length, 3, f);
  }
  assert.equal(loadInput(readSample('broken', '02-trailing-comma.json')).repaired, true);
});

test('prose before and after, and prose + fence, are ignored', () => {
  const body = json(basePack());
  for (const text of [`Here you go!\n\n${body}\n\nLet me know if you want changes.`, `Here you go:\n\`\`\`json\n${body}\n\`\`\`\nEnjoy!`]) {
    const res = loadInput(text);
    assert.equal(res.kind, 'pack');
    assert.equal(res.ok, true);
  }
});

test('Windows line endings and a BOM together', () => {
  const res = loadInput('\uFEFF' + json(basePack()).replace(/\n/g, '\r\n'));
  assert.equal(res.kind, 'pack');
  assert.equal(res.ok, true);
});

// ---------------------------------------------------------------- loadInput: error reports

test('truncated pack (03): clear "cut off" error with a position, no crash', () => {
  const res = loadInput(readSample('broken', '03-truncated.json'));
  assert.equal(res.kind, 'error');
  assert.equal(res.error.code, 'invalid_json');
  assert.equal(res.error.truncated, true);
  assert.equal(res.error.line, 8);
  assert.match(res.error.message, /cut off/);
  assert.match(res.error.message, /line 8/);
});

test('smart quotes (08): error at line 2 column 3, with a curly-quote hint', () => {
  const res = loadInput(readSample('broken', '08-smart-quotes.json'));
  assert.equal(res.kind, 'error');
  assert.equal(res.error.code, 'invalid_json');
  assert.equal(res.error.line, 2);
  assert.equal(res.error.column, 3);
  assert.equal(res.error.truncated, false);
  assert.match(res.error.message, /Curly quotes/);
});

test('syntax error in the middle: position is in the ORIGINAL text, even after a BOM, prose and blanked commas', () => {
  const text = '\uFEFFHere:\n{\n  "format": "quizrunner.quiz",\n  "list": [1, 2,],\n  "oops": 1 "next": 2\n}';
  const res = loadInput(text);
  assert.equal(res.kind, 'error');
  assert.equal(res.error.line, 5);                       // the missing comma, not the (repaired) trailing comma on line 4
  assert.equal(res.error.column, 13);
  const bomFree = stripBom(text);
  assert.equal(bomFree[res.error.index], '"');           // index points at the second quote of `"next"`
});

test('error branch never throws on odd input', () => {
  for (const text of ['{', '}', '{"a"', '{"a":', '[', '```', '```json\n```', '{"questions": [', '\u0000\u0001', '{'.repeat(2000)]) {
    assert.doesNotThrow(() => loadInput(text), JSON.stringify(text.slice(0, 20)));
  }
});

test('empty and whitespace-only input -> empty error', () => {
  for (const text of ['', '   \n\t', '\uFEFF', undefined, null]) {
    const res = loadInput(text);
    assert.equal(res.kind, 'error');
    assert.equal(res.error.code, 'empty');
  }
});

test('unrecognized text -> clear error', () => {
  const res = loadInput('hello there, this is just a sentence');
  assert.equal(res.kind, 'error');
  assert.equal(res.error.code, 'unrecognized');
});

test('JSON without questions is a pack-kind result with a blocking error (not a crash)', () => {
  const res = loadInput('{"hello": "world"}');
  assert.equal(res.kind, 'pack');
  assert.equal(res.ok, false);
  assert.equal(res.errors[0].code, 'no_questions');
});

test('a very large pack still loads (performance smoke test)', () => {
  const pack = basePack();
  const q = pack.questions[0];
  pack.questions = Array.from({ length: 2000 }, (_, i) => ({ ...q, number: i + 1, answer: 'ABCD'[i % 4] }));
  pack.meta.total_questions = 2000;
  const start = Date.now();
  const res = loadInput(json(pack));
  assert.equal(res.ok, true);
  assert.ok(Date.now() - start < 1000, 'under 1 s');
});

// ---------------------------------------------------------------- P2-03 legacy detection

test('numbered plain text is detected as legacy and returns the legacy questions', () => {
  const res = loadInput('1. What is a network?\nA. one\nB. two\n\n2. True or False: Water is wet.');
  assert.equal(res.kind, 'legacy');
  assert.deepEqual(res.questions.map((q) => [q.number, q.type]), [[1, 'mc'], [2, 'tf']]);
});

test('legacy text that mentions braces or code is still legacy', () => {
  const res = loadInput('1. What does { return 1; } do in a function body?\nA. returns 1\nB. nothing');
  assert.equal(res.kind, 'legacy');
});

test('legacy text with a BOM or Windows line endings is still legacy', () => {
  assert.equal(loadInput('\uFEFF1. Q?\r\nA. a\r\nB. b\r\n').kind, 'legacy');
});

test('detectInputKind', () => {
  assert.equal(detectInputKind(''), 'empty');
  assert.equal(detectInputKind(json(basePack())), 'json');
  assert.equal(detectInputKind('```json\n{"questions": []}\n```'), 'json');
  assert.equal(detectInputKind('{“questions”: []}'), 'json');                  // curly quotes still count as JSON-like
  assert.equal(detectInputKind('1. Q?\nA. a\nB. b'), 'legacy');
  assert.equal(detectInputKind('{"foo": 1}'), 'json');
  assert.equal(detectInputKind('just words'), 'unknown');
});

test('a Quiz Pack is never mistaken for legacy text, even if a JSON line looks like "1. ..."', () => {
  const pack = basePack();
  pack.meta.extra_numbers = [1.5, 2.5];                     // pretty-printed: a line that is just `1.5,`
  const text = json(pack);
  assert.ok(/^\s*1\.5,/m.test(text) === true);
  assert.equal(loadInput(text).kind, 'pack');
  assert.equal(loadInput(text.replace(/^\s+/gm, '')).kind, 'pack');   // same, with indentation removed: `1.5,` starts the line
});

// ---------------------------------------------------------------- P2-05 normalization

test('normalizePack: uppercases option letters and answers, trims strings', () => {
  const pack = basePack();
  pack.questions[0].answer = ' b ';
  pack.questions[0].options = { a: ' one ', b: 'two ', c: 'three', d: ' four' };
  pack.questions[0].question = '  Padded?  ';
  pack.meta.title = '  My title ';
  pack.meta.topics[0].name = ' Spaced name ';
  const out = normalizePack(pack);
  assert.equal(out.questions[0].answer, 'B');
  assert.deepEqual(out.questions[0].options, { A: 'one', B: 'two', C: 'three', D: 'four' });
  assert.equal(out.questions[0].question, 'Padded?');
  assert.equal(out.meta.title, 'My title');
  assert.equal(out.meta.topics[0].name, 'Spaced name');
});

test('normalizePack: does not modify its input', () => {
  const pack = basePack();
  pack.questions[0].answer = 'b';
  const before = JSON.stringify(pack);
  normalizePack(pack);
  assert.equal(JSON.stringify(pack), before);
});

test('normalizePack: infers type (tf when there are no options, otherwise mc) and never overrides a given type', () => {
  const pack = basePack();
  delete pack.questions[0].type;
  delete pack.questions[1].type;
  delete pack.questions[1].options;
  pack.questions[1].answer = 'true';
  pack.questions[2].type = 'tf';
  const out = normalizePack(pack);
  assert.equal(out.questions[0].type, 'mc');
  assert.equal(out.questions[1].type, 'tf');
  assert.equal(out.questions[1].answer, 'True');
  assert.equal(out.questions[2].type, 'tf');
});

test('normalizePack: true/false answers get the exact spelling True / False, mc answers become letters', () => {
  const pack = basePack();
  pack.questions[0] = { number: 1, type: 'tf', topic: 't1', question: 'Q?', answer: ' FALSE ', explanation: 'x', concept: 'c' };
  const out = normalizePack(pack);
  assert.equal(out.questions[0].answer, 'False');
});

test('normalizePack: part and total_parts default to 1, existing values are kept', () => {
  const out = normalizePack(basePack());
  assert.equal(out.meta.part, 1);
  assert.equal(out.meta.total_parts, 1);
  const pack = basePack();
  pack.meta.part = 2;
  pack.meta.total_parts = 3;
  const kept = normalizePack(pack);
  assert.equal(kept.meta.part, 2);
  assert.equal(kept.meta.total_parts, 3);
});

test('normalizePack: a lowercase answer then validates (end to end through loadInput)', () => {
  const pack = basePack();
  pack.questions[0].answer = 'b';
  pack.questions[1].answer = ' d ';
  const res = loadInput(json(pack));
  assert.equal(res.ok, true);
  assert.equal(firstQuestion(res).answer, 'B');
});

test('normalizePack: odd shapes are returned untouched and never throw', () => {
  assert.equal(normalizePack(null), null);
  assert.deepEqual(normalizePack([1, 2]), [1, 2]);
  assert.doesNotThrow(() => normalizePack({ meta: 'x', questions: [null, 5, 'str', { options: 7 }] }));
});

test('normalizePack: a "__proto__" key from untrusted JSON stays plain data', () => {
  const parsed = JSON.parse('{"questions":[],"__proto__":{"polluted":true}}');
  const out = normalizePack(parsed);
  assert.equal(({}).polluted, undefined);
  assert.equal(out.polluted, undefined);
});
