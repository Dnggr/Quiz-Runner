// BUG-06: the unsupported-file message reads as a sentence. The helper is pure; the DOM code around it is not tested here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { listWithOr } from '../js/ui/loadpack.js';
import { ACCEPTED_FILE_EXTENSIONS } from '../js/constants.js';

test('BUG-06 listWithOr joins the last item with "or"', () => {
  assert.equal(listWithOr([]), '');
  assert.equal(listWithOr(['.json']), '.json');
  assert.equal(listWithOr(['.json', '.txt']), '.json or .txt');
  assert.equal(listWithOr(['.json', '.txt', '.md']), '.json, .txt or .md');
});

test('BUG-06 the accepted extensions are named in the message with "or" before the last one', () => {
  assert.equal(listWithOr(ACCEPTED_FILE_EXTENSIONS), '.json, .txt or .md');
  const src = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', 'js/ui/loadpack.js'), 'utf8');
  assert.match(src, /Choose a \$\{listWithOr\(ACCEPTED_FILE_EXTENSIONS\)\} file\./);
  assert.doesNotMatch(src, /ACCEPTED_FILE_EXTENSIONS\.join\(', '\)/, 'no plain comma join is left in the message');
});
