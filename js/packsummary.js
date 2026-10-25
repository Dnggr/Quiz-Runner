// packsummary.js — what the Topics preview screen (P2-07) shows about a loaded pack. Pure module: no DOM.
// Input is a normalized, error-free pack (see loader.js `loadInput`). Pack content is untrusted, so every
// field is type-checked and anything unexpected is dropped rather than shown.
import { DIFFICULTIES } from './constants.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const textList = (v) => (Array.isArray(v) ? v : []).map(text).filter(Boolean);

/**
 * @typedef {{ id: string, name: string, subtopics: string[], count: number }} TopicSummary
 * @typedef {{
 *   title: string, subject: string, questionCount: number,
 *   topics: TopicSummary[],
 *   difficulty: { level: string, count: number, percent: number }[],
 *   untaggedDifficulty: number,
 *   notes: string[],
 * }} PackSummary
 */

/**
 * @param {any} pack
 * @returns {PackSummary}
 *   `difficulty` always lists easy, moderate, challenging in that order (count 0 when absent); `percent` is a whole
 *   number of all questions. Questions with no or an unknown `difficulty` count as `untaggedDifficulty`.
 *   `notes` accepts the spec's array of strings and, leniently, a single string.
 */
export function summarizePack(pack) {
  const meta = isPlainObject(pack) && isPlainObject(pack.meta) ? pack.meta : {};
  const questions = isPlainObject(pack) && Array.isArray(pack.questions) ? pack.questions.filter(isPlainObject) : [];

  const perTopic = new Map();
  const perLevel = new Map(DIFFICULTIES.map((level) => [level, 0]));
  let untagged = 0;
  for (const q of questions) {
    perTopic.set(q.topic, (perTopic.get(q.topic) || 0) + 1);
    if (perLevel.has(q.difficulty)) perLevel.set(q.difficulty, perLevel.get(q.difficulty) + 1);
    else untagged++;
  }

  const topics = (Array.isArray(meta.topics) ? meta.topics : [])
    .filter((t) => isPlainObject(t) && text(t.id))
    .map((t) => ({
      id: text(t.id),
      name: text(t.name) || text(t.id),
      subtopics: textList(t.subtopics),
      count: perTopic.get(text(t.id)) || 0,
    }));

  const total = questions.length;
  return {
    title: text(meta.title) || 'Untitled Quiz Pack',
    subject: text(meta.subject),
    questionCount: total,
    topics,
    difficulty: DIFFICULTIES.map((level) => {
      const count = perLevel.get(level);
      return { level, count, percent: total ? Math.round((100 * count) / total) : 0 };
    }),
    untaggedDifficulty: untagged,
    notes: typeof meta.notes === 'string' ? textList([meta.notes]) : textList(meta.notes),
  };
}
