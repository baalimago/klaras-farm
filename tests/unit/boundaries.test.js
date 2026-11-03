// Architecture rules, enforced: pure domain folders import only domain folders and types.js,
// and never touch browser globals, time, randomness or the DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../web/js");
const DOMAINS = ["farm", "geometry", "motion", "play", "edit", "dsp"];
const BANNED = [
  /\bDate\.now\b/, /\bnew Date\(\s*\)/, /\bMath\.random\b/, /\bcrypto\./, /\bsetTimeout\b/, /\bsetInterval\b/,
  /\brequestAnimationFrame\b/, /\bdocument\./, /\bwindow\./, /\bnavigator\./, /\blocalStorage\b/, /\bindexedDB\b/,
  /\bAudioContext\b/, /\bperformance\.now\b/, /\bfetch\(/,
];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".js") && !p.endsWith(".test.js") ? [p] : [];
  });
}

for (const domain of DOMAINS) {
  test(`${domain}/ is pure`, () => {
    let dirFiles = [];
    try { dirFiles = files(join(ROOT, domain)); } catch { return; }
    for (const file of dirFiles) {
      const src = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const rule of BANNED) assert.ok(!rule.test(src), `${relative(ROOT, file)} uses ${rule}`);
      for (const [, spec] of src.matchAll(/(?:import|export)[^'"]*?from\s*["']([^"']+)["']/g)) {
        const target = relative(ROOT, resolve(dirname(file), spec));
        const top = target.split("/")[0];
        assert.ok(DOMAINS.includes(top) || target === "types.js", `${relative(ROOT, file)} imports ${spec}`);
      }
    }
  });
}

test("no module outside io/, components/ and main.js reads IndexedDB or audio directly", () => {
  for (const file of files(ROOT)) {
    const rel = relative(ROOT, file);
    if (rel.startsWith("io/") || rel.startsWith("components/") || rel === "main.js") continue;
    const src = readFileSync(file, "utf8");
    assert.ok(!/\bindexedDB\b|\bnew AudioContext\b|getUserMedia/.test(src), `${rel} touches a device API`);
  }
});
