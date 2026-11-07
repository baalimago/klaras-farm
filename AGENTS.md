# AGENTS.md

How to work on Klara's Farm. This is the most important document in the repository: read it fully before changing anything, and keep it true. `CLAUDE.md` is a symlink to it.

## 1. What we are building

A felt-board word game for a toddler, played with a parent, on a base iPad (11th gen, A16, iPadOS 18+). Parents draw things and record names and questions in their own voice and languages; the child taps and listens. Live at https://klaras-farm.wasmer.app.

The bar every change is judged against:

- **No lag, ever.** 60 fps while anything moves, 0 fps when idle, a tap sounds within 50 ms, a dragged thing stays under the finger. If it is laggy on the iPad even slightly, the design is wrong.
- **The child view has no text and no failure states.** No buzzers or ✗. Child buttons are icon-only and at least 88 px. One exception, decided in QA round 3: a short, self-fading tip for the grown-up beside the child ("Hold 1 s to record your own question") may appear next to a find button when a question played in the iPad voice. It never blocks a tap and can be switched off in Settings.
- **The iPad is the main target, not the only one.** Parent copy names the device only through `io/device.js` ("this iPad" on an iPad, "this device" elsewhere), and steps that exist only on iPad and iPhone (`device().ios`) show only there.
- **Parents never get stuck or confused.** Every screen has a visible way out. Every edit shows on screen immediately. Parent targets are at least 44 px. Copy is short, warm and says exactly what to do ("Record: say “Chicken”").
- **Offline and private.** Everything lives on the iPad. No accounts, no tracking, no network needed to play.
- **Toddler-proof input.** Primary pointer only, palms ignored, mash-safe audio, press-and-hold plus an adult check before anything meant for grown-ups.

## 2. Build for change, not for the first demo

Features get revisited after every family playtest. Code that only fits its first acceptance criteria breaks the moment someone tweaks it, and that is how state bugs reach the iPad. So:

- **Model behaviour as explicit state machines.** Any flow with steps or modes (placing legs, a find round, a recording, a gate) is a pure reducer, `state + event → state`, with every state named and every transition tested. No ad-hoc booleans spread across a component.
- **Render from state, always.** A component keeps no shadow copy of data. After every event it renders from the current state; nothing is patched into the DOM by hand. If the screen and the state can disagree, that is a bug.
- **State changes show immediately.** Update the state and the screen synchronously, then persist. Never make the UI wait on IndexedDB, audio or the network to reflect an edit.
- **Small modules with one job and a stated contract.** A module's header says what it owns and what it promises. Compose small, separately tested pieces instead of growing one big element.
- **When you touch a module, leave it better.** If a small tweak needs a hack, the structure is wrong: fix the structure, and its tests, in the same change.

## 3. Architecture

```
web/js/
  farm/ geometry/ motion/ play/ edit/ dsp/   pure domains: data in, data out
  farm-store.js session.js play-engine.js    state owners, one per kind of state
  io/                                        device adapters: IndexedDB, audio, mic, canvas, storage
  gift/                                      wrapper.js: birthday wrapping paper, self-contained and reusable
  components/<tag>/                          custom elements: the board and the parent UI
  shell.js main.js                           mounting and boot
backend/                                     Python ASGI: static assets, health, client log, migrations
```

Each domain has its architecture doc, `docs/<domain>.md`: farm, geometry, motion, play, edit, dsp, io, gift, components, backend. Read the doc before changing the domain. Product intent is in `design/DESIGN.md` and `design/USER_STORIES.md`. `design/ARCHITECTURE.md` and `design/IMPLEMENTATION.md` are the original plans and are historical; where they disagree with `docs/`, `docs/` wins.

Rules that hold everywhere:

1. **Pure domains stay pure.** They import only each other and `types.js`. No DOM, `window`, timers, `fetch`, `Date.now`, `performance.now` or `Math.random`: inject `now` and `rng`. `tests/unit/boundaries.test.js` enforces this.
2. **One owner per state.** The farm lives in `FarmStore` (one snapshot, changed only through intents in `farm/intents.js`). UI mode lives in `Session`; the first-run overlays (welcome card, tour) are mounted and dismissed by the `Shell`, because they never change the mode and never come back by themselves. The board's world lives in `PlayEngine`. Components read state and call intents; they never mutate a snapshot.
3. **Only `io/`, `components/` and `main.js` touch the device** (IndexedDB, audio, mic, DOM, storage). The exception is `gift/`, a package meant to be copied onto other pages: it owns its DOM, canvas and audio, imports nothing from the app, and only `main.js` imports it.
4. **Data format changes are versioned.** Bump `FORMAT_VERSION` in `farm/snapshot.js`, add a `migrate` step, decide `minReaderFormat`, extend `storedFormat()` so old IndexedDB records are detected and migrated on load, update `types.js`, `tests/builders.js` and the export fixtures, and regenerate `web/data/starter.json` with `node tools/make-starter.mjs`. Old exports must still import.
5. **iPad audio and gestures.** Call `audio.unlock()` and start speech synchronously inside the gesture handler. Never `await` before closing UI after a tap (iPad promises such as `storage.persist()` can hang). Guard each step in a pointer handler so one failure never eats the tap.
6. **No secrets in the repo.** Tokens live in the environment only.
7. **Only original or properly licensed assets.** Music and sounds are synthesized in code; there are no audio files.

## 4. Style

