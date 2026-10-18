const MIN_LEAF_COUNT = 1;
const MAX_LEAF_COUNT = 30;

function assertLeafCount(count) {
  if (!Number.isInteger(count) || count < MIN_LEAF_COUNT || count > MAX_LEAF_COUNT) {
    throw new RangeError(
      `leaf count must be an integer between ${MIN_LEAF_COUNT} and ${MAX_LEAF_COUNT}`,
    );
  }
}

export class Session {
  constructor(leafCount) {
    assertLeafCount(leafCount);
    this.leafCount = leafCount;
    this.slots = new Array(leafCount).fill(null);
    this.activeSlot = 0;
  }

  selectSlot(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.leafCount) {
      throw new RangeError(`slot index must be an integer between 0 and ${this.leafCount - 1}`);
    }
    this.activeSlot = index;
  }

  addStrike(record) {
    // A filled active slot means the user explicitly chose it for re-recording,
    // so that slot is ignored by the duplicate check.
    const index = this.activeSlot;
    for (let i = 0; i < this.slots.length; i += 1) {
      const slot = this.slots[i];
      if (slot !== null && slot.midi === record.midi && i !== index) {
        return { status: "duplicate", existingSlot: i };
      }
    }
    if (index === null) {
      return { status: "full" };
    }
    this.slots[index] = record;
    this.activeSlot = this._nextEmptyFrom(index + 1);
    return { status: "filled", slot: index };
  }

  sortedByPitch() {
    return this.slots
      .filter((slot) => slot !== null)
      .sort((a, b) => a.midi - b.midi);
  }

  wouldDrop(newCount) {
    assertLeafCount(newCount);
    const dropped = [];
    for (let i = newCount; i < this.slots.length; i += 1) {
      if (this.slots[i] !== null) dropped.push(this.slots[i]);
    }
    return dropped;
  }

  setLeafCount(newCount) {
    assertLeafCount(newCount);
    if (newCount === this.leafCount) return;

    const kept = this.slots.slice(0, newCount);
    this.slots = kept.concat(new Array(newCount - kept.length).fill(null));
    this.leafCount = newCount;

    if (this.activeSlot === null || this.activeSlot >= newCount) {
      this.activeSlot = this._nextEmptyFrom(0);
    }
  }

  reset() {
    this.slots = new Array(this.leafCount).fill(null);
    this.activeSlot = 0;
  }

  _nextEmptyFrom(start) {
    const count = this.slots.length;
    for (let step = 0; step < count; step += 1) {
      const index = (start + step) % count;
      if (this.slots[index] === null) return index;
    }
    return null;
  }
}
