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
| Guided Access | `components/kf-settings/` | Follow the in-app guide; triple-click locks the app. |
| Wake lock | `io/wake.js` | Screen stays on for 5 minutes of play. |
| Smoothness | `io/renderer.js`, `io/felt.js`, `play/` | Safari Web Inspector Timelines, 2 minutes of play with 8 walking things (Walks, Hops and Scuttles mixed): no frame over 4 ms of script, idle board shows no rAF. |

## Log

| Date | Version (`/healthz` assets) | iPad / iPadOS | Result |
|---|---|---|---|