- **No build step.** Vanilla ES modules served as-is. No frameworks, bundler or TypeScript; types are JSDoc in `web/js/types.js`. The only vendored library is `web/vendor/fflate.js`.
- **Components:** one folder per tag, `web/js/components/<tag>/`, with `<Name>Element.js`, `define.js` (guards `customElements.get`) and `<tag>.css`. Light DOM, `services` injected by the Shell, `kf-close` to close a panel, DOM built with `h()` from `kf-dialog/dom.js` (never `innerHTML` with data). Editing controls always sit above the canvas.
- **CSS:** tokens in `web/css/tokens.css`. Colours in data are palette keys from `farm/palette.js`, never hex. The one exception: a place's sky and ground may hold a colour the parent picked with the colour picker, stored as lowercase `#rrggbb` (format 5). The felt look: stitched dashed edges, soft shadows, rounded shapes.
- **Code:** named exports, short functions, early returns, plain loops over clever one-liners. Comments say why, not what.
- **Python:** standard library, uvicorn and pg8000 only (ask before adding a framework); type hints on new code.
- **Commits:** imperative subject under 72 characters, and a body that explains why. AI agents end the message with their attribution trailer.

## 5. Quality: test, look, review

### Test at the right level

Most behaviour is tested where it lives, per use case, not through the whole app.

- **Pure modules and state machines:** unit tests for every use case and transition, including the awkward ones (changing your mind midway, undo, cancel, limits, empty input). Most tests belong here.
- **Components:** a browser test per use case, mounting the element alone with fake services (`tests/browser/harness.js`: use `modulePage()`, then create elements with `document.createElement`, because elements written into the page HTML do not upgrade). After each interaction, assert that the screen matches the state.
- **End to end:** a few journeys through the real app (first run, add a thing, play a round, export and import). Do not add an e2e test for every feature; it makes the suite heavy and slow without finding more bugs.
- **Every bug fix starts with a test that fails**, at the level where the bug lives.

Coverage is **70% minimum, 90% preferred** for lines, branches and functions; new code should land at 90% or better. Never lower a threshold to get green.

```sh
npm test               # unit tests with coverage (fails under 70%)
npm run test:fast      # the same without coverage, for a quick loop
npm run test:browser   # Playwright Chromium against the real Python app
uv run pytest -q       # backend unit + e2e, real Postgres via testcontainers (needs Docker); fails under 70%
```

### Look at it in an emulated iPad

Every UX or UI change is checked in browser emulation before it ships: Playwright Chromium at the iPad's size (1180×820 landscape, touch enabled), driven through each flow the change affects, with screenshots you actually look at. Check that controls are on top and reachable, nothing hides behind the canvas, every screen has a way out, the copy says what to do, and the screen updates on every tap. What only a real iPad can prove goes in `tests/manual-ipad.md`.

### Review every major change

A major change (a new feature, a reworked flow, a data format change, anything touching several domains) is reviewed with the spawn-review skill before it ships: https://github.com/baalimago/skills/blob/main/skills/spawn-review/SKILL.md (it runs the `review` skill and its profiles from the same repository). Use at least three independent reviewers with profiles chosen from the change: `falsifier` always, `ux-design` for UI, `mutation-tester` when tests changed, `data-safety` for format changes, `rules-lawyer` against this file. Brief them with the user's spec, never the author's summary. Verify their findings, fix the confirmed ones and the low-hanging fruit, re-run the gates, and note what was found and fixed in the commit message.

## 6. Docs move with the code

Keeping the docs current is part of every change, not a follow-up.

- A change to a domain updates its `docs/<domain>.md` in the same commit: modules, contracts, state machines, events, constants, timings, format versions.
- A new domain folder gets a new doc and a mention in section 3; `tests/unit/docs.test.js` fails otherwise.
- If you find a doc that disagrees with the code, fix it in your change.
- README.md's "How to play" stays true for parents. This file stays true for agents: when a rule here stops fitting, change the rule here.

## 7. Python tooling: the uv stack

- **uv** manages Python, the virtualenv and dependencies: `uv sync`, `uv run <cmd>`, `uv add [--dev] <pkg>`. Commit `uv.lock`. No pip, pip-tools or Poetry.
- **Wasmer installs from `requirements.txt`**, generated from the lock. After a dependency change run `uv export --no-dev --no-hashes --no-header -o requirements.txt`; CI checks they match.
- **ruff** lints and formats, replacing Black, isort and flake8. `uv run ruff check .` and `uv run ruff format .` must be clean.
- **ty** type-checks. It is still beta, so CI runs it as advisory; keep it clean anyway.

## 8. Running and shipping

- Run everything in a sandbox or CI, never on the owner's machine. `uv sync && uv run python main.py` serves on port 8000.
- **Deploys are gated.** Push work to `develop`, never to `main`. CI (`.github/workflows/ci.yml`) runs every suite above plus the Python checks; only when all pass does its `promote` job fast-forward `main`, and Wasmer Edge deploys `main`.
- Before pushing: all suites green locally, the emulated-iPad check done for UI changes, and the review done for major changes.
- After a promote, confirm the live `<base href>` asset hash at https://klaras-farm.wasmer.app matches a local run, and that `/healthz` is ok.
- Device errors are posted to `/api/client-log` and appear in the Wasmer app logs as `client-log ...` lines. Read them before guessing at a device-only bug.
- Database migrations run as a deploy step (`uv run python -m backend.migrate`), never on boot.
