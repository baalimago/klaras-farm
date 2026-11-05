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
| Find question speaks on the first press | `io/audio.js`, `play/ask.js`, `play-engine.js`, `components/kf-find-buttons/`, `main.js` | Cold-launch, remove all prompt recordings for one thing, tap 🔍 as the very first touch: you hear "Where is the …?" in the iPad voice, then the animal's sound. Repeat with a recorded question: your voice, then the sound. |
| Find game setup by long-press | `components/kf-find-buttons/`, `components/kf-find-setup/`, `session.js` | Hold 🔍 for a second: the ring fills, the adult check opens, then "Find game". Hold the colour dots: "Colour game". A short tap still starts a round. |
| Colour question then colour word | `io/audio.js`, `components/kf-find-setup/` | Record the colour question and "yellow", tap the colour dots until yellow: your question and the word play back to back without a gap; tapping any yellow animal is right. |
| Hold to edit at the screen edges | `edit/hold.js`, `components/kf-board/` | Holds near the bottom edge and sides never start (system gestures win). |
| Eye stamping way out | `components/kf-guided-add/eyes.js` | Stamp eyes, hold Done 1 s with a finger (no callout, no text selection, the fill completes); a quick tap shows "Keep holding"; Cancel restores the old eyes. |
| Leg placing by touch | `components/kf-guided-add/legs.js`, `edit/leg-flow.js` | Pick 8, place them close together with a fingertip, drag one, change the count midway: the panel follows every tap. |
| Edits show while typing | `components/kf-thing-card/`, `farm-store.js` | With the keyboard up in the name field, tap a felt colour: the swatch and preview change at once. |
| Guided Access | `components/kf-settings/` | Follow the in-app guide; triple-click locks the app. |
| Wake lock | `io/wake.js` | Screen stays on for 5 minutes of play. |
| Editing drawn shapes | `components/kf-guided-add/shape-editor.js`, `components/kf-draw-pad/` | Draw a body and an ear from inside it, tap the body, drag it, pinch it bigger and pull the round handle: the shape stays under the finger with no lag, the felt updates on lift, a palm on the screen does nothing. |
| Smoothness | `io/renderer.js`, `io/felt.js`, `play/` | Safari Web Inspector Timelines, 2 minutes of play with 8 walking things (Walks, Hops and Scuttles mixed): no frame over 4 ms of script, idle board shows no rAF. |
| Dragging under the finger | `components/kf-board/`, `components/kf-scene-tools/`, `io/renderer.js`, `play-engine.js` | In edit mode drag a thing in fast circles, then in Change scene → Move drag and resize a piece: it stays under the fingertip with no visible trail or offset, 60 fps in Timelines, no hitch on release. |
| Colour sheet over the canvas | `components/kf-scene-tools/` | Shape tool → colour button: every swatch takes the tap first time, no stroke appears behind the sheet. |
| Resizing an animal | `components/kf-edit-layer/`, `components/kf-board/`, `play/world.js`, `io/renderer.js` | In edit mode tap an animal (ring and blue round handle, no card), pull the handle out fast and back in: the animal grows and shrinks under the fingertip with its feet planted, eyes and legs with it, 60 fps in Timelines, no hitch or jump on lift; it stops at a sensible smallest and biggest size; grown over a neighbour, the neighbour glides away; a palm resting on the screen or a second finger does nothing; tap it again for its card; after Done and a reload it keeps its size. |
| Things spread in edit mode | `play/spread.js`, `play/world.js`, `components/kf-edit-layer/` | Let the animals bunch up in play, hold to edit: they glide apart smoothly (no hitch), every pencil and cross can be tapped, nothing hides under the edit bar; after Done and a reload they are still apart. |
| Re-recording replaces what plays | `components/kf-thing-card/`, `play/voice.js`, `farm/intents.js`, `play-engine.js` | With English and Swedish on, open a thing's card on the Swedish tab and re-record its sound: the English tab shows the same "Your recording", and a tap in play (either language) plays the new sound. Re-record a name: ▶ on the card and a tap both play the new take. A thing with only a sound and no recorded name: a tap says the name in the iPad voice, then the sound. |
| Enter closes the keyboard | `components/kf-thing-card/enter.js` | In a thing's card, clear the name (the field turns orange, "Give it a name"), type one, press the keyboard's "done"/return key: the keyboard closes and the title shows the name. Same in a question field of the card and of the Find game setup. Also with a Swedish keyboard and with dictation. |
| Record your own question | `components/kf-thing-card/questions.js`, `components/kf-find-setup/` | A thing with no recorded questions: the card and the Find game setup say "The iPad voice reads these for now"; 🔍 in play asks in the iPad voice. Record question 1: the invitation goes, line 1 says "Your recording", the others "Not asked until recorded", and 🔍 asks in your voice. The colour game setup does the same for "Tap on an animal that is…". |
| Recording tip beside a find button | `components/kf-find-buttons/`, `play/ask.js`, `io/prefs.js` | With no recorded questions, tap 🔍: the iPad voice asks and "🎤 Hold 1 s to record your own question" fades in beside the button, readable at arm's length, then fades out after about 6 s. While it is up, taps on it and on the animals under it still work. Tap again: no new tip for 3 minutes. Record a question: that animal never shows it again. Settings → "Show recording tips" off: none, also after a cold launch. |
| Onboarding tour by touch | `components/kf-tour/`, `components/kf-welcome/`, `shell.js` | Delete all data, open the app: after "Start playing" the tour's first card points at an animal; tapping the animal still makes it speak; Next through all four cards (the card never covers the ring, every button takes the first tap); Skip tour from card 2 closes it. Holding the scene on card 2 opens the adult check with the tour out of the way, and the tour then points at a pencil. Settings → Help → "Show the tour again" works. Relaunch: no tour. |
| Editing sounds | `dsp/chimes.js`, `components/kf-dialog/feedback.js` | With the volume at half, each edit (tool, select, pick up, drop, colour, add, delete, undo, Next/Back in Add a thing) gives one soft, short sound, quieter than a child's tap; mashing a button gives one sound, not a pile-up. |

## Log

| Date | Version (`/healthz` assets) | iPad / iPadOS | Result |
|---|---|---|---|
