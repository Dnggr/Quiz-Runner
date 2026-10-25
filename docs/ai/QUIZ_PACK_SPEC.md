# Quiz Pack Spec — v1

Audience: any AI asked to produce a quiz for Quiz Runner, and developers implementing the loader/validator.
Authoritative. If the app and this file disagree, this file wins until the owner approves a change (then bump the version).

A **Quiz Pack** is a single JSON document containing the exam's metadata, topic list, and every question with its answer and a short explanation. The app grades locally; the AI is not involved after the pack is loaded.

---

## 1. Content rules (what the AI must do)

These come from the learner's study system and are not optional.

1. **Ground everything in the learner's files.** Use only the materials the learner attached. Do not supplement with general knowledge. Keep terminology, concepts, and level of detail consistent with the files. If something is not supported by the files, do not invent it — record a short note in `meta.notes`.
2. **Exact count.** Produce exactly the number of questions requested (across all parts).
3. **Mix difficulty** (`easy`, `moderate`, `challenging`) following the requested mix, and mix **skills**: definition, function, structure, process, comparison, sequence, application (scenario-based).
4. **Reword, don't copy.** Questions must test understanding, not pattern-matching of a sentence from the notes. Include scenario-based questions.
5. **One correct answer** per question. Distractors must be plausible, similar in length and style to the correct option. Avoid "all of the above", "none of the above", "A and B", and giveaway absolutes ("always", "never") unless the material itself is absolute.
6. **Randomize the correct letter.** Aim for roughly 25% each of A, B, C, D. Never more than 3 identical correct letters in a row.
7. **Topics first.** Define the topic list in `meta.topics` before writing questions (6–15 topics, each with subtopics). Every question uses exactly one topic id. In an initial exam, every topic gets at least 3 questions so weaknesses can be measured.
8. **Concept tag.** Give each question a `concept`: a short noun phrase (max 8 words) naming what it tests. This is used for weakness tracking and to avoid repeats in later quizzes.
9. **Explanations are simple and student-friendly**: 1–3 short sentences saying why the correct option is right and why the most tempting wrong option is wrong. No jargon the materials don't use.
10. **No leaks.** Never put hints or answers in the question text. Number questions 1…N sequentially with no gaps or duplicates.
11. **Multiple choice (A–D) by default.** Use True/False only if the learner asks for it.

## 2. Output rules

- Output **only** the pack: a downloadable file named `<quiz_id>.json` if you can create one, otherwise **one** code block containing the JSON. No text before or after. Put any message for the learner in `meta.notes`.
- Valid JSON: double quotes for all keys and strings, escape inner quotes (`\"`) and line breaks (`\n`), no comments, no trailing commas, numbers as numbers (not strings). Use plain straight quotes as JSON delimiters.
- Plain text inside strings (no Markdown formatting).

## 3. Structure

```
{
  "format": "quizrunner.quiz",
  "version": 1,
  "meta": { ... },
  "questions": [ ... ]
}
```

### 3.1 `meta`

| Field | Type | Required | Notes |
|---|---|---|---|
| `quiz_id` | string | yes | Lowercase, hyphens, unique per exam (e.g. `networks-initial-01`). **Same across all parts** |
| `title` | string | yes | Shown to the learner |
| `subject` | string | yes | Course/subject name |
| `quiz_type` | string | yes | `initial` · `targeted` · `retention` · `custom` |
| `total_questions` | integer | yes | Total across all parts |
| `topics` | array | yes | `[{ "id": "t1", "name": "…", "subtopics": ["…"] }]`. Ids are short and stable |
| `quiz_number` | integer | no | 1, 2, 3 … |
| `part`, `total_parts` | integer | no | Default 1 and 1 |
| `target_topics` | array of ids | no | Targeted quizzes only |
| `based_on` | string | no | `quiz_id` of the exam this follows |
| `generated_by` | string | no | e.g. "Claude", "ChatGPT" |
| `generated_on` | string | no | `YYYY-MM-DD` |
| `source_note` | string | no | Which files were used |
| `notes` | array of strings | no | Anything the learner should know (e.g. "Materials only support 8 topics") |

### 3.2 `questions[]`

