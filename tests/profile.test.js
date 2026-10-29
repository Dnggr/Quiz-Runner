// P6-07 (cumulative profile receipt) and P6-11 (retention check from all topics in history).
// Exams are saved through the real save path, and the profile receipt is read back with the same code the Prompt Builder
// uses, so what is tested is what the app does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareProfileReceipt, profileTopics, readHistory, loadSnapshots } from '../js/history.js';
import { parseReceipt } from '../js/receipt.js';
import { receiptInfo, defaultTopicRows, buildPrompt } from '../js/promptBuilder.js';
import { STORAGE_KEYS, STORAGE_PREFIX, packKey } from '../js/constants.js';
import { newStore, packWith, takeExam, answers } from './helpers.js';

const NOW = new Date('2026-11-01T08:00:00.000Z');
const topics = (...names) => names.map((name, i) => ({ id: `t${i + 1}`, name }));

/**
 * Three exams in "Testing":
 *   q1 (Oct 1)  t1 Networks, t2 Security   -> both weak (all wrong)
 *   q2 (Oct 8)  t1 Storage,  t2 security   -> t1 is a DIFFERENT topic that reuses id t1; "security" is Security again (name differs only by case), weak again
 *   q3 (Oct 15) t1 Networks, t2 Cloud      -> Networks all right, Cloud all right
 * Priority topics: Security (weak in 2 exams). Anchor = q3 (newest, its pack is stored).
 */
function seeded() {
  const ctx = newStore();
  const p1 = packWith('q1', topics('Networks', 'Security'));
  const p2 = packWith('q2', topics('Storage', 'security'));
  const p3 = packWith('q3', topics('Networks', 'Cloud'));
  takeExam(ctx.store, p1, '2026-10-01T10:00:00.000Z', answers(p1, []));
  takeExam(ctx.store, p2, '2026-10-08T10:00:00.000Z', answers(p2, [1, 2]));   // Storage right, security wrong
  takeExam(ctx.store, p3, '2026-10-15T10:00:00.000Z', answers(p3, [1, 2, 3, 4]));
  return ctx;
}

const parsedProfile = (store, options) => {
  const prepared = prepareProfileReceipt(store, { now: NOW, tzOffsetMinutes: 0 });
  assert.equal(prepared.ok, true);
  const receipt = prepared.build(options);
  const parsed = parseReceipt(receipt.markdown);
  assert.equal(parsed.ok, true, parsed.errors.join('; '));
  return { prepared, receipt, parsed };
};

// ---- P6-07 -------------------------------------------------------------------------------------------------------

test('P6-07 nothing to export: no history, or only an exam whose answers were not saved, says why', () => {
  const { store } = newStore();
  assert.match(prepareProfileReceipt(store).error, /at least one exam taken on this device/);
  store.set(STORAGE_KEYS.history, [{ id: 'x@1', quiz_id: 'x', title: 'X', started_at: '2026-10-01T00:00:00.000Z', totals: { total: 4, correct: 2, wrong: 2, skipped: 0, unsure: 0, percent: 50, rating: 'Needs work' }, outcomes: [], receipt_id: 'r', imported: { topics: [] } }]);
  assert.match(prepareProfileReceipt(store).error, /at least one exam taken on this device/);
});

test('P6-07 a history that cannot be read is reported and left untouched', () => {
  const { storage, store } = newStore();
  storage.setItem(STORAGE_PREFIX + STORAGE_KEYS.history, JSON.stringify({ not: 'an array' }));
  assert.match(prepareProfileReceipt(store).error, /could not be read/);
  assert.equal(storage.getItem(STORAGE_PREFIX + STORAGE_KEYS.history), JSON.stringify({ not: 'an array' }));
});

test('P6-07 the profile receipt is a normal v1 receipt of the newest exam, with history and cumulative rules on', () => {
  const { store } = seeded();
  const { receipt, parsed, prepared } = parsedProfile(store);
  assert.equal(prepared.exams, 3);
  assert.equal(parsed.warnings.length, 0);
  assert.equal(receipt.data.format, 'quizrunner.receipt');
  assert.equal(receipt.data.version, 1);
  assert.equal(receipt.data.exam.quiz_id, 'q3');                     // the anchor: newest exam with a stored pack
  assert.equal(receipt.data.history.length, 3);
  assert.deepEqual(receipt.data.cumulative.priority_topics, ['security']);   // topic name as of its most recent exam
  assert.ok(receipt.markdown.includes('## 7. History (optional)'));
  assert.ok(receipt.markdown.startsWith('<!-- BEGIN RECEIPT -->'));
  assert.match(receipt.receiptId, /^qr-q3-\d{12}$/);
});

