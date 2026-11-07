# Klara's Farm: user stories

Version 5. v3 was signed off by adversarial review after two rounds. v4 added edit mode (E11) and scripted question recordings (US-4.8) from Lorentz's feedback; v5 applies the adversarial review of edit mode and the UX flows. See the changelog at the end.

"Parent area" below means **edit mode** (E11).

People:
- **Parent**: builds places and things, records voices, controls the app. Two parents may speak different languages.
- **Klara**: 12 months, the player. Taps imprecisely, short attention, cannot read.
- **Operator**: the developer, deploying to Wasmer Edge.

Priority: **M** = first playable version, **N** = next, **L** = later. Look is the Sunny felt palette throughout.

## Definition of Done (every story)

- Written test-first. Pure logic lives in small modules with single-process unit tests next to them.
- Device APIs (audio, mic, storage, wake lock, clock) are reached only through adapters, so error paths are tested with stubs.
- Parent UI passes axe and html-validate. Child view checks from US-5.2 stay green.
- Cross-process behaviour (once a backend with state exists, from US-8.3) is covered by the e2e suite: real Postgres via testcontainers and a temp dir as the volume, several assertions per suite.
- Anything that cannot be automated is added to the manual iPad checklist (see the end).

## E1. First run

**US-1.1 (M) Play in under a minute.** As a parent, I want the app to open with a starter Farm, Sea and Kitchen, so that Klara can play before I've made anything.
- On a fresh install the three starter places exist, each with 2–3 things (no voice yet; tapping still reacts and chimes).
- Task: produce the starter scenes and things as stroke data in the same format parents create (who draws them is an open task).

**US-1.2 (M) First-run flow.** As a parent, I want a short first-run sequence, so that the app is set up properly without reading a manual.
- There is **no Start button**. iPads only allow sound after a user gesture, so the first tap anywhere unlocks audio, and if that tap hits a thing, it plays straight away.
- A one-time welcome card for the parent (first launch only): Add to Home Screen nudge (Safari only), persistent-storage request, how to enter edit mode (hold for 1.5 s), and a co-play tip ("Play together: say the names with Klara"). Dismissing it starts play.
- The microphone permission is **not** requested here; it is requested on the first Record.
- Test: Playwright walks the flow with stubbed adapters; asserts no mic request occurs.

**US-1.3 (M) Audio survives interruptions.** As a parent, I want sound to come back after a phone call, FaceTime, Siri, screen lock or app switch, so that Klara doesn't tap a silent screen.
- On `visibilitychange`, `AudioContext` `statechange`, or the next tap, the app calls `resume()`. If iOS needs a gesture, the next tap on any thing resumes and plays that thing's clip.
- Test: in WebKit, force `suspend()`, tap a thing, assert playback started.

**US-1.4 (M) Screen stays on while playing.** As a parent, I want the screen not to dim during play.
- Request a Screen Wake Lock in play mode, re-request on visibility change, and degrade silently if unsupported.

## E2. Places

**US-2.1 (M) Create a place.** As a parent, I want to create a new place with a name (for me) and choose its ground and sky colours from the Sunny palette, or any colour with the colour picker.

**US-2.2 (M) Draw a scene.** As a parent, I want to draw a few strokes on the place's backdrop (barn, window, seaweed), so that the place is ours.
- Strokes are smoothed and rendered as felt pieces with stitches and shadows. Undo removes the last stroke.

**US-2.3 (M) Rename or delete a place.** As a parent, I want to rename or delete any place, including starters.
- Delete asks for confirmation inside the app and names how many things and recordings will be lost.

**US-2.4 (M) Switch places.** As a parent, I want to switch the current place from the parent area.
- The scene cross-fades and things drop in. The last-used place is restored on next launch.

**US-2.5 (M) Empty place still feels alive.** As Klara, I want a place with no things to still move (clouds drift, waves roll); as a parent, I want to see "Add a thing" there.

**US-2.6 (N) Klara picks the place.** As a parent, I want an optional picture-only place picker for Klara.

## E3. Things

**US-3.1 (M) Draw a thing.** As a parent, I want to draw one outline for a thing, so that it can live in a place.
- A gap under 8% of the outline length closes automatically; a larger gap shows "close the outline" and highlights both ends.
- The closed outline becomes the felt shape and the tap mask. (Pure modules: gap closing, fill, mask; unit tested with fixture strokes.)

