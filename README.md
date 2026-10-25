# Quiz Runner

Static, mobile-first practice-exam app: load an AI-generated quiz, take it, get graded.
No build step, no backend, no dependencies. Plan and rules: [`AGENTS.md`](AGENTS.md), [`docs/PLAN.md`](docs/PLAN.md).

## Run locally

ES modules do **not** run from `file://` (double-clicking `index.html` shows a warning instead of the app).
Serve the folder over HTTP:

```bash
npx serve .          # or: npm start
```

Then open the address it prints (usually http://localhost:3000). Developed and tested on Node 22.

## Test

```bash
npm test             # runs: node --test
```

Pure modules (`constants`, `store`, `router`, `loader`, `receipt`) are tested without a browser.
Note: `node --test tests/` (a directory argument) fails on Node 22; use `node --test` or `npm test`.

## Layout

```
index.html        markup only
css/styles.css    all styles (design tokens at the top)
js/main.js        bootstrap + screen switching
js/router.js      hash router (#/quiz, #/export) so the phone's back button works
js/constants.js   versions, thresholds, rating bands, storage keys (the only place for them)
js/store.js       localStorage wrapper: "qr:v1:" keys, try/catch everywhere, in-memory fallback
js/loader.js      legacy text parser (JSON loader arrives in Phase 2)
js/receipt.js     legacy "1. B" export (Markdown/JSON receipt arrives in Phase 4)
js/ui/            DOM-only screen code
samples/          good and deliberately broken packs, a sample receipt (see samples/README.md)
tests/            node:test suites
docs/             PLAN, DEV_CHECKLIST, ai/ specs (Quiz Pack, Receipt, Prompt templates)
```

## Rollback

The pre-v2 app is tagged `v1-legacy`. Redeploy that tag on Vercel to go back.
