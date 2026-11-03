// Recorder: one take from the microphone (ARCHITECTURE §8, US-4.1, US-4.3, US-4.4).
// getUserMedia with AGC, noise suppression and echo cancellation off; MediaRecorder without
// timeslice; the real mimeType read after start; an AnalyserNode feeds the level meter and the
// pure auto-stop reducer; tracks are stopped afterwards. The bytes are never modified: the take is
// decoded once to compute trim points and gain (dsp/take.js). SHA-256 is computed here, before
// any storage transaction.
import { autoStopInit, autoStopStep, AUTO_STOP } from "../dsp/autostop.js";
import { rms, dbfs, meterLevel } from "../dsp/level.js";
import { analyseTake, TAKE } from "../dsp/take.js";
import { mixDown } from "../dsp/wav.js";

const POLL_MS = 30;
const BLIP_GAP_MS = 170; // the start blip finishes before recording begins, so it isn't captured

/**
 * @typedef {{ok:true, bytes:ArrayBuffer, mime:string, sha256:string, durationMs:number, trimStartMs:number,
 *            trimEndMs:number, gainDb:number, cappedAt5s:boolean}
 *         | {ok:false, error:'denied'|'too-short'|'silent'|'failed'|'unsupported'|'cancelled'}} RecordResult
 * @typedef {{stop: () => Promise<RecordResult>, cancel: () => void, done: Promise<RecordResult>}} RecordHandle
 */

export class Recorder {
  /** @param {{audio: import('./audio.js').AudioEngine, mediaDevices?: MediaDevices, MediaRecorderClass?: typeof MediaRecorder}} opts */
  constructor({ audio, mediaDevices = globalThis.navigator?.mediaDevices, MediaRecorderClass = globalThis.MediaRecorder } = {}) {
    this.audio = audio;
    this._md = mediaDevices;
    this._MR = MediaRecorderClass;
  }

  get supported() {
    return !!(this._md?.getUserMedia && this._MR && this.audio);
  }

  /** 'granted' | 'denied' | 'prompt' | 'unsupported'. Never prompts. */
  async permission() {
    if (!this.supported) return "unsupported";
    try {
      const s = await globalThis.navigator.permissions.query({ name: "microphone" });
      return s.state;
    } catch {
      return "prompt";
    }
  }

  /**
   * Starts a take. Resolves once recording has begun (or failed). Call it from a click handler:
   * it unlocks audio synchronously first.
   * @param {{onLevel?: (level01:number, db:number) => void}} [opts]
   * @returns {Promise<RecordHandle>}
   */
  async start({ onLevel } = {}) {
    if (!this.supported) return finished({ ok: false, error: "unsupported" });
    const audio = this.audio;
    audio.unlock?.();
    audio.setSessionType?.("play-and-record");

    let stream;
    try {
      stream = await this._md.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
    } catch (e) {
      audio.setSessionType?.("playback");
      const name = e?.name;
      return finished({ ok: false, error: name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "unsupported" : "failed" });
    }
    const stopTracks = () => stream.getTracks().forEach((t) => t.stop());

    const blip = audio.chime?.("start") || 0;
    if (blip) await wait(Math.min(BLIP_GAP_MS, blip * 1000));

    let mr;
    const chunks = [];
    try {
      mr = new this._MR(stream);
      mr.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      await new Promise((ok, fail) => {
        mr.onstart = ok;
        mr.onerror = (e) => fail(e?.error ?? new Error("recorder error"));
        mr.start(); // no timeslice: one complete file on stop
      });
    } catch {
      stopTracks();
      audio.setSessionType?.("playback");
      return finished({ ok: false, error: "failed" });
    }
    const t0 = performance.now();
    const stopped = new Promise((r) => { mr.onstop = r; });

    // level meter and auto-stop
    let analyser = null;
    let source = null;
    try {
      const ctx = audio.context;
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
    } catch {}
    const buf = analyser ? new Float32Array(analyser.fftSize) : null;
    let auto = autoStopInit();

    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    let finishing = null;

    const finish = (reason) => {
      if (finishing) return finishing;
      clearInterval(poll);
      clearTimeout(cap);
      finishing = (async () => {
        if (mr.state !== "inactive") mr.stop();
        await stopped;
        const wallMs = performance.now() - t0;
        stopTracks();
        try { source?.disconnect(); } catch {}
        audio.setSessionType?.("playback");
        if (reason !== "cancel") audio.chime?.("stop");
        const result = reason === "cancel" ? { ok: false, error: "cancelled" } : await this._process(chunks, mr.mimeType, wallMs, reason, auto);
        resolveDone(result);
        return result;
      })().catch(() => {
        const r = { ok: false, error: "failed" };
        resolveDone(r);
        return r;
      });
      return finishing;
    };

    const poll = setInterval(() => {
      if (!analyser) return;
      analyser.getFloatTimeDomainData(buf);
      const db = dbfs(rms(buf));
      try { onLevel?.(meterLevel(db), db); } catch {}
      auto = autoStopStep(auto, performance.now() - t0, db);
      if (auto.stop) finish(auto.stop);
    }, POLL_MS);
    const cap = setTimeout(() => finish("cap"), AUTO_STOP.capMs + 150); // in case the analyser is unavailable

    return { stop: () => finish("button"), cancel: () => { finish("cancel"); }, done };
  }

  async _process(chunks, mimeType, wallMs, reason, auto) {
    const mime = mimeType || chunks[0]?.type || "audio/mp4";
    if (wallMs < TAKE.minMs || !chunks.length) return { ok: false, error: "too-short" };
    const bytes = await new Blob(chunks, { type: mime }).arrayBuffer();
    let decoded;
    try {
      decoded = await this.audio.decode(bytes);
    } catch {
      return { ok: false, error: "failed" };
    }
    const channels = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));
    const a = analyseTake(mixDown(channels), decoded.sampleRate, Number.isFinite(auto.floorDb) ? { floorDb: auto.floorDb } : {});
    if (a.verdict !== "ok") return { ok: false, error: a.verdict };
    const sha256 = await sha256Hex(bytes);
    return {
      ok: true, bytes, mime, sha256,
      durationMs: a.durationMs, trimStartMs: a.trimStartMs, trimEndMs: a.trimEndMs, gainDb: a.gainDb,
      cappedAt5s: reason === "cap",
    };
  }
}

/** Lowercase hex SHA-256 of an ArrayBuffer. */
export async function sha256Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let s = "";
  for (const b of d) s += b.toString(16).padStart(2, "0");
  return s;
}

function finished(result) {
  const done = Promise.resolve(result);
  return { stop: () => done, cancel() {}, done };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
