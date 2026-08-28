import assert from "node:assert/strict";

import {
  generatePack,
  packOddsReference,
  possiblePackCards,
} from "../src/experience/pack-data.ts";

assert.equal(generatePack(false, "swsh7", () => 0.5).length, 5);
assert.equal(generatePack(false, "base1", () => 0.5).length, 11);
assert.ok(possiblePackCards("me5").length > 0);
assert.ok(packOddsReference("swsh7").url.startsWith("https://"));

for (const operation of [
  () => generatePack(false, "unknown-community-game"),
  () => possiblePackCards("unknown-community-game"),
  () => packOddsReference("unknown-community-game"),
]) {
  assert.throws(operation, /Unknown pack pool/);
}

console.log("Pack pool fail-closed checks passed.");
