# Samples

| File | Purpose | Expected result |
|---|---|---|
| `sample-pack.json` | Good pack: 10 questions, 3 topics (4/3/3), one True/False (Q6) | Loads with no errors or warnings |
| `sample-receipt.md` | Receipt for `sample-pack.json` with fixed responses (7/10, Fair) laid out per `docs/ai/RECEIPT_SPEC.md` §7 | Golden target for the receipt builder (P4-12) and receipt import (P6-08) |
| `sample-pack-130.prompt.md` | Prompt for generating `sample-pack-130.json` (task P0-06) | Paste into an AI chat with your real course files attached |
| `sample-pack-130.json` | **Not created yet (P0-06).** Must come from real course files via an AI | Loads; loads in under 1 s (P7-06) |

## `broken/` (each file has exactly one flaw)

Every broken file is the same 3-question base pack (Q1 topic `t1`; Q2 and Q3 topic `t2`) with one thing broken.

| File | Flaw | Expected loader/validator outcome |
|---|---|---|
| `01-code-fenced.json` | JSON wrapped in a ```` ```json ```` fence | Loads (fence stripped) |
| `02-trailing-comma.json` | Trailing comma after `notes` and after the last question | Loads (retry without trailing commas) |
| `03-truncated.json` | Cut off in the middle of Q3 | Loads with Q1 and Q2 (salvage, P7-01): "Loaded 2 of 3", a count warning, and a Continue prompt for question 3 |
| `04-missing-answer.json` | Q3 has no `answer` | Error: Q3 missing `answer` |
| `05-answer-not-in-options.json` | Q2 answer is `"E"` | Error: Q2 answer not among options |
| `06-duplicate-numbers.json` | Q3 is numbered 2 | Error: duplicate question number 2 |
| `07-unknown-topic.json` | Q3 topic is `"t9"` | Error: Q3 topic not in `meta.topics` |
| `08-smart-quotes.json` | Curly quotes used as JSON delimiters | Error (not JSON). Whether to auto-repair is an open question (see the hand-off notes) |
| `09-bom.json` | UTF-8 byte-order mark at the start | Loads (BOM stripped) |
