# Quiz Runner v2 — Plan

Status: planning (no code yet) · Date: 2026-10-25 · Spec version: 1

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
| `history` | Array of graded results (per-question outcomes, per-topic stats, timestamps) |

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
│  ├─ exam.js            pure: response model, "Not sure" rule, progress counts, answer-free exam questions
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
