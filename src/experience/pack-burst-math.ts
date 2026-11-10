/**
 * The arithmetic behind the burst opening: springs, the rolled tear line, the
 * ring the cards unwind through, and the table layout they land in.
 *
 * Kept free of Three and the DOM so `npm run verify-burst` can exercise it
 * under plain Node, and so the scene file only has to turn these numbers into
 * transforms.
 */

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const k = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return k * k * (3 - 2 * k);
};

/** Deterministic generator so a tear line can be reproduced from its seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A damped spring described the way designers describe one: `response` is the
 * period in seconds, `bounce` is 0 for critically damped and approaches 1 for
 * undamped. Everything that moves in the burst scene is one of these, so an
 * interrupted gesture keeps its velocity instead of restarting a tween.
 */
export class Spring {
  x: number;
  to: number;
  v = 0;
  stiffness = 0;
  damping = 0;

  constructor(x: number, response = 0.5, bounce = 0) {
    this.x = x;
    this.to = x;
    this.tune(response, bounce);
  }

  tune(response: number, bounce = 0): this {
    this.stiffness = (2 * Math.PI / response) ** 2;
    this.damping = (4 * Math.PI * (1 - bounce)) / response;
    return this;
  }

  snap(x: number): this {
    this.x = x;
    this.to = x;
    this.v = 0;
    return this;
  }

  /** Detach from the target: the value is then driven by hand (see `orbitPose`). */
  release(): this {
    this.stiffness = 0;
    this.damping = 0;
    this.v = 0;
    return this;
  }

  step(h: number): void {
    this.v += (this.stiffness * (this.to - this.x) - this.damping * this.v) * h;
    this.x += this.v * h;
  }
}

/**
 * Semi-implicit Euler is only stable while the step is short against the
 * stiffest spring, so a slow frame is cut into 240 Hz slices.
 */
export function stepSprings(springs: Iterable<Spring>, dt: number): void {
  const steps = Math.max(1, Math.ceil(dt * 240));
  const h = dt / steps;
  for (const spring of springs) {
    for (let i = 0; i < steps; i += 1) spring.step(h);
  }
}

/* -------------------------------- tear line -------------------------------- */

export interface TearLineOptions {
  /** Half the pack's width: the line spans [-halfWidth, halfWidth]. */
  halfWidth: number;
  /** Height the line is centred on, normally the printed perforation. */
  baseY: number;
  minY: number;
  maxY: number;
  /** Unit the wander is scaled by, normally the pack's height. */
  scale: number;
  segments?: number;
}

export interface TearLine {
  /** Height of the tear at mesh-local x, piecewise linear between samples. */
  cut: (x: number) => number;
  highest: number;
  lowest: number;
  /** How tightly this pack's strip rolls up, 0.65 – 1.4. */
  roll: number;
}

/**
 * Every pack tears differently: the line climbs or dives across the wrapper,
 * bows, wobbles, drifts on a random walk and now and then snags and jumps.
 * It is rolled once per pack — before the first touch — so the mesh can be
 * split ahead of the gesture and the tear itself costs nothing.
 */
export function rollTearLine(
  random: () => number,
  { halfWidth, baseY, minY, maxY, scale, segments = 96 }: TearLineOptions,
): TearLine {
  const between = (a: number, b: number) => a + random() * (b - a);
  const slope = between(-0.034, 0.034) * scale;
  const bow = between(-0.016, 0.016) * scale;
  const wobble = between(0.002, 0.006) * scale;
  const frequency = between(1.5, 3.5);
  const phase = between(0, Math.PI * 2);
  const offset = between(-0.012, 0.012) * scale;
  const roll = between(0.65, 1.4);

  let walk = 0;
  const heights = new Float64Array(segments + 1);
  let highest = -Infinity;
  let lowest = Infinity;
  for (let i = 0; i <= segments; i += 1) {
    const s = (i / segments) * 2 - 1;
    walk = clamp(
      walk +
        between(-0.0014, 0.0014) * scale +
        (random() < 0.05 ? between(-0.008, 0.008) * scale : 0),
      -0.012 * scale,
      0.012 * scale,
    );
    const tooth =
      between(-0.002, 0.002) * scale +
      (random() < 0.14 ? between(-0.005, 0.005) * scale : 0);
    const y = clamp(
      baseY +
        offset +
        slope * s +
        bow * (1 - s * s) +
        wobble * Math.sin(s * frequency * Math.PI + phase) +
        walk +
        tooth,
      minY,
      maxY,
    );
    heights[i] = y;
    highest = Math.max(highest, y);
    lowest = Math.min(lowest, y);
  }

  const cut = (x: number): number => {
    const f = clamp((x + halfWidth) / (2 * halfWidth), 0, 1) * segments;
    const i = Math.min(segments - 1, Math.floor(f));
    return heights[i] + (heights[i + 1] - heights[i]) * (f - i);
  };

  return { cut, highest, lowest, roll };
}

