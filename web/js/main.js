// Composition root: the only module that knows io/, flags and the clock.
// Boot: open repository → hydrate (or import starter content) → build engine, audio, renderer → show play.
import { FarmStore } from "./farm-store.js";
import { FarmError } from "./farm/intents.js";
import { readFlags } from "./flags.js";
import { openIdbRepo } from "./io/idb-repo.js";
import { MemoryRepo } from "./io/memory-repo.js";
import { AudioEngine } from "./io/audio.js";
import { MusicPlayer } from "./io/music.js";
import { Recorder } from "./io/mic.js";
import { WakeLock } from "./io/wake.js";
import * as share from "./io/share.js";
import * as storage from "./io/storage.js";
import { loadStarter } from "./io/starter.js";
import { PlayEngine } from "./play-engine.js";
import { PRESET_IDS } from "./motion/pose.js";
import { Session } from "./session.js";
import { Shell } from "./shell.js";
import "./components/kf-board/define.js";
import "./components/kf-find-buttons/define.js";

const APP_VERSION = document.querySelector("base")?.getAttribute("href")?.split("/")[2] || "dev";

async function boot() {
  const flags = readFlags(location.search);
  const deviceId = storage.deviceId();
  const env = { now: () => new Date().toISOString(), rng: Math.random, newId: () => crypto.randomUUID(), deviceId };
  const warnings = [];

  let repo;
  try {
    repo = await openIdbRepo({ onBlocked: () => warnings.push("blocked"), onVersionChange: () => location.reload() });
  } catch (e) {
    if (e?.name === "VersionError") return showUpdateNeeded();
    warnings.push("no-storage"); // private browsing or storage disabled: play works, nothing is kept
    repo = new MemoryRepo();
  }

  const store = new FarmStore(repo, env, APP_VERSION);
  let fresh = false;
  try {
    ({ fresh } = await store.hydrate());
  } catch (e) {
    if (!(e instanceof FarmError)) throw e;
    warnings.push("corrupt");
  }
  if (fresh) await store.replaceAll(await loadStarter(env, navigator.language, APP_VERSION), []);
  else share.discardImportBackup(store).catch(() => {}); // "Undo import" lasts until the next boot
  if (!fresh) repo.sweepOrphanBlobs?.(new Date(Date.now() - 24 * 3600e3).toISOString()).catch(() => {});

  const [presets, scripts] = await Promise.all([loadJsonMap("data/motions/", PRESET_IDS), loadScripts()]);

  const audio = new AudioEngine({ getBlob: (sha) => store.getBlob(sha) });
  const recorder = new Recorder({ audio });
  const engine = new PlayEngine({ store, audio, presets, scripts, rng: env.rng, flags, now: () => performance.now() });
  const session = new Session({ now: () => Date.now(), holdMs: flags.holdMs });
  const wake = new WakeLock();
  const music = new MusicPlayer({
    audio,
    shouldPlay: () => session.state.mode === "play" && document.visibilityState === "visible" && !engine.world.asleep,
  });

  const services = { store, session, engine, audio, music, recorder, scripts, presets, share, storage, flags, env, appVersion: APP_VERSION, warnings };
  const board = document.getElementById("board");
  board.connect(services);
  services.board = board;
  session.connect(services);
  // Find games: the child starts them with the 🔍 and colour buttons (created here so they upgrade).
  const findButtons = document.createElement("kf-find-buttons");
  findButtons.services = services;
  document.getElementById("stage").append(findButtons);
  const shell = new Shell(document.getElementById("parent-layer"), services);
  services.shell = shell;

  session.addEventListener("change", () => {
    document.getElementById("stage").dataset.mode = session.state.mode;
    if (session.state.mode === "play") wake.request();
    music.update();
  });
  // Music starts with the first tap (iOS unlocks audio on a gesture) and after waking from sleep.
  // pointerup is a user activation on iOS: the first one also unlocks the device voice for later questions.
  document.addEventListener("pointerup", () => { music.update(); audio.primeSpeech(); }, { passive: true });
  audio.addEventListener("statechange", () => music.update());
  wake.request();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { audio.resume(); wake.request(); }
    music.update();
  });

  storage.watchForUpdates(() => shell.updateReady());
  storage.registerServiceWorker();
  if (!store.settings.welcomed) shell.welcome();
  window.__kf = services; // debugging and browser tests
  document.documentElement.dataset.ready = "true";
}

async function loadJsonMap(dir, ids) {
  const entries = await Promise.all(ids.map(async (id) => [id, await (await fetch(`${dir}${id}.json`)).json()]));
  return Object.fromEntries(entries);
}

async function loadScripts() {
  const langs = await (await fetch("data/scripts/index.json")).json();
  return loadJsonMap("data/scripts/", langs);
}

function showUpdateNeeded() {
  document.getElementById("parent-layer").innerHTML =
    '<div class="kf-sheet center" role="alertdialog" aria-labelledby="upd"><h2 id="upd">Update needed</h2><p>Another window is using a newer version of Klara\'s Farm. Close it, then reopen the app.</p></div>';
}

boot().catch((e) => {
  console.error(e);
  document.documentElement.dataset.ready = "error";
});