**US-3.2 (M) Klara stamps the eyes.** As a parent, I want Klara to tap where the eyes go, so that she helps make it.
- A full-screen stamping view with no controls Klara could hit. The parent takes over by holding a strip at the top for 1 s.
- Taps outside the outline snap to the nearest point inside. Zero, one or two eyes; a third tap moves the oldest eye. The parent can undo or drag an eye afterwards.

**US-3.3 (M) Pick how it moves.** As a parent, I want one tap to choose **walks** or **floats**, so that it comes alive without rigging.
- Walks: squash-and-stretch body and swinging yarn legs. Floats: gentle bob, covers objects and jellyfish.

**US-3.4 (M) Pick a felt colour.** As a parent, I want to choose the thing's felt colour from the Sunny palette.

**US-3.5 (M) Place is full.** As a parent, I want + Add greyed out (with a reason) when a place already has 4 things, before I start drawing, so that Klara is never overwhelmed.

**US-3.6 (M) Delete a thing.** As a parent, I want to delete a thing with an in-app confirmation that warns its recordings will be lost, followed by a few seconds of Undo.

**US-3.10 (M) Drafts.** As a parent, I want the add-a-thing steps saved as a draft after each step, with Back and ✕ (Keep draft / Discard) on every step, so that an interruption never loses work.

**US-3.7 (M) Redraw a thing.** Keep its recordings and eyes, replace the outline.

**US-3.8 (M) Recolour a thing.**

**US-3.9 (N) More motion styles.** Swims (fish), hops (spoon, teapot), scuttles (crab).

## E4. Voice

**US-4.1 (M) Record a name.** As a parent, I want to record a thing's name in my language, so that Klara hears my voice.
- Mic permission is requested on the first Record only.
- Recording measures the room's noise floor in the first 300 ms and stops after about 800 ms below it, or on a Stop button that is always visible, or at the 5 s cap (with a message if the cap cut it off). The start blip is not captured. Silence is trimmed. Loudness is normalised to about −16 LUFS integrated with a −1 dBFS true-peak ceiling.
- Playback and redo before saving. The clip is stored with its MIME type and a `language` field from day one.
- Test: the DSP module is unit tested with fixture WAVs, asserting measured loudness and peak.

**US-4.2 (M, optional step) Record the sound.** As a parent, I want to optionally record the thing's sound ("woof", "clink"), played after the name. The name stays the goal; the sound is a bonus, offered as the last skippable step when adding a thing and on the thing's card (see design/sketches/ux-flows.html, flow 6).

**US-4.3 (M) Microphone denied.** As a parent, I want plain steps to re-enable the mic in iPad Settings if I declined, and the rest of creation keeps working.

**US-4.4 (M) Bad recording.** As a parent, I want "Try again" when a recording fails, is under 0.3 s, or is silent after trimming; an empty clip is never saved.

**US-4.5 (M) Broken clip.** As a parent, I want a clip that won't decode to be flagged "re-record" in the parent area, while the thing still reacts and chimes in play.

**US-4.7 (M) Re-record a clip.** As a parent, I want to re-record any clip (name, question variant, sound) of an existing thing from the parent area, without losing its drawing.
- Same flow as US-4.1 (5 s cap, trim, normalise, playback before saving).
- The old clip is replaced only when the new one is saved; cancelling keeps the old clip.
- Test: stubbed recorder adapter covers save and cancel.

**US-4.8 (M) Record scripted "Where is the…" variants.** As a parent, I want the app to tell me exactly what to say, so that I can record a few natural ways of asking for each thing in my language.
- When creating a thing, the parent types its name once per language (parent-only text, never shown to Klara). The name is still recorded as its own clip (US-4.1).
- The app then shows three scripts, one at a time, filled with that name, each with its own Record button. English example: "Where is the dog?", "Can you find the dog?", "Show me the dog!".
- Scripts are data: one JSON file per language with three templates, a `{name}` placeholder and an optional article slot (the article is picked once when the name is typed, e.g. German der/die/das). Adding a language means adding a file.
- The parent can edit the cue text for a thing; the text is a cue, and the parent says it naturally.
- The language picker lists every language. If a language has no file, the cue is shown in English with "say this in your language".
- Each clip is stored as `kind: prompt`, `take: 1–3`, with its `language`. Recording the questions can be skipped and done later; Find it (US-6.2) only asks about things that have at least one question clip.
- Tests: template filling and the per-language fallback are pure, unit-tested functions; the record sequence runs with a stubbed recorder.

