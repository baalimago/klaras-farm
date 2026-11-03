// Flags: pure defaults, overridable with ?flag=name:value (repeatable). Read only in main.js.
// Each flag is removed within two milestones of its decision (ARCHITECTURE §11).
export const DEFAULT_FLAGS = Object.freeze({
  holdMs: 1500,
  gateKind: "keypad",
  motionSpeed: 1,
  autoStopRecording: true,
  sleepTimer: true,
});

export function readFlags(search = "") {
  const flags = { ...DEFAULT_FLAGS };
  for (const raw of new URLSearchParams(search).getAll("flag")) {
    const [name, value] = raw.split(":");
    if (!(name in DEFAULT_FLAGS)) continue;
    const d = DEFAULT_FLAGS[name];
    flags[name] = typeof d === "number" ? Number(value) : typeof d === "boolean" ? value === "true" : value;
  }
  return flags;
}
