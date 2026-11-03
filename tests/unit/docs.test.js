// AGENTS.md rule 6: every domain has an architecture doc in docs/<domain>.md, and AGENTS.md lists it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync, lstatSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const JS = join(ROOT, "web/js");
const domains = [...readdirSync(JS).filter((n) => statSync(join(JS, n)).isDirectory()), "backend"];

test("every domain folder has docs/<domain>.md, listed in AGENTS.md", () => {
  const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
  for (const d of domains) {
    assert.ok(existsSync(join(ROOT, "docs", `${d}.md`)), `docs/${d}.md is missing`);
    assert.match(agents, new RegExp(`\\b${d}\\b`), `AGENTS.md does not mention ${d}`);
  }
});

test("CLAUDE.md is a symlink to AGENTS.md", () => {
  const p = join(ROOT, "CLAUDE.md");
  assert.ok(lstatSync(p).isSymbolicLink());
  assert.equal(readlinkSync(p), "AGENTS.md");
});
