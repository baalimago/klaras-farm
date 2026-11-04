# AGENTS.md

Rules for anyone (human or AI agent) changing Klara's Farm. `CLAUDE.md` is a symlink to this file.

Klara's Farm is a felt-board word game for a toddler, played with a parent, on a base iPad (11th gen, A16, iPadOS 18+). Parents draw things and record names in their own voice and languages; the child taps and hears them. Live at https://klaras-farm.wasmer.app. Pushes to `main` deploy automatically on Wasmer Edge.

## The bar

- **No lag, ever.** If it is laggy even slightly on the iPad, the design is wrong. 60 fps while moving, 0 fps when idle (the renderer sleeps), a tap sounds within 50 ms.
- **The child view has no text and no failure states.** No buzzers, no ✗, nothing scary. Child buttons are icon-only and at least 88 px. Parent targets are at least 44 px.
- **Everything works offline and stays on the iPad.** No accounts, no tracking, no network needed to play.
- **Toddler-proof input.** Primary pointer only, palms ignored, mash-safe audio, press-and-hold plus an adult check to reach edit mode.

## Architecture in one screen

```
web/js/
  farm/ geometry/ motion/ play/ edit/ dsp/   pure domains: data in, data out
  farm-store.js session.js play-engine.js    state owners (one each)
  io/                                        device adapters (IndexedDB, audio, mic, canvas, storage)
  components/<tag>/                          custom elements (parent UI and the board)
  shell.js main.js                           mounting and boot
backend/                                     Python ASGI: static assets, health, client log, migrations
```

Each domain has an architecture doc in `docs/<domain>.md`: farm, geometry, motion, play, edit, dsp, io, components, backend. Read the doc before changing a domain. Product intent lives in `design/` (DESIGN.md, USER_STORIES.md); `design/ARCHITECTURE.md` and `design/IMPLEMENTATION.md` are the original plans and may lag behind `docs/`, which wins.

## Rules

1. **Pure domains stay pure.** `farm/ geometry/ motion/ play/ edit/ dsp/` import only each other and `types.js`. No DOM, no `window`, no time (`Date.now`, `performance.now`), no `Math.random`, no timers, no fetch. Inject `now` and `rng`. `tests/unit/boundaries.test.js` enforces this.
2. **One owner per state.** The farm lives in `FarmStore` (a single snapshot, changed only through intents in `farm/intents.js`). UI mode lives in `Session`. The board's world lives in `PlayEngine`. Components read state and call intents; they never mutate snapshots.
3. **Only `io/`, `components/` and `main.js` touch the device** (IndexedDB, audio, mic, DOM, storage).
4. **Data format changes are versioned.** Bump `FORMAT_VERSION` in `farm/snapshot.js`, add a `migrate` step, think about `minReaderFormat`, extend `storedFormat()` in `farm/snapshot.js` (called by `FarmStore.hydrate()`) so stored IndexedDB records of the old format are detected and migrated, update `types.js`, `tests/builders.js`, the export fixtures, and regenerate `web/data/starter.json` with `node tools/make-starter.mjs`. Old exports must still import.
5. **iPad audio and gestures.** Call `audio.unlock()` and start speech synchronously inside the gesture. Never `await` before closing UI after a tap (iPad promises like `storage.persist()` can hang). Guard each step in pointer handlers so one failure never eats the tap.
6. **Keep the docs up to date. This is not optional.** Any change to a domain updates its `docs/<domain>.md` in the same commit: new modules, changed contracts, events, constants, timings, format versions. A new domain folder gets a new doc and a mention here (`tests/unit/docs.test.js` fails otherwise). If you find a doc that disagrees with the code, fix the doc in your change. Keep README.md's "How to play" true for users and this file true for agents.
7. **No secrets in the repo.** Tokens (for example the Wasmer token used to read logs) live in the environment only.
8. **Licensing.** Only original or properly licensed assets. Music and chimes are synthesized in code; there are no audio files.

## Style guide

