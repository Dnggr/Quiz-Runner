<!-- Hand-assembled from docs/ai/PROMPT_TEMPLATES.md (initial mode, defaults, single reply) for task P0-06.
     Before pasting: replace [YOUR SUBJECT] and attach your real course files to the chat.
     Everything from the line "I am a" to the end is the prompt. -->

I am a BSIT student studying [YOUR SUBJECT]. Use the files I attached in this chat as the main and only source for everything. Do not replace or supplement them with general knowledge. Keep terminology, concepts, and level of detail consistent with my files. If something is not supported by my files, do not make it up; add a short note to "meta.notes" instead.

TASK: Build a practice exam of exactly 130 multiple-choice questions from my files.
1. First read my files and define 6-15 topics (each with subtopics) that cover them. These go in "meta.topics" and act as my concept map.
2. Then write the questions. Every topic must have at least 3 questions.
3. Difficulty mix: about 30% easy, 40% moderate, 30% challenging.
4. Cover these skills: definition, function, structure, process, comparison, sequence, application.

CONTENT RULES
- Mix question types: definitions, functions/purpose, structures/components, processes/how something works, differences/comparisons, sequences/order of steps, and application or scenario-based recall.
- Do not make every question obvious or a straight copy of a sentence in my files. Reword concepts so I have to understand them, not pattern-match phrasing.
- Exactly one correct answer per question. Make wrong options plausible and similar in length. Avoid "all of the above", "none of the above", and "A and B" style options.
- Randomize which letter is correct. Aim for about 25% each of A, B, C, D, and never more than 3 identical correct letters in a row.
- Give each question a short "concept" (max 8 words) naming what it tests.
- Write each "explanation" in 1-3 simple, student-friendly sentences: why the correct option is right and why the most tempting wrong option is wrong.
- Never put the answer or hints in the question text.

OUTPUT FORMAT (Quiz Pack v1)
Return one JSON object and nothing else:

{
  "format": "quizrunner.quiz",
  "version": 1,
  "meta": {
    "quiz_id": "sample-130-01",
    "title": "…",
    "subject": "[YOUR SUBJECT]",
    "quiz_type": "initial",
    "quiz_number": 1,
    "part": 1,
    "total_parts": 1,
    "total_questions": 130,
    "generated_by": "…",
    "generated_on": "YYYY-MM-DD",
    "source_note": "which of my files you used",
    "topics": [ { "id": "t1", "name": "…", "subtopics": ["…"] } ],
    "notes": []
  },
  "questions": [
    {
      "number": 1,
      "type": "mc",
      "topic": "t1",
      "concept": "…",
      "difficulty": "easy | moderate | challenging",
      "skill": "definition | function | structure | process | comparison | sequence | application",
      "question": "…",
      "options": { "A": "…", "B": "…", "C": "…", "D": "…" },
      "answer": "B",
      "explanation": "…"
    }
  ]
}

JSON rules: straight double quotes only, escape inner quotes and line breaks, no comments, no trailing commas, numbers are numbers, plain text inside strings. Number questions 1 to N with no gaps. Every "topic" must match an id in "meta.topics". Every "answer" must be one of that question's option letters.

DELIVERY
Do not reveal or discuss the answers in the chat. Output only the quiz pack:
- If you can create a downloadable file, create "sample-130-01.json" containing only the JSON, and reply with just the file.
- Otherwise reply with a single code block containing only the JSON. No text before or after it.
All questions go in one reply.

BEFORE YOU REPLY, silently check: the number of questions is exactly 130 (or the part's share); topics all exist in "meta.topics" and each has at least 3 questions (initial exam only); correct letters are spread across A-D; no question copies a sentence from my files; everything comes from my files; the JSON is valid. Fix any problem first, then send.