/* ---------------------------------- layout --------------------------------- */

export interface FanSlot {
  x: number;
  y: number;
  z: number;
  /** Lean in radians, positive counter-clockwise. */
  rz: number;
  scale: number;
  row: number;
}

export interface FanLayoutInput {
  count: number;
  /** Visible world size at the plane the cards rest on. */
  viewWidth: number;
  viewHeight: number;
  cardWidth: number;
  cardHeight: number;
  /** World-space room kept clear for host chrome. */
  padTop?: number;
  padBottom?: number;
  padSide?: number;
  maxScale?: number;
}

/** A card keeps at least this much of its width clear of its neighbour. */
const MIN_VISIBLE = 0.46;
/** Side by side with a gap of 7% of a card. */
const FLAT_STEP = 1.07;
/** Cards shrink this far before a row is allowed to overlap. */
const COMFORT_SCALE = 0.62;
/** Lean per card in radians: a hand of cards, and a row laid out flat. */
const TIGHT_LEAN = 0.075;
const FLAT_LEAN = 0.028;
/** The outermost card of a row never leans further than this. */
const MAX_ROW_LEAN = 0.24;

/**
 * Where every card comes to rest: one row with clear gaps when there is room,
 * a hand of overlapping cards when there is not, and more rows on a tall
 * screen. Each candidate row count is scored by how large the cards end up
 * and how much of each stays visible; the best one wins.
 *
 * Later cards lie over earlier ones, so on an overlapped row it is the left
 * edge of every card — where a trading card prints its name — that shows.
 */
export function fanLayout({
  count,
  viewWidth,
  viewHeight,
  cardWidth,
  cardHeight,
  padTop = 0.3,
  padBottom = 0.3,
  padSide = 0.2,
  maxScale = 1,
}: FanLayoutInput): FanSlot[] {
  if (count <= 0) return [];
  const width = Math.max(0.1, viewWidth - padSide * 2);
  const height = Math.max(0.1, viewHeight - padTop - padBottom);
  const centreY = (padBottom - padTop) / 2;

  // The end cards of a row lean over, so their corners reach further out than
  // their width: budget for that up front and the row never leaves the screen.
  const leanPerCard = (inRow: number) =>
    Math.min(TIGHT_LEAN, MAX_ROW_LEAN / Math.max(1, (inRow - 1) / 2));
  const leanReach = (inRow: number) =>
    cardHeight * Math.sin((leanPerCard(inRow) * (inRow - 1)) / 2);
  const stepFor = (inRow: number, scale: number) => {
    const w = cardWidth * scale;
    return inRow > 1
      ? Math.min(
          w * FLAT_STEP,
          (width - w - leanReach(inRow) * scale) / (inRow - 1),
        )
      : 0;
  };

  let best = { rows: 1, scale: 0, score: -Infinity };
  for (let rows = 1; rows <= Math.min(4, count); rows += 1) {
    const perRow = Math.ceil(count / rows);
    const reach = leanReach(perRow);
    const fit = Math.min(maxScale, height / (rows * cardHeight * 1.06));
    const flat = width / (cardWidth * (1 + FLAT_STEP * (perRow - 1)) + reach);
    const overlapped =
      width / (cardWidth * (1 + MIN_VISIBLE * (perRow - 1)) + reach);
    const scale = Math.min(
      clamp(flat, Math.min(COMFORT_SCALE, fit), fit),
      overlapped,
    );
    const w = cardWidth * scale;
    const visible = perRow > 1 ? Math.min(1, stepFor(perRow, scale) / w) : 1;
    // Fewer rows read better, so an extra row has to earn its place.
    const score = scale * (0.55 + 0.45 * visible) * (1 - 0.1 * (rows - 1));
    if (score > best.score) best = { rows, scale, score };
  }

  const { rows, scale } = best;
  const w = cardWidth * scale;
  const pitch = cardHeight * scale * 1.06;
  const perRow = Math.ceil(count / rows);
  const slots: FanSlot[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / perRow);
    const inRow = Math.min(perRow, count - row * perRow);
    const column = index - row * perRow;
    const step = stepFor(inRow, scale);
    const tight = inRow > 1 && step < w;
    const m = column - (inRow - 1) / 2;
    slots.push({
      x: m * step,
      y:
        centreY +
        ((rows - 1) / 2 - row) * pitch -
        m * m * (tight ? 0.032 : 0.016) * scale,
      z: index * 0.004,
      rz: -m * (tight ? leanPerCard(inRow) : FLAT_LEAN),
      scale,
      row,
    });
  }
  return slots;
}

