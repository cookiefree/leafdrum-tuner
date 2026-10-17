# Leaf Drum Note Finder - Project Plan

Instructions for the coding agent: read this whole file before writing any code. Work phase by phase, in order. After finishing each phase, run its acceptance checks, commit, and stop and report before starting the next phase. Do not add features, dependencies, or files that are not listed here. If something in this plan is ambiguous or impossible, say so and ask instead of guessing.

---

## 1. Goal

A static website that runs in a phone browser, listens to the microphone, and tells the user which musical note a leaf drum (tongue drum) leaf plays.

User flow:

1. User opens the site on their phone and taps "Start" (this is required for mic permission and audio context).
2. User selects how many leaves the drum has (for example 8, 11, 15, or a custom number).
3. User strikes the leaves one at a time. For each strike the app detects the pitch and fills the next empty slot with the note name, octave, frequency, and cents offset from the nearest note.
4. When all slots are filled, the app shows the full set of notes sorted by pitch, so the user can see the drum's scale.

The user does not know the notes of their drum and wants to find out. This is a note finder first, a tuner display second.

## 2. Decisions already made (do not revisit)

| Topic | Decision |
|---|---|
| Hosting | GitHub Pages, static files only, no backend |
| App type | Plain website, not a PWA. No service worker, no manifest |
| Note names | English, sharps only: C, C#, D, D#, E, F, F#, G, G#, A, A#, B. No German H, no flats |
| Reference pitch | A4 = 440 Hz by default, adjustable in settings |
| Privacy | All audio processing happens on the device. Audio is never recorded, stored, or sent anywhere |
| Language of UI | English |

## 3. Tech stack and constraints

- Vanilla HTML, CSS, JavaScript with ES modules (`<script type="module">`). No framework, no bundler, no build step.
- No runtime dependencies. Pitch detection is implemented in this repo (see section 6). Do not pull in libraries from a CDN.
- `package.json` exists only to hold `"type": "module"` and a test script (`node --test`). No dev dependencies.
- Tests use Node's built-in test runner (`node:test`, `node:assert`).
- Target browsers: current iOS Safari and current Android Chrome. Desktop Chrome and Firefox should work for development.
- Mobile first layout. Must be usable one-handed on a phone in portrait orientation.
- The site must work when served over HTTPS (GitHub Pages) and on `localhost`. Microphone access does not work on plain HTTP over a LAN IP, so the app must detect `window.isSecureContext === false` and show a clear message.
- Keep files small and readable. Short comments only where the logic is not obvious. No emojis anywhere in code, UI, or docs.

## 4. Repository layout

```
leafdrum-tuner/
  index.html
  css/
    style.css
  src/
    main.js        UI wiring and app state
    audio.js       microphone capture and the analysis loop
    pitch.js       pitch detection (McLeod Pitch Method)
    onset.js       strike (onset) detection
    notes.js       frequency <-> note conversions
    session.js     slot logic: filling, replacing, sorting, duplicates
  tests/
    notes.test.js
    pitch.test.js
    onset.test.js
    session.test.js
  package.json
  README.md
  PLAN.md          this file
```

## 5. Phases

### Phase 0 - Scaffold

Tasks:
- Create the layout above with empty or minimal files.
- `index.html`: viewport meta tag, a title, a root container, loads `src/main.js` as a module and `css/style.css`.
- `package.json` with `"type": "module"` and `"scripts": { "test": "node --test" }`.
- `README.md` with a one-paragraph description and how to run locally (`python3 -m http.server 8000`, then open `http://localhost:8000` on desktop).
- Initialize git and make the first commit.

Acceptance:
- Opening the page on desktop shows a blank styled page with no console errors.
- `npm test` runs and exits cleanly (zero tests is fine at this point).

### Phase 1 - Note math (`notes.js`) with tests

Implement and export:
- `freqToMidi(freq, a4 = 440)` returns a float: `69 + 12 * log2(freq / a4)`.
- `midiToFreq(midi, a4 = 440)`.
- `describeFreq(freq, a4 = 440)` returns `{ midi, name, octave, label, cents, freq }` where `midi` is the nearest integer MIDI note, `name` is like `"C#"`, `octave` follows scientific pitch notation (MIDI 60 = C4), `label` is like `"C#4"`, and `cents` is the offset from that nearest note, in the range -50 to +50.

