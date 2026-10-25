# AGENTS.md — Quiz Runner

Context file for AI coding assistants working in this repo. Read this first, then `docs/PLAN.md`. The task list is `docs/DEV_CHECKLIST.md`.

## What this is
Quiz Runner is a static, mobile-first web app (deployed on Vercel at `quiz-runner-theta.vercel.app`) for taking AI-generated practice exams built from the owner's own course materials, then getting instant grading, feedback, and a shareable "receipt" of strengths and weaknesses.

The owner is a student. They attach course files to an AI chat (Claude or ChatGPT), paste a prompt, get a quiz file back, load it here, take the exam, and export a receipt to paste back into an AI.

## The loop (keep this in mind for every change)
1. **Prompt Builder** (in the app) → prompt to paste into an AI chat.
2. AI returns a **Quiz Pack** (JSON file or one code block).
3. Load the pack → **Topics preview** → **Exam** → **Results** (graded in the app).
4. Export a **Receipt** → paste into any AI, or feed back into the Prompt Builder for a targeted or retention quiz.

## Source of truth
| Topic | File |
|---|---|
| Product plan, decisions, structure | `docs/PLAN.md` |
| Tasks and phases | `docs/DEV_CHECKLIST.md` |
| Quiz Pack format and validation | `docs/ai/QUIZ_PACK_SPEC.md` |
| Receipt format, thresholds, rating, allocation | `docs/ai/RECEIPT_SPEC.md` |
| Prompt wording and builder options | `docs/ai/PROMPT_TEMPLATES.md` |

If code and a spec disagree, the spec wins unless the owner approves a change. Change code and spec together, in the same commit, and bump `SPEC_VERSION` if a format changed.

## Tech rules
- Vanilla HTML/CSS/JS, **ES modules, no build step, no frameworks**, no new dependencies without asking.
- Static hosting only. **No backend, no accounts, no API keys, no network calls** (including analytics and fonts from CDNs).
- Pure logic modules (`loader`, `validator`, `grader`, `analytics`, `receipt`, `promptBuilder`) must not touch the DOM so they can be unit-tested with `node --test`.
- All persistence goes through `store.js`. Keys are namespaced `qr:v1:`. Wrap every `localStorage` access in try/catch and fall back to memory.
- Thresholds, bands, versions, and storage keys live in `constants.js` only. Never hard-code them elsewhere.

## UI rules
- Mobile first. Keep the existing CSS variables (design tokens), dark theme, safe-area padding, and 48px minimum tap targets.
- Text inputs and textareas use 16px font size (prevents iOS zoom).
- Never rely on color alone for correct/wrong; add an icon or text.
- Escape all user/AI text before inserting into the DOM (use `textContent` or an escape helper). Pack content is untrusted.

## Behavior that must not break
- **No answers in the DOM during the exam**, not even hidden. They are read from memory only after finishing.
- The old plain-text paste flow (Quick Paste, answers-only export like `1. B`) keeps working.
- Refresh during an exam must resume it.
- One missed question never makes a topic "weak" (see `RECEIPT_SPEC.md` §3).
- The receipt must be understandable by an AI with no other context (it contains its own instruction block).

## Working agreement
- Plan first. For anything beyond a small fix, state the plan and the files you will touch before editing.
- Small, reviewable commits. One checklist task (or a few related) per commit; reference the task id (e.g. `P3-05`).
- Tick the box in `docs/DEV_CHECKLIST.md` when a task is done and tested.
- Add or update tests for any change to pure logic. Use fixtures from `samples/`.
- When something in the specs is ambiguous or missing, ask the owner rather than guessing. Record the decision in `docs/PLAN.md` §5.
- Don't refactor unrelated code or restyle the UI as a side effect.

## Commands (proposed)
- Run locally: `npx serve .` (ES modules do not work from `file://`).
- Tests: `node --test tests/`
- Deploy: push to the main branch; Vercel builds a preview per branch.
- Rollback: redeploy the `v1-legacy` git tag.

## Don'ts
- Don't call any AI API from the app.
- Don't store anything outside the browser.
- Don't change the Quiz Pack or Receipt format without updating the specs and the version.
- Don't remove or weaken validation to make a sample load; fix the sample or report the issue.
- Don't include course content in generated prompts; the learner attaches their own files to the AI chat.