export interface SlotHit {
  index: number;
  /** Where on the card the point falls, 0–1 from its left and bottom edges. */
  u: number;
  v: number;
}

/**
 * Which card a point is over, judged by where the cards rest rather than
 * where they currently are. A card that lifts and tilts under the pointer can
 * therefore never slide out from under it and flicker, and every visible
 * sliver of an overlapped row is its own target.
 */
export function slotAt(
  x: number,
  y: number,
  slots: readonly FanSlot[],
  cardWidth: number,
  cardHeight: number,
): SlotHit | null {
  for (let index = slots.length - 1; index >= 0; index -= 1) {
    const slot = slots[index];
    const cos = Math.cos(-slot.rz);
    const sin = Math.sin(-slot.rz);
    const dx = x - slot.x;
    const dy = y - slot.y;
    const u = (dx * cos - dy * sin) / (cardWidth * slot.scale) + 0.5;
    const v = (dx * sin + dy * cos) / (cardHeight * slot.scale) + 0.5;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return { index, u, v };
  }
  return null;
}

/* ---------------------------------- unwind --------------------------------- */

export interface OrbitInput {
  /** 0 → 1 across the unwind. */
  progress: number;
  /** Position within the deck, 0 … count - 1. */
  index: number;
  count: number;
  /** Where the card was when the deck cleared the wrapper. */
  from: { x: number; y: number; rz: number };
  /** Where the launch would have carried it, so the hand-off has no kink. */
  coastY: number;
  slot: FanSlot;
  centreY: number;
  radiusX: number;
  radiusY: number;
  radiusZ: number;
}

export interface OrbitPose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

/** Turns of the ring before it opens out into the row. */
const ORBIT_TURNS = 1.25;

/**
 * The deck leaves the wrapper as a stack, opens into a ring that sweeps
 * round the middle of the stage facing the viewer, and the ring then opens
 * out into the resting layout. The pose is a pure function of progress, so
 * every card arrives exactly on its slot whatever the frame rate.
 */
export function orbitPose({
  progress,
  index,
  count,
  from,
  coastY,
  slot,
  centreY,
  radiusX,
  radiusY,
  radiusZ,
}: OrbitInput): OrbitPose {
  const u = clamp(progress, 0, 1);
  const turned = 1 - (1 - u) ** 2;
  const out = smoothstep(0.52, 1, u);
  const ring = Math.sin(Math.min(1, u / 0.42) * (Math.PI / 2)) * (1 - out);

  // The ring starts evenly spaced and ends with every card on the bearing of
  // its own slot, so the hand-off from circle to row needs no crossing.
  const even = (-index * 2 * Math.PI) / Math.max(1, count);
  const end = Math.PI / 2 - (index - (count - 1) / 2) * 0.55;
  const angle = end + (1 - turned) * (even - end + Math.PI * 2 * ORBIT_TURNS);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const hub = coastY + (centreY - coastY) * smoothstep(0, 0.42, u);
  return {
    x: from.x * (1 - out) + slot.x * out + cos * radiusX * ring,
    // Seen from a little above: the near side of the ring sits lower.
    y: hub * (1 - out) + slot.y * out - sin * radiusY * ring,
    z: slot.z * out + sin * radiusZ * ring,
    rx: -0.12 * ring,
    ry: -cos * 0.45 * ring,
    rz: from.rz * (1 - out) + slot.rz * out + cos * 0.14 * ring,
  };
}
