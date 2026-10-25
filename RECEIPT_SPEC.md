# Receipt Spec — v1

Audience: developers building `analytics.js` / `receipt.js`, and any AI that receives a receipt.
A **Receipt** is the exam's "proof of what happened": score, rating, strengths, weaknesses, and what to take next. It is exported by Quiz Runner after grading and can be pasted into any AI chat, which should understand it without extra explanation.

Two forms, same data:
- `.md` — Markdown with plain-language sections **and** an embedded JSON block (best for pasting into chats).
- `.json` — the data only (best for re-importing into Quiz Runner).

---

## 1. Answer states

| State | Meaning | Counts as |
|---|---|---|
| `correct` | selected = answer | correct |
| `wrong` | selected ≠ answer | miss |
| `skipped` | nothing selected | miss |
| `unsure` flag | learner pressed "Not sure" (with or without a selection) | separate flag |

Derived:
- **shaky** = correct **and** unsure (probably a lucky guess or fragile knowledge).
- **gap** = miss that is skipped, or wrong **and** unsure (learner knew they didn't know).
- **misconception** = wrong **and not** unsure (confidently wrong; highest-value to fix).

## 2. Overall rating (percentage = correct ÷ total)

| Percentage | Rating |
|---|---|
| 90–100 | Excellent |
| 75–89 | Good |
| 60–74 | Fair |
| below 60 | Needs work |

Constants live in `constants.js` (`RATING_BANDS`).

## 3. Topic status

Computed per topic on one exam. `n` = questions in the topic, `misses` = wrong + skipped, `accuracy` = correct ÷ n, `shakyRatio` = shaky ÷ n. Evaluate **in this order**:

| # | Status | Rule |
|---|---|---|
| 1 | `weak` | `misses ≥ 2` **and** `accuracy < 0.70` |
| 2 | `strong` | `n ≥ 3` **and** `accuracy ≥ 0.85` **and** `shakyRatio < 0.25` |
| 3 | `watch` | `misses == 1` (not weak, not strong) |
| 4 | `developing` | `misses ≥ 2` (not weak), or accuracy ≥ 0.85 with `shakyRatio ≥ 0.25` |
| 5 | `insufficient` | `n < 3` and `misses == 0` |

Why: one missed question never makes a topic "weak" (the study rule is to look for repeated misses). Constants: `WEAK_MIN_MISSES=2`, `WEAK_MAX_ACCURACY=0.70`, `STRONG_MIN_N=3`, `STRONG_MIN_ACCURACY=0.85`, `STRONG_MAX_SHAKY=0.25`.

**Rankings**
- Weaknesses: `weak` topics sorted by `misses` desc, then `accuracy` asc.
- Strengths: `strong` topics sorted by `accuracy` desc, then `n` desc.
- Watch list: `watch` + `developing` topics sorted by `accuracy` asc.

## 4. Cumulative rules (across exams, matched by normalized topic name: lowercase, trimmed, collapsed spaces)

- **Priority topic:** `weak` in ≥ 2 distinct exams.
- **Improved:** status moved up between the topic's two most recent exams (`weak → developing/watch/strong`, `developing/watch → strong`), or accuracy rose ≥ 15 percentage points.
- **Still weak:** `weak` in the most recent exam that included the topic.
- **Score delta:** percentage minus the previous exam's percentage in the same `subject`.

## 5. Retention check composition

10–15 questions drawn from **all** topics in history: 1 per topic, +1 extra for each priority topic, trimmed or padded to the requested total. Mix of difficulties; skew toward `moderate`/`challenging` for `strong` topics.

## 6. Next-exam recommendation (deterministic)

Input: topic statuses, `N` (default 40, adjustable 10–130).

1. Group shares of `N`: weak **60%**, watch + developing **25%**, strong **15%**.
2. If there are no weak topics: watch + developing **60%**, strong **40%**.
3. If a group is empty, give its share to the next group down the list (weak → watch/developing → strong → any topic). If only one group exists, it gets 100%.
4. Within **weak**: split proportionally to `misses`, minimum 2 per weak topic. Within other groups: split evenly, minimum 1 per topic.
5. Round with the largest-remainder method so the total is exactly `N`.
6. Suggested difficulty mix: weak topics 30% easy / 45% moderate / 25% challenging; strong topics 10 / 40 / 50; others 20 / 50 / 30.
7. Always: new questions only (see `covered_concepts`), reuse the exact topic ids and names from the receipt.

Output shape: `next_exam.allocations = [{ topic, name, count, reason, difficulty_mix }]`.

## 7. Markdown receipt layout

Everything between `<!-- BEGIN RECEIPT -->` and `<!-- END RECEIPT -->` is the receipt. Sections 8–10 are optional (export toggles).

````markdown
<!-- BEGIN RECEIPT -->
# QUIZ RUNNER RECEIPT
- Receipt ID: {{receipt_id}}
- Exam: {{title}} ({{quiz_id}}) · type: {{quiz_type}} · taken: {{taken_at}}
- App: Quiz Runner {{app_version}} · spec v{{spec_version}}

## FOR THE AI READING THIS
This is a graded exam receipt from Quiz Runner, a study app. The learner took a practice exam built from their own course materials and the app already graded it. Treat all results below as verified: do not re-grade or recalculate.
Do what the learner asks next. Defaults:
- "Explain my mistakes": go through section 4 grouped by topic, in simple student-friendly language: why their answer was wrong and why the correct one is right.
- "Study plan": prioritize the weaknesses in section 3 in the order given; keep strong topics for light review only.
- "Next quiz": follow section 6, new questions only (avoid section 9), and use the quiz format in section 10 if present; otherwise ask the learner to paste a prompt from Quiz Runner's Prompt Builder.
Rules: use only the learner's course materials as the source of content. If the materials are not available in this chat, say so and ask the learner to attach them. Do not invent course content.

## 1. Result
- Score: {{correct}}/{{total}} ({{percent}}%) · Rating: {{rating}}
- Correct {{correct}} · Wrong {{wrong}} · Skipped {{skipped}} · Marked unsure {{unsure}} · Correct but unsure {{shaky}}
- Misses: {{gaps}} gaps (didn't know) · {{misconceptions}} misconceptions (confidently wrong)

## 2. Topic breakdown
| Topic | Questions | Correct | Accuracy | Status |
|---|---|---|---|---|
| … | … | … | …% | weak/developing/watch/strong/insufficient |

## 3. Capability summary
- Strong in: …
- Developing / watch: …
- Weak (ranked, most missed first): …
- Priority topics (weak in 2+ exams): … (only if history is included)

## 4. Missed questions (grouped by topic)
### {{topic name}}
- Q{{number}} [{{concept}}] — {{question}}
  - Your answer: {{selected or "no answer"}}{{" (unsure)" if flagged}} · Correct: {{answer}} — {{option text}}
  - Why: {{explanation}}

## 5. Correct but unsure (shaky)
- Q{{number}} [{{concept}}] — topic: {{topic name}}

## 6. Recommended next exam
- Total questions: {{N}} · New questions only
- Allocation: {{topic}} × {{count}} ({{reason}}; difficulty {{mix}}) …
- Keep a few questions from strong topics so they are not forgotten.

## 7. History (optional)
| Date | Exam | Score | Rating | Δ vs previous |
|---|---|---|---|---|
- Improved: … · Still weak: …

## 8. Topic list used (reuse these exact ids and names in future quizzes)
- {{id}}: {{name}}

## 9. Concepts already covered (optional, to avoid repeats)
- {{topic name}}: concept; concept; …

## 10. Quiz format for the next quiz (optional)
{{compact Quiz Pack format from PROMPT_TEMPLATES.md "FORMAT_SPEC"}}

## 11. Machine-readable data
```json
{{receipt json}}
```
<!-- END RECEIPT -->
````

Export toggles: **Missed-question detail** (section 4) · **History/profile** (section 7) · **Covered concepts** (section 9) · **Next-quiz format instructions** (section 10, default on). Sections 1–3, 5, 6, 8, 11 are always included.

Size guidance: a 130-question exam with 40 misses is roughly 4–7k tokens with everything on. Show an estimate (characters ÷ 4) in the export screen.

## 8. JSON receipt schema

```json
{
  "format": "quizrunner.receipt",
  "version": 1,
  "receipt_id": "qr-networks-initial-01-202610251430",
  "created_at": "2026-10-25T14:30:00+08:00",
  "app_version": "2.0.0",
  "exam": {
    "quiz_id": "networks-initial-01",
    "title": "Computer Networks — Practice Exam 1",
    "subject": "Computer Networks",
    "quiz_type": "initial",
    "quiz_number": 1,
    "total": 130,
    "taken_at": "2026-10-25T14:10:00+08:00",
    "duration_sec": 3600
  },
  "result": {
    "correct": 94, "wrong": 30, "skipped": 6, "unsure": 22, "shaky": 8,
    "percent": 72.3, "rating": "Fair",
    "gaps": 14, "misconceptions": 22
  },
  "topics": [
    { "id": "t1", "name": "Network Basics", "total": 12, "correct": 11, "wrong": 1, "skipped": 0,
      "unsure": 2, "shaky": 1, "accuracy": 0.917, "status": "strong" }
  ],
  "strengths": ["t1"],
  "weaknesses": ["t4", "t7"],
  "watch": ["t2"],
  "missed": [
    { "number": 14, "topic": "t4", "concept": "TCP vs UDP", "question": "…",
      "selected": "C", "answer": "A", "unsure": false, "explanation": "…" }
  ],
  "shaky": [ { "number": 9, "topic": "t2", "concept": "Subnet mask purpose" } ],
  "next_exam": {
    "recommended_total": 40,
    "allocations": [
      { "topic": "t4", "name": "Transport Layer", "count": 12, "reason": "weak: 6 misses",
        "difficulty_mix": { "easy": 0.3, "moderate": 0.45, "challenging": 0.25 } }
    ],
    "rules": ["new questions only", "reuse topic ids and names"]
  },
  "topic_list": [ { "id": "t1", "name": "Network Basics" } ],
  "history": [
    { "quiz_id": "networks-initial-01", "title": "…", "taken_at": "…", "percent": 72.3, "rating": "Fair" }
  ],
  "cumulative": {
    "priority_topics": ["Transport Layer"],
    "improved": [],
    "still_weak": ["Transport Layer"],
    "score_delta": null
  },
  "covered_concepts": { "Network Basics": ["Purpose of a network", "MAC vs IP address"] }
}
```

Optional blocks: `missed`, `history`, `cumulative`, `covered_concepts` are present only if their toggle is on.

## 9. Import rules

- Accept `.json`, or `.md` (extract the JSON block between the markers).
- Skip if `receipt_id` already exists in history.
- If the pack for `exam.quiz_id` is not stored locally, keep the receipt's data (stats, missed questions) but disable "Open exam review".
- Unknown `version`: warn and try best-effort import.

## 10. Changelog
- v1 — initial format.
