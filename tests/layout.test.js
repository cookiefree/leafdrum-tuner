import test from "node:test";
import assert from "node:assert/strict";

import layout from "../src/layout.js";

const GROUP_ORDER = [
  "Center",
  "Top",
  "Top-right",
  "Right",
  "Bottom-right",
  "Bottom",
  "Bottom-left",
  "Left",
  "Top-left",
];

test("layout has 27 tongues with unique ids", () => {
  assert.equal(layout.tongues.length, 27);
  const ids = layout.tongues.map((tongue) => tongue.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("tongues are in the playing order, center first and then clockwise from the top", () => {
  const expected = GROUP_ORDER.flatMap((groupName) => [
    { groupName, size: "big" },
    { groupName, size: "middle" },
    { groupName, size: "small" },
  ]);
  assert.deepEqual(
    layout.tongues.map(({ groupName, size }) => ({ groupName, size })),
    expected,
  );
});

test("there are 9 groups with big, middle and small tongues in each", () => {
  const groups = new Map();
  for (const tongue of layout.tongues) {
    if (!groups.has(tongue.groupName)) groups.set(tongue.groupName, []);
    groups.get(tongue.groupName).push(tongue.size);
  }
  assert.equal(groups.size, 9);
  assert.deepEqual([...groups.keys()], GROUP_ORDER);
  for (const sizes of groups.values()) {
    assert.deepEqual(sizes, ["big", "middle", "small"]);
  }
});

test("each tongue label names its group and size", () => {
  for (const tongue of layout.tongues) {
    assert.equal(tongue.label, `${tongue.groupName}, ${tongue.size}`);
  }
  assert.equal(layout.tongues[4].label, "Top, middle");
});
