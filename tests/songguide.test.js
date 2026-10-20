import test from 'node:test';
import assert from 'node:assert/strict';
import {
  midiName,
  parseNote,
  parseSong,
  coverage,
  bestTransposition,
  mapSong,
  SongGuide,
  MAX_SONG_NOTES,
} from '../src/songguide.js';

// All note lists in these tests are made up for testing, not taken from any song.

// A drum like the one scanned so far: D2 A2 C3 D3 E3 F3 G3 A3 C4 D4 E4.
const DRUM = [38, 45, 48, 50, 52, 53, 55, 57, 60, 62, 64];

test('midiName: sharps and octaves', () => {
  assert.equal(midiName(60), 'C4');
  assert.equal(midiName(69), 'A4');
  assert.equal(midiName(61), 'C#4');
  assert.equal(midiName(59), 'B3');
  assert.equal(midiName(38), 'D2');
});

test('parseNote: letters, sharps, flats, case, octave boundaries', () => {
  assert.equal(parseNote('C4'), 60);
  assert.equal(parseNote('A4'), 69);
  assert.equal(parseNote('c4'), 60);
  assert.equal(parseNote('F#3'), 54);
  assert.equal(parseNote('Bb3'), 58);
  assert.equal(parseNote('bb3'), 58); // lowercase letter b + flat
  assert.equal(parseNote('b3'), 59); // plain B3
  assert.equal(parseNote('E\u266D2'), 39); // Eb2
  assert.equal(parseNote('Cb4'), 59); // wraps down to B3
  assert.equal(parseNote('B#3'), 60); // wraps up to C4
  assert.equal(parseNote('G\u266F5'), 80);
});

test('parseNote: rejects things that are not notes', () => {
  for (const t of ['H4', 'C', '4', 'C44', 'C#', 'CC4', '', 'x', 'C-1']) {
    assert.equal(parseNote(t), null, t);
  }
});

test('parseSong: separators, rests and line breaks', () => {
  const r = parseSong('C4 D4, E4;F4 | G4\nA4\t-  B4 _ . r R rest C5');
  assert.deepEqual(r.notes, [60, 62, 64, 65, 67, 69, 71, 72]);
  assert.equal(r.rests, 6);
  assert.deepEqual(r.errors, []);
});

test('parseSong: collects unreadable tokens without stopping', () => {
  const r = parseSong('C4 oops D4 C4+E4 E4');
  assert.deepEqual(r.notes, [60, 62, 64]);
  assert.deepEqual(r.errors.map((e) => e.token), ['oops', 'C4+E4']);
  assert.deepEqual(r.errors.map((e) => e.position), [1, 3]);
});

test('parseSong: empty and weird input', () => {
  assert.deepEqual(parseSong('').notes, []);
  assert.deepEqual(parseSong(null).notes, []);
  assert.deepEqual(parseSong('   \n  ').notes, []);
});

test('parseSong: caps very long input', () => {
  const r = parseSong(Array(MAX_SONG_NOTES + 500).fill('C4').join(' '));
  assert.equal(r.notes.length, MAX_SONG_NOTES);
});

test('coverage: counts playable notes and lists what is missing', () => {
  const song = [64, 66, 64, 66, 59, 62]; // E4 F#4 E4 F#4 B3 D4
  const c = coverage(song, DRUM);
  assert.equal(c.total, 6);
  assert.equal(c.playable, 3); // E4, E4, D4
  assert.deepEqual(c.missing, [
    { name: 'F#4', count: 2 },
    { name: 'B3', count: 1 },
  ]);
});

test('coverage: with a shift', () => {
  const c = coverage([52, 54, 55], DRUM, -2); // -> D3 E3 F3
  assert.equal(c.playable, 3);
  assert.deepEqual(c.missing, []);
});

test('bestTransposition: finds the shift that fits the drum', () => {
  // Needs F# and B, which the drum lacks; two semitones down it fits completely.
  const song = [52, 54, 55, 57, 59, 62, 64];
  const best = bestTransposition(song, DRUM);
  assert.equal(best.semitones, -2);
  assert.equal(best.playable, 7);
  assert.equal(best.total, 7);
  assert.deepEqual(best.missing, []);
});

test('bestTransposition: prefers no shift when nothing is gained', () => {
  const best = bestTransposition([60, 62, 64], DRUM);
  assert.equal(best.semitones, 0);
  assert.equal(best.playable, 3);
});

test('bestTransposition: ties go to the smaller shift, then the lower one', () => {
  assert.equal(bestTransposition([60, 62], [60]).semitones, 0);
  assert.equal(bestTransposition([61], [60, 62]).semitones, -1);
});

test('bestTransposition: reports partial coverage honestly', () => {
  // Six consecutive semitones cannot all fit a scale without sharps and flats.
  const song = [61, 62, 63, 64, 65, 66];
  const best = bestTransposition(song, DRUM);
  assert.ok(best.playable < 6);
  assert.ok(best.playable >= 3);
  assert.equal(best.playable + best.missing.reduce((s, m) => s + m.count, 0), 6);
});