**US-4.6 (N) Several takes.** Up to 3 takes per clip, played in rotation.

## E5. Play: Tap and hear

**US-5.1 (M) Tap anything.** As Klara, I want every thing I tap to jump and say its name (then its sound, if recorded) in a parent's voice, so that I connect the word with the thing.
- Hit target is 1.3× the drawing and never smaller than 120 CSS px (about 2 cm on iPad). Overlaps: topmost wins, then nearest centre.
- Only the primary pointer counts. Touches with a contact `width` or `height` above a threshold (palm) are ignored.
- Mash policy: tapping the playing thing restarts it only after 300 ms; tapping a different thing stops the current clip and plays the new one; nothing queues.
- A felt-confetti puff of at most 1 s and a capped particle count follows each tap.
- CI: `pointerdown` to `AudioBufferSourceNode.start()` under 50 ms in WebKit (instrumented). Manual: under 150 ms end to end on an iPad.
- Tests: synthetic PointerEvents for hit testing, palm rejection and mash policy (pure modules).

**US-5.2 (M) No dead ends, no text, no punishment.** As a parent, I want the child view to be safe for unsupervised taps.
- The child view has zero visible text nodes (DOM test).
- The only interactive elements are the things and the scene; the edit-mode hold (US-11.1) lives on them, so there are no extra buttons (DOM query plus axe).
- Every visual reaction returns to idle play within 3 s (fake-timer test). Audio may keep playing up to its cap: name plus optional sound, at most 5 s + 5 s.
- No flashing faster than 3 Hz. No failure sounds in Tap and hear.
- The chime sits at least 6 dB below voice clips; a limiter on the master bus prevents sudden loud sounds.

**US-5.3 (M) Things move gently.** As Klara, I want things to wander slowly and blink, so that the scene is alive but easy to tap.
- Default 1–3 things per place; hard cap 4 (US-3.5).
- Speed is capped (for example, at most 40 CSS px/s). All things pause while a finger is down, and a tapped thing stops during its reaction.

**US-5.4 (M) Gentle ending.** As a parent, I want an optional timer (default 8 minutes, can be switched off) after which the things yawn and fall asleep, so that play ends without a tantrum.

**US-5.5 (N) Reduce motion.** A parent setting that slows or stops wandering; also respects the system reduce-motion setting.

## E6. Play: Find it (18 months+)

(Question recordings moved to US-4.8, M, so they exist by the time Find it is switched on.)

**US-6.2 (N) Answer the question.** As Klara, I want a parent's voice to ask for a thing and a celebration when I tap it.
- Wrong tap: the tapped thing says its own name, then the question repeats. After 2 misses the right thing glows.

**US-6.3 (N) Turn Find it on.** A parent setting, per place.

## E7. Safety, privacy and control

**US-7.1** Replaced by edit mode, E11.

**US-7.2 (M) No accidental escapes inside the app.** Zoom, text selection, long-press menus and pull-to-refresh are disabled in the child view.

**US-7.3 (M) Guided Access guide.** A one-page parent guide to lock the iPad to the app.

**US-7.4 (M) Privacy statement.** As a parent, I want one plain-language screen saying: everything stays on this iPad, the app never records during play, and the mic is on only while a parent is recording (Klara may be audible in the background of those clips).

**US-7.5 (M) Delete all data.** As a parent, I want "Delete all data" with confirmation, which wipes IndexedDB, caches and the service worker.
- Test: Playwright asserts all storage is empty afterwards.

**US-7.6 (M) Parent area is accessible.** Labelled controls, 44 pt targets, works with VoiceOver and zoom, passes axe. Edit mode is also reachable without the hold: a keyboard shortcut on desktop and a VoiceOver "Edit" action. Badges stay still and at least 44 pt while things wiggle.

