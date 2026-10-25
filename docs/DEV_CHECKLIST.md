# Quiz Runner v2 — Dev Checklist

Work top to bottom. Each phase ends in something usable. Tick boxes as you go.
References: `PLAN.md` (why) · `ai/QUIZ_PACK_SPEC.md` · `ai/RECEIPT_SPEC.md` · `ai/PROMPT_TEMPLATES.md`.

**MVP = Phases 0–5** (load a pack → take exam → graded results → receipt → Prompt Builder). Phases 6–8 make it durable and polished.

---

## Phase 0 — Lock the contracts
- [ ] P0-01 Read and approve `QUIZ_PACK_SPEC.md` (v1 fields, required vs optional)
- [ ] P0-02 Read and approve `RECEIPT_SPEC.md` (thresholds, rating bands, allocation rule)
- [ ] P0-03 Read and approve `PROMPT_TEMPLATES.md` wording
- [ ] P0-04 Git tag the current app as `v1-legacy` (rollback point)
- [x] P0-05 Create `samples/sample-pack.json` (10 questions, 3 topics, includes one True/False)
- [ ] P0-06 Generate `samples/sample-pack-130.json` from real course files with an AI (performance test + real-world format check)
- [x] P0-07 Create `samples/broken/` with one file per failure: code-fenced JSON, trailing comma, truncated output, missing `answer`, answer letter not in options, duplicate question numbers, unknown topic id, smart quotes as delimiters, BOM at start
- [x] P0-08 Create `samples/sample-receipt.md` by hand from the template in `RECEIPT_SPEC.md`

**Done when:** all three docs are approved and the samples exist.