test('mapSong: indices, duplicates and missing notes', () => {
  // Tongue 0 = D3 (50), 1 = E3 (52), 2 = D3 again (50), 3 = unknown, 4 = G3 (55)
  const drumMap = [50, 52, 50, null, 55];
  const steps = mapSong([50, 52, 54, 55], drumMap);
  assert.deepEqual(steps[0].indices, [0, 2]);
  assert.equal(steps[0].index, 0);
  assert.deepEqual(steps[1].indices, [1]);
  assert.equal(steps[2].missing, true);
  assert.equal(steps[2].index, null);
  assert.equal(steps[2].name, 'F#3');
  assert.equal(steps[3].index, 4);
  assert.deepEqual(steps.map((s) => s.n), [0, 1, 2, 3]);
});

test('mapSong: applies the transposition to the reported note', () => {
  const steps = mapSong([52, 55], [50, null, 53], -2);
  assert.deepEqual(steps.map((s) => s.midi), [50, 53]);
  assert.deepEqual(steps.map((s) => s.index), [0, 2]);
  assert.equal(steps[0].name, 'D3');
});

const mk = (notes, drumMap = [50, 52, 53, 55, 57], opts) => new SongGuide(mapSong(notes, drumMap), opts);

test('SongGuide: advances only on the right note', () => {
  const g = mk([50, 52, 53]);
  assert.equal(g.current().midi, 50);
  const wrong = g.heard(55);
  assert.equal(wrong.result, 'wrong');
  assert.equal(wrong.expected.midi, 50);
  assert.equal(wrong.heardName, 'G3');
  assert.equal(g.current().midi, 50); // unchanged
  const ok = g.heard(50);
  assert.equal(ok.result, 'correct');
  assert.equal(ok.next.midi, 52);
  assert.equal(g.progress().played, 1);
});

test('SongGuide: finishes and then reports done', () => {
  const g = mk([50, 52]);
  g.heard(50);
  assert.equal(g.done, false);
  g.heard(52);
  assert.equal(g.done, true);
  assert.equal(g.current(), null);
  assert.equal(g.heard(50).result, 'done');
});

test('SongGuide: skips notes the drum cannot play', () => {
  // 51 and 54 are not on the drum.
  const g = mk([51, 50, 54, 52, 54]);
  assert.equal(g.current().midi, 50); // leading missing note skipped
  g.heard(50);
  assert.equal(g.current().midi, 52); // 54 skipped
  g.heard(52);
  assert.equal(g.done, true); // trailing missing note skipped
  const p = g.progress();
  assert.equal(p.played, 2);
  assert.equal(p.skipped, 3);
  assert.equal(p.missingInRange, 3);
});

test('SongGuide: skipMissing=false stops on missing notes until skipped', () => {
  const g = mk([51, 50], [50], { skipMissing: false });
  assert.equal(g.current().missing, true);
  assert.equal(g.heard(50).result, 'wrong'); // cannot be played, expected is the missing step
  g.skip();
  assert.equal(g.current().midi, 50);
});

test('SongGuide: skip() moves on and counts', () => {
  const g = mk([50, 52, 53]);
  g.skip();
  assert.equal(g.current().midi, 52);
  assert.equal(g.progress().skipped, 1);
});

test('SongGuide: back() undoes the last advance, including skipped missing notes', () => {
  const g = mk([50, 54, 52]); // 54 is missing
  g.heard(50); // advances past 54 automatically
  assert.equal(g.current().midi, 52);
  g.back();
  assert.equal(g.current().midi, 50);
  assert.equal(g.progress().played, 0);
  assert.equal(g.progress().skipped, 0);
  g.back(); // nothing left to undo: no crash
  assert.equal(g.current().midi, 50);
});

test('SongGuide: restart() goes back to the start', () => {
  const g = mk([50, 52, 53]);
  g.heard(50);
  g.heard(52);
  g.restart();
  assert.equal(g.current().midi, 50);
  assert.equal(g.progress().played, 0);
  assert.equal(g.history.length, 0);
});

test('SongGuide: practising a part with start and end', () => {
  const g = mk([50, 52, 53, 55, 57], undefined, { start: 1, end: 4 });
  assert.equal(g.current().midi, 52);
  assert.equal(g.progress().total, 3);
  g.heard(52);
  g.heard(53);
  assert.equal(g.current().midi, 55);
  g.heard(55);
  assert.equal(g.done, true);
});

test('SongGuide: anyOctave accepts the right note in another octave', () => {
  const strict = mk([52]);
  assert.equal(strict.heard(64).result, 'wrong');
  const loose = mk([52], undefined, { anyOctave: true });
  assert.equal(loose.heard(64).result, 'correct');
  const loose2 = mk([52], undefined, { anyOctave: true });
  assert.equal(loose2.heard(40).result, 'correct');
  const loose3 = mk([52], undefined, { anyOctave: true });
  assert.equal(loose3.heard(53).result, 'wrong'); // a different note is still wrong
});

test('SongGuide: peekNext() previews the next playable step', () => {
  const g = mk([50, 54, 52]); // 54 missing
  assert.equal(g.peekNext().midi, 52);
  g.heard(50);
  assert.equal(g.peekNext(), null);
});

test('SongGuide: empty song, and ranges out of bounds', () => {
  const g = new SongGuide([]);
  assert.equal(g.done, true);
  assert.equal(g.current(), null);
  const h = mk([50, 52], undefined, { start: 5, end: 99 });
  assert.equal(h.done, true);
});

test('SongGuide: repeated notes need repeated strikes', () => {
  const g = mk([50, 50, 50]);
  g.heard(50);
  g.heard(50);
  assert.equal(g.done, false);
  g.heard(50);
  assert.equal(g.done, true);
});
