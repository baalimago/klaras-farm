# Klara's Farm

A felt-board word game for toddlers, played with a parent. Parents draw the things and record their names in their own voice and language; the child taps a thing and hears its name. iPad-first (base iPad 11th gen, iPadOS 18+), runs in any modern browser, works offline from the Home Screen. Python backend on Wasmer Edge, vanilla JS frontend with no build step.

Live: https://klaras-farm.wasmer.app

## How to play

- **First time:** after the welcome card, a short tour shows a felt animal, how to edit, Scenes and how to record sounds. Tap Next, or Skip tour at any time. Settings → Help → "Show the tour again" brings it back.
- **Play:** tap anything. It jumps and says its name (then its sound, if recorded). Until a grown-up records the name, the iPad's built-in voice says it; in edit mode a small mic dot marks things still waiting for your voice.
- **Find games:** two big round buttons in the bottom corners of the play screen start a round when tapped; nothing is asked by itself. 🔍 asks "Where is the… cow?" (one of your recorded questions at random followed by the cow's recorded name, or the iPad's voice), and only after the question plays the cow's recorded sound as a clue. The coloured dots ask "Tap on an animal that is yellow!" (your recorded question and colour word, or the iPad's voice, in the play language) and turn that colour; any yellow thing is right, not one particular animal. A wrong tap says that thing's name, then the question again; after ~6 quiet seconds the right thing hops and the question repeats once; after two wrong taps the right thing(s) glow and hop. A right tap celebrates, then says the name and plays the sound. A round ends quietly after ~30 s. Hide the buttons per scene with Settings → "Show find games in <scene>".
- **Record the find games (grown-ups):** press and hold 🔍 for a second, then tap the code shown: record the question once per language ("Where is the…", "Show me the…", "Pet the…": up to 6 ways to ask), then each animal's name. Klara hears your question, then the animal's name, so a new animal only needs its name. Press and hold the coloured dots the same way to record the colour question ("Tap on an animal that is…") once per language, then tap an animal or a colour and say just the colour word. Each panel shows which names or colours of this scene and which languages still need a recording. Done takes you straight back to the game; for a few minutes another hold opens it again without the code. An animal's name can also be recorded on its card. While a question still plays in the iPad's voice, a small note beside its button reminds you ("Hold 1 s to record your own question"); it fades by itself, and Settings → Play → "Show recording tips" turns it off.
- **Music:** a soft generated lullaby plays under play (starts with the first tap), dips while a name is said, and fades out in edit mode and when the things fall asleep. Switch it off in Settings → Play.
- **Things:** a fresh install has a Farm, a Sea and a Kitchen of felt animals and objects, each with its real number of legs. When you add a thing or open its card, pick its felt (one colour for the whole animal) and how it moves: Walks, Hops, Scuttles (quick little steps) or Floats. Every animal needs a name; on the Name step the keyboard's Enter key goes on. ‹ Back and ✕ are always at the top: ✕ asks whether to keep a draft or stop adding. A kept draft waits in + Add as "Finish your draft". On a thing's card every change shows and saves at once; "Undo changes" puts the thing back as it was when you opened the card (recordings stay). In edit mode a pencil with a ? needs a name, one with a 🎤 needs your voice.
- **Edit mode (grown-ups):** press and hold an empty spot or a thing for 1.5 s, then tap the code shown. Things wiggle. Tap an animal once to select it (a stitched ring): drag the round handle on the ring to make it bigger or smaller. Tap it again, or its pencil, to open its card; the cross deletes it; drag a thing to move it. The bar has Scenes, Change scene, + Add (with how many things the scene has, like 5/8), Settings and Done. + Add opens the animal library: draw a new animal, or tap any animal you have made (in any scene, with its recordings) or one of the ready-made examples to put a copy in this scene. A new scene starts with 3 or 4 animals from the library. Edit mode closes by itself after a minute.
- **Eyes and legs:** when adding a thing, tap the body where an eye goes, or tap Let Klara stamp and she stamps them by tapping; hold Done or Cancel at the top for 1 second to take over. For legs, pick how many (0 to 8), then tap where each goes or tap Spread evenly; drag a leg to move it, Undo and Clear are there, and you can pick another number at any time. The thing card has Re-stamp eyes and Place legs.
- **Drawing a thing:** draw the body only; eyes and legs come in later steps. Add a head, ears or horns by drawing them over the body: they join it, whether drawn as a closed shape or a single line. A shape drawn apart asks you to draw it touching the body. Tap a shape to move it, make it bigger or smaller (round handle or pinch), draw it again or delete it. Undo takes back the last change; Start over clears the drawing.
- **Change scene:** draw your own landscape. The tools are left of the board and the chosen tool's options right of it (above and below when the iPad is upright), so nothing covers the scene. Shape and Line draw felt pieces anywhere (hills, a sun, a pond, a fence) in the colour you pick; Move drags a piece (the round handle resizes it, "To back" puts it behind the others); Colour recolours a piece; Sky and Ground change those colours (pick one of the swatches, or tap the rainbow for any colour); Delete removes a piece; Start begins again from Blank, Meadow, Sea or Room. Undo steps back; Done returns to the animals.
- **Birthday:** every 7 November the farm opens wrapped in gift paper. Touch it and pull: the paper tears wherever the finger goes. The torn strip folds back under the finger and drops off. After three or four long pulls (or eight pokes) the rest fades away with confetti and a chime, and the farm is ready. Preview it any day with `?flag=wrap:always`.
- **Settings:** languages (one, or "Mix languages" for a random recorded language on each tap), sleep timer, things per scene (1 to 12, 8 by default; lowering it keeps the things already there), adult-check kind, recording tips, export/import (share sheet), privacy, Guided Access guide (iPad and iPhone), delete all data.

## Run locally

```sh
uv sync                          # Python env from uv.lock (uvicorn, pg8000; dev: pytest, ruff, ty, testcontainers)
uv run python main.py             # http://localhost:8000 (Wasmer runs python main.py from requirements.txt)
```

## Tests

```sh
npm test                          # unit tests with coverage (fails under 70%), Node's built-in runner
uv run pytest -q                  # backend unit + e2e: real Postgres (testcontainers, needs Docker); coverage fails under 70%
uv run ruff check . && uv run ruff format --check .   # Python lint and format
npm run test:browser              # Chromium against the real Python app (needs the playwright package)
```

CI (`.github/workflows/ci.yml`) runs all three. `tests/manual-ipad.md` lists what only a real iPad can prove.

## Database migrations

Postgres is not needed to play (everything lives on the iPad). It is wired for the later encrypted backup. Migrations run as a deploy step, never on boot:

```sh
uv run python -m backend.migrate  # uses DB_HOST, DB_PORT, DB_NAME, DB_USERNAME, DB_PASSWORD
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
