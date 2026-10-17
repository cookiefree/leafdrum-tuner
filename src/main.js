import {
  CONFIDENT_CLARITY,
  NOISE_GATE_RMS,
  getAudioSupportIssue,
  isAudioRunning,
  startAudio,
  stopAudio,
} from "./audio.js";
import { describeFreq } from "./notes.js";

const REFERENCE_PITCH = 440;
const DASH = "-";

const SUPPORT_MESSAGES = {
  "insecure-context":
    "Microphone access needs HTTPS or localhost. Open this page through a secure address, then reload.",
  unsupported: "This browser does not support microphone capture.",
};

const app = document.getElementById("app");

app.innerHTML = `
  <h1>Leaf Drum Note Finder</h1>
  <p id="status" class="status" role="status">Tap Start to allow the microphone.</p>
  <button id="toggle" class="toggle" type="button">Start</button>
  <section class="readout">
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
`;

const statusLine = document.getElementById("status");
const toggleButton = document.getElementById("toggle");
const noteLine = document.getElementById("note");
const hzLine = document.getElementById("hz");
const centsLine = document.getElementById("cents");
const meterMarker = document.getElementById("meter-marker");

const supportIssue = getAudioSupportIssue();

if (supportIssue) {
  toggleButton.disabled = true;
  statusLine.textContent = SUPPORT_MESSAGES[supportIssue];
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

  const note = describeFreq(reading.freq, REFERENCE_PITCH);
  const sign = note.cents >= 0 ? "+" : "-";
  noteLine.textContent = note.label;
  hzLine.textContent = `${note.freq.toFixed(1)} Hz`;
  centsLine.textContent = `${sign}${Math.abs(note.cents).toFixed(1)} cents`;
  meterMarker.classList.remove("hidden");
  meterMarker.style.left = `${note.cents + 50}%`;
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

toggleButton.addEventListener("click", async () => {
  if (isAudioRunning()) {
    stopListening("Stopped.");
    return;
  }

  toggleButton.disabled = true;
  try {
    await startAudio(showReading);
    toggleButton.textContent = "Stop";
    statusLine.textContent = "Listening. Play a steady note to test.";
  } catch (error) {
    stopListening(describeAudioError(error));
  } finally {
    toggleButton.disabled = false;
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && isAudioRunning()) {
    stopListening("Audio stopped because the page was hidden. Tap Start to continue.");
  }
});
