// Browser test harness: starts the real Python app on a free port with a temp dir as its
// volume, launches Chromium, and gives each test a fresh page. No sleeps: readiness is polled.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
export const ROOT = resolve(import.meta.dirname, "../..");

export function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on("error", fail);
  });
}

export async function startServer({ env = {} } = {}) {
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), "kf-volume-"));
  const proc = spawn("python3", ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(port), "--log-level", "warning"], {
    cwd: ROOT,
    env: { ...process.env, KF_DATA_DIR: dataDir, GIT_SHA: "test", ...env },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${url}/healthz`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url,
    dataDir,
    async stop() {
      proc.kill();
      await new Promise((r) => proc.once("exit", r));
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** One browser + server for a test file. Use `newPage()` per test. */
export async function setup({ fakeMedia = false, serverEnv } = {}) {
  const server = await startServer({ env: serverEnv });
  const args = fakeMedia ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] : ["--autoplay-policy=no-user-gesture-required"];
  const browser = await chromium.launch({ args });
  const contexts = [];
  return {
    server,
    browser,
    /** A fresh context (empty storage) with an iPad-landscape viewport and touch. `init`: a script run before the app (e.g. a speech stub). */
    async newPage({ viewport = { width: 1180, height: 820 }, waitReady = true, permissions = [], init = null } = {}) {
      const context = await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: 1, permissions });
      contexts.push(context);
      if (init) await context.addInitScript(init);
      const page = await context.newPage();
      page.errors = [];
      page.on("pageerror", (e) => page.errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
      await page.goto(server.url + "/");
      if (waitReady) await page.waitForFunction(() => document.documentElement.dataset.ready === "true", null, { timeout: 15000 });
      return page;
    },
    /**
     * A same-origin page with <base href="/v/<hash>/"> and the app CSS, but without booting the app.
     * Use it to test one module or element: `await page.evaluate(() => import('./js/geometry/hit.js'))`.
     */
    async modulePage(html = "", { viewport = { width: 1180, height: 820 }, permissions = [] } = {}) {
      const context = await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: 1, permissions });
      contexts.push(context);
      const page = await context.newPage();
      page.errors = [];
      page.on("pageerror", (e) => page.errors.push(e.message));
      const { assets } = await (await fetch(`${server.url}/healthz`)).json();
      await page.goto(`${server.url}/v/${assets}/manifest.webmanifest`);
      await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><base href="/v/${assets}/"><link rel="stylesheet" href="css/main.css"></head><body>${html}</body></html>`);
      return page;
    },
    async teardown() {
      for (const c of contexts) await c.close().catch(() => {});
      await browser.close();
      await server.stop();
    },
  };
}
