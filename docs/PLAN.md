# Quiz Runner v2 — Plan

Status: built — v2.0.0 code is in place; what is still open is tracked in `DEV_CHECKLIST.md` (Phase 8 and the bug flags) · Plan written: 2026-10-25 · Spec version: 1

---

## 1. Where we are now

From the current `index.html`:

- One static file (HTML + CSS + JS), no build step, deployed on Vercel (`quiz-runner-theta.vercel.app`).
- Flow today: paste plain-text questions → regex parser → answer one at a time (A–D, True/False, "Not sure", jump grid) → export a plain list (`1. B`) → paste it back into an AI to be graded.
- Limits:
  - No answer key and no feedback inside the app. The AI must grade every time.
  - Questions have no topic tags, so finding weaknesses depends on the AI re-analysing.
  - Refreshing the page loses the exam. No history.
  - Every new quiz needs the long study prompt pasted by hand.

## 2. Goal (v2)

Make it feel like a digital exam that grades itself, and turn the study system (concept map → exam → grade → weak concepts → targeted quiz → compare → retention check) into a loop the app runs.

```
Prompt Builder ──copy──▶ AI chat (with your course files)
      ▲                         │ outputs ONE file / code block
      │                         ▼
 Receipt ◀── Results ◀── Exam ◀── Quiz Pack (paste or upload)
      │
      └──paste to any AI to get tutoring, or feed back into Prompt Builder for the next quiz
```

The user asked for three things; each maps to one feature:

| Ask | Feature |
|---|---|
| AI gives a file (questions + answers + feedback) that I paste in the app and get graded | **Quiz Pack** import + in-app grading |
| A universal prompt creator inside the app | **Prompt Builder** |
| An exportable receipt of score, strengths, weaknesses, and what to take next that any AI can read | **Receipt** export |

## 3. Principles

1. **AI writes content, the app grades.** After the pack loads, no AI is needed to score or analyse. Grading is deterministic.
2. **No backend, no accounts, no API keys.** Everything stays on the device. The user copy-pastes between the app and the AI chat.
3. **Contract first.** The Quiz Pack and Receipt specs (`docs/ai/`) are the product. The loader, the Prompt Builder, and the receipt generator all derive from the same spec version.
4. **Don't break today's flow.** Plain-text paste keeps working as "Quick Paste (answers only)".
5. **Mobile first.** Keep the current design tokens, 16px inputs (prevents iOS zoom), safe-area handling, and large tap targets.
6. **Exam honesty.** Answers live in the pack but are never shown until the exam is submitted.

## 4. Features

### 4.1 Quiz Pack (import)
- One JSON document: `meta` (title, subject, type, topics list, notes) + `questions` (text, options, answer, explanation, topic, concept, difficulty, skill).
- Load by paste, file upload, or drag-and-drop.
- Tolerant loader (strips code fences, tolerates trailing commas, salvages truncated output) plus a strict validator with human-readable errors.
- "Topics covered" screen before the exam replaces the old Step 1 concept map. It is built from `meta.topics`.
- Multi-part packs (same `quiz_id`) merge, because a 130-question pack with explanations is long and some chat UIs may cut long replies.

### 4.2 Prompt Builder (inside the app)
- Form: mode (initial / targeted / retention / custom), subject, learner description, question count, difficulty mix, skill coverage, delivery (file / code block / split into parts).
- Targeted and retention modes accept a pasted receipt (or "use latest from this device") and embed it.
- Output is a self-contained prompt: it embeds the full format spec, so it works in a fresh chat with no other files.
- Lives in the app so the prompt and the loader always share one spec version.
- Details: `docs/ai/PROMPT_TEMPLATES.md`.

### 4.3 Results and Receipt
- Results: score, percentage, rating, correct / wrong / skipped / unsure, per-topic breakdown, review of every missed question (your answer, correct answer, simple explanation).
- Analytics: strong / developing / watch / weak topics, "lucky guesses" (correct but unsure), recommended next exam.
- Receipt: one Markdown file that is both human-readable and AI-readable, with an embedded JSON block. Includes AI instructions so a fresh chat knows what it is looking at.
- Cumulative profile: history across exams, topics weak in more than one exam (priority), improvements since last exam.
- Details: `docs/ai/RECEIPT_SPEC.md`.

## 5. Key decisions

