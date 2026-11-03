// Sends uncaught errors to the server log (POST /api/client-log), so failures that only happen
// on the iPad are visible without a cable. At most a few short reports per page load; no data
// from the farm is ever included, only the error text and where it happened.
const MAX_REPORTS = 8;
let sent = 0;

export function report(kind, detail) {
  if (sent >= MAX_REPORTS) return;
  sent++;
  const text = `${kind} ${String(detail).slice(0, 1500)} @${location.pathname} v=${document.baseURI.split("/v/")[1] ?? "?"}`;
  try {
    if (navigator.sendBeacon?.("/api/client-log", new Blob([text], { type: "text/plain" }))) return;
  } catch {}
  try {
    fetch("/api/client-log", { method: "POST", body: text, keepalive: true }).catch(() => {});
  } catch {}
}

export function installErrorReporting(win = window) {
  win.addEventListener("error", (e) => report("error", `${e.message} ${e.filename ?? ""}:${e.lineno ?? ""}:${e.colno ?? ""} ${e.error?.stack ?? ""}`));
  win.addEventListener("unhandledrejection", (e) => report("rejection", e.reason?.stack ?? e.reason));
  const orig = console.error.bind(console);
  console.error = (...args) => {
    orig(...args);
    report("console.error", args.map((a) => a?.stack ?? a).join(" "));
  };
}
