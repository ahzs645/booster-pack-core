import assert from "node:assert/strict";

import {
  shouldShowBackwardsCard,
  syncBackwardsCardVisibility,
} from "../src/experience/pack-card-visibility.ts";

const visibility = (topIndex, isolatedIndex) =>
  Array.from({ length: 4 }, (_, index) =>
    shouldShowBackwardsCard(index, topIndex, isolatedIndex),
  );

assert.deepEqual(visibility(0, null), [true, true, true, true]);
assert.deepEqual(visibility(1, null), [false, true, true, true]);
assert.deepEqual(visibility(1, 1), [false, true, false, false]);

const groups = Array.from({ length: 4 }, () => ({ visible: true }));
syncBackwardsCardVisibility(groups, 1, 1);
assert.deepEqual(
  groups.map((group) => group.visible),
  [false, true, false, false],
);

// Completing the face reveal restores the unchanged stack.
syncBackwardsCardVisibility(groups, 1);
assert.deepEqual(
  groups.map((group) => group.visible),
  [false, true, true, true],
);

// Completing the advancing flip hides the old top and restores the new stack.
syncBackwardsCardVisibility(groups, 2);
assert.deepEqual(
  groups.map((group) => group.visible),
  [false, false, true, true],
);

console.log("Card visibility invariant verified.");
