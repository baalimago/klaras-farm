# Klara's Farm: design notes

Status: concept, stress-tested once by an adversarial review. No implementation yet; waiting on a look-and-feel pick from the sketches in `design/sketches/farm-sketches.html`.

## 1. What it is

An iPad-first web app (also runs in a desktop browser) that helps toddlers learn words through play with a parent. It works in any language because every word the child hears is recorded by the parent, in the parent's own voice.

**Creation (parent-led):** the parent draws an animal, the child brings it to life, the parent records what it is called, and the animal walks into the farm.

**Play:** the drawn animals wander around the farm. Now and then the farm asks, in the parent's voice, for one of them ("Where's the dog?", later "Where's the blue dog?"). The child taps it and gets a celebration.

## 2. Decisions from the adversarial review

Ranked by how badly the original idea would break without them.

| # | Problem | Decision |
|---|---------|----------|
| 1 | Splicing recorded "blue" + "dog" breaks in most languages (adjective order, gender/case agreement, classifiers) and sounds robotic. With only one dog on screen, "blue" adds nothing. | **Never splice.** The parent records whole phrases. Each clip is stored under `(animal, colour?, language, kind)`. The app never parses language. Colour prompts only appear when the **same animal is on screen in two colours**. |
| 2 | Colour words are understood around 2.5–3.5 years, much later than nouns. | **Levels**, unlocked by the parent or by success rate: L0 one animal, tap it and it says its name and sound. L1 two animals. L2 three or four. L3 same animal in two colours. L4 colour plus a different-animal distractor. |
| 3 | Toddlers scribble, parents leave gaps, blobs can't walk, and rigging joints on an iPad at 7pm will be abandoned. | **Parent draws, child decorates** (stamps googly eyes, scribbles fur, taps to wake). The outline is **auto-closed and flood-filled** to get a mask used for tinting and hit-testing. **No skeleton in v1:** one tap picks a motion style (walker: squash-and-stretch body plus wiggling leg sticks). Flyer and swimmer later. |
| 4 | iPads have no haptic motor and Safari has no `navigator.vibrate`. | **Drop haptics.** Reward = parent's voice ("Yes, dog!") + chime + happy jump + confetti. `vibrate` only as a progressive extra on Android. |
| 5 | iOS audio: autoplay blocked, `<audio>` lags, Safari records AAC/MP4 while Chrome records Opus/WebM, storage can be evicted after 7 days. | Unlock `AudioContext` on the parent's Start tap. Decode every clip into `AudioBuffer`s up front. Detect the recorder's MIME type and store it with the clip; trim silence and normalise. Mic is only used in creation mode. `navigator.storage.persist()` plus a strong Add to Home Screen nudge. |
| 6 | Tapping proves comprehension, not speech. Under-2s learn poorly from screens without a co-playing adult. | **"Say it!" moments:** an animal walks to centre and cups its ear; any sound above a loudness threshold (no speech recognition, never recorded) makes it react. Reward turn-taking, not correctness. Show parent tips during drawing ("Ask: what does a cow say?"). Allow 2–3 takes per phrase for variety. |
| 7 | Toddlers mash, palm, and escape. | Only the primary pointer counts; ignore palms. Tap targets 1.3–1.5× the drawing. Animals freeze while a prompt plays. Max 4 animals. Wrong tap: the tapped animal happily says its own name, then the prompt repeats; after 2 misses the target glows. No buzzers, no ✗. `touch-action:none`, no selection or callouts. Parent gate = press and hold. Guided Access setup guide. Sessions end naturally (animals yawn and sleep after ~8 minutes). |
| 8 | Parent voices and children's drawings are personal data (COPPA, GDPR-K). | **Local-first.** The device holds the source of truth. The child is never recorded. The server only stores optional, client-side-encrypted backups. Parent accounts only, no child profiles server-side. |
| 9 | Wasmer Edge: volumes are region-locked with seconds of write lag; cold starts on scale-to-zero; psycopg's C extension may not run on WASM. | Store blobs (stroke JSON, 10–50 KB audio) **in Postgres**, not on the volume. Content-hash IDs make uploads idempotent. Play never waits on the network. **Week-1 spike:** confirm a pure-Python driver (pg8000) with `sslmode=require` on the non-standard port. One connection per request. |

## 3. MVP scope

In:
- Installable PWA, works offline. Backend serves static files and a health check.
- One language per family to start; data model already keyed by language.
- Parent draws (auto-close and fill), child adds eyes, walker motion only.
- Parent records per animal: name, sound, "Where's the ___?".
- Levels L0–L2. Max 4 animals.
- Success: voice + chime + jump + confetti. Wrong tap: the tapped animal says its name.
- One "Say it!" moment per session.
- Parent gate and a Guided Access guide.

