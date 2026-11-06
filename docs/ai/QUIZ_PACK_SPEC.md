# Quiz Pack Spec — v1

Audience: any AI asked to produce a quiz for Quiz Runner, and developers implementing the loader/validator.
Authoritative. If the app and this file disagree, this file wins until the owner approves a change (then bump the version).

A **Quiz Pack** is a single JSON document containing the exam's metadata, topic list, and every question with its answer and a short explanation. The app grades locally; the AI is not involved after the pack is loaded.

---

## 1. Content rules (what the AI must do)

These come from the learner's study system and are not optional.

1. **Ground everything in the learner's files.** Use only the materials the learner attached. Do not supplement with general knowledge. Keep terminology, concepts, and level of detail consistent with the files. If something is not supported by the files, do not invent it — record a short note in `meta.notes`.
   **Exception (BUG-42): a learner with no files.** When the prompt says the learner has no course files (Prompt Builder source `web`), nothing is attached and the AI must not ask for files. It then grounds the content in **reliable sources** instead: official documentation and standards, university course pages, peer-reviewed papers, recognised textbooks. If it cannot browse, it uses only well-established knowledge that standard textbooks agree on and says so in `meta.notes`. It never invents facts, numbers, commands, names, sources or links, and it names the sources it used in `meta.source_note` (and, where useful, `source_ref` on a question). The rest of this section applies unchanged.
2. **Exact count.** Produce exactly the number of questions requested (across all parts).
3. **Mix difficulty** (`easy`, `moderate`, `challenging`) following the requested mix, and mix **skills**: definition, function, structure, process, comparison, sequence, application (scenario-based).
4. **Reword, don't copy.** Questions must test understanding, not pattern-matching of a sentence from the notes. Include scenario-based questions.
5. **One correct answer** per question. Distractors must be plausible, similar in length and style to the correct option. Avoid "all of the above", "none of the above", "A and B", and giveaway absolutes ("always", "never") unless the material itself is absolute.
6. **Randomize the correct letter.** Aim for roughly 25% each of A, B, C, D. Never more than 3 identical correct letters in a row. The app also spreads the letters itself after loading (§7 "Answer positions", BUG-46), but only for questions whose wording does not name a letter, so do it properly anyway.
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

The AI must write every field marked "yes". The app only **blocks** loading when `quiz_id` is missing (§7); a pack without `title`, `subject`, `quiz_type` or `total_questions` still loads, with a warning that says what the app does without it (BUG-31).

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
| `source_note` | string | no | Which files were used; with no files (BUG-42), the reliable sources used, by name |
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
| `source_ref` | string | no | e.g. "Lecture 3, slide 12"; with no files (BUG-42), e.g. "RFC 791 §3.2" |

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
- [ ] With no files (BUG-42): every fact comes from a reliable source or from well-established knowledge, nothing is made up, and `meta.source_note` names the sources used.
- [ ] Output is valid JSON only (no commentary, no trailing commas, no smart quotes as delimiters).

## 7. Loader/validator behavior (for developers)

- **Errors (block loading):** not JSON after cleanup (and not a cut-off reply, see "Truncated output") · no `questions` · question missing `question`, `answer`, or `topic` · `answer` not among options · duplicate `number` · `topic` not in `meta.topics` · `number` missing, or not a whole number of 1 or more (BUG-08) · an option of a multiple-choice question that is empty or not text (BUG-12) · `meta.quiz_id` missing, blank or not text (BUG-23: it is the key of the saved pack, the exam and its receipt).
- **Warnings (load anyway):** count ≠ `meta.total_questions` · missing `explanation` or `concept` · option count ≠ 4 · any correct letter above 40% of questions · `version` differs from the app's `SPEC_VERSION` · the same topic `id` listed twice in `meta.topics` (BUG-12; the later entry is used) · a question `type` that is not `mc` or `tf` (BUG-15; it is treated as `mc`) · `meta.quiz_type` not one of `initial`, `targeted`, `retention`, `custom`, and a `difficulty` or `skill` outside the lists in §3.2 (BUG-20; the value is kept as written, and an unknown `difficulty` counts as "no difficulty given") · `total_questions`, `part`, `total_parts` or `quiz_number` present but not a whole number of 1 or more (BUG-17; the app ignores it) · `meta.title`, `subject`, `quiz_type` or `total_questions` missing or blank (BUG-31; one warning per field: a missing title is shown as "Untitled Quiz Pack", a missing subject is compared only with other exams that have none, a missing `total_questions` means the count is unknown and nothing is reported missing).
- **Normalization:** uppercase option letters and answers, trim whitespace, infer `type` (`tf` if no `options`), default `part`/`total_parts` to 1, and (BUG-08, BUG-12, BUG-15, BUG-17, BUG-20):
  - a whole number written as digits in text (`"3"`, `"130"`) becomes a number: question `number`, `meta.total_questions`, `part`, `total_parts`, `quiz_number`. Anything else that is not a whole number is not converted (see the errors and warnings above). §2 still tells the AI to write numbers as numbers; this only forgives the slip;
  - `type` is lowercased and the usual spellings are mapped: `TF`, `True/False`, `true or false` → `tf`; `MC`, `Multiple Choice` → `mc`;
  - `meta.quiz_type`, `difficulty` and `skill` are lowercased;
  - an option written as a number (`"A": 5`) becomes text (`"5"`).