**US-7.7 (M) Orientation.** The scene is landscape-first. In portrait the board is letterboxed, never cropped. Set in the web manifest; tested with Playwright viewport changes.

## E8. Data and offline

**US-8.1 (M) Works offline.** As a parent, I want to install the app to the home screen and play without internet (service worker caches the app shell).

**US-8.2 (M) Data stays on the device.** As a parent, I want drawings and recordings kept in IndexedDB with persistent storage requested.
- If `navigator.storage.persist()` returns false, the parent area shows a lasting warning recommending an export.
- If storage is full or IndexedDB is unavailable (private browsing), a clear parent message appears. Nothing fails silently.

**US-8.3 (M) Export and import everything.** As a parent, I want to save all places, things and recordings as one file through the share sheet, and import it again, so that a cleared Safari or a lost iPad never loses the recordings.
- The export file carries a format `version`.
- Import **replaces** everything on the device, after an in-app confirmation that says how many places, things and recordings will be lost (merging is out of scope for M).
- A corrupt file, or one with a newer `version`, is rejected with a parent message and leaves current data untouched.
- Tests: export, wipe, import, assert byte-identical data; import a corrupt file and assert storage is unchanged (Playwright).

**US-8.4 (N) Encrypted server backup.** As a parent, I want automatic backups to the server, encrypted on the device, so that I don't have to remember to export.
- Brings in the backend's stateful parts: Postgres capability, migrations, content-hash idempotent uploads, the server cannot read content, and the testcontainers e2e suite.

**US-8.5 (N) Restore on another device.** Restore a backup on a second iPad with a pairing code. Verify that Safari can play clips recorded in Chrome (Opus/WebM) first.

**US-8.6 (N) Delete server backup.** Server-side deletion of a family's backups.

## E9. Languages

**US-9.1 (M) Two languages.** As parents who speak different languages, we each want to record our own clips for the same thing.
- The thing's card has one tab per language (typed name, name clip, 3 questions) and + Language.
- Every clip carries `language` (US-4.1). A setting chooses which language plays, or alternates.

## E10. Operator

**US-10.1 (M) Deploy the static app.** As the operator, I want `wasmer deploy` to ship the Python app serving the static frontend with an `app.yaml`, so that it runs on Wasmer Edge.

**US-10.2 (M) Health check.** `/healthz` returns 200 when the process is up. (A database check is added with US-8.4.)

**SPIKE-1 (M, week 1) Postgres driver on Wasmer.** Prove a pure-Python driver (pg8000) connects with TLS to Wasmer's managed Postgres on its non-standard port. This retires the biggest backend risk before US-8.4.

## E11. Edit mode (tap-and-hold)

