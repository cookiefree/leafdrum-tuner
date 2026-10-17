const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function freqToMidi(freq, a4 = 440) {
  return 69 + 12 * Math.log2(freq / a4);
}

export function midiToFreq(midi, a4 = 440) {
  return a4 * 2 ** ((midi - 69) / 12);
}

export function describeFreq(freq, a4 = 440) {
  const exact = freqToMidi(freq, a4);
  // Math.round sends exact half-semitone ties up to the next note.
  const midi = Math.round(exact);
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  const cents = Math.min(50, Math.max(-50, 100 * (exact - midi)));
  return {
    midi,
    name,
    octave,
    label: `${name}${octave}`,
    cents,
    freq,
  };
}