test('P6-07 never carries missed-question detail, even if asked, and history stays on even if switched off', () => {
  const { store } = seeded();
  const { receipt } = parsedProfile(store, { missed: true, history: false });
  assert.equal('missed' in receipt.data, false);
  assert.equal(receipt.markdown.includes('## 4. Missed questions'), false);
  assert.ok('history' in receipt.data && 'cumulative' in receipt.data);
});

test('P6-07 the topic list covers every topic of every exam, matched by normalized name, not just the newest exam', () => {
  const { store } = seeded();
  const { receipt } = parsedProfile(store);
  assert.deepEqual(receipt.data.topic_list.map((t) => t.name), ['Networks', 'Cloud', 'Storage', 'security']);   // the name as of the topic's latest exam
});

test('P6-07 the anchor exam keeps its topic ids; a different topic that reuses an id gets a free one', () => {
  const { store } = seeded();
  const { receipt } = parsedProfile(store);
  const list = Object.fromEntries(receipt.data.topic_list.map((t) => [t.name, t.id]));
  assert.equal(list.Networks, 't1');     // anchor ids first: the receipt's per-topic stats refer to them
  assert.equal(list.Cloud, 't2');
  assert.equal(new Set(Object.values(list)).size, 4);   // no id used twice
  assert.deepEqual(receipt.data.topics.map((t) => [t.id, t.name]), [['t1', 'Networks'], ['t2', 'Cloud']]);
  // Stats and allocations only ever name ids that mean the same topic in the list.
  const nameOf = new Map(receipt.data.topic_list.map((t) => [t.id, t.name]));
  for (const t of receipt.data.topics) assert.equal(nameOf.get(t.id), t.name);
  for (const a of receipt.data.next_exam.allocations) assert.equal(nameOf.get(a.topic), a.name);
});

test('P6-07 covered concepts are merged across every exam, each once, under the topic\'s latest name', () => {
  const { store } = seeded();
  const { receipt } = parsedProfile(store);
  assert.deepEqual(receipt.data.covered_concepts, {
    Networks: ['Networks concept 1', 'Networks concept 2'],
    Cloud: ['Cloud concept 1', 'Cloud concept 2'],
    Storage: ['Storage concept 1', 'Storage concept 2'],
    security: ['security concept 1', 'security concept 2', 'Security concept 1', 'Security concept 2'],
  });
});

test('P6-07 the other export toggles still work', () => {
  const { store } = seeded();
  const { receipt } = parsedProfile(store, { concepts: false, formatSpec: false });
  assert.equal('covered_concepts' in receipt.data, false);
  assert.equal(receipt.markdown.includes('## 9. '), false);
  assert.equal(receipt.markdown.includes('## 10. '), false);
  const full = parsedProfile(store).receipt;
  assert.ok(full.markdown.includes('## 9. ') && full.markdown.includes('## 10. '));
});

test('P6-07 same device, same clock: same receipt text (reproducible)', () => {
  const { store } = seeded();
  assert.equal(parsedProfile(store).receipt.markdown, parsedProfile(store).receipt.markdown);
});

test('P6-07 an exam whose pack is gone is skipped as the anchor; the next newest is used and the pack-less exam still counts in the history', () => {
  const { store } = seeded();
  store.remove(packKey('q3'));
  const { receipt } = parsedProfile(store);
  assert.equal(receipt.data.exam.quiz_id, 'q2');
  assert.equal(receipt.data.history.length, 3);
});

test('P6-07 an exam imported from a receipt contributes its topics to the profile, after the exams taken here', () => {
  const { store } = seeded();
  const history = readHistory(store).entries;
  store.set(STORAGE_KEYS.history, [...history, {
    entry_version: 1, id: 'q9@2026-10-20T10:00:00.000Z', quiz_id: 'q9', title: 'Imported', subject: 'Testing', quiz_type: 'custom', quiz_number: null,
    started_at: '2026-10-20T10:00:00.000Z', finished_at: '', spec_version: 1, app_version: '2.0.0',
    totals: { total: 4, correct: 2, wrong: 2, skipped: 0, unsure: 0, percent: 50, rating: 'Needs work' }, outcomes: [], receipt_id: 'qr-q9-1',
    imported: { at: NOW.toISOString(), topics: [{ id: 't1', name: 'Databases', status: 'weak', accuracy: 0.5 }], missed: [], covered_concepts: { Databases: ['Joins'] } },
  }]);
  const { receipt } = parsedProfile(store);
  assert.equal(receipt.data.exam.quiz_id, 'q3');   // an imported exam has no answers, so it is never the anchor
  const names = receipt.data.topic_list.map((t) => t.name);
  assert.ok(names.includes('Databases'));
  assert.deepEqual(receipt.data.covered_concepts.Databases, ['Joins']);
  assert.equal(new Set(receipt.data.topic_list.map((t) => t.id)).size, names.length);
  assert.equal(receipt.data.history.length, 4);
});