- **No build step.** Vanilla ES modules served as-is. No frameworks, no bundler, no TypeScript; types are JSDoc in `web/js/types.js`. The only vendored library is `web/vendor/fflate.js`.
- **Components:** one folder per tag in `web/js/components/<tag>/` with `<Name>Element.js`, `define.js` (guards `customElements.get`) and `<tag>.css`. Light DOM, `services` injected by the Shell, `kf-close` to close a panel. Build DOM with the small `h()` helper (`kf-dialog/dom.js`), never `innerHTML` with data.
- **CSS:** design tokens in `web/css/tokens.css`, no hex colours in data (palette keys from `farm/palette.js`). Felt look: stitched dashed edges, soft shadows, rounded shapes.
- **Code:** small modules, named exports, a header comment saying what the module owns and which user story it serves. Short functions, early returns, no clever one-liners where a plain loop reads better. Comments explain why, not what.
- **Copy for parents:** short, warm, plain sentences. Say exactly what to do ("Record: say “Chicken”"). No jargon.
- **Commits:** imperative subject under 72 characters, a body explaining why. AI agents end commit messages with their attribution trailer.

## Testing (test-first)

Write the test with the change. **Coverage: 70% minimum, 90% preferred**, for lines, branches and functions. New code should land at 90% or better; never lower the thresholds to get green. All suites must pass before pushing:

```sh
npm test                 # unit tests with coverage; fails under 70% (lines, branches, functions)
npm run test:fast        # the same tests without coverage, for a quick loop
npm run test:browser     # Playwright Chromium against the real Python app (tests/browser)
uv run pytest -q         # backend unit + e2e, real Postgres (testcontainers, needs Docker); fails under 70%
```

- Unit tests sit next to modules (`*.test.js`). Shared builders in `tests/builders.js`; the repository contract in `tests/contracts/`.
- Browser tests use `tests/browser/harness.js` (`setup({fakeMedia})`, `newPage()`, `modulePage(html)`). Elements written into `modulePage` HTML do not upgrade; create them with `document.createElement`. Code that only runs in the browser (components, io) is covered here; put logic in pure modules so unit tests can cover it.
- What only a real iPad can prove is listed in `tests/manual-ipad.md`; update it when you add device-dependent behaviour.
- CI (`.github/workflows/ci.yml`) runs everything above plus the Python lint, format and type checks.

## Python tooling (the uv stack)

Use Astral's tools for everything Python:

- **uv** manages Python, the virtualenv and dependencies. `uv sync` installs, `uv run <cmd>` runs inside the env, `uv add <pkg>` / `uv add --dev <pkg>` changes `pyproject.toml` and `uv.lock`. Commit `uv.lock`. Do not use pip, pip-tools or Poetry.
- **Wasmer installs from `requirements.txt`**, which is generated from the lock: after any dependency change run `uv export --no-dev --no-hashes --no-header -o requirements.txt` (CI checks they match).
- **ruff** is the linter and the formatter (it replaces Black, isort, flake8 and pyupgrade). `uv run ruff check .` and `uv run ruff format .` must be clean; rules are in `pyproject.toml`.
- **ty** is the type checker. It is still beta, so CI runs it as advisory; keep it clean anyway and add type hints to new code.
- Backend code stays dependency-light: the standard library, uvicorn and pg8000. Ask before adding a framework.

## Running and deploying

- Run anything in a sandbox or CI, not on the owner's machine. `uv sync && uv run python main.py` serves on port 8000.
- **Deploys are gated on the tests, including Playwright.** Push work to `develop`, never to `main`. CI runs every suite on `develop`; only when all pass does its `promote` job fast-forward `main`, and `main` auto-deploys to Wasmer Edge (`python main.py`, uvicorn). Run the suites locally first anyway, and add a Playwright test for every interaction feature or bug fix.
- After a promote, check the live asset hash in `<base href>` of https://klaras-farm.wasmer.app matches a local run, and that `/healthz` is ok.
- Client errors from devices are posted to `/api/client-log` and appear in the Wasmer app logs as `client-log ...` lines. Read them before guessing at device-only bugs.
- Database migrations run as a deploy step (`uv run python -m backend.migrate`), never on boot.
