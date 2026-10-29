// Shared test helpers (not a test file: node --test only runs *.test.js).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createStore } from '../js/store.js';
import { buildSession } from '../js/session.js';
import { gradeExam } from '../js/grader.js';
import { selectOption } from '../js/exam.js';
import { saveFinishedExam } from '../js/history.js';
import { strict as assert } from 'node:assert';

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

// ---- Phase 6 helpers (P6-07..P6-11) ------------------------------------------------------------------------------
/** A localStorage double that can also be listed (`length` / `key(i)`) and can run out of room (`quotaAfter` = max number of keys). */
export function fakeStorage({ quotaAfter = Infinity } = {}) {
  const data = new Map();
  return {
    data,
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (!data.has(k) && data.size >= quotaAfter) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
      data.set(k, String(v));
    },
    removeItem: (k) => { data.delete(k); },
  };
}

export const newStore = (options) => { const storage = fakeStorage(options); return { storage, store: createStore({ storage }) }; };

/**
 * A pack with the given topics ([{ id, name }]), two questions per topic, every answer "A". Concepts are `<name> concept 1|2`.
 * Picking "B" is a miss; leaving a number out skips it.
 */
export function packWith(quizId, topics, { subject = 'Testing', title = `Exam ${quizId}` } = {}) {
  const questions = [];
  for (const t of topics) {
    for (const k of [1, 2]) {
      const number = questions.length + 1;
      questions.push({
        number, type: 'mc', topic: t.id, concept: `${t.name} concept ${k}`, difficulty: 'easy', skill: 'definition',
        question: `Question ${number} about ${t.name}?`, options: { A: 'a', B: 'b', C: 'c', D: 'd' }, answer: 'A', explanation: `Because A (${number}).`,
      });
    }
  }
  return {
    format: 'quizrunner.quiz', version: 1,
    meta: { quiz_id: quizId, title, subject, quiz_type: 'custom', total_questions: questions.length, topics: topics.map((t) => ({ id: t.id, name: t.name, subtopics: [] })), notes: [] },
    questions,
  };
}

/** Take and save an exam through the app's own save path. `picks`: question number -> letter; a missing number is skipped. */
export function takeExam(store, pack, startedAt, picks = {}) {
  let session = buildSession(pack, new Date(startedAt));
  let responses = session.responses;
  for (const [number, letter] of Object.entries(picks)) responses = selectOption(responses, Number(number), letter);
  session = { ...session, responses, finished: true, finished_at: new Date(Date.parse(startedAt) + 600000).toISOString() };
  assert.deepEqual(saveFinishedExam(store, session, gradeExam(session.pack, session.responses)), { packSaved: true, historySaved: true });
  return `${pack.meta.quiz_id}@${session.started_at}`;
}

/** Answers for `packWith` packs: `right` = question numbers answered correctly, every other one is wrong ("B"). */
export const answers = (pack, right = []) => Object.fromEntries(pack.questions.map((q) => [q.number, right.includes(q.number) ? 'A' : 'B']));
