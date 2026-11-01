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

The percentage is rounded to one decimal (72.3) and the rating is taken from that **same rounded number**, so the percentage shown and the rating next to it never disagree: 269 of 299 is 89.967%, shown as 90 and rated Excellent (BUG-11). Constants live in `constants.js` (`RATING_BANDS`).

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
4. Within **weak**: split proportionally to `misses`, minimum 2 per weak topic. Within other groups: split evenly, minimum 1 per topic. When the weak share (60% of `N`) cannot hold 2 for every weak topic, **the share wins over the minimum of 2**: the minimum falls to 1 per weak topic. A weak topic is never left without a question, because it could not be re-measured: when the share cannot hold even 1 each, it grows to the number of weak topics, taking the extra questions from the strong group first, then from watch + developing. If there are more weak topics than `N`, the most-missed topics get one question each and the rest get none (BUG-07). **The minimum of 1 for the other groups holds whenever `N` is at least the number of topics** (BUG-26): a group whose share is smaller than its number of topics is lifted to one question per topic, taking the questions from the strong group first, then watch + developing, and from the weak share last. **When `N` is smaller than the number of topics**, nobody can cover every topic, so the shares stand and priority decides who goes without: weak topics are covered first (above), then watch + developing in the order of the watch list (lowest accuracy first; they may take the strong group's questions), and strong topics are the first to get none.
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

- Accept `.json`, or `.md` (extract the JSON block between the markers). A text that starts with `{` is read as JSON, whatever it contains: the markers are looked for only in other text, so a question or explanation that holds `<!-- BEGIN RECEIPT -->` does not turn a `.json` receipt (or a backup) into a "Markdown receipt" (BUG-22). Text before the begin marker is still allowed.
- Skip if `receipt_id` already exists in history. A receipt with **no** `receipt_id` (only a hand-edited one; the app always writes it) is matched by its date: the same `quiz_id` and the same start second is the same exam. When such a receipt has no usable date of its own and was dated at the time of import (below), there is no date to match, so it is matched by `quiz_id`, title and the counts (`total`, `correct`, `wrong`, `skipped`, `unsure`) instead, and a second import is skipped (BUG-35). A receipt that has a usable date is never matched by its counts, so a retake with the same score is kept.
- The counts are the facts (BUG-19): `correct + wrong + skipped` must equal `exam.total` and `unsure` must not be more than `exam.total`, otherwise the receipt is refused ("may have been edited"). `exam.total` must also be at most 1000 (`MAX_PACK_QUESTIONS`, the most the loader and the Prompt Builder accept); a larger claim is refused the same way (BUG-30). `percent` and `rating` are **recomputed from the counts** by the rules of §2 and the imported values are ignored, so a receipt may leave them out (BUG-28); if the receipt's `percent` is a number more than 0.5 off, or its `rating` text differs, the import goes ahead with a warning.
- **Which date texts are read (BUG-34).** `exam.taken_at` and `created_at` must be ISO 8601: `YYYY-MM-DD`, or `YYYY-MM-DD` and a time `hh:mm`, optionally `:ss` and a fraction, joined by `T` or a space, optionally followed by `Z` or an offset (`+08:00`, `+0800`, `+08`) — the form §8 shows. A text without an offset counts as UTC. The calendar is checked, so `2026-02-31` is not a date. A hand-typed `2026-10-25` works; loose text does not (`12`, `March 5`, `25 Oct 2026`, `10/25/2026`), and neither does a number: it counts as no date, under the rules below.
- `exam.taken_at` is used only when it is a date from 1 January 1970 up to 30 December 9999 (BUG-29: every local time zone then still shows a 4-digit year). Anything else (`+275760-09-13…`, `0001-01-01…`, text) counts as no date: the receipt's `created_at` is used instead, under the same limits, with the warning "no valid exam date"; when neither is usable the receipt is refused. A date later than the moment of import plus one day is not used either (BUG-32): the next date that is not in the future is used, with a warning; when every date is in the future (the device that made the receipt had its clock set ahead), the receipt is still imported and dated at the time of import, with a warning.
- `exam.duration_sec` is used for the finish time only when start + duration is a date up to the end of year 9999; a larger value is ignored with a warning, and the rest of the receipt is imported (BUG-24).
- If the pack for `exam.quiz_id` is not stored locally, keep the receipt's data (stats, missed questions) but disable "Open exam review".
- Unknown `version`: warn and try best-effort import.

## 10. Changelog
- v1 — initial format.
- v1 (BUG-07, BUG-11, BUG-19) — §6 says which rule wins when the weak share cannot hold 2 questions per weak topic; §2 says the rating uses the rounded percentage; §9 lists the import checks (`unsure` within the total) and says `percent` and `rating` are recomputed. The receipt format itself is unchanged, so `SPEC_VERSION` stays 1.
- v1 (BUG-22, BUG-24) — §9 says that a text starting with `{` is JSON before any marker is looked for, and what happens to a duration that gives no valid date. The receipt format itself is unchanged, so `SPEC_VERSION` stays 1.
- v1 (BUG-26, BUG-28, BUG-29) — §6 says what the minimum of 1 per topic means for the watch / developing and strong groups, and who goes without when `N` is smaller than the number of topics; §9 says `percent` and `rating` may be absent and gives the range of a usable `exam.taken_at`. The receipt format itself is unchanged, so `SPEC_VERSION` stays 1.
- v1 (BUG-30, BUG-32) — §9 limits `exam.total` to 1000 and says what happens to a receipt dated in the future. The receipt format itself is unchanged, so `SPEC_VERSION` stays 1.
- v1 (BUG-34, BUG-35) — §9 says which date texts are read (ISO 8601 only) and how a receipt without `receipt_id` that was dated at the time of import is recognised on a second import. The receipt format itself is unchanged, so `SPEC_VERSION` stays 1.
