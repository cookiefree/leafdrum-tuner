// Song guide logic: turn a list of note names into a step-by-step guide for the drum.
//
// Pure logic, no DOM, no storage. The user supplies the notes (typed or pasted);
// nothing about any particular song lives in this repository.
//
// Typical flow:
//   const { notes, errors } = parseSong(text);          // "E4 G4 B4 | A4 - G4" -> MIDI numbers
//   const shift = bestTransposition(notes, drumMidis);  // optional: find a key that fits the drum
//   const steps = mapSong(notes, drumMap, shift.semitones);
//   const guide = new SongGuide(steps, { anyOctave: false });
//   guide.current()      -> the step to play now (highlight step.indices on the drum)
//   guide.heard(midi)    -> call on every detected strike; advances when it matches

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const MAX_SONG_NOTES = 2000;

/** MIDI number -> name with sharps and octave (60 -> "C4"). */
export function midiName(midi) {
  return NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

/**
 * Parse one note token such as "C4", "f#3", "Bb4", "E♭2". The octave is required.
 * Returns the MIDI number (C4 = 60), or null if the token is not a note.
 */
export function parseNote(token) {
  const m = /^([A-Ga-g])([#b\u266F\u266D]?)(\d)$/.exec(String(token).trim());
  if (!m) return null;
  let pc = LETTER_PC[m[1].toUpperCase()];
  if (m[2] === '#' || m[2] === '\u266F') pc += 1;
  else if (m[2] === 'b' || m[2] === '\u266D') pc -= 1;
  return 12 * (Number(m[3]) + 1) + pc;
}

const REST = /^(-|_|\.|r|R|rest)$/;

/**
 * Parse a song typed as text: notes separated by spaces, commas, semicolons,
 * bars or line breaks. Rests ("-", "_", ".", "r") are skipped. One note at a time
 * (no chords).
 * @returns {{notes:number[], errors:{token:string, position:number}[], rests:number}}
 */
export function parseSong(text) {
  const tokens = String(text ?? '').split(/[\s,;|]+/).filter(Boolean);
  const notes = [];
  const errors = [];
  let rests = 0;
  tokens.forEach((token, position) => {
    if (REST.test(token)) {
      rests++;
      return;
    }
    const midi = parseNote(token);
    if (midi === null) errors.push({ token, position });
    else if (notes.length < MAX_SONG_NOTES) notes.push(midi);
  });
  return { notes, errors, rests };
}

/**
 * How much of the song can the drum play after shifting it by `transpose` semitones?
 * @param {number[]} song        MIDI numbers
 * @param {Iterable<number>} available  MIDI numbers the drum has
 * @returns {{playable:number, total:number, missing:{name:string,count:number}[]}}
 */
export function coverage(song, available, transpose = 0) {
  const have = new Set(available);
  let playable = 0;
  const missing = new Map();
  for (const m of song) {
    const t = m + transpose;
    if (have.has(t)) playable++;
    else {
      const name = midiName(t);
      missing.set(name, (missing.get(name) || 0) + 1);
    }
  }
  return {
    playable,
    total: song.length,
    missing: [...missing]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

/**
 * Find the shift (in semitones) that lets the drum play the most notes of the song.
 * Ties go to the smaller shift, then to the lower one.
 */
export function bestTransposition(song, available, { min = -24, max = 24 } = {}) {
  const have = new Set(available);
  let best = null;
  for (let t = min; t <= max; t++) {
    const c = coverage(song, have, t);
    const better =
      best === null ||
      c.playable > best.playable ||
      (c.playable === best.playable &&
        (Math.abs(t) < Math.abs(best.semitones) || (Math.abs(t) === Math.abs(best.semitones) && t < best.semitones)));
    if (better) best = { semitones: t, ...c };
  }
  return best;
}

/**
 * Turn a song into steps for the drum.
 * @param {number[]} song
 * @param {Array<number|null>} drumMap  MIDI number per tongue index (null = unknown tongue)
 * @param {number} transpose  semitones to shift the song by
 * @returns {{n:number, midi:number, name:string, indices:number[], index:number|null, missing:boolean}[]}
 *   `indices` lists every tongue that plays the note (some drums repeat notes);
 *   `index` is the first of them, or null if the drum cannot play it.
 */
export function mapSong(song, drumMap, transpose = 0) {
  const byMidi = new Map();
  drumMap.forEach((midi, index) => {
    if (midi === null || midi === undefined) return;
    if (!byMidi.has(midi)) byMidi.set(midi, []);
    byMidi.get(midi).push(index);
  });
  return song.map((m, n) => {
    const midi = m + transpose;
    const indices = byMidi.get(midi) || [];
    return { n, midi, name: midiName(midi), indices, index: indices.length ? indices[0] : null, missing: indices.length === 0 };
  });
}

/** Step-by-step follow-along state machine. */
export class SongGuide {
  /**
   * @param {ReturnType<typeof mapSong>} steps
   * @param {object} [opts]
   * @param {boolean} [opts.skipMissing=true]  skip notes the drum cannot play
   * @param {boolean} [opts.anyOctave=false]   accept the right note in any octave
   * @param {number} [opts.start=0]            first step of the part to practise
   * @param {number} [opts.end=steps.length]   one past the last step
   */
  constructor(steps, { skipMissing = true, anyOctave = false, start = 0, end = steps.length } = {}) {
    this.steps = steps;
    this.skipMissing = skipMissing;
    this.anyOctave = anyOctave;
    this.start = Math.max(0, Math.min(start, steps.length));
    this.end = Math.max(this.start, Math.min(end, steps.length));
    this.restart();
  }

  restart() {
    this.pos = this.start;
    this.played = 0;
    this.skipped = 0;
    this.history = [];
    this._skipMissing();
  }

  get done() {
    return this.pos >= this.end;
  }

  /** The step to play now, or null when finished. */
  current() {
    return this.done ? null : this.steps[this.pos];
  }

  /** The step after the current one (for a "next" preview), or null. */
  peekNext() {
    let p = this.pos + 1;
    while (p < this.end && this.skipMissing && this.steps[p].missing) p++;
    return p < this.end ? this.steps[p] : null;
  }

  progress() {
    let missing = 0;
    for (let i = this.start; i < this.end; i++) if (this.steps[i].missing) missing++;
    return {
      index: this.pos - this.start,
      total: this.end - this.start,
      played: this.played,
      skipped: this.skipped,
      missingInRange: missing,
    };
  }

  /**
   * Report a detected strike (MIDI number of the note that was played).
   * @returns {{result:'correct'|'wrong'|'done', expected?:object, heardName?:string, next?:object|null}}
   */
  heard(midi) {
    const cur = this.current();
    if (!cur) return { result: 'done' };
    const ok = this.anyOctave ? ((midi - cur.midi) % 12 + 12) % 12 === 0 : midi === cur.midi;
    if (!ok) return { result: 'wrong', expected: cur, heardName: midiName(midi) };
    this._snapshot();
    this.played++;
    this.pos++;
    this._skipMissing();
    return { result: 'correct', next: this.current() };
  }

  /** Skip the current note. */
  skip() {
    if (this.done) return;
    this._snapshot();
    this.skipped++;
    this.pos++;
    this._skipMissing();
  }

  /** Undo the last advance (a correct note or a skip). */
  back() {
    const s = this.history.pop();
    if (!s) return;
    this.pos = s.pos;
    this.played = s.played;
    this.skipped = s.skipped;
  }

  _snapshot() {
    this.history.push({ pos: this.pos, played: this.played, skipped: this.skipped });
  }

  _skipMissing() {
    while (this.pos < this.end && this.skipMissing && this.steps[this.pos].missing) {
      this.skipped++;
      this.pos++;
    }
  }
}