Cut from v1: colours (L3/L4), skeleton rigging, flyer/swimmer, switching language mid-session, accounts, sync, haptics, analytics.

Validation: 5 families for 2 weeks. Does the child ask for it again, and does the parent stay engaged?

## 4. Open questions for the product owner

1. Youngest target age: 18 months (needs L0) or 2+?
2. Is colour central to the vision, or one example of a later level? The sketches show it because it was in the brief.
3. Is "parent draws, child brings it to life" acceptable, or must the child draw?
4. Do families need the same farm on several devices in year one? This decides whether accounts and sync are worth building early.
5. Language of the parent-facing screens, and is there a business model that needs accounts?

## 5. Architecture requirements

Goals: readable, maintainable, easy to scale. Small modules with one job each and explicit seams between them.

### Backend: Python on Wasmer Edge

- Python app deployed with `app.yaml` (`kind: wasmer.io/App.v0`), `capabilities.database.engine: postgres` (never omit: omitted means MySQL), one database-capable region (`fr-roub1` or `ca-beau1`), `instaboot` on `/`.
- DB config comes only from `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD`. No `DATABASE_URL`, no hardcoded ports, TLS required without chain verification.
- Instances are stateless and ephemeral. No in-process state that matters. Per-instance connection count of 1–3.
- Volume (mounted at e.g. `/data`) only for things that tolerate seconds of propagation lag. Blobs go to Postgres (see decision 9).
- Layering, each its own package with its own tests:
  - `domain/`: pure types and rules (animal, clip key, level progression). No I/O.
  - `storage/`: repository interfaces plus a Postgres implementation and a filesystem implementation for the volume. Injected, never imported globally.
  - `api/`: thin HTTP handlers that validate input, call domain/storage, and serialise.
  - `config/`: reads environment once, returns a typed settings object.
- Migrations are plain SQL files applied in order and are idempotent.

### Frontend: vanilla JS

Follows the vanilla-web conventions (https://github.com/baalimago/skills/blob/main/skills/vanilla-web):
- Static HTML documents enhanced by custom elements, ES modules, import map, no framework, no bundler.
- `js/components/<tag>/` with `Tag.js` (class, no side effects), `tag.js` (define), `tag.css`, `tag.test.js`.
- One store (`EventTarget`) per concern: farm, recordings, levels, settings. Elements emit intent; stores are the only writers.
- Pure modules for the hard parts so they can be unit-tested without a DOM: stroke gap closing, region fill and mask, hit testing, wander/steering, level progression, clip lookup by `(animal, colour, language, kind)`.
- Audio, mic and storage behind small adapters so tests can swap them.
- Untrusted strings only through `textContent`. Strict CSP.
- Data lives in IndexedDB; a service worker caches the app shell for offline play.

## 6. Testing requirements

Written test-first (TDD): every behaviour starts as a failing test.

**Unit tests, per module, single process.**
- Every Python module and every JS module ships with small, fast tests next to it.
- No network, no real database, no real filesystem beyond a temp dir. Storage is tested through its interface with in-memory fakes.
- JS pure modules run under Node's built-in test runner; custom elements run in a real browser (Playwright: Chromium, Firefox, WebKit), including a test where the island's module is delayed so pre-upgrade behaviour stays covered.

**End-to-end suite, cross-process.**
- Spawns the real app as a separate process against a **real Postgres started with testcontainers** and a **temporary directory as the volume**.
- Each test suite runs **multiple assertions** against one spawned environment (start once, assert many) to keep it fast.
- Covers: migrations from empty, saving and reading back animals and clips, idempotent re-upload by content hash, the app restarting and still seeing persisted data, two app processes sharing the same database and volume.
- Browser e2e on Playwright WebKit for the iPad-critical paths (audio unlock on first tap, single-pointer handling, offline reload).
- Manual checklist on a real iPad before each release: audio latency, mic permission, Add to Home Screen, Guided Access, storage persistence.

**Gates:** html-validate and axe-core on every document, ESLint (`@eslint/js`), Prettier, `tsc --noEmit` with `checkJs`, plus the Python linter and type checker chosen at scaffold time.

## 7. Look and feel

Three live sketches in `design/sketches/farm-sketches.html`:
- **A. Crayon Meadow:** white paper, wax-crayon scribbles; the parent's drawing fits right in.
- **B. Paper Theatre:** bright layered cut-paper hills, clean bold outlines; clearest for spotting colours.
- **C. Chalk Night:** calm dark chalkboard, colour glows; low stimulation, could be a bedtime mode of A or B.

All three already apply the review decisions: no text in the child's view (the question is a bubble with the parent's avatar, a colour blob and the animal), max 4 animals, two dogs in different colours so the colour actually matters, googly eyes that look at the finger, gentle wrong-tap response, a hint glow after two misses, and a press-and-hold parent gate.