## Phase 1 — Foundation (no visible change)
- [x] P1-01 Split `index.html` into `css/styles.css` and `js/*.js` ES modules (see `PLAN.md` §8)
- [x] P1-02 Verify legacy flow is identical (paste text → answer → export `1. B` list)
- [x] P1-03 `constants.js`: `SPEC_VERSION`, `APP_VERSION`, thresholds, storage keys
- [x] P1-04 `store.js`: namespaced keys (`qr:v1:`), try/catch on every access, in-memory fallback if `localStorage` is unavailable
- [x] P1-05 Simple screen router (hash-based so the phone's back button works)
- [x] P1-06 Test harness with `node --test` for pure modules
- [x] P1-07 Local dev command documented (`npx serve .`) — ES modules don't run from `file://`

**Done when:** the app behaves exactly like today, but from modules, and the tests run.

## Phase 2 — Quiz Pack in
- [ ] P2-01 Load by paste, file picker, and drag-and-drop (`.json`, `.txt`, `.md`)
- [x] P2-02 `loader.js` pipeline: strip BOM → strip code fences / surrounding prose → extract first top-level `{…}` → `JSON.parse` → on failure remove trailing commas and retry → else report error with position
- [x] P2-03 Detect legacy plain-text input and route to "Quick Paste (answers only)" mode (today's behaviour)
- [x] P2-04 `validator.js` with **errors** (block) and **warnings** (allow):
  - errors: missing `questions`, missing `question` / `answer` / `topic`, answer not in options, duplicate `number`, topic id not in `meta.topics`
  - warnings: count ≠ `meta.total_questions`, missing `explanation`, answer letters badly skewed (any letter > 40%), option count ≠ 4, missing `concept`
- [x] P2-05 Normalize on load: uppercase letters, trim whitespace, infer `type` if missing, default `part`/`total_parts`
- [x] P2-06 Friendly error screen listing problems by question number
- [x] P2-07 Topics preview screen (title, topics + subtopics, count, difficulty mix, `meta.notes`)
- [x] P2-08 Warn (don't block) if pack `version` differs from `SPEC_VERSION`
- [x] P2-09 Unit tests for every file in `samples/` and `samples/broken/`

**Done when:** every good sample loads, every broken sample gives a clear message, and nothing crashes.

## Phase 3 — Exam and results
- [x] P3-01 Response model per question: `{ selected: 'A'|…|null, unsure: boolean }`
- [x] P3-02 "Not sure" UX (confirm): no option selected → mark unsure and advance (as today); option selected → toggle flag and stay
- [x] P3-03 Autosave to `session` on every change; resume banner on app load
- [x] P3-04 Finish confirmation showing unanswered and unsure counts, with shortcuts "Go to first unanswered" / "Review unsure"
- [x] P3-05 `grader.js` (pure): pack + responses → per-question outcome (`correct` / `wrong` / `skipped`, plus `unsure`) and totals
- [x] P3-06 Results screen — Overview: score `x/N`, percentage, rating, counts
- [x] P3-07 Results — Review: filter chips (Wrong · Unsure · Skipped · All); each item shows question, your answer, correct answer, explanation, topic, concept
- [x] P3-08 Jump grid on results colored by outcome
- [x] P3-09 Save graded result to `history`; save pack as `pack:<quiz_id>`
- [x] P3-10 Answers never appear in the DOM during the exam (not even hidden), only after finish
- [x] P3-11 Unit tests: all correct, all wrong, all skipped, mix, True/False, unsure combinations

**Done when:** you can take the sample pack end to end and see correct scores and feedback.

## Phase 4 — Analytics and Receipt
- [ ] P4-01 `analytics.js` topic stats: total, correct, wrong, skipped, unsure, shaky (correct + unsure), accuracy
- [ ] P4-02 Topic status: `weak` · `developing` · `watch` · `strong` · `insufficient` (rules in `RECEIPT_SPEC.md` §3)
- [ ] P4-03 Overall rating from percentage bands
- [ ] P4-04 Split misses into **gaps** (skipped / unsure) and **misconceptions** (wrong and confident)
- [ ] P4-05 Rank weaknesses (misses desc, then accuracy asc); list strengths
- [ ] P4-06 Next-exam recommendation (allocation algorithm in `RECEIPT_SPEC.md` §6)
- [ ] P4-07 Results tabs: Topics (bars + status chips) and Next steps (what to study, what to take next)
- [ ] P4-08 `receipt.js`: build Markdown receipt and JSON receipt
- [ ] P4-09 Export screen toggles: missed-question detail · cumulative history · covered concepts · next-quiz format instructions (default on)
- [ ] P4-10 Copy / Download `.md` / Download `.json`; show approximate size ("≈ 4k tokens" = chars ÷ 4)
- [ ] P4-11 Keep legacy "answers only" export for Quick Paste mode
- [ ] P4-12 Golden-file test: sample pack + fixed responses → exact expected receipt text

**Done when:** a receipt pasted into Claude and ChatGPT lets them explain your mistakes and propose the next quiz without extra context.

## Phase 5 — Prompt Builder
- [ ] P5-01 Screen with fields: mode · subject · learner description · question count · difficulty mix (default 30/40/30) · skill coverage checkboxes · delivery (file or code block / split into parts of N)
- [ ] P5-02 Mode presets: initial 130 · targeted 40 · retention 12 (all editable)
- [ ] P5-03 `promptBuilder.js` (pure) assembling the blocks from `PROMPT_TEMPLATES.md`
- [ ] P5-04 Embed the compact format spec in every prompt (prompt must work in a fresh chat)
- [ ] P5-05 Targeted / retention: paste receipt or "Use latest from this device"; validate and summarize what will be targeted; allow editing question counts per topic
- [ ] P5-06 Force topic reuse: embed exact topic ids and names from the receipt
- [ ] P5-07 Live preview, Copy, Download `.md`, length estimate
- [ ] P5-08 Remember last-used options in `settings`
- [ ] P5-09 "Next quiz prompt" button on Results/Receipt opens the builder prefilled in targeted mode
- [ ] P5-10 Test: `SPEC_VERSION` in generated prompt equals the loader's supported version
- [ ] P5-11 Snapshot tests for each mode

**Done when:** prompt → AI → pack → exam → receipt → next prompt works as a full loop.

## Phase 6 — History and learner profile
- [ ] P6-01 Progress screen: list of exams (date, title, score, rating)
- [ ] P6-02 Open an old exam read-only (uses stored pack)
- [ ] P6-03 Topic mastery across exams (matched by normalized topic name)
- [ ] P6-04 Priority topics: weak in ≥ 2 distinct exams
- [ ] P6-05 Compare with previous exam: score delta, improved topics, still-weak topics
- [ ] P6-06 Simple trend chart (inline SVG, no library)
- [ ] P6-07 Export cumulative profile receipt
- [ ] P6-08 Import receipt/profile: merge into history, skip duplicates by `receipt_id`
- [ ] P6-09 Full backup (download) and restore
- [ ] P6-10 Delete one exam / clear all data with confirmation
- [ ] P6-11 Retention check generator: pulls from all topics in history, extra weight on priority topics

## Phase 7 — Resilience
- [ ] P7-01 Truncation salvage: keep all complete question objects, report "Loaded 97 of 130"
- [ ] P7-02 **Continue prompt** generated from the missing question numbers
- [ ] P7-03 **Repair prompt** generated from the validator's error list
- [ ] P7-04 Multi-part merge: same `quiz_id`, combine by question number, later part wins on conflict, show progress "Parts loaded: 2 of 3"
- [ ] P7-05 `localStorage` quota error handling (message + export backup + prune oldest)
- [ ] P7-06 Large paste performance (130-question pack loads in under 1 s on a mid-range phone)
- [ ] P7-07 Graceful handling of corrupted `session` / `history` (offer reset, never white-screen)

## Phase 8 — Polish, QA, release
- [ ] P8-01 Accessibility: option buttons have roles and labels, visible focus, color is never the only signal (add icons/text for correct/wrong)
- [ ] P8-02 Keyboard shortcuts on desktop: A–D select, N/P next/prev, U unsure
- [ ] P8-03 Keep safe-area padding and 16px inputs; test on iOS Safari and Android Chrome
- [ ] P8-04 Real-world runs (record results in `docs/QA_LOG.md`):
  - [ ] Claude: initial 130 (single reply) · split into parts · targeted · retention
  - [ ] ChatGPT: initial 130 (single reply) · split into parts · targeted · retention
  - [ ] Note every failure mode, then fix the templates or loader
- [ ] P8-05 README: how to use the loop in 6 steps, with screenshots
- [ ] P8-06 Bump `APP_VERSION`; deploy to a Vercel preview; test on a phone; promote to production
- [ ] P8-07 Rollback plan confirmed (`v1-legacy` tag redeploys the old app)
- [ ] P8-08 Optional: practice mode · timer · PWA/offline

---

## Test scenarios (must pass before release)

**Loading:** valid pack · code-fenced pack · pack with prose before/after · BOM · trailing comma · truncated mid-question · two parts merged · part pasted twice · legacy plain text · empty input · very large input.

**Validation:** answer lowercase (`b`) · answer not in options · duplicate numbers · gaps in numbering · topic id missing · 3 or 5 options · True/False with and without options · explanation missing.

**Exam:** refresh mid-exam and resume · jump to any question · change an answer · unsure with and without selection · finish with skipped questions · start over.

**Grading and analytics:** perfect score · zero score · one miss in a topic (→ `watch`, not `weak`) · two misses in a four-question topic (→ `weak`) · topic with 2 questions and no misses (→ `insufficient`) · high accuracy with many unsure (not `strong`) · rounding of next-exam allocation sums to exactly N.

**Receipt:** golden file match · all toggles on/off · imported receipt merges once · 130-question receipt size stays reasonable.

**Prompt Builder:** each mode · each delivery option · receipt embedded verbatim · topic ids and names match the receipt · changing count updates allocation.

**Environment:** iOS Safari · Android Chrome · desktop Chrome/Edge/Firefox · private browsing (storage unavailable) · offline after load.

---

## Definition of done (every task)
- Pure logic has unit tests; DOM code manually checked on a phone-sized viewport.
- No new network calls, no new dependencies unless approved.
- Spec docs updated in the same change if a format or rule changed, and `SPEC_VERSION` bumped if the format changed.
- No answers visible in the exam DOM.
- Legacy Quick Paste mode still works.