| Field | Type | Required | Notes |
|---|---|---|---|
| `number` | integer | yes | Unique, sequential. Part 2 continues where part 1 ended |
| `type` | string | yes | `mc` or `tf` |
| `topic` | string | yes | Must match an `id` in `meta.topics` |
| `question` | string | yes | |
| `options` | object | yes for `mc` | `{ "A": "…", "B": "…", "C": "…", "D": "…" }`. Omit for `tf` |
| `answer` | string | yes | `"A"`–`"D"` for `mc`; `"True"` or `"False"` for `tf` |
| `explanation` | string | yes | Rule 9 |
| `concept` | string | strongly recommended | Rule 8 |
| `difficulty` | string | recommended | `easy` · `moderate` · `challenging` |
| `skill` | string | recommended | `definition` · `function` · `structure` · `process` · `comparison` · `sequence` · `application` |
| `source_ref` | string | no | e.g. "Lecture 3, slide 12" |

## 4. Multi-part packs

If asked to split into parts: every part is a **complete, valid pack** with identical `meta` (same `quiz_id`, `total_questions`, `topics`) except `part`. `questions` contains only that part's questions, numbered continuously. The app merges parts by `quiz_id` and question `number`.

**Continuation:** if told "continue from question N", output a pack in the same format with the same `meta` and only questions N onward.

## 5. Example (shortened to 3 questions)

```json
{
  "format": "quizrunner.quiz",
  "version": 1,
  "meta": {
    "quiz_id": "networks-initial-01",
    "title": "Computer Networks — Practice Exam 1",
    "subject": "Computer Networks",
    "quiz_type": "initial",
    "quiz_number": 1,
    "part": 1,
    "total_parts": 1,
    "total_questions": 3,
    "generated_by": "Claude",
    "generated_on": "2026-10-25",
    "source_note": "Lecture 1–3 slides",
    "topics": [
      { "id": "t1", "name": "Network Basics", "subtopics": ["Purpose of networks", "Devices"] },
      { "id": "t2", "name": "Addressing", "subtopics": ["MAC address", "IP address"] }
    ],
    "notes": []
  },
  "questions": [
    {
      "number": 1,
      "type": "mc",
      "topic": "t1",
      "concept": "Purpose of a network",
      "difficulty": "easy",
      "skill": "function",
      "question": "A small office wants its computers to use one shared printer and exchange files. What is the main reason a network helps here?",
      "options": {
        "A": "It makes each computer physically larger",
        "B": "It lets devices communicate and share resources",
        "C": "It removes the need for operating systems",
        "D": "It stops devices from talking to each other"
      },
      "answer": "B",
      "explanation": "A network exists so devices can communicate and share resources like printers and files. The other options describe things a network does not do."
    },
    {
      "number": 2,
      "type": "mc",
      "topic": "t2",
      "concept": "MAC vs IP address",
      "difficulty": "moderate",
      "skill": "comparison",
      "question": "Which statement best separates a MAC address from an IP address?",
      "options": {
        "A": "A MAC address changes every time a device joins a new network",
        "B": "An IP address is burned into the network card at the factory",
        "C": "Both identify a device in exactly the same way",
        "D": "A MAC address identifies the network card, while an IP address identifies the device's place on a network"
      },
      "answer": "D",
      "explanation": "The MAC address belongs to the network card. The IP address tells where the device sits on a network. Option B swaps the two."
    },
    {
      "number": 3,
      "type": "tf",
      "topic": "t2",
      "concept": "Device can have MAC and IP",
      "difficulty": "easy",
      "skill": "definition",
      "question": "A device can have both a MAC address and an IP address.",
      "answer": "True",
      "explanation": "They work at different levels, so one device normally has both."
    }
  ]
}
```

## 6. AI self-check (run silently before sending)

- [ ] Question count equals the requested total (across parts); numbers are 1…N with no gaps.
- [ ] Every `topic` exists in `meta.topics`; every topic has ≥ 3 questions (initial exams).
- [ ] Each `answer` exists in that question's `options`; correct letters are spread across A–D with no run longer than 3.
- [ ] No question copies a sentence from the files word for word; several are scenario-based.
- [ ] Every fact comes from the learner's files; anything unsupported is in `meta.notes`.
- [ ] Output is valid JSON only (no commentary, no trailing commas, no smart quotes as delimiters).

## 7. Loader/validator behavior (for developers)

- **Errors (block loading):** not JSON after cleanup · no `questions` · question missing `question`, `answer`, or `topic` · `answer` not among options · duplicate `number` · `topic` not in `meta.topics`.
- **Warnings (load anyway):** count ≠ `meta.total_questions` · missing `explanation` or `concept` · option count ≠ 4 · any correct letter above 40% of questions · `version` differs from the app's `SPEC_VERSION`.
- **Normalization:** uppercase option letters and answers, trim whitespace, infer `type` (`tf` if no `options`), default `part`/`total_parts` to 1.

## 8. Changelog
- v1 — initial format.
