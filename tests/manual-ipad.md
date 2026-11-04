# Manual iPad checklist

Run on the base iPad (11th generation, A16) with iPadOS 18 or later before a release when CI labels the change "iPad check needed" (any change under the trigger paths). Takes about 15 minutes. Log each run at the bottom.

| Check | Trigger paths | How |
|---|---|---|
| Tap to sound under 150 ms | `io/audio.js`, `play-engine.js`, `components/kf-board/` | Record the screen with sound, tap a thing with a recorded name, count frames from touch to sound. |
| Sound after a call, Siri and screen lock | `io/audio.js` | FaceTime the iPad mid-play, lock and unlock, then tap a thing: it plays. |
| Mute switch and volume | `io/audio.js` | With silent mode on, voices still play (audio session "playback"). |
| Mic permission and denial | `io/mic.js`, `components/kf-recorder/` | First Record asks; deny shows the Settings steps; allow in Settings and retry. |
| Recording quality | `io/mic.js`, `dsp/` | Record a name in a quiet and a noisy room: auto-stop after you finish, trimmed, even volume. |
| Add to Home Screen and offline | `sw.template.js`, `io/storage.js`, `index.html` | Install, enable Airplane Mode, cold-launch: plays. |
| Storage persistence | `io/idb-repo.js`, `io/storage.js` | Data still there after a week of not opening the app. |
| Export and import through the share sheet | `io/share.js`, `components/kf-settings/` | Export to Files, delete all data, import: everything back, recordings play. |
| Hold to edit at the screen edges | `edit/hold.js`, `components/kf-board/` | Holds near the bottom edge and sides never start (system gestures win). |
| Eye stamping way out | `components/kf-guided-add/eyes.js` | Stamp eyes, hold Done 1 s with a finger (no callout, no text selection, the fill completes); a quick tap shows "Keep holding"; Cancel restores the old eyes. |
| Leg placing by touch | `components/kf-guided-add/legs.js`, `edit/leg-flow.js` | Pick 8, place them close together with a fingertip, drag one, change the count midway: the panel follows every tap. |
| Edits show while typing | `components/kf-thing-card/`, `farm-store.js` | With the keyboard up in the name field, tap a felt colour: the swatch and preview change at once. |
| Guided Access | `components/kf-settings/` | Follow the in-app guide; triple-click locks the app. |
| Wake lock | `io/wake.js` | Screen stays on for 5 minutes of play. |
| Editing drawn shapes | `components/kf-guided-add/shape-editor.js`, `components/kf-draw-pad/` | Draw a body and an ear from inside it, tap the body, drag it, pinch it bigger and pull the round handle: the shape stays under the finger with no lag, the felt updates on lift, a palm on the screen does nothing. |
| Smoothness | `io/renderer.js`, `io/felt.js`, `play/` | Safari Web Inspector Timelines, 2 minutes of play with 4 things: no frame over 4 ms of script, idle board shows no rAF. |

## Log

| Date | Version (`/healthz` assets) | iPad / iPadOS | Result |
|---|---|---|---|
