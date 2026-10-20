import {
  CONFIDENT_CLARITY,
  DEFAULT_INPUT_GAIN,
  NOISE_GATE_RMS,
  getAudioSupportIssue,
  isAudioRunning,
  setInputGain,
  startAudio,
  stopAudio,
} from "./audio.js";
import { createDrumView } from "./drumview.js";
import layout from "./layout.js";
import { describeFreq, midiToFreq } from "./notes.js";
import { StrikeDetector } from "./onset.js";
import { Session } from "./session.js";
import {
  SongGuide,
  bestTransposition,
  coverage,
  mapSong,
  parseNote,
  parseSong,
} from "./songguide.js";

const A4_DEFAULT = 440;
const DASH = "-";
const MIN_A4 = 400;
const MAX_A4 = 480;
const A4_QUICK_CHOICES = [432, 440];
const MIN_GATE = 0.005;
const MAX_GATE = 0.1;
const MIN_INPUT_GAIN = 1;
const MAX_INPUT_GAIN = 30;
const MAX_DEBUG_LINES = 500;
const ONSET_PEAK_WINDOW_MS = 600;

const STORAGE_KEYS = {
  a4: "leafdrum.a4",
  gate: "leafdrum.gate",
  inputGain: "leafdrum.inputGain",
  diagnostics: "leafdrum.diagnostics",
  drumMap: "leafdrum.drumMap",
  song: "leafdrum.song",
};

const SUPPORT_MESSAGES = {
  "insecure-context":
    "Microphone access needs HTTPS or localhost. Open this page through a secure address, then reload.",
  unsupported: "This browser does not support microphone capture.",
};

function readStored(key, isValid) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const value = JSON.parse(raw);
    return isValid(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be blocked (private mode, denied cookies); settings just do not persist.
  }
}

function removeStored(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage can be blocked; there is nothing else to clear.
  }
}

let a4 = A4_DEFAULT;
let gate = NOISE_GATE_RMS;
let inputGain = DEFAULT_INPUT_GAIN;
let showDiagnostics = false;

const storedA4 = readStored(
  STORAGE_KEYS.a4,
  (value) => typeof value === "number" && value >= MIN_A4 && value <= MAX_A4,
);
if (storedA4 !== null) a4 = storedA4;

const storedGate = readStored(
  STORAGE_KEYS.gate,
  (value) => typeof value === "number" && value >= MIN_GATE && value <= MAX_GATE,
);
if (storedGate !== null) gate = storedGate;

const storedInputGain = readStored(
  STORAGE_KEYS.inputGain,
  (value) => typeof value === "number" && value >= MIN_INPUT_GAIN && value <= MAX_INPUT_GAIN,
);
if (storedInputGain !== null) inputGain = storedInputGain;
setInputGain(inputGain);

const storedDiagnostics = readStored(STORAGE_KEYS.diagnostics, (value) => typeof value === "boolean");
if (storedDiagnostics !== null) showDiagnostics = storedDiagnostics;

const detector = new StrikeDetector({ a4, gate });
const session = new Session(layout.tongues.length);

let songNotes = [];
let songShift = 0;
let songFrom = 1;
let songTo = 1;
let activeGuide = null;
let guideMode = false;

const app = document.getElementById("app");

