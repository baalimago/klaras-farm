import { test } from "node:test";
import assert from "node:assert/strict";
import { musicBar, BAR_S, PROGRESSION, MUSIC_BUS_DB, MUSIC_DUCK_DB } from "./music.js";
import { CHIME_BUS_DB } from "./chimes.js";

const melody = (notes) => notes.filter((n) => n.partials);

test("a bar is repeatable from its index and seed", () => {
  assert.deepEqual(musicBar(13, 5), musicBar(13, 5));
  assert.notDeepEqual(melody(musicBar(13, 5)), melody(musicBar(13, 6)));
});

test("every note starts inside the bar and the melody stays in the soft middle range", () => {
  for (let bar = 0; bar < 64; bar++) {
    for (const n of musicBar(bar, 3)) {
      assert.ok(n.at >= 0 && n.at < BAR_S, `bar ${bar}: starts in the bar`);
      assert.ok(n.gain > 0 && n.gain <= 0.35, "quiet notes");
      assert.ok(n.freq >= 60 && n.freq <= 1200, `bar ${bar}: ${n.freq} Hz in range`);
    }
  }
});

test("each bar carries its chord's root in the bass", () => {
  for (let bar = 0; bar < PROGRESSION.length; bar++) {
    const bass = musicBar(bar, 1).find((n) => !n.partials && n.wave === "sine");
    const root = 440 * 2 ** ((PROGRESSION[bar][0] - 12 - 69) / 12);
    assert.ok(Math.abs(bass.freq - root) < 0.01);
  }
});

test("the melody is sparse (a lullaby, not a jingle) and phrases end on one long note", () => {
  let total = 0;
  for (let bar = 0; bar < 64; bar++) total += melody(musicBar(bar, 9)).length;
  assert.ok(total / 64 <= 3 && total / 64 >= 1, `about 1 to 3 melody notes a bar (${total / 64})`);
  for (const phrase of [0, 1, 2]) {
    const end = melody(musicBar(phrase * 8 + 7, 9));
    assert.ok(end.length <= 1);
    if (end.length) assert.ok(end[0].decay > 2);
  }
});

test("the melody changes from phrase to phrase", () => {
  const phrase = (p) => Array.from({ length: 8 }, (_, i) => melody(musicBar(p * 8 + i, 2)).map((n) => n.freq)).flat();
  assert.notDeepEqual(phrase(0), phrase(1));
});

test("music sits well under the chimes and further under the voices while ducked", () => {
  assert.ok(MUSIC_BUS_DB <= CHIME_BUS_DB - 6);
  assert.ok(MUSIC_DUCK_DB < 0);
});
