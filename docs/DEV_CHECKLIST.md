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
- [x] P2-01 Load by paste, file picker, and drag-and-drop (`.json`, `.txt`, `.md`) — checked 2026-10-31 in headless Chromium (`QA_LOG.md` §7): paste, picker and drop each reach the Topics preview for all three file types; two dropped files load the first and say so; `.png` / `.exe` are refused with a message; a drop on another screen is ignored. Not tried on a real phone's file picker
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
- [x] P4-01 `analytics.js` topic stats: total, correct, wrong, skipped, unsure, shaky (correct + unsure), accuracy
- [x] P4-02 Topic status: `weak` · `developing` · `watch` · `strong` · `insufficient` (rules in `RECEIPT_SPEC.md` §3)
- [x] P4-03 Overall rating from percentage bands
- [x] P4-04 Split misses into **gaps** (skipped / unsure) and **misconceptions** (wrong and confident)
- [x] P4-05 Rank weaknesses (misses desc, then accuracy asc); list strengths
- [x] P4-06 Next-exam recommendation (allocation algorithm in `RECEIPT_SPEC.md` §6)
- [x] P4-07 Results tabs: Topics (bars + status chips) and Next steps (what to study, what to take next)
- [x] P4-08 `receipt.js`: build Markdown receipt and JSON receipt
- [x] P4-09 Export screen toggles: missed-question detail · cumulative history · covered concepts · next-quiz format instructions (default on)
- [x] P4-10 Copy / Download `.md` / Download `.json`; show approximate size ("≈ 4k tokens" = chars ÷ 4)
- [x] P4-11 Keep legacy "answers only" export for Quick Paste mode
- [x] P4-12 Golden-file test: sample pack + fixed responses → exact expected receipt text

**Done when:** a receipt pasted into Claude and ChatGPT lets them explain your mistakes and propose the next quiz without extra context.

## Phase 5 — Prompt Builder
- [x] P5-01 Screen with fields: mode · subject · learner description · question count · difficulty mix (default 30/40/30) · skill coverage checkboxes · delivery (file or code block / split into parts of N)
- [x] P5-02 Mode presets: initial 130 · targeted 40 · retention 12 (all editable)
- [x] P5-03 `promptBuilder.js` (pure) assembling the blocks from `PROMPT_TEMPLATES.md`
- [x] P5-04 Embed the compact format spec in every prompt (prompt must work in a fresh chat)
- [x] P5-05 Targeted / retention: paste receipt or "Use latest from this device"; validate and summarize what will be targeted; allow editing question counts per topic
- [x] P5-06 Force topic reuse: embed exact topic ids and names from the receipt
- [x] P5-07 Live preview, Copy, Download `.md`, length estimate — checked 2026-10-31 in headless Chromium (`QA_LOG.md` §7): the preview and the "≈ N tokens · N characters" line update as options change, Copy reports success, Download gives `<subject>-<mode>-NN.prompt.md`
- [x] P5-08 Remember last-used options in `settings`
- [x] P5-09 "Next quiz prompt" button on Results/Receipt opens the builder prefilled in targeted mode — checked 2026-10-31 in headless Chromium (`QA_LOG.md` §7): from the receipt screen the builder opens in Targeted mode with the subject, 40 questions and the finished exam's weak topics filled in. The button on the Results screen shares the same handler (`openNextPrompt`) but was not clicked separately
- [x] P5-10 Test: `SPEC_VERSION` in generated prompt equals the loader's supported version
- [x] P5-11 Snapshot tests for each mode

**Done when:** prompt → AI → pack → exam → receipt → next prompt works as a full loop.

