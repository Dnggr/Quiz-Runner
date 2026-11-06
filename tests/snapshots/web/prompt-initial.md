I am a BSIT student studying Networking Basics. I do not have course files or notes for this, so nothing is attached to this chat. Build the content yourself, following the SOURCE RULES below. Keep terminology, concepts, and level of detail suited to a student at my level taking a standard course on this subject.

TASK: Build a practice exam of exactly 130 multiple-choice questions on Networking Basics.
1. First define 6-15 topics (each with subtopics) that a standard course on Networking Basics covers, using only the sources the SOURCE RULES below allow. These go in "meta.topics" and act as my concept map.
2. Then write the questions. Every topic must have at least 3 questions.
3. Difficulty mix: about 30% easy, 40% moderate, 30% challenging.
4. Cover these skills: definition, function, structure, process, comparison, sequence, application.

SOURCE RULES (I have no course files)
- Research first. If you can browse or search the web, do it before writing. Take facts only from reliable sources: official documentation and standards (for example RFCs, IEEE, and vendor documentation), university course pages, peer-reviewed papers, and recognised textbooks or open educational resources. Do not use forums, social media, anonymous blogs, content farms, or other AI-written summaries as a source.
- If you cannot browse, use only well-established knowledge that standard textbooks agree on, and say so in one note in "meta.notes". If you are not sure a fact is correct or current, leave it out.
- Never invent facts, numbers, commands, names, or sources. Never make up a link.
- Write the sources you actually used into "meta.source_note", by name (site, standard, or book title). Where it helps, add a short "source_ref" to a question.
- Put anything else I should know (for example "no files, so the topics follow a standard course outline") in "meta.notes".
- Do not ask me for files or for more details before you start. Build the quiz now.

CONTENT RULES
- Mix question types: definitions, functions/purpose, structures/components, processes/how something works, differences/comparisons, sequences/order of steps, and application or scenario-based recall.
- Do not make every question obvious or a straight copy of a sentence from a source. Reword concepts so I have to understand them, not pattern-match phrasing.
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
    "quiz_id": "networking-basics-initial-01",
    "title": "…",
    "subject": "Networking Basics",
    "quiz_type": "initial",
    "quiz_number": 1,
    "part": 1,
    "total_parts": 1,
    "total_questions": 130,
    "generated_by": "…",
    "generated_on": "YYYY-MM-DD",
    "source_note": "the reliable sources you used (site, standard, or book names)",
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
- If you can create a downloadable file, create "networking-basics-initial-01.json" containing only the JSON, and reply with just the file.
- Otherwise reply with a single code block containing only the JSON. No text before or after it.
All questions go in one reply.

BEFORE YOU REPLY, silently check: the number of questions is exactly 130 (or the part's share); topics all exist in "meta.topics" and each has at least 3 questions (initial exam only); correct letters are spread across A-D; no question copies a sentence from a source word for word; every fact comes from a reliable source or from well-established knowledge, and nothing is made up; "meta.source_note" names the sources used; the JSON is valid. Fix any problem first, then send.
