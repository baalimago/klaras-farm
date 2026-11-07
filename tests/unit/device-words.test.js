// The iPad is the main target, not the only one (AGENTS.md): parent copy names the device only
// through io/device.js. This guards every component at once, so "iPad" cannot creep back into
// a message that also shows on a phone or a laptop. Comments may still say iPad.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../../web/js/components");

function sources(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (e.name.endsWith(".js") && !e.name.endsWith(".test.js")) out.push(p);
  }
  return out;
}

/** The code without comments: block comments, then line comments (not "://" in URLs). */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("no component hard-codes iPad or iPhone in its copy", () => {
  const offenders = [];
  for (const file of sources(ROOT)) {
    code(readFileSync(file, "utf8")).split("\n").forEach((line, i) => {
      if (/iP(ad|hone)/.test(line)) offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], "use device().name / device().voice from io/device.js");
});

test("the guard sees a string and ignores comments", () => {
  assert.match(code('const a = "The iPad is out of space"; // fine'), /iPad/);
  assert.doesNotMatch(code("// iPad audio rules\n/** iPad */\nconst x = 1; // iPad"), /iPad/);
});
