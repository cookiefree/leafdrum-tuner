import {
  CONFIDENT_CLARITY,
  NOISE_GATE_RMS,
  getAudioSupportIssue,
  isAudioRunning,
  startAudio,
  stopAudio,
} from "./audio.js";
import { describeFreq } from "./notes.js";
import { StrikeDetector } from "./onset.js";
import { Session } from "./session.js";

const A4_DEFAULT = 440;
const DASH = "-";
const QUICK_PRESETS = [8, 11, 15];
const PRESET_MIN = 5;
const PRESET_MAX = 15;
const MIN_LEAVES = 1;
const MAX_LEAVES = 30;
const MIN_A4 = 400;
const MAX_A4 = 480;
const A4_QUICK_CHOICES = [432, 440];
const MIN_GATE = 0.005;
const MAX_GATE = 0.1;

const STORAGE_KEYS = {
  a4: "leafdrum.a4",
  gate: "leafdrum.gate",
  diagnostics: "leafdrum.diagnostics",
  leafCount: "leafdrum.leafCount",
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

let a4 = A4_DEFAULT;
let gate = NOISE_GATE_RMS;
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

const storedDiagnostics = readStored(STORAGE_KEYS.diagnostics, (value) => typeof value === "boolean");
if (storedDiagnostics !== null) showDiagnostics = storedDiagnostics;

const detector = new StrikeDetector({ a4, gate });
const session = new Session(8);

const storedLeafCount = readStored(
  STORAGE_KEYS.leafCount,
  (value) => Number.isInteger(value) && value >= MIN_LEAVES && value <= MAX_LEAVES,
);
if (storedLeafCount !== null) session.setLeafCount(storedLeafCount);

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
      <label for="gate">Sensitivity (noise gate): <span id="gate-value" class="setting-value"></span></label>
      <input id="gate" type="range" min="0" max="100" step="1">
      <p class="setting-hint">Lower picks up quieter strikes. Raise it in a noisy room.</p>
    </div>
    <div class="setting checkbox-setting">
      <input id="diagnostics" type="checkbox">
      <label for="diagnostics">Show diagnostics</label>
    </div>
  </section>
  <p id="status" class="status" role="status">Tap Start to allow the microphone.</p>
  <section class="leaf-count" aria-labelledby="leaves-title">
    <h2 id="leaves-title" class="section-title">Leaves</h2>
    <div id="presets" class="presets"></div>
    <div class="count-inputs">
      <div class="field">
        <label for="preset-select">Other preset</label>
        <select id="preset-select"></select>
      </div>
      <div class="field">
        <label for="custom-count">Custom (1-30)</label>
        <input id="custom-count" type="number" min="1" max="30" inputmode="numeric">
      </div>
    </div>
  </section>
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
  <section>
    <h2 class="section-title">Leaves in playing order</h2>
    <div id="slots" class="slots"></div>
  </section>
  <section id="sorted" class="sorted hidden">
    <h2 class="section-title">Sorted by pitch</h2>
    <div id="sorted-notes" class="sorted-notes"></div>
    <p id="sorted-summary" class="sorted-summary hidden"></p>
  </section>
  <p id="feedback" class="feedback" role="status">Tap Start, then strike a leaf.</p>
  <div class="controls">
    <button id="toggle" class="button primary" type="button">Start</button>
    <button id="reset" class="button secondary" type="button">Reset</button>
  </div>
`;

const settingsToggle = document.getElementById("settings-toggle");
const settingsSection = document.getElementById("settings");
const a4Input = document.getElementById("a4");
const a4Quick = document.getElementById("a4-quick");
const gateSlider = document.getElementById("gate");
const gateValue = document.getElementById("gate-value");
const diagnosticsCheckbox = document.getElementById("diagnostics");
const diagnosticsLine = document.getElementById("diagnostics-line");
const statusLine = document.getElementById("status");
const presetsContainer = document.getElementById("presets");
const presetSelect = document.getElementById("preset-select");
const customInput = document.getElementById("custom-count");
const noteLine = document.getElementById("note");
const hzLine = document.getElementById("hz");
const centsLine = document.getElementById("cents");
const meterMarker = document.getElementById("meter-marker");
const slotsContainer = document.getElementById("slots");
const sortedSection = document.getElementById("sorted");
const sortedNotes = document.getElementById("sorted-notes");
const sortedSummary = document.getElementById("sorted-summary");
const feedbackLine = document.getElementById("feedback");
const toggleButton = document.getElementById("toggle");
const resetButton = document.getElementById("reset");

presetsContainer.innerHTML = QUICK_PRESETS.map(
  (count) =>
    `<button type="button" class="preset" data-count="${count}" aria-pressed="false">${count}</button>`,
).join("");

let presetOptions = "";
for (let count = PRESET_MIN; count <= PRESET_MAX; count += 1) {
  presetOptions += `<option value="${count}">${count}</option>`;
}
presetSelect.innerHTML = presetOptions;

a4Quick.innerHTML = A4_QUICK_CHOICES.map(
  (value) =>
    `<button type="button" class="chip" data-a4="${value}" aria-pressed="false">${value}</button>`,
).join("");

let lastStrikeText = "";
let wakeLock = null;

function persistSettings() {
  writeStored(STORAGE_KEYS.a4, a4);
  writeStored(STORAGE_KEYS.gate, gate);
  writeStored(STORAGE_KEYS.diagnostics, showDiagnostics);
  writeStored(STORAGE_KEYS.leafCount, session.leafCount);
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
    `clarity ${frame.clarity.toFixed(2)}`,
    `gate ${gate.toFixed(3)}`,
  ];
  if (lastStrikeText) parts.push(lastStrikeText);
  diagnosticsLine.textContent = parts.join(" | ");
}

function renderSlots() {
  slotsContainer.innerHTML = session.slots
    .map((slot, index) => {
      const isActive = index === session.activeSlot;
      const classes = `slot${isActive ? " active" : ""}${slot === null ? " empty" : ""}`;
      const activeAttr = isActive ? ' aria-current="true"' : "";
      if (slot === null) {
        return `<button type="button" class="${classes}" data-index="${index}"${activeAttr}>
            <span class="slot-leaf">Leaf ${index + 1}</span>
            <span class="slot-note">waiting</span>
          </button>`;
      }
      const sign = slot.cents >= 0 ? "+" : "-";
      return `<button type="button" class="${classes}" data-index="${index}"${activeAttr}>
          <span class="slot-leaf">Leaf ${index + 1}</span>
          <span class="slot-note">${slot.label}</span>
          <span class="slot-detail">${slot.freq.toFixed(1)} Hz</span>
          <span class="slot-cents">${sign}${Math.abs(slot.cents).toFixed(1)} cents</span>
        </button>`;
    })
    .join("");
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

function syncCountControls() {
  for (const button of presetsContainer.querySelectorAll(".preset")) {
    const active = Number(button.dataset.count) === session.leafCount;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  presetSelect.value =
    session.leafCount >= PRESET_MIN && session.leafCount <= PRESET_MAX
      ? String(session.leafCount)
      : "";
  customInput.value = String(session.leafCount);
}

function syncSettingsControls() {
  a4Input.value = String(a4);
  for (const button of a4Quick.querySelectorAll(".chip")) {
    const active = Number(button.dataset.a4) === a4;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  gateSlider.value = String(gateToSlider(gate));
  gateValue.textContent = gate.toFixed(3);
  diagnosticsCheckbox.checked = showDiagnostics;
  diagnosticsLine.classList.toggle("hidden", !showDiagnostics);
}

function requestLeafCount(newCount) {
  if (!Number.isInteger(newCount) || newCount < MIN_LEAVES || newCount > MAX_LEAVES) {
    syncCountControls();
    return;
  }
  if (newCount === session.leafCount) {
    syncCountControls();
    return;
  }

  const dropped = session.wouldDrop(newCount);
  if (dropped.length > 0) {
    const labels = dropped.map((slot) => slot.label).join(", ");
    const plural = dropped.length === 1 ? "note" : "notes";
    const confirmed = window.confirm(
      `Changing to ${newCount} leaves will drop ${dropped.length} recorded ${plural} (${labels}). Continue?`,
    );
    if (!confirmed) {
      syncCountControls();
      return;
    }
  }

  session.setLeafCount(newCount);
  renderSlots();
  renderSorted();
  syncCountControls();
  persistSettings();
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
  if (recordedCount > 0) {
    session.reset();
    renderSlots();
    renderSorted();
    setFeedback("Recorded leaves were cleared after the reference pitch change.");
  }
  syncSettingsControls();
  persistSettings();
}

function handleStrikeEvent(event) {
  if (event.type === "onset") {
    setFeedback("Listening to that strike...");
    return;
  }

  if (event.type === "strike-failed") {
    lastStrikeText = `last strike: failed (${event.reason})`;
    setFeedback(
      event.reason === "inconsistent"
        ? "Unclear note (two leaves at once, or the previous sound still ringing). Let it fade and try again."
        : "Could not read that strike, try again",
    );
    return;
  }

  lastStrikeText = `last strike: ${event.readingsUsed}/${event.readingsTotal} readings, ${event.freq.toFixed(1)} Hz`;
  const record = describeFreq(event.freq, a4);
  const result = session.addStrike(record);

  if (result.status === "filled") {
    setFeedback(`Recorded ${record.label} in leaf ${result.slot + 1}`);
    renderSlots();
    renderSorted();
    return;
  }

  if (result.status === "duplicate") {
    setFeedback(`Already recorded as leaf ${result.existingSlot + 1}`);
    return;
  }

  setFeedback("All leaves recorded. Tap a leaf to re-record, or press Reset.");
}

function handleAudioFrame(frame) {
  showReading(frame);
  updateDiagnostics(frame);
  const events = detector.push({
    time: frame.time,
    rms: frame.rms,
    freq: frame.freq,
    clarity: frame.clarity,
  });
  for (const event of events) {
    handleStrikeEvent(event);
  }
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
  stopAudio();
  releaseWakeLock();
  clearReadout();
  diagnosticsLine.textContent = "";
  toggleButton.textContent = "Start";
  statusLine.textContent = message;
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

gateSlider.addEventListener("input", () => {
  gate = sliderToGate(Number(gateSlider.value));
  detector.setOptions({ gate });
  gateValue.textContent = gate.toFixed(3);
  persistSettings();
});

diagnosticsCheckbox.addEventListener("change", () => {
  showDiagnostics = diagnosticsCheckbox.checked;
  diagnosticsLine.classList.toggle("hidden", !showDiagnostics);
  persistSettings();
});

presetsContainer.addEventListener("click", (event) => {
  const button = event.target.closest(".preset");
  if (button) requestLeafCount(Number(button.dataset.count));
});

presetSelect.addEventListener("change", () => {
  if (presetSelect.value) requestLeafCount(Number(presetSelect.value));
});

customInput.addEventListener("change", () => {
  requestLeafCount(Number(customInput.value));
});

slotsContainer.addEventListener("click", (event) => {
  const card = event.target.closest(".slot");
  if (!card) return;
  session.selectSlot(Number(card.dataset.index));
  renderSlots();
});

toggleButton.addEventListener("click", async () => {
  if (isAudioRunning()) {
    stopListening("Stopped. Recorded leaves are kept.");
    return;
  }

  toggleButton.disabled = true;
  try {
    detector.reset();
    await startAudio(handleAudioFrame);
    acquireWakeLock();
    toggleButton.textContent = "Stop";
    statusLine.textContent = "Listening. Strike the leaves one at a time.";
    setFeedback("Listening");
  } catch (error) {
    stopListening(describeAudioError(error));
  } finally {
    toggleButton.disabled = false;
  }
});

resetButton.addEventListener("click", () => {
  session.reset();
  renderSlots();
  renderSorted();
  setFeedback("Cleared all leaves.");
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

renderSlots();
renderSorted();
syncCountControls();
syncSettingsControls();
clearReadout();
