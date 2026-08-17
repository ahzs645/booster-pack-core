import assert from "node:assert/strict";

import {
  cardDismissDirection,
  nextBackwardsRevealAction,
} from "../src/experience/pack-reveal.ts";

// Regular and backwards modes both respect the physical swipe direction.
assert.equal(cardDismissDirection(0, -40), -1);
assert.equal(cardDismissDirection(0, 40), 1);
// Buttons have no gesture direction, so their dismissals alternate naturally.
assert.equal(cardDismissDirection(0), 1);
assert.equal(cardDismissDirection(1), -1);

assert.deepEqual(
  nextBackwardsRevealAction({
    topIndex: 0,
    cardCount: 3,
    faceUp: false,
  }),
  { kind: "flip", index: 0 },
);

assert.deepEqual(
  nextBackwardsRevealAction({
    topIndex: 0,
    cardCount: 3,
    faceUp: true,
    direction: -40,
  }),
  { kind: "dismiss", index: 0, direction: -1, nextTopIndex: 1 },
);

assert.deepEqual(
  nextBackwardsRevealAction({
    topIndex: 1,
    cardCount: 3,
    faceUp: true,
    direction: 40,
  }),
  { kind: "dismiss", index: 1, direction: 1, nextTopIndex: 2 },
);

assert.deepEqual(
  nextBackwardsRevealAction({
    topIndex: 3,
    cardCount: 3,
    faceUp: false,
  }),
  { kind: "none" },
);

console.log("Backwards reveal transitions verified.");