Tests:
- 440 Hz -> A4, 0 cents. 261.63 Hz -> C4, about 0 cents. 466.16 Hz -> A#4.
- A frequency 30 cents above a note returns cents of about +30. 30 cents below returns about -30.
- Changing `a4` to 432 shifts results correctly (432 Hz -> A4 with a4 = 432).
- Octave boundaries are correct (B3 -> C4).

Acceptance: all notes tests pass.

### Phase 2 - Pitch detection (`pitch.js`) with tests

Implement the McLeod Pitch Method (normalized square difference function):
- Signature: `detectPitch(buffer, sampleRate, { minFreq = 100, maxFreq = 1500 })` returns `{ freq, clarity }` or `null` if no pitch is found.
- `buffer` is a `Float32Array` of time-domain samples. Use a window of about 2048 samples taken from the analyser buffer.
- Compute the NSDF only for lags in the range `sampleRate / maxFreq` to `sampleRate / minFreq`.
- Find the key maxima of the NSDF (the peak between each positive-going and negative-going zero crossing). Choose the first key maximum whose value is at least `0.93` times the highest key maximum. This avoids octave-down errors.
- Refine the chosen peak position with parabolic interpolation.
- `clarity` is the NSDF value at the chosen peak (0 to 1).
- Return `null` if the buffer is silent (very low RMS) or no key maximum exists.

Tests (generate synthetic signals in the test file, 48000 Hz and 44100 Hz sample rates):
- Pure sines at 220, 261.63, 440, 880 Hz are detected within 0.5 Hz (or 2 cents).
- A signal with a strong 2nd and 3rd harmonic on top of a 261.63 Hz fundamental still returns about 261.63 Hz, not an octave off.
- A signal with a weak fundamental and strong 2nd harmonic is allowed to fail, but the test should document the behavior.
- Silence returns `null`.
- White noise returns `null` or a low clarity (below 0.5).
- Frequencies outside `minFreq` and `maxFreq` are not returned.

Acceptance: all pitch tests pass.

### Phase 3 - Microphone capture and live readout

`audio.js`:
- `startAudio()` calls `navigator.mediaDevices.getUserMedia` with:
  ```js
  { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } }
  ```
  These must be disabled, because the browser's default processing damages pitch detection.
