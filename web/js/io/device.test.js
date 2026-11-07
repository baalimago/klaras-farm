import { test } from "node:test";
import assert from "node:assert/strict";
import { detectKind, deviceFor, isSafari, device } from "./device.js";

const UA = {
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  ipadOS: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  chromeIOS: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  chrome: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};

test("an iPad is an iPad, also when iPadOS says it is a Mac (touch points give it away)", () => {
  assert.equal(detectKind({ userAgent: UA.ipad }), "ipad");
  assert.equal(detectKind({ userAgent: UA.ipadOS, maxTouchPoints: 5 }), "ipad");
  assert.equal(detectKind({ userAgent: UA.chromeIOS }), "ipad");
});

test("a real Mac, an iPhone, Android and desktop are not iPads", () => {
  assert.equal(detectKind({ userAgent: UA.ipadOS, maxTouchPoints: 0 }), "other");
  assert.equal(detectKind({ userAgent: UA.iphone }), "iphone");
  assert.equal(detectKind({ userAgent: UA.android, maxTouchPoints: 5 }), "other");
  assert.equal(detectKind({ userAgent: UA.chrome }), "other");
  assert.equal(detectKind(undefined), "other");
  assert.equal(detectKind({}), "other");
});

test("Safari: desktop Safari and every iOS browser; not Chrome or Android", () => {
  assert.equal(isSafari({ userAgent: UA.ipadOS, maxTouchPoints: 0 }), true, "Safari on a Mac");
  assert.equal(isSafari({ userAgent: UA.chromeIOS }), true, "WebKit on iPad");
  assert.equal(isSafari({ userAgent: UA.chrome }), false);
  assert.equal(isSafari({ userAgent: UA.android }), false);
});

test("the words: the device's own name on Apple devices, neutral words elsewhere", () => {
  assert.deepEqual(deviceFor({ userAgent: UA.ipad }), { kind: "ipad", name: "iPad", voice: "iPad voice", ios: true, safari: true });
  assert.deepEqual(deviceFor({ userAgent: UA.iphone }), { kind: "iphone", name: "iPhone", voice: "iPhone voice", ios: true, safari: true });
  assert.deepEqual(deviceFor({ userAgent: UA.android }), { kind: "other", name: "device", voice: "built-in voice", ios: false, safari: false });
});

test("device() reads the real navigator once and keeps the answer", () => {
  const a = device();
  assert.equal(a, device());
  assert.ok(["ipad", "iphone", "other"].includes(a.kind));
});
