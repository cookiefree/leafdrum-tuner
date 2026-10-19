import { detectPitch } from "./pitch.js";

export const CONFIDENT_CLARITY = 0.75;
export const NOISE_GATE_RMS = 0.02;
export const DEFAULT_INPUT_GAIN = 8;

const FFT_SIZE = 4096;
const PITCH_WINDOW = 2048;

let audioContext = null;
let mediaStream = null;
let gainNode = null;
let analyser = null;
let frameBuffer = null;
let frameHandle = null;
let inputGain = DEFAULT_INPUT_GAIN;

export function getAudioSupportIssue() {
  if (!window.isSecureContext) return "insecure-context";
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    return "unsupported";
  }
  return null;
}

export function isAudioRunning() {
  return frameHandle !== null;
}

export function setInputGain(value) {
  inputGain = value;
  if (gainNode) {
    gainNode.gain.value = value;
  }
}

export async function startAudio(onFrame) {
  if (audioContext) return;

  audioContext = new AudioContext();
  if (audioContext.state === "suspended") {
    // Resuming must start inside the user's tap handler for iOS Safari.
    audioContext.resume();
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });

    const source = audioContext.createMediaStreamSource(mediaStream);
    gainNode = audioContext.createGain();
    gainNode.gain.value = inputGain;
    analyser = audioContext.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    source.connect(gainNode);
    gainNode.connect(analyser);
    frameBuffer = new Float32Array(FFT_SIZE);

    const tick = () => {
      frameHandle = requestAnimationFrame(tick);
      emitFrame(onFrame);
    };
    tick();
  } catch (error) {
    stopAudio();
    throw error;
  }
}

function emitFrame(onFrame) {
  analyser.getFloatTimeDomainData(frameBuffer);
  const samples = frameBuffer.subarray(FFT_SIZE - PITCH_WINDOW);

  let sumOfSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sumOfSquares += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumOfSquares / samples.length);

  const reading = detectPitch(samples, audioContext.sampleRate, { minFreq: 60 });
  onFrame({
    rms,
    freq: reading ? reading.freq : null,
    clarity: reading ? reading.clarity : 0,
    time: performance.now(),
  });
}

export function stopAudio() {
  if (frameHandle !== null) {
    cancelAnimationFrame(frameHandle);
    frameHandle = null;
  }
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
    mediaStream = null;
  }
  analyser = null;
  gainNode = null;
  frameBuffer = null;
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
}
