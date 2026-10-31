# Quiz Runner v2 — QA Log

Where the real-world runs of `DEV_CHECKLIST.md` **P8-04** are recorded, plus the phone pass of **P8-03**.
Nothing in this file has been run against a real AI chat or a real phone yet: every result below is **Not run** until the owner fills it in. The two checklist boxes stay open until then.

Last updated: 2026-10-31 · App version at the time: see `js/constants.js` (`APP_VERSION`) · Spec version: 1

---

## 1. How to run one test

1. In Quiz Runner open **Prompt Builder**, set the options listed for the run (§3), copy the prompt.
2. Open a **fresh chat** in the AI product, attach the same course files every time, paste the prompt, send.
3. Do not edit the reply. Save the file, or copy the code block, exactly as the AI gave it.
4. Load it in the app. Write down what happened in the run record (§4): did it load, which errors or warnings, what the Topics preview said.
5. Take the exam (or a few questions) and open Results, so grading and the receipt are exercised on real content too.
6. Every problem goes in the failure-mode register (§5), even when the loader repaired it. Then fix the **template or the loader**, add a test or a sample for it, and put the fix in the register.

Keep the same course files and subject for all eight runs so the results are comparable.

## 2. Order and dependencies

```
Initial 130 (single reply)  ──take the exam──▶  Receipt  ──▶  Targeted 40
Initial 130 (split in parts)                              └─▶  Retention 12 (needs 2+ exams in History)
```

- Targeted and retention prompts embed a receipt. Use the receipt from the initial run **of the same AI product**, taken from this app (*Use latest from this device*), not the sample receipt.
- The first initial-130 run that loads cleanly can also be saved as `samples/sample-pack-130.json`, which closes **P0-06** and gives P7-06 a real file to time.

## 3. The eight runs

Prompt sizes are what the Prompt Builder produced on 2026-10-30 for subject "Computer Networks", default options, using `samples/sample-receipt.md` for the two receipt modes. Real receipts are longer, so treat the targeted and retention sizes as a floor. A 130-question pack with explanations is about 80 KB (`PLAN.md` §7), roughly 20k tokens of output.

| # | AI | Run | Builder options | Prompt size | Result |
|---|---|---|---|---|---|
| 1 | Claude | Initial 130, single reply | mode Initial · 130 · delivery *One file or code block* | ≈ 940 tokens | Not run |
| 2 | Claude | Initial 130, split into parts | mode Initial · 130 · delivery *Split into parts* · 45 per part (3 parts) | ≈ 990 tokens | Not run |
| 3 | Claude | Targeted | mode Targeted · 40 · receipt from run 1 | ≥ 2,900 tokens | Not run |
| 4 | Claude | Retention | mode Retention · 12 · profile receipt, or receipt of the latest exam | ≥ 2,700 tokens | Not run |
| 5 | ChatGPT | Initial 130, single reply | as run 1 | ≈ 940 tokens | Not run |
| 6 | ChatGPT | Initial 130, split into parts | as run 2 | ≈ 990 tokens | Not run |
| 7 | ChatGPT | Targeted | as run 3, receipt from run 5 | ≥ 2,900 tokens | Not run |
| 8 | ChatGPT | Retention | as run 4 | ≥ 2,700 tokens | Not run |

### What "pass" means for a run

A run passes when all of these hold. Anything else is a failure mode to log.

- The reply is **only** the pack: a file, or one code block, with no text around it and no answers discussed in the chat.
- The loader accepts it **without repair**. If it needed the tolerant cleanup (fence, prose, trailing comma, BOM) or salvage, note which, and still log it: the template should make it unnecessary.
- Question count equals what was asked (for parts: the total across parts). No count warning.
- Numbers are 1…N with no gaps or duplicates; every `topic` exists in `meta.topics`; every `answer` is one of its options.
- No answer-letter warning (no letter above 40%), and no run of more than 3 identical correct letters.
- Initial exam: 6–15 topics, each with at least 3 questions. Difficulty close to the requested mix.
- Targeted and retention: `meta.topics` ids and names are **identical** to the receipt's topic list; `quiz_type` is right; `based_on` / `target_topics` are set for targeted; no question repeats a covered concept.
- Parts: each part is a complete, valid pack with the same `quiz_id`, `total_questions` and `topics`; only `part` differs; the app merges them and shows "Parts loaded: 3 of 3".
- Explanations are 1–3 plain sentences; nothing in the questions gives the answer away.

## 4. Run records

Copy this block once per run (1–8) and fill it in.