| # | Decision | Why | Alternative if it fails |
|---|---|---|---|
| D1 | Quiz Pack is **JSON** with a tolerant loader | Strict structure, easy to validate, easy to extend | Line-based text format that survives partial output better. Revisit if JSON breaks often in real runs |
| D2 | **Answers are inside the pack**, hidden by the UI | The AI can't talk to the app, so the pack must carry answers and feedback | Show the pack only through "Copy code" so it's never read |
| D3 | "Not sure" becomes a **flag**, separate from the selected answer | Lets us tell *lucky guesses* (correct + unsure) from *real gaps* and *misconceptions* (wrong + confident) | Keep today's behaviour (Not sure = no answer) |
| D4 | Weak / strong thresholds are fixed constants (see `RECEIPT_SPEC.md`) | Respects "don't flag weakness from one miss" | Make them user-editable settings later |
| D5 | Analysis is computed **in the app**, not by the AI | Consistent results, works offline, receipt is trustworthy | None needed |
| D6 | Prompt Builder is **inside** the app | One spec version, receipt → next prompt in one tap | Separate page |
| D7 | Storage: `localStorage` plus export/import | No backend. Export protects against cleared browser data | IndexedDB if packs outgrow quota |
| D8 | Stack: vanilla **ES modules, no build** | Deploys exactly as today on Vercel | Vite + TypeScript later if the code outgrows it |
| D9 | Topics are tracked across exams by **normalized topic name** | The AI creates topic ids per pack, so ids can differ between exams | Prompt Builder forces the AI to reuse the exact topic names/ids from the receipt |
| D10 | Concept map lives in `meta.topics` and is shown in-app | Keeps the AI's reply to a single copyable file | AI shows an outline in chat first (messier to copy) |
| D11 | **Proposed (P7), awaiting owner approval.** A pack with missing questions (cut off, or only some parts) can still start an exam | `QUIZ_PACK_SPEC` §7 makes a count mismatch a warning, not an error | Block Start until the pack is complete |
| D12 | **Proposed (P7).** A loaded pack is merged with the one waiting on the Topics preview when `quiz_id` matches; later wins per question and per `meta` field; topics are the union; merged `part`/`total_parts` = 1/1; held in memory only | Spec says "merge by `quiz_id` and `number`, later wins" but not these details | Persist the held parts in storage; ask before overwriting |
| D13 | **Proposed (P7).** Continue prompt: the spec template when the missing numbers are a tail; a second wording (`PROMPT_TEMPLATES.md`) for numbers missing at the start or in the middle | The template only describes "questions 1-K received" | Always ask "from the first missing number to the end" |
| D14 | **Proposed (P7).** Repair prompt lists at most 50 problems, each cut at 300 characters; `total_questions` above 1000 counts as unknown | Spec gives no limits; keeps a bogus pack from making a huge prompt | No caps |
| D15 | **Proposed (P7-05), awaiting owner approval.** "Prune oldest" removes saved question packs (`pack:<quiz_id>`), oldest exam first (a pack no exam uses comes first); the history entries stay, so an exam keeps its score and date and loses only its review and topic breakdown. The backup is offered before pruning, not forced. A value that did not fit stays in memory and is saved again after pruning | Packs are the bulk of the data and losing one is reversible from a backup; the checklist says "prune oldest" without saying what | Delete whole oldest exams; force a backup download before the prune button works |
| D16 | **Proposed (P7-07).** A `session` or `history` that cannot be read or used is reported in a notice on the Home and Progress screens with a reset for that key only (saved packs and settings stay). Damaged history text can be downloaded first; a damaged exam in progress cannot (its answers stay out of every file, as in the backup). Nothing is deleted without a confirmation, and a damaged history is never overwritten by a new exam. A screen that throws shows a notice and returns to the start screen | The checklist says "offer reset, never white-screen" and nothing more | Reset everything at once; repair entries one by one; silently start empty |
| D17 | **Proposed (P7-06).** "Loads in under 1 s on a mid-range phone" is checked as: paste → parsed, repaired and validated pack, within 100 ms on the development machine (about 10x faster than the target phone), best of five runs, in `node --test` | There is no phone in the test run; the target does not say what "loads" covers | Time it in a real browser on a real phone before each release |
| D18 | **Proposed (P8-01, P8-02), awaiting owner approval.** The accessibility and keyboard work covers **both** exam screens, the Quiz Pack exam and Quick Paste (its options and jump cells become buttons; behaviour is unchanged). Shortcuts: A–D choose that option, N next (on the last question: the finish confirmation, or the export screen in Quick Paste), P previous, U "Not sure" (same rule as the button). A–D do nothing on True/False questions. Ignored while typing in a field, with Ctrl / Cmd / Alt, when a key is held down, and while the finish confirmation is open. The checklist says "desktop": there is no device check, a keyboard simply produces the keys, and the hint line is shown only where a mouse and keyboard exist | The checklist says "A–D select" and "option buttons" without naming the screens, and True/False options are not letters | Pack exam only; add T / F keys for True/False; show the hint everywhere |
| D19 | **Proposed (P8-03), awaiting owner approval.** The page and the finish dialog are also padded by the left and right safe-area insets (landscape phones with a notch), not only top and bottom. The viewport tag is left as it is: its `maximum-scale=1.0` stops pinch-zoom, which is an accessibility question to decide separately (decided in D39: removed) | "Keep safe-area padding" can mean "do not remove it" or "make it complete"; with `viewport-fit=cover` the sides are covered by the notch | Leave the sides alone |
| D20 | **Proposed (P8-04).** `docs/QA_LOG.md` holds the run sheet, the pass criteria, one record per run, the failure-mode register and the phone pass of P8-03. Runs with real AI chats and real phones are done by the owner; the log marks every one "Not run" until then | The checklist names the file and the runs but not their settings, order or what counts as a pass | Record results inside this checklist |
| D21 | **Proposed (P8-06), awaiting owner approval.** The release version is `2.0.0`: `APP_VERSION` in `constants.js` drops `-dev`, and `package.json` `version` is kept the same. The version is also written into `samples/sample-receipt.md` (the golden file of P4-12) and the prompt snapshots, so they are updated with it, changing only the two version lines | The checklist says "bump" without a number. `RECEIPT_SPEC.md` §8 already shows `2.0.0`, and the tests accept any `x.y.z` | `2.0.0-rc.1` for the preview and `2.0.0` at promotion; leave `package.json` alone |
| D22 | **Proposed (P8-07), awaiting owner approval.** The rollback goes through a branch made from the `v1-legacy` tag and "Promote to Production" (or Instant Rollback right after release), documented in `README.md`. `AGENTS.md` still says "redeploy the `v1-legacy` git tag" | Vercel builds from branch pushes and promotes existing deployments; it has no "deploy this tag" action | Keep the tag wording and accept that it is shorthand |
| D23 | **Proposed (BUG-02), awaiting owner approval.** The Prompt Builder asks for at most `MAX_PACK_QUESTIONS` (1000) questions: a larger count, or per-topic counts that add up to more, is an error and builds no prompt; the count box gets `max` from the same constant. The specs gave no upper limit | A pack with `total_questions` above 1000 is treated as unknown by the loader (D14), so it could never report missing questions or get a Continue prompt | Lower limit (e.g. 130, the largest the next-exam rule covers); no limit, as before |

