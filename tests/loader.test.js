import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLegacyText } from '../js/loader.js';

test('empty / junk input yields no questions', () => {
  assert.deepEqual(parseLegacyText(''), []);
  assert.deepEqual(parseLegacyText('hello there\nno numbers here'), []);
});

test('multiple choice: options A-D, uppercase-normalised, type mc', () => {
  const [q] = parseLegacyText(`1. What is the primary purpose of a computer network?
A. To increase the physical size of computers
b) To allow devices to communicate and share resources
C. To eliminate the need for operating systems
d. To prevent devices from communicating with one another`);
  assert.equal(q.number, 1);
  assert.equal(q.type, 'mc');
  assert.equal(q.text, 'What is the primary purpose of a computer network?');
  assert.deepEqual(q.options.map((o) => o.letter), ['A', 'B', 'C', 'D']);
  assert.equal(q.options[1].text, 'To allow devices to communicate and share resources');
});

test('true/false: no options -> True/False options, "True or False:" prefix removed', () => {
  const [q] = parseLegacyText('37. True or False: A device can have both a MAC address and an IP address.');
  assert.equal(q.number, 37);
  assert.equal(q.type, 'tf');
  assert.equal(q.text, 'A device can have both a MAC address and an IP address.');
  assert.deepEqual(q.options, [{ letter: 'True', text: 'True' }, { letter: 'False', text: 'False' }]);
});

test('bold numbering **1.** and **2.** is accepted', () => {
  const qs = parseLegacyText('**1.** First?\nA. a\nB. b\n\n**2.** Second?\nA. a\nB. b');
  assert.deepEqual(qs.map((q) => q.number), [1, 2]);
  assert.equal(qs[0].text, 'First?');
});

test('question text continues on following lines until the first option', () => {
  const [q] = parseLegacyText('5. A long question\nthat wraps onto a second line?\nA. one\nB. two\nstray line after options');
  assert.equal(q.text, 'A long question that wraps onto a second line?');
  assert.equal(q.options.length, 2);               // the stray line is ignored once options started
});

test('Windows line endings and blank lines are fine; numbering is kept as written', () => {
  const qs = parseLegacyText('10. Ten?\r\nA. a\r\nB. b\r\n\r\n3. Three?\r\nA. a\r\nB. b\r\n');
  assert.deepEqual(qs.map((q) => q.number), [10, 3]);
});

test('an option-looking line before any question is ignored', () => {
  const qs = parseLegacyText('A. orphan\n1. Real?\nA. yes\nB. no');
  assert.equal(qs.length, 1);
  assert.equal(qs[0].options.length, 2);
});

test('mixed mc and tf in one paste', () => {
  const qs = parseLegacyText('1. MC?\nA. a\nB. b\n2. TF statement.');
  assert.deepEqual(qs.map((q) => q.type), ['mc', 'tf']);
});