```
### Run N — <AI> · <initial single / initial parts / targeted / retention>
- Date:
- Product and model as shown in the chat:
- Reply form: file / code block / other (describe)
- Cut off or split across replies? (yes/no, where)
- Loaded without repair? (yes/no) Cleanup or salvage used:
- Validator errors:
- Validator warnings:
- Topics preview: title, N topics, N questions, difficulty mix:
- Parts (if split): how many, "Parts loaded" text, anything the AI did between parts:
- Receipt/topic reuse (targeted, retention): ids and names identical? (yes/no, differences):
- Took the exam and opened Results? (yes/no) Anything odd:
- Failure modes found: (ids from §5)
- Verdict: pass / pass with fixes / fail
```

### Run 1 — Claude · initial 130, single reply
Not run.

### Run 2 — Claude · initial 130, split into parts
Not run.

### Run 3 — Claude · targeted
Not run.

### Run 4 — Claude · retention
Not run.

### Run 5 — ChatGPT · initial 130, single reply
Not run.

### Run 6 — ChatGPT · initial 130, split into parts
Not run.

### Run 7 — ChatGPT · targeted
Not run.

### Run 8 — ChatGPT · retention
Not run.

## 5. Failure-mode register

One row per distinct problem. "Fix" says whether the **template** (`PROMPT_TEMPLATES.md` and `promptBuilder.js`) or the **loader/validator** changed, and names the test or sample that now covers it.

| ID | Run(s) | What went wrong | Cause (as far as known) | Fix | Covered by | Status |
|---|---|---|---|---|---|---|
| — | — | No runs yet | — | — | — | — |

Things the specs already expect, so look for them first (this is a watch list, not a record of what happened):

- JSON wrapped in a code fence, or text before or after the pack.
- Curly quotes used as JSON delimiters (`samples/broken/08-smart-quotes.json`; whether to auto-repair is still an open question).
- Trailing commas; a byte-order mark at the start of a downloaded file.
- A reply cut off before the end ("Loaded 97 of 130" and the Continue prompt).
- Question count off by a few, or numbering gaps and duplicates.
- A `topic` id that is not in `meta.topics`; an `answer` letter that is not among the options.
- Correct letters skewed (one letter above 40%) or in long runs.
- Parts that change `meta` (different `quiz_id`, topics or totals), parts that restart numbering at 1, or a part sent twice.
- The AI explaining or revealing answers in the chat despite the delivery block.
- Targeted or retention packs that rename, renumber or drop topics from the receipt.
- A file the AI says it created but that cannot be downloaded (then the code-block fallback is the only route).

## 6. Phone pass (P8-03)

To be done on a real device, on the Vercel preview of the branch, with a pack loaded.

| Check | iOS Safari | Android Chrome |
|---|---|---|
| Tapping a text field or textarea does **not** zoom the page (fields are 16px) | Not run | Not run |
| Content clears the status bar and the home indicator; nothing is cut off at the top or bottom | Not run | Not run |
| Landscape: content clears the notch / rounded corners on the left and right | Not run | Not run |
| Finish dialog fits and scrolls on a small screen; its buttons are reachable | Not run | Not run |
| Exam: options, Previous / Not sure / Next and the jump grid are comfortable to tap | Not run | Not run |
| Refresh in the middle of an exam resumes it | Not run | Not run |
| Load by file picker and by paste; copy and download a receipt | Not run | Not run |
| With a screen reader on (VoiceOver / TalkBack): options read as "radio button, A. …, selected / not selected"; the jump cells read "Question 3, answered" | Not run | Not run |
| Private browsing (storage unavailable): the warning shows and the exam still works | Not run | Not run |

Desktop: A–D, N, P and U work on the pack exam and on the Quick Paste exam; Tab shows a visible focus ring on every control; the keyboard hint appears under the buttons (it is hidden on a phone).

## 7. Checked without a device or an AI (2026-10-30)

These do not replace §3 or §6.

- `npm test` passes, including new tests for the shortcut rules (`tests/exam.test.js`) and for the 16px fields, safe-area padding, focus ring, radio buttons and non-colour marks (`tests/a11y-static.test.js`).
- Both exam screens were driven in a headless DOM (jsdom): roles and `aria-checked`, the shortcuts, no shortcuts while typing or while the finish dialog is open, focus kept after a redraw, the dialog's Tab trap, and no explanation text in the exam DOM.
- The Prompt Builder produces a valid prompt for each of the four scenarios in §3 (sizes above).
- The Git commands in `README.md` "Release and rollback" (P8-07) were run against a throwaway local repository with an **annotated** `v1-legacy` tag and a bare remote standing in for `origin`: `git tag -l`, `git ls-remote --tags` and `git ls-remote --heads` show the tag and the new branch, the plain `v1-legacy:refs/heads/rollback-v1` push is rejected, and `v1-legacy^{commit}:refs/heads/rollback-v1` creates the branch with the old tree. This checks the command syntax only. It does **not** show that the tag exists in the real repository, nor that Vercel builds and promotes that branch; the rehearsal on a preview is still to do by the owner.
