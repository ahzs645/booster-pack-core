#!/usr/bin/env node
/**
 * Checks the burst opening's arithmetic: springs settle, a rolled tear line
 * stays inside the band the wrapper can be torn in, the unwind starts where the
 * launch left each card and ends exactly on its slot, and the resting layout
 * keeps every card on screen and reachable.
 */
import assert from "node:assert/strict";

import {
  Spring,
  fanLayout,
  orbitPose,
  rollTearLine,
  seededRandom,
  slotAt,
  stepSprings,
} from "../src/experience/pack-burst-math.ts";

const CARD_W = 2.02;
const CARD_H = CARD_W * (88 / 63);

// --- springs ---------------------------------------------------------------
{
  const spring = new Spring(0, 0.5, 0.3);
  spring.to = 1;
  let peak = 0;
  for (let i = 0; i < 180; i += 1) {
    stepSprings([spring], 1 / 60);
    peak = Math.max(peak, spring.x);
  }
  assert.ok(Math.abs(spring.x - 1) < 1e-3, "a spring settles on its target");
  assert.ok(peak > 1.01, "a bouncy spring overshoots");

  const stiff = new Spring(0, 0.1, 0);
  stiff.to = 1;
  let overshoot = 0;
  // One 50 ms frame is half this spring's period: unsubstepped it would explode.
  for (let i = 0; i < 40; i += 1) {
    stepSprings([stiff], 0.05);
    overshoot = Math.max(overshoot, stiff.x);
    assert.ok(Number.isFinite(stiff.x));
  }
  assert.ok(Math.abs(stiff.x - 1) < 1e-3, "a stiff spring survives slow frames");
  assert.ok(overshoot < 1.02, "a critically damped spring does not overshoot");
}

// --- tear line -------------------------------------------------------------
{
  const options = { halfWidth: 1.15, baseY: 1.2, minY: 0.55, maxY: 1.65, scale: 4.11 };
  const shapes = new Set();
  for (let seed = 1; seed <= 200; seed += 1) {
    const line = rollTearLine(seededRandom(seed), options);
    assert.ok(line.roll >= 0.65 && line.roll <= 1.4);
    for (let i = 0; i <= 400; i += 1) {
      const x = -1.3 + (2.6 * i) / 400;
      const y = line.cut(x);
      assert.ok(y >= options.minY && y <= options.maxY, "the tear stays in its band");
      assert.ok(y >= line.lowest - 1e-9 && y <= line.highest + 1e-9);
    }
    // Past either edge the line holds its end height, so the wrapper's rounded
    // sides are cut level rather than extrapolated.
    assert.equal(line.cut(-5), line.cut(-options.halfWidth));
    assert.equal(line.cut(5), line.cut(options.halfWidth));
    shapes.add(line.cut(0).toFixed(4));
  }
  assert.ok(shapes.size > 150, "every pack tears differently");
  const again = rollTearLine(seededRandom(7), options);
  const same = rollTearLine(seededRandom(7), options);
  assert.equal(again.cut(0.3), same.cut(0.3), "a seed reproduces its tear");
}

// --- layout ----------------------------------------------------------------
const VIEWS = [
  ["desktop", 7.38, 5.1],
  ["wide", 9.06, 5.1],
  ["tablet", 3.82, 5.1],
  ["phone", 2.36, 5.1],
];
for (const [name, viewWidth, viewHeight] of VIEWS) {
  for (const count of [1, 3, 5, 6, 10, 11]) {
    const pad = { padTop: 0.35, padBottom: 0.8, padSide: 0.12 };
    const slots = fanLayout({
      count, viewWidth, viewHeight, cardWidth: CARD_W, cardHeight: CARD_H, ...pad,
    });
    assert.equal(slots.length, count);
    for (const [index, slot] of slots.entries()) {
      const halfW = (CARD_W * slot.scale) / 2;
      const halfH = (CARD_H * slot.scale) / 2;
      // Leaning cards reach a little past their upright box.
      const reach = halfW * Math.cos(slot.rz) + halfH * Math.abs(Math.sin(slot.rz));
      assert.ok(
        Math.abs(slot.x) + reach <= viewWidth / 2 + 0.03,
        `${name} ×${count}: card ${index} stays on screen`,
      );
      assert.ok(slot.scale > 0.2 && slot.scale <= 1, `${name} ×${count}: usable size`);
      // The middle of every card's left third belongs to that card alone.
      const probeX = slot.x - halfW * 0.6 * Math.cos(slot.rz);
      const probeY = slot.y - halfW * 0.6 * Math.sin(slot.rz);
      assert.equal(
        slotAt(probeX, probeY, slots, CARD_W, CARD_H)?.index,
        index,
        `${name} ×${count}: card ${index} can be picked`,
      );
    }
    for (let index = 1; index < count; index += 1) {
      if (slots[index].row !== slots[index - 1].row) continue;
      const step = slots[index].x - slots[index - 1].x;
      assert.ok(
        step >= CARD_W * slots[index].scale * 0.45,
        `${name} ×${count}: card ${index - 1} keeps a readable sliver`,
      );
    }
  }
}
assert.equal(slotAt(50, 50, fanLayout({
  count: 5, viewWidth: 7, viewHeight: 5, cardWidth: CARD_W, cardHeight: CARD_H,
}), CARD_W, CARD_H), null);

// --- unwind ----------------------------------------------------------------
{
  const count = 5;
  const slots = fanLayout({
    count, viewWidth: 7.38, viewHeight: 5.1, cardWidth: CARD_W, cardHeight: CARD_H,
  });
  for (let index = 0; index < count; index += 1) {
    const input = {
      index, count,
      from: { x: 0.2, y: 1.4, rz: 0.05 },
      coastY: 1.9,
      slot: slots[index],
      centreY: 0.1,
      radiusX: 2.4, radiusY: 0.5, radiusZ: 1.4,
    };
    const start = orbitPose({ ...input, progress: 0 });
    assert.ok(Math.abs(start.x - 0.2) < 1e-9 && Math.abs(start.y - 1.9) < 1e-9);
    assert.ok(Math.abs(start.z) < 1e-9 && Math.abs(start.ry) < 1e-9);
    const end = orbitPose({ ...input, progress: 1 });
    for (const key of ["x", "y", "z", "rz"]) {
      assert.ok(Math.abs(end[key] - slots[index][key]) < 1e-9, `card ${index} lands on its slot (${key})`);
    }
    assert.ok(Math.abs(end.rx) < 1e-9 && Math.abs(end.ry) < 1e-9);
    // No teleporting: the path is continuous at 120 Hz.
    let previous = start;
    for (let step = 1; step <= 150; step += 1) {
      const pose = orbitPose({ ...input, progress: step / 150 });
      assert.ok(Math.hypot(pose.x - previous.x, pose.y - previous.y, pose.z - previous.z) < 0.25);
      previous = pose;
    }
  }
}

console.log("Burst springs, tear line, layout and unwind verified.");
