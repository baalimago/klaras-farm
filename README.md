# Klara's Farm

A felt-board word game for toddlers, played with a parent. Parents draw the things and record their names in their own voice and language; the child taps a thing and hears its name. iPad-first (base iPad 11th gen, iPadOS 18+), runs in any modern browser, works offline from the Home Screen. Python backend on Wasmer Edge, vanilla JS frontend with no build step.

Live: https://klaras-farm.wasmer.app

## How to play

- **Play:** tap anything. It jumps and says its name (then its sound, if recorded). Until a grown-up records the name, the iPad's built-in voice says it; in edit mode a small mic dot marks things still waiting for your voice.
- **Find it:** turn on "Find it in <scene>" in Settings. Now and then, when the board is calm, the app asks "Where is the cow?" (your recorded question, or the iPad's voice). A right tap celebrates; after two wrong taps the right thing glows.
- **Edit mode (grown-ups):** press and hold an empty spot or a thing for 1.5 s, then tap the code shown. Things wiggle; pencil edits, cross deletes. The bar has Scenes, Change scene, + Add, Settings and Done. Edit mode closes by itself after a minute.
- **Settings:** languages, sleep timer, adult-check kind, export/import (share sheet), privacy, Guided Access guide, delete all data.

## Run locally

```sh
pip install -e ".[dev]"          # uvicorn, pg8000, pytest, testcontainers
python main.py                    # http://localhost:8000 (Wasmer runs the same command)
```

## Tests

```sh
npm test                          # unit tests, Node's built-in runner, single process (~1 s)
python -m pytest -q               # backend unit + e2e: real Postgres (testcontainers, needs Docker) and a temp dir as the volume
npm run test:browser              # Chromium against the real Python app (needs the playwright package)
```

CI (`.github/workflows/ci.yml`) runs all three. `tests/manual-ipad.md` lists what only a real iPad can prove.

## Database migrations

Postgres is not needed to play (everything lives on the iPad). It is wired for the later encrypted backup. Migrations run as a deploy step, never on boot:

```sh
python -m backend.migrate         # uses DB_HOST, DB_PORT, DB_NAME, DB_USERNAME, DB_PASSWORD
```

`/healthz` reports the git SHA (`GIT_SHA`) and asset hash; `/healthz?deep=1` also checks the database.

## Layout

- `backend/`: ASGI app (in-memory static server with hashed immutable assets, rendered service worker, health), asset archive on the volume, Postgres access and migrations.
- `web/`: `index.html`, `css/`, `data/` (motion presets, question scripts per language, starter content), `vendor/fflate.js`, and `js/`:
  - pure domains: `farm/` `geometry/` `motion/` `play/` `edit/` `dsp/`
  - state owners: `farm-store.js` `session.js` `play-engine.js`
  - device adapters: `io/` (IndexedDB, audio, mic, renderer, felt painter, export, storage)
  - `components/<tag>/`: custom elements
- `tests/`: builders, the repository contract, unit and browser tests, fixtures.
- `design/`: [design notes](design/DESIGN.md), [user stories](design/USER_STORIES.md), [architecture](design/ARCHITECTURE.md), [implementation contracts](design/IMPLEMENTATION.md), sketches.
