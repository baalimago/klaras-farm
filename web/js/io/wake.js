// Screen Wake Lock while playing (US-1.4). Degrades silently where unsupported or refused.
// The browser drops the lock when the page is hidden; main.js calls request() again on
// visibilitychange.

export class WakeLock {
  constructor({ nav = globalThis.navigator, doc = globalThis.document } = {}) {
    this._nav = nav;
    this._doc = doc;
    this._sentinel = null;
    this._pending = null;
  }

  get supported() {
    return !!this._nav?.wakeLock?.request;
  }

  get active() {
    return !!this._sentinel && !this._sentinel.released;
  }

  /** Resolves true when the screen is being kept on. Never throws. */
  request() {
    if (!this.supported) return Promise.resolve(false);
    if (this.active) return Promise.resolve(true);
    if (this._doc && this._doc.visibilityState && this._doc.visibilityState !== "visible") return Promise.resolve(false);
    if (this._pending) return this._pending;
    this._pending = (async () => {
      try {
        const s = await this._nav.wakeLock.request("screen");
        this._sentinel = s;
        s.addEventListener?.("release", () => { if (this._sentinel === s) this._sentinel = null; });
        return true;
      } catch {
        return false;
      } finally {
        this._pending = null;
      }
    })();
    return this._pending;
  }

  /** Lets the screen dim again. Never throws. */
  async release() {
    const s = this._sentinel;
    this._sentinel = null;
    try {
      await s?.release();
    } catch {}
  }
}
