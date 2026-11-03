# Klara's Farm: user stories

Version 3. Signed off by adversarial review after two rounds (v1: 15 required changes; v2: 2 more). See the changelog at the end.

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
- Steps: big Start (unlocks audio), Add to Home Screen nudge (Safari only, dismissible), persistent-storage request, a one-line explanation of the parent gate, a one-line co-play tip ("Play together: say the names with Klara").
- The microphone permission is **not** requested here; it is requested on the first Record.
- Test: Playwright walks the flow with stubbed adapters; asserts no mic request occurs.

**US-1.3 (M) Audio survives interruptions.** As a parent, I want sound to come back after a phone call, FaceTime, Siri, screen lock or app switch, so that Klara doesn't tap a silent screen.
- On `visibilitychange`, `AudioContext` `statechange`, or the next tap, the app calls `resume()`. If iOS needs a gesture, the next tap on any thing resumes and plays that thing's clip.
- Test: in WebKit, force `suspend()`, tap a thing, assert playback started.

**US-1.4 (M) Screen stays on while playing.** As a parent, I want the screen not to dim during play.
- Request a Screen Wake Lock in play mode, re-request on visibility change, and degrade silently if unsupported.

## E2. Places

**US-2.1 (M) Create a place.** As a parent, I want to create a new place with a name (for me) and choose its ground and sky colours from the Sunny palette.

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
- Taps outside the outline snap to the nearest point inside. Zero, one or two eyes allowed. The parent can undo or drag an eye.

**US-3.3 (M) Pick how it moves.** As a parent, I want one tap to choose **walks** or **floats**, so that it comes alive without rigging.
- Walks: squash-and-stretch body and swinging yarn legs. Floats: gentle bob, covers objects and jellyfish.

**US-3.4 (M) Pick a felt colour.** As a parent, I want to choose the thing's felt colour from the Sunny palette.

**US-3.5 (M) Place is full.** As a parent, I want to be told when a place already has 4 things, so that Klara is never overwhelmed.

**US-3.6 (M) Delete a thing.** As a parent, I want to delete a thing with an in-app confirmation that warns its recordings will be lost.

**US-3.7 (N) Redraw a thing.** Keep its recordings and eyes, replace the outline.

**US-3.8 (N) Recolour a thing.**

**US-3.9 (N) More motion styles.** Swims (fish), hops (spoon, teapot), scuttles (crab).

## E4. Voice

**US-4.1 (M) Record a name.** As a parent, I want to record a thing's name in my language, so that Klara hears my voice.
- Mic permission is requested on the first Record only.
- Recording is capped at 5 s. Silence is trimmed. Loudness is normalised to about −16 LUFS integrated with a −1 dBFS true-peak ceiling.
- Playback and redo before saving. The clip is stored with its MIME type and a `language` field from day one.
- Test: the DSP module is unit tested with fixture WAVs, asserting measured loudness and peak.

**US-4.2 (M) Record the sound.** As a parent, I want to record the thing's sound ("woof", "clink"), played after the name, because animal sounds are among the earliest words.

**US-4.3 (M) Microphone denied.** As a parent, I want plain steps to re-enable the mic in iPad Settings if I declined, and the rest of creation keeps working.

**US-4.4 (M) Bad recording.** As a parent, I want "Try again" when a recording fails, is under 0.3 s, or is silent after trimming; an empty clip is never saved.

**US-4.5 (M) Broken clip.** As a parent, I want a clip that won't decode to be flagged "re-record" in the parent area, while the thing still reacts and chimes in play.

**US-4.7 (M) Re-record a clip.** As a parent, I want to re-record the name or sound of an existing thing from the parent area, without losing its drawing.
- Same flow as US-4.1 (5 s cap, trim, normalise, playback before saving).
- The old clip is replaced only when the new one is saved; cancelling keeps the old clip.
- Test: stubbed recorder adapter covers save and cancel.

**US-4.6 (N) Several takes.** Up to 3 takes per clip, played in rotation.

## E5. Play: Tap and hear

