// Shared test helpers (not a test file: node --test only runs *.test.js).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const samples = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'samples');
export const readSample = (...p) => readFileSync(join(samples, ...p), 'utf8');

/** A small valid 4-question pack (answers B, D, A, C; one topic list of two). Deep-cloned per call. */
export function basePack() {
  const mc = (number, topic, answer) => ({
    number, type: 'mc', topic, concept: `Concept ${number}`, difficulty: 'easy', skill: 'definition',
    question: `Question text ${number}?`,
    options: { A: 'a', B: 'b', C: 'c', D: 'd' },
    answer,
    explanation: `Because ${answer}.`,
  });
  return {
    format: 'quizrunner.quiz',
    version: 1,
    meta: {
      quiz_id: 'test-pack-01', title: 'Test pack', subject: 'Testing', quiz_type: 'custom', total_questions: 4,
      topics: [{ id: 't1', name: 'One', subtopics: [] }, { id: 't2', name: 'Two', subtopics: [] }],
      notes: [],
    },
    questions: [mc(1, 't1', 'B'), mc(2, 't1', 'D'), mc(3, 't2', 'A'), mc(4, 't2', 'C')],
  };
}