## Phase 6 — History and learner profile
- [x] P6-01 Progress screen: list of exams (date, title, score, rating) — checked 2026-10-31 in headless Chromium (`QA_LOG.md` §7): each row shows title, score and percentage, date, rating and subject, with Open / Compare / Delete
- [x] P6-02 Open an old exam read-only (uses stored pack) — checked 2026-10-31 in headless Chromium (`QA_LOG.md` §7): opens from the stored pack and history entry, shows a read-only note, hides Export receipt and Next quiz prompt, and refuses to open while an unfinished session of the same quiz exists
- [x] P6-03 Topic mastery across exams (matched by normalized topic name)
- [x] P6-04 Priority topics: weak in ≥ 2 distinct exams
- [x] P6-05 Compare with previous exam: score delta, improved topics, still-weak topics
- [x] P6-06 Simple trend chart (inline SVG, no library)
- [x] P6-07 Export cumulative profile receipt
- [x] P6-08 Import receipt/profile: merge into history, skip duplicates by `receipt_id`
- [x] P6-09 Full backup (download) and restore
- [x] P6-10 Delete one exam / clear all data with confirmation
- [x] P6-11 Retention check generator: pulls from all topics in history, extra weight on priority topics

## Phase 7 — Resilience
- [x] P7-01 Truncation salvage: keep all complete question objects, report "Loaded 97 of 130"
- [x] P7-02 **Continue prompt** generated from the missing question numbers
- [x] P7-03 **Repair prompt** generated from the validator's error list
- [x] P7-04 Multi-part merge: same `quiz_id`, combine by question number, later part wins on conflict, show progress "Parts loaded: 2 of 3"
- [x] P7-05 `localStorage` quota error handling (message + export backup + prune oldest) — notice with *Download backup* and *Make room*; "oldest" = oldest saved pack (D15)
- [x] P7-06 Large paste performance (130-question pack loads in under 1 s on a mid-range phone) — parse+validate ≈ 2–9 ms (31 ms interpreter-only) against a 100 ms test budget (D17); **still to time on a real phone**
- [x] P7-07 Graceful handling of corrupted `session` / `history` (offer reset, never white-screen) — notices with reset per key (D16), failing screens fall back to the start screen

## Phase 8 — Polish, QA, release
- [x] P8-01 Accessibility: option buttons have roles and labels, visible focus, color is never the only signal (add icons/text for correct/wrong) — options are `<button role="radio">` in a radiogroup named by the question on both exam screens (D18), one shared focus ring, focus kept after a redraw, Tab kept inside the finish dialog, jump cells carry a check / `?` and an `aria-label`; Results already had an icon and a word for every state. Checked in a headless DOM, **not yet with a screen reader on a phone** (`QA_LOG.md` §6)
- [x] P8-02 Keyboard shortcuts on desktop: A–D select, N/P next/prev, U unsure — rules in `exam.js` `examShortcut` (unit-tested), used by the pack exam and Quick Paste (D18); A–D do nothing on True/False questions (D18); hint under the buttons on mouse-and-keyboard devices only
- [ ] P8-03 Keep safe-area padding and 16px inputs; test on iOS Safari and Android Chrome — **code side done:** all four safe-area insets now pad the page and the dialog (D19), static tests keep every text field at 16px and the viewport at `viewport-fit=cover`. **Still to do on real devices:** the phone pass in `QA_LOG.md` §6
- [ ] P8-04 Real-world runs (record results in `docs/QA_LOG.md`) — **log and run sheet created (settings, pass criteria, failure-mode register); no run has been made yet**:
  - [ ] Claude: initial 130 (single reply) · split into parts · targeted · retention
  - [ ] ChatGPT: initial 130 (single reply) · split into parts · targeted · retention
  - [ ] Note every failure mode, then fix the templates or loader
- [x] P8-05 README: how to use the loop in 6 steps, with screenshots — six steps in `README.md`, five screenshots in `docs/img/` taken from the running app in headless Chromium at 390×844 (2×) with `samples/sample-pack.json` (step 2 happens in the AI chat, so it has none). They are not photos from a real phone
- [ ] P8-06 Bump `APP_VERSION`; deploy to a Vercel preview; test on a phone; promote to production — **bump done:** `APP_VERSION` and `package.json` are `2.0.0` (D21), the golden sample receipt and the prompt snapshots follow it, `npm test` passes. **Still to do by the owner:** deploy the preview, the phone pass in `QA_LOG.md` §6, promote
- [ ] P8-07 Rollback plan confirmed (`v1-legacy` tag redeploys the old app) — **procedure written** in `README.md` "Release and rollback" (D22): Vercel does not deploy a bare tag, so it goes through a branch from the tag and Promote to Production. **Not confirmed:** the tag may not exist yet (P0-04 is open) and nobody has rehearsed a rollback. Check the tag, then rehearse once on a preview
- [ ] P8-08 Optional: practice mode · timer · PWA/offline — **not started:** each of the three needs an owner decision first (see the questions at the end of the P8 hand-over; `PLAN.md` §11 also lists them as post-v2 backlog)