**US-5.1 (M) Tap anything.** As Klara, I want every thing I tap to jump and say its name (then its sound) in a parent's voice, so that I connect the word with the thing.
- Hit target is 1.3× the drawing and never smaller than 120 CSS px (about 2 cm on iPad). Overlaps: topmost wins, then nearest centre.
- Only the primary pointer counts. Touches with a contact `width` or `height` above a threshold (palm) are ignored.
- Mash policy: tapping the playing thing restarts it only after 300 ms; tapping a different thing stops the current clip and plays the new one; nothing queues.
- A felt-confetti puff of at most 1 s and a capped particle count follows each tap.
- CI: `pointerdown` to `AudioBufferSourceNode.start()` under 50 ms in WebKit (instrumented). Manual: under 150 ms end to end on an iPad.
- Tests: synthetic PointerEvents for hit testing, palm rejection and mash policy (pure modules).

**US-5.2 (M) No dead ends, no text, no punishment.** As a parent, I want the child view to be safe for unsupervised taps.
- The child view has zero visible text nodes (DOM test).
- The only interactive elements are things and the parent gate (DOM query plus axe).
- Every visual reaction returns to idle play within 3 s (fake-timer test). Audio may keep playing up to its cap: name plus sound, at most 5 s + 5 s.
- No flashing faster than 3 Hz. No failure sounds in Tap and hear.
- The chime sits at least 6 dB below voice clips; a limiter on the master bus prevents sudden loud sounds.

**US-5.3 (M) Things move gently.** As Klara, I want things to wander slowly and blink, so that the scene is alive but easy to tap.
- Default 1–3 things per place; hard cap 4 (US-3.5).
- Speed is capped (for example, at most 40 CSS px/s). All things pause while a finger is down, and a tapped thing stops during its reaction.

**US-5.4 (M) Gentle ending.** As a parent, I want an optional timer (default 8 minutes, can be switched off) after which the things yawn and fall asleep, so that play ends without a tantrum.

**US-5.5 (N) Reduce motion.** A parent setting that slows or stops wandering; also respects the system reduce-motion setting.

## E6. Play: Find it (18 months+)

**US-6.1 (N) Record the question.** As a parent, I want to record "Where's the ___?" for each thing.

**US-6.2 (N) Answer the question.** As Klara, I want a parent's voice to ask for a thing and a celebration when I tap it.
- Wrong tap: the tapped thing says its own name, then the question repeats. After 2 misses the right thing glows.

**US-6.3 (N) Turn Find it on.** A parent setting, per place.

## E7. Safety, privacy and control

**US-7.1 (M) Parent gate.** As a parent, I want to reach the parent area by holding a corner button for 3 s, so that Klara can't.
- A progress ring fills while holding and resets on release. A second simultaneous touch cancels (palms).
- Test: fake timers and synthetic pointers.

**US-7.2 (M) No accidental escapes inside the app.** Zoom, text selection, long-press menus and pull-to-refresh are disabled in the child view.

**US-7.3 (M) Guided Access guide.** A one-page parent guide to lock the iPad to the app.

**US-7.4 (M) Privacy statement.** As a parent, I want one plain-language screen saying: everything stays on this iPad, Klara is never recorded, and the mic is used only while a parent records.

**US-7.5 (M) Delete all data.** As a parent, I want "Delete all data" with confirmation, which wipes IndexedDB, caches and the service worker.
- Test: Playwright asserts all storage is empty afterwards.

**US-7.6 (M) Parent area is accessible.** Labelled controls, 44 pt targets, works with VoiceOver and zoom, passes axe.

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

**US-9.1 (N) Two languages.** As parents who speak different languages, we each want to record our own clips for the same thing.
- Every clip already carries `language` (US-4.1). A setting chooses which language plays, or alternates.

## E10. Operator

**US-10.1 (M) Deploy the static app.** As the operator, I want `wasmer deploy` to ship the Python app serving the static frontend with an `app.yaml`, so that it runs on Wasmer Edge.

**US-10.2 (M) Health check.** `/healthz` returns 200 when the process is up. (A database check is added with US-8.4.)

**SPIKE-1 (M, week 1) Postgres driver on Wasmer.** Prove a pure-Python driver (pg8000) connects with TLS to Wasmer's managed Postgres on its non-standard port. This retires the biggest backend risk before US-8.4.

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
Round 2 review: added US-4.7 (re-record a clip) and defined import as replace-with-confirmation with a versioned, validated file (US-8.3); clarified the 3 s idle rule versus audio length.

Also adopted from the optional list: sound recording and gentle ending moved to M, co-play tip in first run, reduce-motion setting (N), Opus-on-Safari check before restore.
