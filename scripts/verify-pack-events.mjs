import assert from "node:assert/strict";

import {
  emptyOpeningProgress,
  generatePackForClass,
  rollPackClass,
  updateOpeningProgress,
} from "../src/experience/pack-events.ts";
import {
  generatePack,
  possiblePackCards,
  tierRank,
} from "../src/experience/pack-data.ts";

assert.equal(rollPackClass("swsh7", () => 0.9599).id, "standard");
assert.equal(rollPackClass("swsh7", () => 0.96).id, "hit-heavy");
assert.equal(rollPackClass("swsh7", () => 0.9899).id, "hit-heavy");
assert.equal(rollPackClass("swsh7", () => 0.99).id, "rare-pack");
assert.equal(rollPackClass("base1", () => 0.9999).id, "standard");

const semiGod = rollPackClass("swsh7", () => 0.97);
const semiGodPack = generatePackForClass(semiGod, false, "swsh7", () => 0.5);
assert.equal(semiGodPack.length, 5);
assert.ok(
  semiGodPack.filter((card) => tierRank(card.tier) >= tierRank("rare"))
    .length >= 3,
);

const godPack = rollPackClass("swsh7", () => 0.995);
const godPackCards = generatePackForClass(godPack, false, "swsh7", () => 0.5);
assert.equal(godPackCards.length, 5);
assert.ok(
  godPackCards.every((card) => tierRank(card.tier) >= tierRank("rare")),
);

const ordinaryClass = rollPackClass("swsh7", () => 0.5);
const ordinaryPack = generatePack(false, "swsh7", () => 0.5);
const first = updateOpeningProgress(emptyOpeningProgress(), {
  openingID: "opening-1",
  packPool: "swsh7",
  setName: "Evolving Skies",
  packs: [ordinaryPack],
  packClasses: [ordinaryClass],
});
assert.equal(first.recap.progress.totalPacks, 1);
assert.ok(first.recap.unlockedAchievements.some(({ id }) => id === "packs-1"));

const deduplicated = updateOpeningProgress(first.progress, {
  openingID: "opening-1",
  packPool: "swsh7",
  setName: "Evolving Skies",
  packs: [ordinaryPack],
  packClasses: [ordinaryClass],
});
assert.equal(deduplicated.recap.progress.totalPacks, 1);

const boosterBox = updateOpeningProgress(first.progress, {
  openingID: "opening-2",
  packPool: "swsh7",
  setName: "Evolving Skies",
  packs: Array.from({ length: 35 }, () => ordinaryPack),
  packClasses: Array.from({ length: 35 }, () => ordinaryClass),
});
assert.equal(boosterBox.recap.progress.totalPacks, 36);
assert.ok(
  boosterBox.recap.unlockedAchievements.some(({ id }) => id === "packs-36"),
);

const masterSet = updateOpeningProgress(emptyOpeningProgress(), {
  openingID: "master-set",
  packPool: "swsh7",
  setName: "Evolving Skies",
  packs: [possiblePackCards("swsh7")],
  packClasses: [ordinaryClass],
});
assert.equal(masterSet.recap.progress.completionPercentage, 100);
assert.ok(
  masterSet.recap.unlockedAchievements.some(
    ({ id }) => id === "master-set-swsh7",
  ),
);

console.log("Pack rarity events and opening progression checks passed.");