| D24 | **Proposed (BUG-10, BUG-16), awaiting owner approval.** The `NN` of a new quiz id (`<subject-slug>-<mode>-<NN>`) is one more than the larger of (a) the highest `NN` in any stored quiz id of the same subject **slug** and (b) the number of distinct stored exams of that slug. Numbering is per slug, not per subject name. `PROMPT_TEMPLATES.md` only said the builder "increments `NN` using local history" | Counting exams reused an id after one was deleted, and different subjects can share a slug ("C++" / "C#" / "C" are `c`; a subject with no Latin letters is `quiz`), so ids collided and two packs then shared one `pack:<quiz_id>` | Count only (as before); put a random or time suffix in the id; make `slugify` keep `+` and `#` |
| D25 | **Proposed (BUG-09), awaiting owner approval.** A stored `pack:<quiz_id>` is applied to an old exam (topic names, read-only view, profile receipt, rebuilt receipt) only when it fits that exam: same number of questions, and for every stored outcome the same number, correct answer and topic id (`packFitsEntry`). If not, the exam keeps its score and has no topics, as when the pack is gone. A pack that differs only in topic **names** still fits | A history entry stores no topic names, so the pack is the only source; the specs are silent on two exams sharing a quiz id | Store `topics: [{id, name}]` in every history entry (a data-format change, so `HISTORY_SCHEMA_VERSION` would go up). **Adopted for new exams in D35** |
| D26 | **Decided (BUG-07; the owner left the choice to the assistant, 2026-11-01).** When the weak share (60% of N) cannot hold 2 questions for every weak topic, **the share wins over "at least 2"**: the minimum falls to 1 per weak topic. A weak topic is never left with 0: if the share cannot hold 1 each it grows, taking questions from the strong group first, then watch + developing. With more weak topics than N, the most-missed get one each. The total is always exactly N | The two rules in `RECEIPT_SPEC` §6 could not both hold; the 60% is the headline of a targeted exam and the owner's study rule is that repeated misses are what to re-test, so a weak topic with no question can never be re-measured | Minimum of 2 wins (the weak share grows to 2 per topic: 8 of 10 questions at 4 weak topics); drop the 60% rule |
| D27 | **Decided (BUG-08).** A question `number` that is missing, not a whole number, or below 1 is an **error** (it keys the answers and the grading). A number written as digits in text (`"3"`) is converted to `3` on load (the loader already trims, uppercases and infers); `"3"` and `3` in one pack are then a duplicate. Same conversion for `meta.total_questions`, `part`, `total_parts`, `quiz_number` (BUG-17; a value that cannot be read as a whole number is a warning and is ignored, an absent `total_questions` stays silent) | `QUIZ_PACK_SPEC` §3.2 already says `number` is a required integer; the loader is meant to be tolerant of how an AI writes things, but not of something that makes grading wrong | Error on text numbers too (stricter, more Repair prompts) |
| D28 | **Decided (BUG-11).** The rating is taken from the **rounded** percentage (one decimal) that is shown and exported, not from the unrounded one | A learner who sees "90%" next to "Good" will think the app is broken, and an AI reading the receipt sees the same two numbers | Rate the exact value and show the percentage with more decimals |
| D29 | **Decided (BUG-12).** An option that is empty or not text is an **error** (one error per question naming the options); an option written as a number is read as text. The same topic `id` twice in `meta.topics` is a **warning** (the later entry's name is used, as in the part merge) | A blank button cannot be answered or read and the answer can point at it. A duplicate topic id does not change grading, only which name is shown | Warning for a blank distractor; error for a duplicate topic id |
| D30 | **Decided (BUG-13).** The Quick Paste parser is **left identical to v1**. Known limits, now pinned by a test: an option that wraps onto a second line is cut at the line break, and a fifth option (`E.`) is dropped | Joining continuation lines onto the last option would also glue the common trailing "Answer: B" / "Explanation: …" lines onto option D, which is worse than a short option. A fifth option needs a screen change. The Quiz Pack path is the main flow | Join lowercase-starting continuation lines onto the last option; show a warning in Quick Paste |
| D31 | **Decided (BUG-15).** `type` is lowercased and the usual spellings are mapped (`TF`, `True/False`, `true or false` → `tf`; `MC`, `Multiple Choice` → `mc`) before the answer is read. A type that is neither is a warning and is treated as multiple choice | The repro blamed the learner for an answer that was correct | Error on any type other than exactly `mc` / `tf` |
| D32 | **Decided (BUG-20).** `meta.quiz_type`, `difficulty` and `skill` are lowercased. A value outside the lists in the spec is a **warning**, kept as written (one warning for `difficulty`, one for `skill`, naming the first few questions). An absent value is not warned about | Nothing downstream breaks on an odd value, so blocking would only cost a Repair round; lowercasing makes `Easy` count as easy in the preview | Error; or silently map unknown values to a default |
| D33 | **Decided (BUG-17).** See D27 | Same family as BUG-08 | — |
| D34 | **Decided (BUG-19).** On receipt import the counts are the facts: `unsure` above the number of questions is refused (like counts that do not add up); `percent` and `rating` are recomputed from the counts (D28 rule) and the imported values are ignored, with a warning when the receipt's percent is more than 0.5 off or its rating text differs | A hand-edited receipt could put any percent or any text in the Progress list and trend; recomputing is more tolerant than refusing and cannot be wrong | Refuse a receipt whose percent or rating disagrees |
| D35 | **Decided (BUG-09 remainder).** Every new history entry stores `topics: [{ id, name }]` (the pack's topic list at the time) and `entry_version` is **2** (`HISTORY_SCHEMA_VERSION`). Version-1 entries are still read: they take their topic names from the stored pack when it fits (D25), as before. A version-2 exam names its topics itself, so a later pack with the same `quiz_id` (even with renamed topics) cannot rename it, and its topics survive a deleted pack. The read-only review and a rebuilt receipt still need the pack (they show questions). Backups and restores carry the field unchanged | It is the only complete fix for two exams sharing a `quiz_id`; the cost is a few dozen bytes per exam | Keep D25 only; write a migration that stamps old entries (not possible: the old names are gone) |
| D36 | **Decided (BUG-22; the owner left the choice to the assistant, 2026-11-01).** A text that starts with `{` is JSON, whatever it contains. The receipt marker `<!-- BEGIN RECEIPT -->` only makes a text a Markdown receipt when the text does not start with `{`; text before the marker is still tolerated. One check (`isMarkdownReceipt`, `receipt.js`) serves `parseReceipt` and `parseBackup` | The marker can appear as plain text inside a question or explanation (the `.json` receipt and the backup do not escape `<`, the Markdown receipt does), and a backup or `.json` receipt holding it was refused. The suggested "marker only at the start of the text" would also refuse a pasted receipt with a line of text before it, which a test ("tolerates text around the markers") requires | Marker only at the start of the text; escape `<` in the `.json` receipt and the backup as the Markdown form does (would not help files already saved) |
| D37 | **Decided (BUG-23; delegated 2026-11-01).** A missing, blank or non-text `meta.quiz_id` is a **blocking error** (`missing_quiz_id`), with a Repair prompt like any other error. The other required `meta` fields stay unchecked for now (BUG-31) | `quiz_id` keys the saved pack (`pack:<quiz_id>`), the history entry and the receipt, so without it exams collide on `pack:` and their receipts cannot be imported (the same reason as D27 for `number`). `QUIZ_PACK_SPEC` §3.1 already says it is required; §7 did not list it. A generated fallback id would not be unique across exams, so it would hide the problem | Warning only; the app invents an id (title slug plus date); check every required `meta` field at once |
| D38 | **Decided (BUG-24; delegated 2026-11-01).** A receipt's `exam.duration_sec` is used only when start + duration is a date that `toISOString()` writes with a normal 4-digit year (up to the end of year 9999). Otherwise `finished_at` stays empty, as for an absent duration, and the import goes ahead with a warning. An absent, zero or negative duration is unchanged and gives no warning | The import crashed with `RangeError: Invalid time value` on `1e300` or `8.64e12`. The duration is a side detail of a receipt; refusing the whole receipt for it would cost the learner a score for nothing | Refuse the receipt; cap the duration at a fixed length (for example 24 hours) |
| D39 | **Decided (BUG-25; delegated 2026-11-01).** `maximum-scale=1.0` is removed from the viewport tag, so pinch-zoom works (WCAG 1.4.4). `user-scalable=no` is not used either; a static test pins both. The 16px text fields (`AGENTS.md`) are what keep iOS from zooming on focus | D19 left it open. Blocking zoom takes away the only way for a low-vision learner to enlarge the text, and the original reason (iOS zoom on focus) is already handled by the 16px rule | Keep `maximum-scale=1.0` on purpose (and write the reason down) |

## 6. Screens

1. **Load** — paste / upload / drag-drop. Tabs: Load · Prompt Builder · Progress.
2. **Topics preview** — title, topics and subtopics, question count, difficulty mix, AI notes. Buttons: Start / Choose another.
3. **Exam** — today's UI, plus an unsure flag, autosave, and a resume banner.
4. **Results** — tabs: Overview · Topics · Review · Next steps.
5. **Export receipt** — option toggles, preview, Copy / Download `.md` / Download `.json`.
6. **Prompt Builder** — form, live preview, Copy / Download.
7. **Progress** — exam history, topic mastery across exams, priority topics, import/export backup.

## 7. Local data (all namespaced `qr:v1:`)

| Key | Content |
|---|---|
| `settings` | Learner description, subject, last-used Prompt Builder options |
| `session` | In-progress exam (pack id, answers, unsure flags, current index) |
| `pack:<quiz_id>` | Full pack, so old receipts and reviews can be rebuilt |
| `history` | Array of graded results (per-question outcomes, the exam's topic ids and names, timestamps); `entry_version` 2 (D35) |

Quota: a 130-question pack is roughly 80 KB, so about 50 packs fit in typical `localStorage`. Handle quota errors with a clear message and an "export backup, then prune" option (D15: `storagehealth.js`; the notice offers *Download backup* and *Make room*, which removes the oldest saved pack after asking).

Damaged data (D16): `store.inspect` tells a missing key from an unreadable one; `storagehealth.scanStoredData` reports an unusable `session` or `history`; the notice offers the reset.

## 8. Proposed structure

```
quiz-runner/
├─ index.html
├─ css/styles.css
├─ js/
│  ├─ main.js            bootstrap + screen router
│  ├─ constants.js       thresholds, versions, storage keys
│  ├─ store.js           localStorage wrapper (+ in-memory fallback)
│  ├─ loader.js          tolerant parse, salvage, legacy text parser
│  ├─ validator.js       pack validation (errors vs warnings), groupIssues for the error screen
│  ├─ packsummary.js     pure: loaded pack → data for the Topics preview
│  ├─ parts.js           pure: what is missing from a pack ("Loaded 97 of 130"), merging the parts of one `quiz_id`, "Parts loaded: 2 of 3"
│  ├─ exam.js            pure: response model, "Not sure" rule, progress counts, answer-free exam questions, keyboard-shortcut rules (A–D, N, P, U)
│  ├─ session.js         pure: in-progress exam record (build / validate / save / load via store.js)
│  ├─ review.js          pure: graded outcomes + pack → Review items, filter chips, counts
│  ├─ history.js         pure: save a graded exam to `history` and `pack:<quiz_id>` via store.js; import a receipt, delete one exam, clear all, build the profile receipt (via store.js)
│  ├─ backup.js          pure: full backup file and restore (merge) via store.js
│  ├─ grader.js          pure: pack + responses → result
│  ├─ analytics.js       pure: topic stats, status, rating, next-exam allocation, history
│  ├─ receipt.js         pure: result → markdown + json; receipt import
│  ├─ promptBuilder.js   pure: options → prompt text
│  ├─ settings.js        pure: last-used Prompt Builder options in `settings` (via store.js)
│  ├─ progress.js        pure: data for the Progress screen, the read-only old-exam view and the trend chart (reads store.js, never writes)
│  ├─ storagehealth.js   pure: storage-full message, prune oldest saved pack, scan for a damaged `session` / `history`, reset one key (via store.js)
│  └─ ui/                one file per screen (DOM only); `notice.js` is the shared notice area (storage full, damaged data, a failed screen)
├─ samples/              good + deliberately broken packs, sample receipt
├─ tests/                node:test for the pure modules
├─ docs/
│  ├─ PLAN.md
│  ├─ DEV_CHECKLIST.md
│  ├─ QA_LOG.md          real-world AI runs (P8-04) and the phone pass (P8-03)
│  └─ ai/ QUIZ_PACK_SPEC.md · RECEIPT_SPEC.md · PROMPT_TEMPLATES.md
└─ AGENTS.md
```

Rule: `grader`, `analytics`, `receipt`, `promptBuilder`, `loader`, `validator` never touch the DOM, so they can be unit-tested with plain Node.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| AI outputs invalid JSON (smart quotes, trailing commas, extra commentary) | Tolerant loader, precise error messages, **Repair prompt** generated by the app |
| 130 questions with explanations is too long for one reply | Truncation salvage ("loaded 97 of 130") + **Continue prompt**; optional split into parts |
| AI ignores the answer-position spread or the exact count | Self-check block in the prompt; app warns on skewed distribution or count mismatch |
| Topic names drift between exams, so cross-exam tracking breaks | Targeted/retention prompts embed the exact topic list; matching by normalized name |
| User sees answers while copying | Pack goes straight from "Copy code"/file download into the app; spec asks for no commentary |
| Browser data cleared, so history is lost | Export/import backup, receipts re-importable |
| Spec drift between prompt and loader | `SPEC_VERSION` constant shared by both; pack and receipt carry `version`; loader warns on mismatch |
| Pasted receipt contains instructions that confuse the AI | Receipt is wrapped as data, with the AI instruction block clearly separated |

## 10. Out of scope for now

Accounts or sync, calling AI APIs from the app, essay or short-answer grading, image-based questions, multi-user or class features, leaderboard.

## 11. Backlog ideas (after v2 ships)

Practice mode (instant feedback per question), timer, PWA/offline install, flashcard view from missed questions, spaced-repetition scheduler (suggest "retention check" dates), light theme, CSV export.

## 12. Assumptions made (change any of these)

- Default exam types: initial 130, targeted 40, retention 12.
- Rating bands: 90+ Excellent · 75–89 Good · 60–74 Fair · below 60 Needs work.
- Multiple-choice A–D is the default; True/False stays supported but is used only when asked.
- The receipt includes the "how to make the next quiz" format instructions by default, so a fresh AI chat can act on it directly.