test('profileTopics: junk entries and missing packs never crash it', () => {
  const entries = [{ quiz_id: 'a' }, { quiz_id: 5 }, { quiz_id: 'b', imported: { topics: 'nope' } }, { quiz_id: 'c', imported: { topics: [null, { name: '  ' }, { id: 't1', name: 'Real' }], covered_concepts: { Real: ['x', 5, ''] } } }];
  const out = profileTopics(entries, () => null, entries[3]);
  assert.deepEqual(out.topicList, [{ id: 't1', name: 'Real' }]);
  assert.deepEqual(out.concepts, { Real: ['x'] });
});

// ---- P6-11 -------------------------------------------------------------------------------------------------------

test('P6-11 the retention rows cover all topics in history, with one extra question for each priority topic', () => {
  const { store } = seeded();
  const { parsed } = parsedProfile(store);
  const read = receiptInfo(parsed);
  assert.equal(read.ok, true);
  assert.deepEqual(read.info.priorityNames, ['security']);
  assert.deepEqual(read.info.priorityIds.length, 1);

  // 4 topics + 1 priority topic = 5 questions: exactly one each, two for the priority topic.
  const rows = defaultTopicRows(read.info, 'retention', 5);
  assert.equal(rows.length, 4);
  const byName = Object.fromEntries(rows.map((r) => [r.name, r.count]));
  assert.deepEqual(byName, { security: 2, Networks: 1, Cloud: 1, Storage: 1 });
  assert.equal(rows.find((r) => r.name === 'security').reason, 'priority topic');
});

test('P6-11 whatever the requested total, the counts add up to exactly it and priority topics never get less than the others', () => {
  const { store } = seeded();
  const info = receiptInfo(parsedProfile(store).parsed).info;
  for (const n of [4, 5, 10, 12, 15]) {
    const rows = defaultTopicRows(info, 'retention', n);
    assert.equal(rows.reduce((a, r) => a + r.count, 0), n);
    const security = rows.find((r) => r.name === 'security').count;
    for (const r of rows) assert.ok(security >= r.count, `n=${n}: ${r.name}`);
  }
});

test('P6-11 the prompt asks for new questions across all the history topics, names the priority topics and states every topic id and name', () => {
  const { store } = seeded();
  const { parsed } = parsedProfile(store);
  const built = buildPrompt({ mode: 'retention', subject: 'Testing', count: 12, receipt: parsed }, { snapshots: loadSnapshots(store) });
  assert.equal(built.ok, true, built.errors.join('; '));
  assert.ok(built.prompt.includes('retention check of exactly 12 NEW'));
  assert.ok(built.prompt.includes('give 1 extra question to each priority topic: security'));
  for (const name of ['Networks', 'Cloud', 'Storage', 'security']) assert.ok(built.prompt.includes(`"name": "${name}"`), name);
  assert.ok(built.prompt.includes('Set "quiz_type" to "retention"'));
  assert.equal(built.meta.quizNumber, 4);   // three exams with three quiz ids are already stored in "Testing"
});

test('P6-07 a NEWER imported exam that reuses an id of the anchor exam cannot take it: the per-topic stats must keep meaning the same topic', () => {
  const { store } = seeded();   // anchor q3: t1 Networks, t2 Cloud
  store.set(STORAGE_KEYS.history, [...readHistory(store).entries, {
    entry_version: 1, id: 'q9@2026-10-25T10:00:00.000Z', quiz_id: 'q9', title: 'Imported', subject: 'Testing', quiz_type: 'custom', quiz_number: null,
    started_at: '2026-10-25T10:00:00.000Z', finished_at: '', spec_version: 1, app_version: '2.0.0',
    totals: { total: 4, correct: 2, wrong: 2, skipped: 0, unsure: 0, percent: 50, rating: 'Needs work' }, outcomes: [], receipt_id: 'qr-q9-1',
    imported: { at: NOW.toISOString(), topics: [{ id: 't1', name: 'Databases', status: 'weak', accuracy: 0.5 }, { id: 't2', name: 'Compilers', status: 'weak', accuracy: 0.5 }], missed: [], covered_concepts: {} },
  }]);
  const { receipt } = parsedProfile(store);
  const idOf = Object.fromEntries(receipt.data.topic_list.map((t) => [t.name, t.id]));
  assert.equal(idOf.Networks, 't1');
  assert.equal(idOf.Cloud, 't2');
  assert.notEqual(idOf.Databases, 't1');
  assert.equal(new Set(Object.values(idOf)).size, receipt.data.topic_list.length);
  const nameOf = new Map(receipt.data.topic_list.map((t) => [t.id, t.name]));
  for (const t of receipt.data.topics) assert.equal(nameOf.get(t.id), t.name);
});