- **Answer positions (BUG-46):** after a pack loads, and after the parts of one `quiz_id` are merged, the app moves the options of multiple-choice questions so the correct letters are spread evenly (counts differ by at most 1) and no letter repeats more than 3 times in a row. It works on a copy: the answer letters, options and `answer` of the loaded pack change; nothing else does. A question is left exactly as written when its `question`, an option or its `explanation` names a letter or a position ("Option B", "(C)", "A and B", "all of the above", "both options", "the last option"), when an option text starts with its own letter ("A. HTTP"), when it does not have exactly the options A-D, and when it is True/False; the other questions make up for them, so the spread is exact only when no question is left as written. The order is pseudo-random but seeded from the pack (quiz id, question numbers, texts and answers), so loading the same pack again gives the same arrangement. Nothing is moved when the letters are already even (counts differ by at most 1) and have no run above 3. The warnings are worked out again on the result: a pack that could not be fully balanced keeps its "spread out" warning.

- **Packs read back from storage (BUG-27):** a pack saved by an older version (a saved exam in progress, a pack in a backup) is checked by the same rules. One that passes is used as it is; one that does not gets a second chance after the normalization above. A pack that is still invalid (a blank option, a missing `number`, a missing `meta.quiz_id`) is refused, as it would be if it were pasted today; nothing is invented to make it pass.

### Truncated output (P7-01)
If the text stops in the middle of the JSON (the AI's reply was cut off) and a `"questions"` list had started, the loader keeps every question object that is complete, drops the one that was being written, and loads the rest as a normal pack. The count warning applies as usual, and the app shows "Loaded 97 of 130". If no complete question can be kept (for example the text stops inside `meta`), nothing loads and the ordinary "cut off" error is shown.

### Missing questions (P7-02)
`meta.total_questions` is the plan: the questions are numbered 1…total. A number in that range with no question is missing. A `total_questions` that is absent, not a whole number, or above 1000 is treated as unknown (nothing is reported missing). The app offers a Continue prompt for the missing numbers (`PROMPT_TEMPLATES.md`).

### Merging parts (P7-04)
A pack loaded while a pack with the same `quiz_id` is still waiting on the Topics preview is merged with it:
- Questions are combined by `number`. When both have the same number, the later pack's question wins. A part pasted twice changes nothing.
- `meta`: for every field the later pack has, the later one wins; `topics` are the union by `id` (later wins for the same id). The merged pack has `part` 1 and `total_parts` 1.
- Progress is "Parts loaded: X of Y": X counts the distinct `part` numbers that arrived whole (a part that was cut off does not count until a whole copy of it is loaded), Y is the largest `total_parts` seen.
- A pack with a different `quiz_id` replaces the waiting one.

## 8. Changelog
- v1 — initial format.
- v1 (P7) — documented the loader's handling of truncated output, missing questions and multi-part merging (§7). The format itself is unchanged, so `SPEC_VERSION` stays 1.
- v1 (BUG-08, BUG-12, BUG-15, BUG-17, BUG-20) — §7 now names a missing or non-integer `number` and an empty or non-text option as errors, lists the new warnings (duplicate topic id, unknown `type`, `quiz_type`, `difficulty`, `skill`, a count that is not a whole number) and the normalization of numbers written as text, `type`, `quiz_type`, `difficulty`, `skill` and numeric option text. The format itself is unchanged (§3 already said `number` is a required integer), so `SPEC_VERSION` stays 1.
- v1 (BUG-23) — §7 names a missing, blank or non-text `meta.quiz_id` as an error. The format itself is unchanged (§3.1 already said `quiz_id` is required), so `SPEC_VERSION` stays 1.
- v1 (BUG-27) — §7 says that a pack read back from storage is normalized before it is checked, and that one which is still invalid is refused. The format itself is unchanged, so `SPEC_VERSION` stays 1.
- v1 (BUG-31) — §3.1 and §7 say that a pack missing `title`, `subject`, `quiz_type` or `total_questions` loads with one warning per field (an absent `total_questions` was silent before). The format itself is unchanged (§3.1 already marked them required), so `SPEC_VERSION` stays 1.
- v1 (BUG-42) — §1 rule 1 has an exception for a learner with no files (reliable sources instead of the files), §3 says what `source_note` and `source_ref` hold then, and §6 has a matching self-check line. The format itself is unchanged, so `SPEC_VERSION` stays 1.
- v1 (BUG-46) — §1 rule 6 and §7 "Answer positions": the app spreads the correct letters evenly after loading (on a copy, seeded from the pack). The format itself is unchanged, so `SPEC_VERSION` stays 1.
