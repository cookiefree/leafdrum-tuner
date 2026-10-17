import test from "node:test";
import assert from "node:assert/strict";
import { freqToMidi, midiToFreq, describeFreq } from "../src/notes.js";

test("frequency to MIDI and back", () => {
  assert.ok(Math.abs(freqToMidi(440) - 69) < 1e-9);
  assert.ok(Math.abs(freqToMidi(432, 432) - 69) < 1e-9);
  assert.ok(Math.abs(midiToFreq(69) - 440) < 1e-9);
  assert.ok(Math.abs(midiToFreq(69, 432) - 432) < 1e-9);
  assert.ok(Math.abs(midiToFreq(60) - 261.625565) < 0.0001);
});

test("440 Hz is A4 with zero cents", () => {
  const note = describeFreq(440);
  assert.equal(note.midi, 69);
  assert.equal(note.name, "A");
  assert.equal(note.octave, 4);
  assert.equal(note.label, "A4");
  assert.ok(Math.abs(note.cents) < 0.01);
  assert.equal(note.freq, 440);
});

test("261.63 Hz is C4 with about zero cents", () => {
  const note = describeFreq(261.63);
  assert.equal(note.midi, 60);
  assert.equal(note.label, "C4");
  assert.ok(Math.abs(note.cents) < 1);
});

test("466.16 Hz is A#4", () => {
  assert.equal(describeFreq(466.16).label, "A#4");
});

test("detuned frequencies report their cents offset", () => {
  const sharp = describeFreq(440 * 2 ** (30 / 1200));
  assert.equal(sharp.label, "A4");
  assert.ok(Math.abs(sharp.cents - 30) < 0.01);

  const flat = describeFreq(440 * 2 ** (-30 / 1200));
  assert.equal(flat.label, "A4");
  assert.ok(Math.abs(flat.cents + 30) < 0.01);
});

test("a different reference pitch shifts the result", () => {
  const note = describeFreq(432, 432);
  assert.equal(note.label, "A4");
  assert.ok(Math.abs(note.cents) < 0.01);

  const shifted = describeFreq(440, 432);
  assert.equal(shifted.label, "A4");
  assert.ok(Math.abs(shifted.cents - 31.77) < 0.05);
});

test("octave boundaries follow scientific pitch notation", () => {
  assert.equal(describeFreq(midiToFreq(59.4)).label, "B3");
  assert.equal(describeFreq(midiToFreq(60)).label, "C4");
  assert.equal(describeFreq(midiToFreq(60.4)).label, "C4");
});

test("exact half-semitone ties round up", () => {
  const note = describeFreq(midiToFreq(59.5));
  assert.equal(note.label, "C4");
  assert.equal(note.cents, -50);
});

test("cents offset always stays within [-50, 50]", () => {
  for (let midi = 21; midi <= 108; midi += 0.13) {
    const note = describeFreq(midiToFreq(midi));
    assert.ok(note.cents >= -50 && note.cents <= 50);
  }
});