Follows the familiar home-screen pattern: hold to enter, things wiggle, badges appear, Done to leave. Two additions protect against a toddler: a longer hold than the usual 0.5 s, and an adult check (Apple's guidance for kids apps calls this a parental gate: an adult-level task, such as simple maths or a question, before parent-only actions).

**US-11.1 (M) Hold to start editing.** As a parent, I want to press and hold a thing or an empty spot in the scene to start editing, so that no button is visible to Klara.
- Hold for 1.5 s (three times the usual 0.5 s long press, because toddlers hold too). Nothing shows for the first 0.5 s; then a felt ring fills with a very soft tone. No pop and no reward at the end: the next thing is the adult check.
- Cancels silently on: release, movement over 10 px, a second touch, a palm, `pointercancel`. Holds never start in the bottom 40 px or within 20 px of the side edges (iPad system gestures).
- The design must not rely on the tone: iOS may only unlock audio on release, so the very first hold can be silent.
- Web details: `touch-action:none`, `-webkit-touch-callout:none` and `user-select:none` on the board and the adult check; `contextmenu` blocked; no `<img>` elements on the board (they trigger the save-image callout).
- Haptics: iPads have no vibration motor and Safari has no `navigator.vibrate`; Android phones get a short vibration.
- Test: a pure gesture module (pointer events in; idle, holding, armed, cancelled out) with fake timers and synthetic pointers. Manual: check whether Safari reports touch size for the palm rule.

**US-11.2 (M) Adult check.** As a parent, I want a check that Klara can't pass by mashing, so that she never lands in edit mode.
- A shuffled 1–9 keypad and a random 3-digit code (about 1 in 729 by chance). Any wrong tap, a tap between buttons, or 10 s idle returns to play silently.
- The rising "entered" chime plays only after passing.
- Alternatives in Settings: spoken digits (for low vision or reading difficulties) or a simple sum. Buttons are 44 pt or larger, high contrast.
- Test: pure module with a seeded random generator.

**US-11.3 (M) Editing in place.** As a parent, I want to edit right on the scene, so that I don't navigate menus.
- Things stop wandering and wiggle in place; still, 44 pt badges: pencil (edit card) and cross (delete, US-3.6). Play reactions are off.
- Bar: Scenes, Change scene, + Add, Settings, Done. Holding an empty spot also adds a thing, placed where the finger was.
- Entering plays an ascending chime and leaving a descending one.

**US-11.4 (M) Edit mode always ends.** As a parent, I want edit mode to close by itself if I walk away, so that Klara is never left in it.
- Done returns to play and ends the session: the next entry needs the adult check again.
- After 60 s without input in the plain wiggle view, edit mode closes with the descending chime. The timer pauses while a card, a guided step, the recorder or a permission prompt is open.
- Only after an auto-close can edit mode be reopened with the hold alone, for up to 5 minutes; any play tap cancels that.
- Test: fake timers.

## Later (L)

- Colour levels: the same thing in two colours ("Where's the blue dog?").
- "Say it!" turn-taking moments with a loudness check.
- Parent tips while drawing.
- Usage summary for parents (which words Klara has heard most).

## Open decisions

- Language of the parent-facing UI.
- Who draws the starter places and things.

## Manual iPad checklist

Tap-to-sound latency under 150 ms; audio after a phone call and after screen lock; mute switch and volume behaviour; mic permission and denial path; Add to Home Screen; storage persistence after a week; Guided Access; wake lock; export and import through the share sheet.

## Changelog from review

1. Export/import moved into M (US-8.3); persistence warning added (US-8.2).
2. Postgres, migrations and testcontainers e2e moved from M to the server-backup story (US-8.4); SPIKE-1 keeps the driver risk early; TDD moved to the Definition of Done.
3. Error-state stories added: mic denied, bad recording, storage full or unavailable, broken clip.
4. Audio interruption (US-1.3) and wake lock (US-1.4) added.
5. Things per place set to 1–3 with a cap of 4; slow motion, 120 px minimum targets, overlap rule and mash policy defined.
6. Loudness target, peak ceiling, 5 s cap, chime level and `language` on every clip.
7. US-5.2 made testable.
8. Latency split into an automated CI bound and a manual iPad bound; palm defined.
9. Thing editing split up; place create, rename and delete added; empty-place story added.
10. Motion styles in M cut to walks and floats.
11. Eye taps snap to inside the outline.
12. First-run flow story; mic asked on first Record.
13. Gate is a 3 s hold with a progress ring; multi-touch cancels.
14. Privacy statement and Delete all data added.
15. Parent-area accessibility and orientation added.
Round 4 review (edit mode and UX flows, sign off with changes, 15 applied): no grace period after Done; no reward for holding; 1–9 keypad code; drafts, Back and ✕ on every step, auto-close paused in sheets; full-screen eye stamping; Settings in the bar; Sound step in add-a-thing; scene Undo; Shape and Yarn tools instead of guessing; editable cues with article slots; noise-floor auto-stop with a Stop button; per-language tabs (US-9.1 now M); web gesture details; accessible edit-mode entry; redraw and recolour now M; + Add disabled at 4; privacy wording fixed.

Round 3 (Lorentz's feedback): no Start button, first tap unlocks audio (US-1.2); edit mode with tap-and-hold, adult check and auto-exit (E11) replaces the corner gate (US-7.1); recording the name stays the goal and the sound becomes optional N (US-4.2); scripted question variants per language are M (US-4.8).

Round 2 review: added US-4.7 (re-record a clip) and defined import as replace-with-confirmation with a versioned, validated file (US-8.3); clarified the 3 s idle rule versus audio length.

Also adopted from the optional list: sound recording and gentle ending moved to M, co-play tip in first run, reduce-motion setting (N), Opus-on-Safari check before restore.
