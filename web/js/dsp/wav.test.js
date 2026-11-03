import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeWav, mixDown } from "./wav.js";

test("encodes mono 16-bit PCM WAV with a correct header", () => {
  const s = new Float32Array([0, 0.5, -0.5, 1, -1, 2]);
  const buf = encodeWav(s, 8000);
  const v = new DataView(buf);
  const str = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  assert.equal(buf.byteLength, 44 + s.length * 2);
  assert.equal(str(0, 4), "RIFF");
  assert.equal(v.getUint32(4, true), buf.byteLength - 8);
  assert.equal(str(8, 8), "WAVEfmt ");
  assert.equal(v.getUint16(20, true), 1, "PCM");
  assert.equal(v.getUint16(22, true), 1, "mono");
  assert.equal(v.getUint32(24, true), 8000);
  assert.equal(v.getUint32(28, true), 16000, "byte rate");
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(str(36, 4), "data");
  assert.equal(v.getUint32(40, true), s.length * 2);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => v.getInt16(44 + i * 2, true)), [0, 16384, -16383, 32767, -32767, 32767]);
});

test("mixes channels down to mono", () => {
  const m = mixDown([new Float32Array([1, 0, 0.5]), new Float32Array([0, 0, 0.5])]);
  assert.deepEqual(Array.from(m), [0.5, 0, 0.5]);
  const one = new Float32Array([0.1]);
  assert.equal(mixDown([one]), one);
});