- Create an `AudioContext`, call `resume()` (must happen inside the user's tap handler for iOS Safari), connect the mic stream to an `AnalyserNode` with `fftSize = 4096` and `smoothingTimeConstant = 0`. Do not connect the analyser to the speakers or `destination`, because that would cause feedback.
- Run a loop with `requestAnimationFrame`. On every frame: read `getFloatTimeDomainData`, compute RMS, run `detectPitch`, and pass `{ rms, freq, clarity, time }` to a callback.
- `stopAudio()` stops all tracks and closes the context.
- Stop audio automatically when the tab becomes hidden (`visibilitychange`), and require the user to tap Start again.

Error handling, with clear plain-language messages in the UI:
- Insecure context (`!window.isSecureContext`).
- `getUserMedia` unavailable.
- Permission denied (`NotAllowedError`), with a hint to enable the microphone in browser settings.
- No microphone found (`NotFoundError`).

UI for this phase (temporary, will be refined later):
- A Start/Stop button.
- A large readout: note label (for example `C#4`), frequency in Hz, cents offset, and a simple horizontal cents meter from -50 to +50.
- Show a dash when there is no confident reading. A reading is confident only if `clarity >= 0.9` and `rms` is above the noise gate (see Phase 4).

Acceptance (manual, on a desktop browser with a tone generator or phone speaker playing a known note):
- Playing 440 Hz shows A4 with about 0 cents.
- Mic permission prompt appears on Start and not before.
- Stopping releases the microphone (the browser's mic indicator goes away).

### Phase 4 - Strike (onset) detection (`onset.js`) with tests

Leaf drums ring for several seconds, so the app must detect a new strike even while the previous note is still decaying, and must read the pitch after the initial attack noise has passed.

Implement a pure, testable detector that is fed `{ rms, time }` per frame and emits events:
- An onset fires when `rms` is above an absolute gate (default `0.02`, adjustable) AND `rms` is at least `2.0` times the smoothed recent average (a slow-moving average of `rms` over roughly the last 300 ms). This catches a new hit on top of a decaying ring.
- After an onset, enforce a refractory period (default `250 ms`) in which no new onset can fire.
- After an onset, the capture window starts at `+120 ms` (skip the attack transient) and lasts `300 ms`. During the capture window the app collects confident pitch readings (`clarity >= 0.9`).
- At the end of the window, the result is computed as follows:
  - Convert each reading to a MIDI float and round to the nearest integer note.
  - Take the most frequent note (the mode). Ignore the window if fewer than 5 confident readings were collected.
  - The reported frequency is the median of the readings that belong to the winning note.
  - This voting step is what protects against single-frame octave jumps and harmonic locks.
- Emit `{ type: 'strike', freq, midi, readingsUsed }` on success, or `{ type: 'strike-failed' }` if the window was rejected.

Tests (feed synthetic `rms` sequences):
- A single sharp rise fires exactly one onset.
- A slowly decaying ring does not fire any onset.
- A second sharp rise 600 ms after the first, on top of a decaying ring, fires a second onset.
- Two rises within the refractory period fire only one onset.
- The voting step returns the mode note when 7 of 10 readings agree and 3 are an octave off.
- Fewer than 5 confident readings returns `strike-failed`.

Acceptance: all onset tests pass.

### Phase 5 - Leaf count and slots (`session.js`) with tests

State and logic:
- `leafCount` N, chosen from presets 5 through 15, plus a custom number input (allowed range 1 to 30). Common drums have 8, 11, or 15 leaves, so make 8, 11, and 15 the most visible choices.
- `slots`: an array of length N, each either empty or `{ midi, name, octave, label, cents, freq }`.
- `activeSlot`: index that will receive the next strike. Defaults to the first empty slot. The user can tap any slot to make it the active slot for re-recording.
- `addStrike(strike)`:
  - If the detected `midi` already exists in another slot, do not fill a new slot. Return `{ status: 'duplicate', existingSlot }` so the UI can show "Already recorded as leaf K". This handles the user hitting the same leaf twice.
  - Otherwise fill the active slot, then move `activeSlot` to the next empty slot (or `null` if all are full). Return `{ status: 'filled', slot }`.
  - If the user explicitly selected an already-filled slot to re-record, overwrite it, and the duplicate check ignores that slot itself.
- `sortedByPitch()` returns the filled slots sorted by `midi` ascending.
- `reset()` clears all slots.
- Changing `leafCount` keeps existing recorded notes where they still fit and drops those that no longer fit, after confirming with the user if anything would be lost.

Tests:
- Filling slots in order, duplicates rejected, re-record overwrites, sorting, reset, and changing `leafCount` behave as described above.

Acceptance: all session tests pass.

### Phase 6 - Full UI

Layout (mobile first, dark theme, large touch targets):
1. Header with the app name and a settings button.
2. Leaf count selector.
3. Live readout from Phase 3 (note label, Hz, cents meter) so the user sees what the mic hears.
4. A grid of N slot cards. Each card shows the leaf number (in the order played), and once filled shows the note label, frequency, and cents. The active slot is visually highlighted. Tapping a card makes it the active slot. Empty cards show "waiting".
5. A "Sorted by pitch" strip that appears and updates as slots fill, showing note labels from lowest to highest. When all slots are full, add a short summary line, for example `11 notes, C3 to F4`.
6. A feedback line that shows the last event: "Recorded C#4 in leaf 3", "Already recorded as leaf 2", "Could not read that strike, try again", or "Listening".
7. Buttons: Start/Stop, Reset.

Settings panel:
- Reference pitch A4, numeric, 400 to 480 Hz, default 440, with quick buttons for 432 and 440.
- Sensitivity (noise gate) slider, mapped to the absolute `rms` gate. Default must work in a quiet room.
- Persist settings (reference pitch, sensitivity, last leaf count) in `localStorage`, wrapped in try/catch so the app still works if storage is blocked. Do not persist recorded notes in this version.

Accessibility and polish:
- Sufficient color contrast, visible focus states, buttons are real `<button>` elements, labels on all inputs.
- Do not rely on color alone to show the cents offset (show the signed number as well).
- Handle orientation and small screens down to 360 px wide with no horizontal scrolling.
- Keep the screen awake while listening if `navigator.wakeLock` is available (optional, fail silently).

Acceptance (manual):
- With the leaf count set to 8, striking eight different leaves fills eight different slots with sensible notes.
- Striking the same leaf twice reports a duplicate instead of filling a second slot.
- Tapping a filled slot and striking again replaces it.
- Reload keeps the settings (A4, sensitivity, leaf count) but not the recorded notes.

### Phase 7 - Real-device testing and tuning

Do this with the actual drum if possible, otherwise with a tone generator.
- Test on iOS Safari and Android Chrome.
- Verify there are no octave errors across the full range of the drum. If there are, report the failing notes and frequencies and adjust only these knobs, in this order: capture window delay, number of required readings, NSDF peak threshold (0.93), `minFreq` and `maxFreq`.
- Verify cents readings are stable to within about 3 cents when the same leaf is struck repeatedly the same way.
- Verify that striking leaves in quick succession (about 1 per second) registers each strike.
- Write down what was changed and why in the README under "Tuning notes".

Acceptance: a full drum can be scanned in one pass with no wrong octaves and no missed strikes, in a quiet room.

### Phase 8 - Deploy to GitHub Pages

- Push the repo to GitHub (public repository).
- Enable GitHub Pages: Settings, Pages, deploy from branch `main`, folder `/ (root)`.
- Make sure all asset paths in `index.html` are relative (no leading slash), because project sites are served from a subpath such as `/leafdrum-tuner/`.
- Open the published `https://<user>.github.io/<repo>/` URL on a phone and confirm the mic permission prompt appears and the full flow works over HTTPS.
- Add the live URL to the README.

Acceptance: the published site works end to end on a real phone.

## 6. Algorithm notes (reference)

- NSDF: `n'(tau) = 2 * r'(tau) / m'(tau)` where `r'` is the autocorrelation and `m'` is the sum of squares of the two shifted windows. Values lie in -1 to 1 and a clean periodic signal gives a peak close to 1 at its period.
- Direct computation costs about `window * maxLag` operations. With a window of 2048 and a max lag of about 480 (100 Hz at 48 kHz), that is about 1 million operations per frame, which is fine on phones at animation-frame rate. Do not add an FFT-based version unless profiling shows a problem.
- Why not just take the loudest FFT bin: tongue drum notes have strong overtones and the strongest bin is often not the fundamental. The NSDF approach with the 0.93 rule is more robust.
- Typical frequency range for these drums is roughly 200 to 800 Hz, so the default 100 to 1500 Hz detection range leaves safe margin.

## 7. Out of scope for this version

- Offline mode, PWA, installability.
- Accounts, backend, analytics, any network requests at runtime.
- Recording or playing back audio.
- Telling the user how to retune a leaf, or suggesting target scales.
- Scale name detection (for example "C major pentatonic"). Possible future addition.
- German note names, flats, or other notation. Possible future addition.
- Saving drum profiles between sessions. Possible future addition.

## 8. Definition of done

- All unit tests pass with `npm test`.
- The site is live on GitHub Pages and works on iOS Safari and Android Chrome.
- A user can pick a leaf count, strike each leaf, and read off the note names, with correct octaves, in a quiet room.
- No console errors, no runtime network requests other than loading the site's own files, no external dependencies.
- README explains what the app does, how to run it locally, how to deploy it, and lists the tuning notes from Phase 7.

## 9. Working rules for the agent

- One phase at a time. Commit at the end of each phase with a clear message (for example `phase 2: pitch detection with tests`).
- Write the tests listed for a phase before or together with the implementation, and do not weaken a test to make it pass. If a test seems wrong, explain why and ask.
- Do not install packages. Do not add a build step.
- Do not change decisions in section 2.
- If a phase's acceptance check cannot be verified without the physical drum or a phone, say exactly which checks the user must do by hand.