app.innerHTML = `
  <header class="app-header">
    <h1>Leaf Drum Note Finder</h1>
    <button id="settings-toggle" class="settings-button" type="button" aria-expanded="false" aria-controls="settings">Settings</button>
  </header>
  <section id="settings" class="settings hidden" aria-labelledby="settings-title">
    <h2 id="settings-title" class="section-title">Settings</h2>
    <div class="setting">
      <label for="a4">Reference pitch A4 (Hz, 400-480)</label>
      <div class="a4-row">
        <input id="a4" type="number" min="400" max="480" step="1" inputmode="decimal">
        <div id="a4-quick" class="a4-quick"></div>
      </div>
    </div>
    <div class="setting">
      <label for="input-gain">Input gain: <span id="input-gain-value" class="setting-value"></span></label>
      <input id="input-gain" type="range" min="1" max="30" step="1">
      <p class="setting-hint">Amplifies a quiet microphone. Raise it if strikes are missed; lower it if the readout is unstable.</p>
    </div>
    <div class="setting">
      <label for="gate">Sensitivity (noise gate): <span id="gate-value" class="setting-value"></span></label>
      <input id="gate" type="range" min="0" max="100" step="1">
      <p class="setting-hint">Lower picks up quieter strikes. Raise it in a noisy room.</p>
    </div>
    <div class="setting checkbox-setting">
      <input id="diagnostics" type="checkbox">
      <label for="diagnostics">Show diagnostics</label>
    </div>
    <div class="debug-actions">
      <button id="copy-debug-log" class="button secondary" type="button">Copy debug log</button>
      <button id="clear-debug-log" class="button secondary" type="button">Clear log</button>
    </div>
  </section>
  <p id="status" class="status" role="status">Tap Start to allow the microphone.</p>
  <section class="readout">
    <h2 class="section-title">Microphone</h2>
    <div id="note" class="note">-</div>
    <div class="details">
      <span id="hz" class="detail">-</span>
      <span id="cents" class="detail">-</span>
    </div>
    <div class="meter" aria-hidden="true">
      <span id="meter-marker" class="meter-marker hidden"></span>
    </div>
    <div class="meter-scale" aria-hidden="true">
      <span>-50</span><span>0</span><span>+50</span>
    </div>
  </section>
  <p id="diagnostics-line" class="diagnostics hidden"></p>
  <section class="drum" aria-labelledby="drum-title">
    <h2 id="drum-title" class="section-title">Your drum</h2>
    <div id="drum-view" class="drum-view"></div>
    <p id="drum-caption" class="drum-caption" aria-live="polite"></p>
    <form id="manual-note-form" class="manual-note">
      <label for="manual-note">Set note manually</label>
      <div class="manual-note-row">
        <input id="manual-note" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="E4">
        <button class="button secondary" type="submit">Set</button>
      </div>
    </form>
  </section>
  <section class="song-guide" aria-labelledby="song-guide-title">
    <details>
      <summary id="song-guide-title">Song guide</summary>
      <div class="song-guide-body">
        <label class="song-label" for="song-text">Paste notes, e.g. E4 G4 B4 - A4</label>
        <textarea id="song-text" rows="4" autocomplete="off" spellcheck="false" placeholder="Paste notes, e.g. E4 G4 B4 - A4"></textarea>
        <p id="song-parse-status" class="song-status" aria-live="polite"></p>
        <p id="song-coverage" class="song-status" aria-live="polite">Playable: 0 of 0 notes</p>
        <p id="song-missing" class="song-missing hidden"></p>
        <div class="song-shift-grid">
          <button id="song-best-key" class="button secondary song-wide" type="button">Find best key</button>
          <button id="song-shift-down" class="button secondary" type="button">Shift -1</button>
          <button id="song-shift-up" class="button secondary" type="button">Shift +1</button>
        </div>
        <p class="song-shift-line">Shift: <span id="song-shift-value">0</span> semitones</p>
        <p id="song-shift-status" class="song-status" aria-live="polite"></p>
        <div class="song-range">
          <label for="song-from">From note #<input id="song-from" type="number" min="1" step="1" inputmode="numeric"></label>
          <label for="song-to">To note #<input id="song-to" type="number" min="1" step="1" inputmode="numeric"></label>
        </div>
        <div class="song-options">
          <label><input id="song-skip-missing" type="checkbox" checked>Skip notes my drum can't play</label>
          <label><input id="song-any-octave" type="checkbox">Accept any octave</label>
        </div>
        <div class="song-actions">
          <button id="song-start" class="button primary" type="button">Start guide</button>
          <button id="song-clear" class="button secondary" type="button">Clear</button>
        </div>
        <div id="song-guide-controls" class="song-guide-controls hidden">
          <button id="song-skip" class="button secondary" type="button">Skip</button>
          <button id="song-back" class="button secondary" type="button">Back</button>
          <button id="song-restart" class="button secondary" type="button">Restart</button>
          <button id="song-exit" class="button secondary" type="button">Exit guide</button>
        </div>
      </div>
    </details>
  </section>
  <section id="sorted" class="sorted hidden">
    <h2 class="section-title">Sorted by pitch</h2>
    <div id="sorted-notes" class="sorted-notes"></div>
    <p id="sorted-summary" class="sorted-summary hidden"></p>
  </section>
  <p id="feedback" class="feedback" role="status">Tap Start, then strike a tongue.</p>
  <div class="controls">
    <button id="toggle" class="button primary" type="button">Start</button>
    <button id="reset" class="button secondary" type="button">Reset</button>
    <button id="copy" class="button secondary copy-button" type="button">Copy results</button>
  </div>
`;

