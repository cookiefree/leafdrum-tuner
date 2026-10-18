import test from "node:test";
import assert from "node:assert/strict";
import { Session } from "../src/session.js";
import { describeFreq, midiToFreq } from "../src/notes.js";

const rec = (midi) => describeFreq(midiToFreq(midi));

test("new session starts empty with the first slot active", () => {
  const session = new Session(8);
  assert.equal(session.leafCount, 8);
  assert.equal(session.slots.length, 8);
  assert.ok(session.slots.every((slot) => slot === null));
  assert.equal(session.activeSlot, 0);
  assert.deepEqual(session.sortedByPitch(), []);
});

test("filling slots in order", () => {
  const session = new Session(4);
  const c4 = rec(60);
  const e4 = rec(64);

  assert.deepEqual(session.addStrike(c4), { status: "filled", slot: 0 });
  assert.equal(session.slots[0], c4);
  assert.equal(session.activeSlot, 1);

  assert.deepEqual(session.addStrike(e4), { status: "filled", slot: 1 });
  assert.equal(session.slots[1], e4);
  assert.equal(session.activeSlot, 2);
});

test("duplicate notes are rejected and do not fill a slot", () => {
  const session = new Session(4);
  session.addStrike(rec(69));

  const result = session.addStrike(rec(69));
  assert.deepEqual(result, { status: "duplicate", existingSlot: 0 });
  assert.equal(session.slots[1], null);
  assert.equal(session.activeSlot, 1);
});

test("duplicates are compared by midi, not frequency", () => {
  const session = new Session(4);
  session.addStrike(describeFreq(442));

  const result = session.addStrike(describeFreq(439));
  assert.equal(result.status, "duplicate");
  assert.equal(result.existingSlot, 0);
});

test("selecting a slot makes it the active slot", () => {
  const session = new Session(4);
  session.selectSlot(2);
  assert.equal(session.activeSlot, 2);

  assert.deepEqual(session.addStrike(rec(60)), { status: "filled", slot: 2 });
  assert.equal(session.activeSlot, 3);
});

test("when every slot is full, a new note is refused", () => {
  const session = new Session(2);
  session.addStrike(rec(60));
  session.addStrike(rec(62));
  assert.equal(session.activeSlot, null);

  assert.deepEqual(session.addStrike(rec(64)), { status: "full" });
  assert.equal(session.slots.length, 2);
});

test("duplicates are still reported when every slot is full", () => {
  const session = new Session(1);
  session.addStrike(rec(60));

  assert.deepEqual(session.addStrike(rec(60)), { status: "duplicate", existingSlot: 0 });
});

test("re-recording a filled slot overwrites it", () => {
  const session = new Session(4);
  session.addStrike(rec(60));
  session.addStrike(rec(62));
  session.addStrike(rec(64));
  assert.equal(session.activeSlot, 3);

  session.selectSlot(1);
  const newNote = rec(67);
  assert.deepEqual(session.addStrike(newNote), { status: "filled", slot: 1 });
  assert.equal(session.slots[1], newNote);
  assert.equal(session.slots[0].midi, 60);
  assert.equal(session.slots[2].midi, 64);
  assert.equal(session.activeSlot, 3);
});

test("striking the note already in the slot being re-recorded is allowed", () => {
  const session = new Session(4);
  session.addStrike(rec(60));
  session.addStrike(rec(62));
  session.selectSlot(0);

  const again = describeFreq(261.9);
  assert.deepEqual(session.addStrike(again), { status: "filled", slot: 0 });
  assert.equal(session.slots[0], again);
});

test("re-recording still rejects a note recorded in another slot", () => {
  const session = new Session(4);
  session.addStrike(rec(60));
  session.addStrike(rec(62));
  session.selectSlot(1);

  assert.deepEqual(session.addStrike(rec(60)), { status: "duplicate", existingSlot: 0 });
  assert.equal(session.slots[1].midi, 62);
});

test("the active slot wraps around to the first empty slot", () => {
  const session = new Session(3);
  session.addStrike(rec(60));
  session.selectSlot(2);
  session.addStrike(rec(62));

  // Slots are [C4, empty, D4]; the next empty slot after slot 2 wraps to 1.
  assert.equal(session.activeSlot, 1);
});

test("sortedByPitch sorts by midi and skips empty slots", () => {
  const session = new Session(5);
  session.addStrike(rec(69));
  session.addStrike(rec(62));
  session.addStrike(rec(64));

  assert.deepEqual(
    session.sortedByPitch().map((slot) => slot.label),
    ["D4", "E4", "A4"],
  );
  assert.deepEqual(
    session.slots.slice(0, 3).map((slot) => slot.label),
    ["A4", "D4", "E4"],
  );
});

test("reset clears every slot and reactivates the first slot", () => {
  const session = new Session(4);
  session.addStrike(rec(60));
  session.addStrike(rec(62));

  session.reset();
  assert.ok(session.slots.every((slot) => slot === null));
  assert.deepEqual(session.sortedByPitch(), []);
  assert.equal(session.activeSlot, 0);
});

test("wouldDrop lists the notes that would be lost", () => {
  const session = new Session(6);
  for (const midi of [60, 62, 64, 65, 67]) session.addStrike(rec(midi));

  assert.deepEqual(session.wouldDrop(3).map((slot) => slot.label), ["F4", "G4"]);
  assert.deepEqual(session.wouldDrop(6), []);
  assert.deepEqual(session.wouldDrop(10), []);
});

test("setLeafCount keeps notes that fit and drops the rest", () => {
  const session = new Session(6);
  for (const midi of [60, 62, 64, 65, 67]) session.addStrike(rec(midi));

  session.setLeafCount(3);
  assert.equal(session.leafCount, 3);
  assert.equal(session.slots.length, 3);
  assert.deepEqual(
    session.sortedByPitch().map((slot) => slot.label),
    ["C4", "D4", "E4"],
  );
  assert.equal(session.activeSlot, null);

  session.setLeafCount(5);
  assert.equal(session.slots.length, 5);
  assert.equal(session.activeSlot, 3);
});

test("setLeafCount keeps the active slot when it still fits", () => {
  const session = new Session(2);
  session.addStrike(rec(60));
  assert.equal(session.activeSlot, 1);

  session.setLeafCount(5);
  assert.equal(session.activeSlot, 1);
});

test("invalid leaf counts and slot indexes are rejected", () => {
  assert.throws(() => new Session(0), RangeError);
  assert.throws(() => new Session(31), RangeError);
  assert.throws(() => new Session(2.5), RangeError);

  const session = new Session(4);
  assert.throws(() => session.setLeafCount(0), RangeError);
  assert.throws(() => session.wouldDrop(31), RangeError);
  assert.throws(() => session.selectSlot(4), RangeError);
  assert.throws(() => session.selectSlot(-1), RangeError);
});
