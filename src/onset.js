// Strike (onset) detection and pitch voting for a ringing instrument.
//
// A tongue drum leaf keeps ringing for seconds, so a new hit often lands on top of
// the previous note. This module:
//   1. detects a new strike as a sudden RISE in loudness (not a loudness level),
//   2. waits until the attack noise has passed,
//   3. collects confident pitch readings for a short window,
//   4. votes: the median reading wins, outliers (octave jumps, leakage from the
//      previous note) are ignored.
//
// Pure logic, no browser APIs. All times are in MILLISECONDS.
//
// Usage:
//   const det = new StrikeDetector({ a4: 440 });
//   // once per analysis frame, with the output of audio.js / detectPitch:
//   const events = det.push({ time, rms, freq, clarity });   // freq may be null
//   for (const e of events) { ... }
//
// Events (returned as an array, usually empty):
//   { type: 'onset', time }
//   { type: 'strike', time, freq, midi, readingsUsed, readingsTotal }
//   { type: 'strike-failed', time, reason }  // 'too-few-readings' | 'inconsistent'
// `time` on strike / strike-failed is the time of the onset they belong to.

export const DEFAULTS = {
  gate: 0.02, //             a strike must be at least this loud (RMS)
  riseRatio: 1.5, //         ...and at least this many times louder than the quietest
  lookbackMs: 100, //        ...frame within this lookback (a decaying ring never rises)
  refractoryMs: 250, //      no new onset this soon after the previous one
  captureDelayMs: 120, //    skip the attack transient
  captureWindowMs: 300, //   collect readings for this long
  minClarity: 0.5, //        a reading counts only if clarity >= this (noise is rejected
  //                          by the vote: scattered readings never agree)
  readingRmsFactor: 0.5, //  ...and rms >= gate * this (ring may fade below the gate)
  minReadings: 5, //         fewer confident readings than this: strike-failed
  minShare: 0.6, //          this share of readings must agree, else strike-failed
  inlierSemitones: 0.5, //   "agree" = within this many semitones of the median
  a4: 440, //                reference pitch (Hz)
};

const midiFloat = (freq, a4) => 69 + 12 * Math.log2(freq / a4);

function median(sorted) {
  const n = sorted.length;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Vote on a set of pitch readings.
 *
 * The note is decided by the MEDIAN reading, then readings within `inlierSemitones`
 * of it are kept and their median frequency is reported. This is robust to
 * outliers and, unlike voting on rounded notes, stable for a leaf tuned close to
 * the boundary between two notes (readings that jitter across the boundary still
 * agree on one frequency).
 *
 * @param {Array<{freq:number, clarity?:number}>} readings
 * @returns {{ok:true, freq:number, midi:number, readingsUsed:number, readingsTotal:number}
 *          |{ok:false, reason:string, readingsTotal:number}}
 */
export function voteReadings(readings, opts = {}) {
  const { a4, minReadings, minShare, inlierSemitones } = { ...DEFAULTS, ...opts };
  const total = readings.length;
  if (total < minReadings) return { ok: false, reason: 'too-few-readings', readingsTotal: total };

  const all = readings.map((r) => midiFloat(r.freq, a4)).sort((p, q) => p - q);
  const center = median(all);
  const inliers = all.filter((m) => Math.abs(m - center) <= inlierSemitones);
  if (inliers.length < minShare * total) {
    return { ok: false, reason: 'inconsistent', readingsTotal: total };
  }

  const m = median(inliers); // inliers is still sorted
  return {
    ok: true,
    freq: a4 * Math.pow(2, (m - 69) / 12),
    midi: Math.round(m),
    readingsUsed: inliers.length,
    readingsTotal: total,
  };
}

export class StrikeDetector {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.reset();
  }

  /** Change options at runtime (sensitivity slider, reference pitch, ...). */
  setOptions(partial) {
    Object.assign(this.options, partial);
  }

  /** Forget everything. Call when listening starts or restarts. */
  reset() {
    this.history = []; // recent { time, rms } frames
    this.lastOnset = -Infinity;
    this.capture = null; // { onsetTime, start, end, readings }
  }

  /**
   * Feed one analysis frame.
   * @param {{time:number, rms:number, freq?:number|null, clarity?:number}} frame
   * @returns {Array<object>} events
   */
  push({ time, rms, freq = null, clarity = 0 }) {
    const o = this.options;
    const events = [];

    // 1. Onset: loud enough, past the refractory period, and clearly RISING
    //    compared with the quietest recent frame.
    let onset = false;
    if (rms >= o.gate && time - this.lastOnset >= o.refractoryMs) {
      let quietest = Infinity;
      for (const h of this.history) {
        if (time - h.time <= o.lookbackMs && h.rms < quietest) quietest = h.rms;
      }
      if (quietest !== Infinity && rms >= o.riseRatio * quietest) onset = true;
    }

    if (onset) {
      // A new hit while still capturing the previous one: close the old capture
      // with what it has (this frame belongs to the new attack, not to the old note).
      if (this.capture) events.push(this._finish());
      this.lastOnset = time;
      events.push({ type: 'onset', time });
      const start = time + o.captureDelayMs;
      this.capture = { onsetTime: time, start, end: start + o.captureWindowMs, readings: [] };
    } else if (this.capture) {
      const c = this.capture;
      if (time >= c.end) {
        events.push(this._finish());
      } else if (
        time >= c.start &&
        freq != null &&
        clarity >= o.minClarity &&
        rms >= o.gate * o.readingRmsFactor
      ) {
        c.readings.push({ freq, clarity });
      }
    }

    // 2. Remember this frame for the next onset check.
    this.history.push({ time, rms });
    const cutoff = time - 2 * o.lookbackMs;
    while (this.history.length && this.history[0].time < cutoff) this.history.shift();

    return events;
  }

  _finish() {
    const c = this.capture;
    this.capture = null;
    const result = voteReadings(c.readings, this.options);
    if (!result.ok) return { type: 'strike-failed', time: c.onsetTime, reason: result.reason };
    return {
      type: 'strike',
      time: c.onsetTime,
      freq: result.freq,
      midi: result.midi,
      readingsUsed: result.readingsUsed,
      readingsTotal: result.readingsTotal,
    };
  }
}
