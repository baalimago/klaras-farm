import { test } from "node:test";
import assert from "node:assert/strict";
import { draftLines, setDraftLine, addDraftQuestion, removeDraftQuestion, draftClips } from "./draft-questions.js";

const prompt = (take, language = "en") => ({ language, kind: "prompt", take, blobSha256: `${language}${take}` });
const draft = (lines, clips = []) => ({ id: "d", step: 6, thing: { names: { en: "Hen" }, cues: lines ? { en: { lines } } : {} }, clips });

test("a new draft has the three example questions", () => {
  assert.deepEqual(draftLines(draft(null).thing, "en"), ["", "", ""]);
  assert.deepEqual(draftLines(draft(["a"]).thing, "en"), ["a"]);
});

test("change a question's words; empty goes back to the example; a bad index changes nothing", () => {
  const d = draft(null);
  const one = setDraftLine(d, { language: "en", index: 1, text: "  Where's the hen?  " });
  assert.deepEqual(one.thing.cues.en.lines, ["", "Where's the hen?", ""]);
  assert.deepEqual(d.thing.cues, {}, "the old draft is untouched");
  assert.deepEqual(setDraftLine(one, { language: "en", index: 1, text: "" }).thing.cues.en.lines, ["", "", ""]);
  assert.equal(setDraftLine(one, { language: "en", index: 3, text: "x" }), one);
  assert.equal(setDraftLine(one, { language: "en", index: -1, text: "x" }), one);
  const sv = setDraftLine(one, { language: "sv", index: 0, text: "Var är hönan?" });
  assert.deepEqual(sv.thing.cues.sv.lines, ["Var är hönan?", "", ""]);
  assert.deepEqual(sv.thing.cues.en.lines, ["", "Where's the hen?", ""], "other languages stay");
});

test("add questions up to six, then no more", () => {
  let d = draft(null);
  d = addDraftQuestion(d, { language: "en" });
  assert.deepEqual(d.thing.cues.en.lines, ["", "", "", ""]);
  d = addDraftQuestion(d, { language: "en", text: " Peep? " });
  assert.equal(d.thing.cues.en.lines[4], "Peep?");
  d = addDraftQuestion(d, { language: "en" });
  assert.equal(d.thing.cues.en.lines.length, 6);
  assert.equal(addDraftQuestion(d, { language: "en" }), d);
});

test("remove a question with its recording; later recordings move up with their lines", () => {
  const d = draft(["one", "", "three", ""], [prompt(1), prompt(2), prompt(3), prompt(4), prompt(2, "sv"), { language: "en", kind: "name", take: 1 }]);
  const r = removeDraftQuestion(d, { language: "en", index: 1, examples: ["e1", "e2", "e3", "e4"] });
  assert.deepEqual(r.thing.cues.en.lines, ["one", "three", "e4"], "an empty line after it keeps its example as words");
  const en = draftClips(r, { language: "en", kind: "prompt" }).map((c) => [c.take, c.blobSha256]);
  assert.deepEqual(en.sort(), [[1, "en1"], [2, "en3"], [3, "en4"]]);
  assert.deepEqual(draftClips(r, { language: "sv" }).map((c) => c.take), [2], "other languages keep their takes");
  assert.equal(draftClips(r, { kind: "name" }).length, 1, "the name stays");
  assert.deepEqual(removeDraftQuestion(d, { language: "en", index: 0 }).thing.cues.en.lines, ["", "three", ""], "lines before stay; no examples given");
});

test("one question always stays; a bad index changes nothing", () => {
  const one = draft(["only"]);
  assert.equal(removeDraftQuestion(one, { language: "en", index: 0 }), one);
  const three = draft(null);
  assert.equal(removeDraftQuestion(three, { language: "en", index: 3 }), three);
  assert.equal(removeDraftQuestion(three, { language: "en", index: 0.5 }), three);
});

test("draftClips filters like FarmStore.clipsFor", () => {
  const d = draft(null, [prompt(1), prompt(1, "sv"), { language: "en", kind: "sound", take: 1 }]);
  assert.equal(draftClips(d).length, 3);
  assert.equal(draftClips(d, { language: "en" }).length, 2);
  assert.equal(draftClips(d, { language: "en", kind: "prompt" }).length, 1);
});