## Bug flags (audit of 2026-10-31)
Found by running the app in headless Chromium and by fuzzing the pure modules (`QA_LOG.md` §7). **Flags only: nothing below has been fixed.** No high-severity bug was found: the loop, grading, receipts, resume, backup/restore and the "no answers in the DOM" rule all behaved. Tick a flag when it is fixed (with a test where the code is pure) or when the owner decides to leave it.
- [ ] BUG-01 *(Low)* **No storage warning at the start of an exam.** `startExam` in `js/main.js` ignores the result of `saveSession`, so when browser storage is blocked or full the "can't be saved" line (`#exStorageWarn`) only appears after the first answer or flag. Repro: open the app with `localStorage` throwing, load a pack, tap Start exam: no warning on question 1
- [ ] BUG-02 *(Low)* **The Prompt Builder has no upper limit on the question count.** `#pbCount` has `min="1"` and no `max`, and `buildPrompt` accepts any whole number: 999,999,999 builds a normal prompt asking for that many questions. The loader already treats a `total_questions` above `MAX_PACK_QUESTIONS` (1000) as unknown, so such a pack could never report missing questions. Fix idea: cap at `MAX_PACK_QUESTIONS` with an error, in `promptBuilder.js` and on the input
- [ ] BUG-03 *(Low, docs)* **Stale copies of the specs at the repository root.** `PLAN.md`, `PROMPT_TEMPLATES.md` and `QUIZ_PACK_SPEC.md` in the root are older than the files in `docs/` (no D11–D22, no TOPIC_BLOCK, no truncation / missing-question / merge rules); only `RECEIPT_SPEC.md` is identical. `AGENTS.md` names `docs/` as the source of truth, but an assistant that opens the root copies gets outdated rules. Needs an owner decision: delete the root copies, or replace them with a one-line pointer
- [ ] BUG-04 *(Low, UI rule)* **Some controls are smaller than the 48px tap-target rule in `AGENTS.md`.** The jump-grid cells are 38×38 (`.jumpgrid` / `.jump` in `css/styles.css`; on the pack exam, Quick Paste and the Results review grid) and the "Start over" link button is 56×31 (`#exQuitBtn`, `#resetBtn`). Option buttons, nav buttons and the checkbox rows are fine. Open question: are the grid cells exempt? (the grid is dense on purpose, 130 cells)
- [ ] BUG-05 *(Low, UX)* **One Back press after finishing an exam does nothing.** History is `/ → /exam → /results`; Back from Results lands on `#/exam`, the route guard sends a finished session straight back to Results, and only the second Back reaches the start screen. Fix idea: make that guard redirect replace the history entry
- [ ] BUG-06 *(Cosmetic)* **Two wording slips.** The unsupported-file message reads "Choose a .json, .txt, .md file." (missing "or"; `js/ui/loadpack.js`); a Prompt Builder prompt for a single part says "in 1 parts of at most N" (`promptBuilder.js`, the parts block)
- [ ] BUG-07 *(Edge case, needs a spec decision)* **The next-exam allocation can give a weak topic fewer than 2 questions, or none.** `RECEIPT_SPEC` §6 wants 60% of N for weak topics and at least 2 per weak topic; at N = 10 that is only 6 questions, so 4 weak topics get 2 / 2 / 1 / 1 and 7 weak topics leave one with no question (`allocateNextExam`, marked SPEC GAP in `analytics.js`). Sums are always exactly N. At the default N = 40 it starts only at 13 or more weak topics (each then gets 1)

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
