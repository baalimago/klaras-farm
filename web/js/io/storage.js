// Device storage and the service worker: device id, persistence, estimates, Delete all data
// (US-7.5), registration and the update policy (ARCHITECTURE §10: a new worker waits; it takes over
// on the next cold launch or when a parent taps "Update ready").
import { closeAllConnections } from "./idb-repo.js";

const DEVICE_KEY = "kf-device-id";
let sessionDeviceId = null;

/** A stable id for this device (localStorage), or one per session when storage is blocked. */
export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return (sessionDeviceId ??= crypto.randomUUID());
  }
}

/** Asks for persistent storage. True when granted (or already persisted). */
export async function requestPersist() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** True when storage is already persistent (no prompt). */
export async function isPersisted() {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}

/** @returns {Promise<{usage: number, quota: number} | null>} */
export async function estimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}

/** Running as the Home Screen app. */
export function isStandalone() {
  try {
    return globalThis.matchMedia?.("(display-mode: standalone)").matches === true || globalThis.navigator?.standalone === true;
  } catch {
    return false;
  }
}

/**
 * Wipes everything this origin keeps: IndexedDB databases, Cache Storage, service worker
 * registrations, localStorage and sessionStorage. Reload afterwards.
 * @returns {Promise<{blocked: boolean}>}  blocked: another window still holds the database open
 */
export async function deleteAllData({ names = ["klaras-farm"] } = {}) {
  closeAllConnections();
  let blocked = false;
  const regs = (await navigator.serviceWorker?.getRegistrations?.().catch(() => [])) ?? [];
  await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
  if (globalThis.caches) {
    const keys = await caches.keys().catch(() => []);
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  if (globalThis.indexedDB) {
    let dbNames = names;
    try {
      const list = await indexedDB.databases?.();
      if (list) dbNames = [...new Set([...names, ...list.map((d) => d.name).filter(Boolean)])];
    } catch {}
    const results = await Promise.all(dbNames.map(deleteDatabase));
    blocked = results.includes("blocked");
  }
  for (const s of ["localStorage", "sessionStorage"]) {
    try {
      globalThis[s]?.clear();
    } catch {}
  }
  sessionDeviceId = null;
  return { blocked };
}

function deleteDatabase(name) {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve("deleted");
    req.onerror = () => resolve("error");
    // The deletion still happens once the other window closes; don't hang the parent's tap on it.
    req.onblocked = () => resolve("blocked");
  });
}

/** Registers /sw.js for the whole origin. Resolves to the registration, or null. */
export async function registerServiceWorker() {
  if (!globalThis.navigator?.serviceWorker) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (e) {
    console.warn("service worker not registered", e);
    return null;
  }
}

/**
 * Calls onReady() once a new version is installed and waiting (only when a version is already in
 * control, so a first install never shows "Update ready"). Checks for updates when the app returns
 * to the foreground. Returns a function that stops watching.
 */
export function watchForUpdates(onReady) {
  const sw = globalThis.navigator?.serviceWorker;
  if (!sw) return () => {};
  let fired = false;
  let stopped = false;
  const ready = () => {
    if (!fired && !stopped && sw.controller) {
      fired = true;
      onReady();
    }
  };
  const track = (worker) => {
    if (!worker) return;
    if (worker.state === "installed") ready();
    else worker.addEventListener("statechange", () => worker.state === "installed" && ready());
  };
  let reg = null;
  const onVisible = () => document.visibilityState === "visible" && reg?.update().catch(() => {});
  sw.ready.then((r) => {
    if (stopped) return;
    reg = r;
    if (r.waiting) ready();
    track(r.installing);
    r.addEventListener("updatefound", () => track(r.installing));
    document.addEventListener("visibilitychange", onVisible);
  });
  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** Activates the waiting version and reloads into it ("Update ready"). */
export async function applyUpdate() {
  const sw = globalThis.navigator?.serviceWorker;
  const reg = await sw?.getRegistration?.("/").catch(() => null);
  if (!reg?.waiting) return location.reload();
  sw.addEventListener("controllerchange", () => location.reload(), { once: true });
  reg.waiting.postMessage({ type: "skip-waiting" });
}
