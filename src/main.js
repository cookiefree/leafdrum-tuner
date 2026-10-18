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

const A4 = 440;
const DASH = "-";
const QUICK_PRESETS = [8, 11, 15];
const PRESET_MIN = 5;
const PRESET_MAX = 15;
const MIN_LEAVES = 1;
const MAX_LEAVES = 30;

const SUPPORT_MESSAGES = {
  "insecure-context":
    "Microphone access needs HTTPS or localhost. Open this page through a secure address, then reload.",
  unsupported: "This browser does not support microphone capture.",
};

const detector = new StrikeDetector({ a4: A4 });
const session = new Session(8);

const app = document.getElementById("app");

app.innerHTML = `
  <header>
    <h1>Leaf Drum Note Finder</h1>
  </header>
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
    reading.rms >= NOISE_GATE_RMS;

  if (!confident) {
    clearReadout();
    return;
  }

  const note = describeFreq(reading.freq, A4);
  const sign = note.cents >= 0 ? "+" : "-";
  noteLine.textContent = note.label;
  hzLine.textContent = `${note.freq.toFixed(1)} Hz`;
  centsLine.textContent = `${sign}${Math.abs(note.cents).toFixed(1)} cents`;
  meterMarker.classList.remove("hidden");
  meterMarker.style.left = `${note.cents + 50}%`;
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
}

function handleStrikeEvent(event) {
  if (event.type === "onset") {
    setFeedback("Listening to that strike...");
    return;
  }

  if (event.type === "strike-failed") {
    setFeedback(
      event.reason === "inconsistent"
        ? "Unclear note (two leaves at once, or the previous sound still ringing). Let it fade and try again."
        : "Could not read that strike, try again",
    );
    return;
  }

  const record = describeFreq(event.freq, A4);
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

function stopListening(message) {
  stopAudio();
  clearReadout();
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
clearReadout();