const settingsToggle = document.getElementById("settings-toggle");
const settingsSection = document.getElementById("settings");
const a4Input = document.getElementById("a4");
const a4Quick = document.getElementById("a4-quick");
const inputGainSlider = document.getElementById("input-gain");
const inputGainValue = document.getElementById("input-gain-value");
const gateSlider = document.getElementById("gate");
const gateValue = document.getElementById("gate-value");
const diagnosticsCheckbox = document.getElementById("diagnostics");
const diagnosticsLine = document.getElementById("diagnostics-line");
const copyDebugLogButton = document.getElementById("copy-debug-log");
const clearDebugLogButton = document.getElementById("clear-debug-log");
const statusLine = document.getElementById("status");
const noteLine = document.getElementById("note");
const hzLine = document.getElementById("hz");
const centsLine = document.getElementById("cents");
const meterMarker = document.getElementById("meter-marker");
const drumContainer = document.getElementById("drum-view");
const drumCaption = document.getElementById("drum-caption");
const manualNoteForm = document.getElementById("manual-note-form");
const manualNoteInput = document.getElementById("manual-note");
const songTextarea = document.getElementById("song-text");
const songParseStatus = document.getElementById("song-parse-status");
const songCoverageLine = document.getElementById("song-coverage");
const songMissingLine = document.getElementById("song-missing");
const songShiftValue = document.getElementById("song-shift-value");
const songShiftStatus = document.getElementById("song-shift-status");
const songFromInput = document.getElementById("song-from");
const songToInput = document.getElementById("song-to");
const songSkipMissing = document.getElementById("song-skip-missing");
const songAnyOctave = document.getElementById("song-any-octave");
const songBestKeyButton = document.getElementById("song-best-key");
const songShiftDownButton = document.getElementById("song-shift-down");
const songShiftUpButton = document.getElementById("song-shift-up");
const songStartButton = document.getElementById("song-start");
const songClearButton = document.getElementById("song-clear");
const songGuideControls = document.getElementById("song-guide-controls");
const songSkipButton = document.getElementById("song-skip");
const songBackButton = document.getElementById("song-back");
const songRestartButton = document.getElementById("song-restart");
const songExitButton = document.getElementById("song-exit");
const sortedSection = document.getElementById("sorted");
const sortedNotes = document.getElementById("sorted-notes");
const sortedSummary = document.getElementById("sorted-summary");
const feedbackLine = document.getElementById("feedback");
const toggleButton = document.getElementById("toggle");
const resetButton = document.getElementById("reset");
const copyButton = document.getElementById("copy");

a4Quick.innerHTML = A4_QUICK_CHOICES.map(
  (value) =>
    `<button type="button" class="chip" data-a4="${value}" aria-pressed="false">${value}</button>`,
).join("");

let lastStrikeText = "";
let wakeLock = null;

const diagnosticsStats = {
  onsets: 0,
  ok: 0,
  failed: 0,
  tooFew: 0,
  inconsistent: 0,
  peakRms: 0,
};

function resetDiagnosticsStats() {
  diagnosticsStats.onsets = 0;
  diagnosticsStats.ok = 0;
  diagnosticsStats.failed = 0;
  diagnosticsStats.tooFew = 0;
  diagnosticsStats.inconsistent = 0;
  diagnosticsStats.peakRms = 0;
}

const debugLog = [];
let debugLogStart = null;
let pendingOnsetLogs = [];

function formatDebugOffset(offsetMs) {
  const tenths = Math.max(0, Math.round(offsetMs / 100));
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  const tenth = tenths % 10;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenth}`;
}

function addDebugLine(timeMs, text) {
  const entry = { offsetMs: debugLogStart === null ? 0 : timeMs - debugLogStart, text };
  debugLog.push(entry);
  if (debugLog.length > MAX_DEBUG_LINES) debugLog.shift();
  return entry;
}

function addDebugLineNow(text) {
  return addDebugLine(performance.now(), text);
}

function onsetPeakText(peakRms) {
  return `onset (peak rms ${peakRms.toFixed(3)})`;
}

function updateOnsetPeaks(frame) {
  if (pendingOnsetLogs.length === 0) return;
  for (const pending of pendingOnsetLogs) {
    if (frame.time <= pending.endTime && frame.rms > pending.peakRms) {
      pending.peakRms = frame.rms;
      pending.entry.text = onsetPeakText(pending.peakRms);
    }
  }
  pendingOnsetLogs = pendingOnsetLogs.filter((pending) => frame.time <= pending.endTime);
}

function debugLogText() {
  const recorded = session.sortedByPitch().length;
  const header = [
    document.title,
    `Date/time: ${new Date().toLocaleString()}`,
    `User agent: ${navigator.userAgent}`,
    `Input gain: ${inputGain}x`,
    `Gate: ${gate.toFixed(3)}`,
    `A4: ${a4} Hz`,
    "minFreq: 60 Hz",
    `Recorded tongues: ${recorded} of ${layout.tongues.length}`,
  ];
  const lines = debugLog.map(
    (entry) => `${formatDebugOffset(entry.offsetMs)} ${entry.text}`,
  );
  return [...header, "", ...lines].join("\n");
}

function persistSettings() {
  writeStored(STORAGE_KEYS.a4, a4);
  writeStored(STORAGE_KEYS.gate, gate);
  writeStored(STORAGE_KEYS.inputGain, inputGain);
  writeStored(STORAGE_KEYS.diagnostics, showDiagnostics);
}

function isStoredSlot(record) {
  return (
    record !== null &&
    typeof record === "object" &&
    Number.isInteger(record.midi) &&
    typeof record.name === "string" &&
    Number.isInteger(record.octave) &&
    typeof record.label === "string" &&
    Number.isFinite(record.cents) &&
    Number.isFinite(record.freq)
  );
}

function persistDrumMap() {
  writeStored(STORAGE_KEYS.drumMap, session.slots);
}

function clearDrumMap() {
  removeStored(STORAGE_KEYS.drumMap);
}

function restoreDrumMap() {
  const stored = readStored(STORAGE_KEYS.drumMap, Array.isArray);
  if (stored === null) return;
  const limit = Math.min(stored.length, session.leafCount);
  for (let index = 0; index < limit; index += 1) {
    if (!isStoredSlot(stored[index])) continue;
    session.selectSlot(index);
    session.addStrike(stored[index]);
  }
  persistDrumMap();
}

function gateToSlider(gateHz) {
  const ratio = Math.log(gateHz / MIN_GATE) / Math.log(MAX_GATE / MIN_GATE);
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

function sliderToGate(position) {
  return MIN_GATE * Math.pow(MAX_GATE / MIN_GATE, position / 100);
}

function setFeedback(text) {
  feedbackLine.textContent = text;
}

function clearReadout() {
  noteLine.textContent = DASH;
  hzLine.textContent = DASH;
  centsLine.textContent = DASH;
  meterMarker.classList.add("hidden");
}

function showReading(reading) {
  const confident =
    reading.freq !== null &&
    reading.clarity >= CONFIDENT_CLARITY &&
    reading.rms >= gate;

  if (!confident) {
    clearReadout();
    return;
  }

  const note = describeFreq(reading.freq, a4);
  const sign = note.cents >= 0 ? "+" : "-";
  noteLine.textContent = note.label;
  hzLine.textContent = `${note.freq.toFixed(1)} Hz`;
  centsLine.textContent = `${sign}${Math.abs(note.cents).toFixed(1)} cents`;
  meterMarker.classList.remove("hidden");
  meterMarker.style.left = `${note.cents + 50}%`;
}

function updateDiagnostics(frame) {
  if (!showDiagnostics) return;
  const parts = [
    `rms ${frame.rms.toFixed(3)}`,
    `peak rms ${diagnosticsStats.peakRms.toFixed(3)}`,
    `gain ${inputGain}x`,
    `clarity ${frame.clarity.toFixed(2)}`,
    `gate ${gate.toFixed(3)}`,
    `onsets ${diagnosticsStats.onsets} | ok ${diagnosticsStats.ok} | failed ${diagnosticsStats.failed} (too-few ${diagnosticsStats.tooFew}, inconsistent ${diagnosticsStats.inconsistent})`,
  ];
  if (lastStrikeText) parts.push(lastStrikeText);
  diagnosticsLine.textContent = parts.join(" | ");
}

function updateDrumCaption() {
  if (session.activeSlot === null) {
    drumCaption.textContent = "All tongues recorded.";
    return;
  }
  const tongue = layout.tongues[session.activeSlot];
  drumCaption.textContent = `Play: ${tongue.label} (${session.activeSlot + 1} of ${layout.tongues.length})`;
}

function updateManualNoteForm() {
  const visible = !guideMode && session.activeSlot !== null;
  manualNoteForm.classList.toggle("hidden", !visible);
  if (!visible) manualNoteInput.value = "";
}

function renderDrum() {
  drumView.update();
  if (!guideMode) updateDrumCaption();
  updateManualNoteForm();
  updateSongCoverage();
}

function summaryText(sorted) {
  const count = sorted.length;
  const lowest = sorted[0].label;
  const highest = sorted[count - 1].label;
  if (count === 1) return `1 note, ${lowest}`;
  return `${count} notes, ${lowest} to ${highest}`;
}

function renderSorted() {
  const sorted = session.sortedByPitch();
  if (sorted.length === 0) {
    sortedSection.classList.add("hidden");
    sortedNotes.innerHTML = "";
    sortedSummary.classList.add("hidden");
    sortedSummary.textContent = "";
    return;
  }

  sortedSection.classList.remove("hidden");
  sortedNotes.innerHTML = sorted
    .map((slot) => `<span class="sorted-note">${slot.label}</span>`)
    .join("");

  if (sorted.length === session.leafCount) {
    sortedSummary.textContent = summaryText(sorted);
    sortedSummary.classList.remove("hidden");
  } else {
    sortedSummary.classList.add("hidden");
    sortedSummary.textContent = "";
  }
}

function availableDrumMidis() {
  return session.slots.filter((slot) => slot !== null).map((slot) => slot.midi);
}

function drumMapMidis() {
  return session.slots.map((slot) => (slot === null ? null : slot.midi));
}

function updateSongCoverage() {
  const result = coverage(songNotes, availableDrumMidis(), songShift);
  songCoverageLine.textContent = `Playable: ${result.playable} of ${result.total} notes`;

  if (result.missing.length === 0) {
    songMissingLine.textContent = "";
    songMissingLine.classList.add("hidden");
    return;
  }

  const missing = result.missing
    .map(({ name, count }) => (count > 1 ? `${name} x${count}` : name))
    .join(", ");
  songMissingLine.textContent = `Missing: ${missing}`;
  songMissingLine.classList.remove("hidden");
}

function updateSongShiftDisplay() {
  songShiftValue.textContent = String(songShift);
}

function shiftText(shift) {
  return `shifted by ${shift} semitone${Math.abs(shift) === 1 ? "" : "s"}`;
}

function announceShift() {
  songShiftStatus.textContent = shiftText(songShift);
}

function updateSongParseStatus(errors) {
  const count = songNotes.length;
  let text = `${count} note${count === 1 ? "" : "s"} read.`;
  if (errors.length > 0) {
    const tokens = [...new Set(errors.map((error) => error.token))];
    text += ` Unreadable: ${tokens.join(", ")}.`;
  }
  songParseStatus.textContent = text;
}

function persistSong() {
  writeStored(STORAGE_KEYS.song, {
    text: songTextarea.value,
    shift: songShift,
    from: songFrom,
    to: songTo,
  });
}

function setSongRangeToWhole() {
  const total = songNotes.length;
  songFrom = 1;
  songTo = total > 0 ? total : 1;
  songFromInput.value = total > 0 ? "1" : "";
  songToInput.value = total > 0 ? String(total) : "";
  songFromInput.max = total > 0 ? String(total) : "";
  songToInput.max = total > 0 ? String(total) : "";
}

function clampSongRange() {
  const total = songNotes.length;
  if (total === 0) {
    setSongRangeToWhole();
    return;
  }

  let from = Number(songFromInput.value);
  let to = Number(songToInput.value);
  if (!Number.isInteger(from) || from < 1) from = 1;
  if (!Number.isInteger(to) || to < 1) to = total;
  if (from > total) from = 1;
  if (to > total) to = total;
  if (from > to) {
    from = 1;
    to = total;
  }

  songFrom = from;
  songTo = to;
  songFromInput.value = String(from);
  songToInput.value = String(to);
  songFromInput.max = String(total);
  songToInput.max = String(total);
}

function applySongText({ resetRange = false, persist = true } = {}) {
  const { notes, errors } = parseSong(songTextarea.value);
  songNotes = notes;

  if (resetRange) setSongRangeToWhole();
  else clampSongRange();

  updateSongParseStatus(errors);
  updateSongCoverage();
  if (persist) persistSong();
}

function loadSongState() {
  const stored = readStored(
    STORAGE_KEYS.song,
    (value) => value !== null && typeof value === "object" && typeof value.text === "string",
  );

  if (stored === null) {
    songTextarea.value = "";
    updateSongShiftDisplay();
    applySongText({ resetRange: true, persist: false });
    return;
  }

  songTextarea.value = stored.text;
  songShift = Number.isInteger(stored.shift) ? stored.shift : 0;
  songFrom = Number.isInteger(stored.from) ? stored.from : 1;
  songTo = Number.isInteger(stored.to) ? stored.to : 1;
  songFromInput.value = String(songFrom);
  songToInput.value = String(songTo);
  updateSongShiftDisplay();
  applySongText({ resetRange: false, persist: false });
  if (songShift !== 0) announceShift();
  else songShiftStatus.textContent = "";
}

function findBestKey() {
  if (songNotes.length === 0) {
    setFeedback("Paste notes first.");
    return;
  }

  const available = availableDrumMidis();
  if (available.length === 0) {
    setFeedback("Record some tongues first.");
    return;
  }

  const best = bestTransposition(songNotes, available);
  songShift = best.semitones;
  updateSongShiftDisplay();
  updateSongCoverage();
  announceShift();
  persistSong();
}

function adjustSongShift(delta) {
  if (songNotes.length === 0) {
    setFeedback("Paste notes first.");
    return;
  }

  songShift += delta;
  updateSongShiftDisplay();
  updateSongCoverage();
  announceShift();
  persistSong();
}

function guideTargetLabel() {
  const current = activeGuide ? activeGuide.current() : null;
  if (!current) return "no tongue";
  if (current.indices.length === 0) return "no playable tongue";
  return layout.tongues[current.indices[0]].label;
}

function setGuideMode(on) {
  guideMode = on;
  songTextarea.disabled = on;
  songBestKeyButton.disabled = on;
  songShiftDownButton.disabled = on;
  songShiftUpButton.disabled = on;
  songFromInput.disabled = on;
  songToInput.disabled = on;
  songSkipMissing.disabled = on;
  songAnyOctave.disabled = on;
  songClearButton.disabled = on;
  resetButton.disabled = on;
  songStartButton.classList.toggle("hidden", on);
  songGuideControls.classList.toggle("hidden", !on);
  updateManualNoteForm();
}

function updateGuideView() {
  if (!activeGuide) return;
  const current = activeGuide.current();

  if (!current) {
    drumView.setGuideIndices([]);
    drumCaption.textContent = "Finished";
    return;
  }

  drumView.setGuideIndices(current.indices);
  const next = activeGuide.peekNext();
  const total = activeGuide.steps.length;
  const nextText = next ? `  next: ${next.name}` : "";
  drumCaption.textContent = `Play: ${current.name} (note ${current.n + 1} of ${total})${nextText}`;
}

function startGuide() {
  if (songNotes.length === 0) {
    setFeedback("Paste notes first.");
    return;
  }

  clampSongRange();
  persistSong();
  const steps = mapSong(songNotes, drumMapMidis(), songShift);
  activeGuide = new SongGuide(steps, {
    skipMissing: songSkipMissing.checked,
    anyOctave: songAnyOctave.checked,
    start: songFrom - 1,
    end: songTo,
  });

  setGuideMode(true);
  updateGuideView();
  if (activeGuide.done) setFeedback("Finished");
  else setFeedback(`Guide started at note ${activeGuide.current().n + 1}.`);
}

function exitGuide() {
  activeGuide = null;
  setGuideMode(false);
  drumView.setGuideIndices(null);
  renderDrum();
  setFeedback("Guide ended. Scan mode is active.");
}

function skipGuide() {
  if (!activeGuide) return;
  activeGuide.skip();
  updateGuideView();
  setFeedback(activeGuide.done ? "Finished" : "Skipped.");
}

function backGuide() {
  if (!activeGuide) return;
  activeGuide.back();
  updateGuideView();
  setFeedback("Back one note.");
}

function restartGuide() {
  if (!activeGuide) return;
  activeGuide.restart();
  updateGuideView();
  setFeedback(activeGuide.done ? "Finished" : "Restarted.");
}

function clearSong() {
  if (guideMode) return;
  songTextarea.value = "";
  songNotes = [];
  songShift = 0;
  songFrom = 1;
  songTo = 1;
  songFromInput.value = "";
  songToInput.value = "";
  songFromInput.max = "";
  songToInput.max = "";
  updateSongShiftDisplay();
  songShiftStatus.textContent = "";
  songParseStatus.textContent = "";
  updateSongCoverage();
  removeStored(STORAGE_KEYS.song);
  setFeedback("Song guide cleared.");
}

function syncSettingsControls() {
  a4Input.value = String(a4);
  for (const button of a4Quick.querySelectorAll(".chip")) {
    const active = Number(button.dataset.a4) === a4;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  inputGainSlider.value = String(inputGain);
  inputGainValue.textContent = `${inputGain}x`;
  gateSlider.value = String(gateToSlider(gate));
  gateValue.textContent = gate.toFixed(3);
  diagnosticsCheckbox.checked = showDiagnostics;
  diagnosticsLine.classList.toggle("hidden", !showDiagnostics);
}

function requestA4(newA4) {
  if (!Number.isFinite(newA4) || newA4 < MIN_A4 || newA4 > MAX_A4) {
    syncSettingsControls();
    return;
  }
  if (newA4 === a4) {
    syncSettingsControls();
    return;
  }

  const recordedCount = session.sortedByPitch().length;
  if (recordedCount > 0) {
    const plural = recordedCount === 1 ? "note" : "notes";
    const confirmed = window.confirm(
      `Changing the reference pitch clears the ${recordedCount} recorded ${plural}, because they were named using the old reference. Continue?`,
    );
    if (!confirmed) {
      syncSettingsControls();
      return;
    }
  }

  a4 = newA4;
  detector.setOptions({ a4 });
  addDebugLineNow(`settings: A4 ${a4} Hz`);
  if (recordedCount > 0) {
    session.reset();
    clearDrumMap();
    renderDrum();
    renderSorted();
    setFeedback("Recorded tongues were cleared after the reference pitch change.");
  }
  syncSettingsControls();
  persistSettings();
}

function resultsText() {
  return layout.tongues
    .map((tongue, index) => {
      const slot = session.slots[index];
      const prefix = `${tongue.groupName}, ${tongue.size}: `;
      if (slot === null) return `${prefix}not recorded`;
      const sign = slot.cents >= 0 ? "+" : "-";
      return `${prefix}${slot.label} (${slot.freq.toFixed(1)} Hz, ${sign}${Math.abs(slot.cents).toFixed(1)} cents)`;
    })
    .join("\n");
}

function handleStrikeEvent(event) {
  if (event.type === "onset") {
    diagnosticsStats.onsets += 1;
    diagnosticsStats.peakRms = 0;
    const entry = addDebugLine(event.time, onsetPeakText(0));
    pendingOnsetLogs.push({
      entry,
      endTime: event.time + ONSET_PEAK_WINDOW_MS,
      peakRms: 0,
    });
    setFeedback("Listening to that strike...");
    return;
  }

  if (event.type === "strike-failed") {
    diagnosticsStats.failed += 1;
    if (event.reason === "inconsistent") {
      diagnosticsStats.inconsistent += 1;
    } else {
      diagnosticsStats.tooFew += 1;
    }
    addDebugLine(event.time, `FAILED ${event.reason}`);
    lastStrikeText = `last strike: failed (${event.reason})`;
    setFeedback(
      guideMode
        ? "Could not read, try again"
        : event.reason === "inconsistent"
          ? "Unclear note (two tongues at once, or the previous sound still ringing). Let it fade and try again."
          : "Could not read that strike, try again",
    );
    return;
  }

  diagnosticsStats.ok += 1;
  lastStrikeText = `last strike: ${event.readingsUsed}/${event.readingsTotal} readings, ${event.freq.toFixed(1)} Hz`;
  const record = describeFreq(event.freq, a4);
  const targetLabel = guideMode
    ? guideTargetLabel()
    : session.activeSlot === null
      ? "no empty tongue"
      : layout.tongues[session.activeSlot].label;
  const centsSign = record.cents >= 0 ? "+" : "-";
  addDebugLine(
    event.time,
    `strike ${targetLabel} -> ${record.label} ${record.freq.toFixed(1)} Hz ${centsSign}${Math.abs(record.cents).toFixed(1)} cents (${event.readingsUsed}/${event.readingsTotal} readings)`,
  );

  if (guideMode) {
    if (!activeGuide) {
      setFeedback("Finished");
      return;
    }
    const guideResult = activeGuide.heard(event.midi);
    if (guideResult.result === "wrong") {
      setFeedback(`Heard ${guideResult.heardName}, expected ${guideResult.expected.name}`);
      return;
    }
    updateGuideView();
    setFeedback(activeGuide.done ? "Finished" : "Correct");
    return;
  }

  const result = session.addStrike(record);

  if (result.status === "filled") {
    persistDrumMap();
    setFeedback(`Recorded ${record.label} on ${layout.tongues[result.slot].label}`);
    renderDrum();
    renderSorted();
    return;
  }

  if (result.status === "duplicate") {
    addDebugLine(event.time, `duplicate of ${layout.tongues[result.existingSlot].label}`);
    setFeedback(`Already recorded on ${layout.tongues[result.existingSlot].label}`);
    return;
  }

  addDebugLine(event.time, "all tongues recorded");
  setFeedback("All tongues recorded. Tap a tongue to re-record, or press Reset.");
}

function handleAudioFrame(frame) {
  showReading(frame);
  const events = detector.push({
    time: frame.time,
    rms: frame.rms,
    freq: frame.freq,
    clarity: frame.clarity,
  });
  for (const event of events) {
    handleStrikeEvent(event);
  }
  updateOnsetPeaks(frame);
  if (frame.rms > diagnosticsStats.peakRms) diagnosticsStats.peakRms = frame.rms;
  updateDiagnostics(frame);
}

function acquireWakeLock() {
  try {
    if (navigator.wakeLock && typeof navigator.wakeLock.request === "function") {
      navigator.wakeLock
        .request("screen")
        .then((lock) => {
          wakeLock = lock;
        })
        .catch(() => {
          wakeLock = null;
        });
    }
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  const lock = wakeLock;
  wakeLock = null;
  if (lock && typeof lock.release === "function") {
    try {
      Promise.resolve(lock.release()).catch(() => {});
    } catch {
      // Ignore; the lock is already gone.
    }
  }
}

function stopListening(message) {
  const wasRunning = isAudioRunning();
  stopAudio();
  releaseWakeLock();
  clearReadout();
  diagnosticsLine.textContent = "";
  toggleButton.textContent = "Start";
  statusLine.textContent = message;
  if (wasRunning) {
    pendingOnsetLogs = [];
    addDebugLineNow("Stop");
  }
}

function describeAudioError(error) {
  switch (error && error.name) {
    case "NotAllowedError":
      return "Microphone permission was denied. Enable the microphone for this site in your browser settings, then try again.";
    case "NotFoundError":
      return "No microphone was found on this device.";
    case "NotReadableError":
      return "The microphone is in use by another app. Close that app and try again.";
    default:
      return `Could not start the microphone${error && error.message ? `: ${error.message}` : "."}`;
  }
}

const drumView = createDrumView(layout, session, {
  onSelect() {
    manualNoteInput.value = "";
    updateDrumCaption();
    updateManualNoteForm();
  },
});
drumContainer.append(drumView.element);

settingsToggle.addEventListener("click", () => {
  const nowHidden = settingsSection.classList.toggle("hidden");
  settingsToggle.setAttribute("aria-expanded", String(!nowHidden));
});

a4Input.addEventListener("change", () => {
  requestA4(Number(a4Input.value));
});

a4Quick.addEventListener("click", (event) => {
  const button = event.target.closest(".chip");
  if (button) requestA4(Number(button.dataset.a4));
});

inputGainSlider.addEventListener("input", () => {
  inputGain = Number(inputGainSlider.value);
  setInputGain(inputGain);
  inputGainValue.textContent = `${inputGain}x`;
  addDebugLineNow(`settings: gain ${inputGain}x`);
  persistSettings();
});

gateSlider.addEventListener("input", () => {
  gate = sliderToGate(Number(gateSlider.value));
  detector.setOptions({ gate });
  gateValue.textContent = gate.toFixed(3);
  addDebugLineNow(`settings: gate ${gate.toFixed(3)}`);
  persistSettings();
});

diagnosticsCheckbox.addEventListener("change", () => {
  showDiagnostics = diagnosticsCheckbox.checked;
  diagnosticsLine.classList.toggle("hidden", !showDiagnostics);
  persistSettings();
});

copyDebugLogButton.addEventListener("click", async () => {
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
    setFeedback("Could not copy");
    return;
  }
  try {
    await navigator.clipboard.writeText(debugLogText());
    setFeedback("Copied");
  } catch {
    setFeedback("Could not copy");
  }
});

clearDebugLogButton.addEventListener("click", () => {
  debugLog.length = 0;
  pendingOnsetLogs = [];
  setFeedback("Debug log cleared.");
});

copyButton.addEventListener("click", async () => {
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") return;
  try {
    await navigator.clipboard.writeText(resultsText());
    setFeedback("Copied results to the clipboard.");
  } catch {
    // Clipboard access can be denied; fail silently.
  }
});

toggleButton.addEventListener("click", async () => {
  if (isAudioRunning()) {
    stopListening("Stopped. Recorded tongues are kept.");
    return;
  }

  toggleButton.disabled = true;
  try {
    resetDiagnosticsStats();
    detector.reset();
    await startAudio(handleAudioFrame);
    debugLogStart = performance.now();
    pendingOnsetLogs = [];
    addDebugLine(debugLogStart, "Start");
    acquireWakeLock();
    toggleButton.textContent = "Stop";
    statusLine.textContent = "Listening. Strike each tongue one at a time.";
    setFeedback("Listening");
  } catch (error) {
    stopListening(describeAudioError(error));
  } finally {
    toggleButton.disabled = false;
  }
});

manualNoteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (guideMode) return;
  if (session.activeSlot === null) {
    updateManualNoteForm();
    setFeedback("All tongues recorded.");
    return;
  }

  const midi = parseNote(manualNoteInput.value.trim());
  if (midi === null) {
    setFeedback("Enter a note like E4.");
    manualNoteInput.select();
    return;
  }

  const record = describeFreq(midiToFreq(midi, a4), a4);
  const result = session.addStrike(record);

  if (result.status === "filled") {
    persistDrumMap();
    manualNoteInput.value = "";
    renderDrum();
    renderSorted();
    setFeedback(`Set ${record.label} on ${layout.tongues[result.slot].label}`);
    if (session.activeSlot !== null) manualNoteInput.focus();
    return;
  }

  if (result.status === "duplicate") {
    setFeedback(`Already recorded on ${layout.tongues[result.existingSlot].label}`);
    manualNoteInput.select();
    return;
  }

  updateManualNoteForm();
  setFeedback("All tongues recorded.");
});

songTextarea.addEventListener("input", () => {
  applySongText({ resetRange: true });
});

songFromInput.addEventListener("change", () => {
  clampSongRange();
  persistSong();
});

songToInput.addEventListener("change", () => {
  clampSongRange();
  persistSong();
});

songBestKeyButton.addEventListener("click", findBestKey);
songShiftDownButton.addEventListener("click", () => adjustSongShift(-1));
songShiftUpButton.addEventListener("click", () => adjustSongShift(1));
songStartButton.addEventListener("click", startGuide);
songClearButton.addEventListener("click", clearSong);
songSkipButton.addEventListener("click", skipGuide);
songBackButton.addEventListener("click", backGuide);
songRestartButton.addEventListener("click", restartGuide);
songExitButton.addEventListener("click", exitGuide);

resetButton.addEventListener("click", () => {
  session.reset();
  clearDrumMap();
  renderDrum();
  renderSorted();
  setFeedback("Cleared all tongues.");
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && isAudioRunning()) {
    stopListening("Audio stopped because the page was hidden. Tap Start to continue.");
  }
});

const supportIssue = getAudioSupportIssue();
if (supportIssue) {
  toggleButton.disabled = true;
  statusLine.textContent = SUPPORT_MESSAGES[supportIssue];
}

restoreDrumMap();
loadSongState();
renderDrum();
renderSorted();
syncSettingsControls();
clearReadout();
