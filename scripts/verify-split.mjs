#!/usr/bin/env node
/**
 * Checks `splitGeometryByCut` against the shipped mesh.
 *
 * A tear has to conserve the wrapper: no triangle may straddle the cut, the two
 * halves must add back up to the original surface area, and the severed edge has
 * to close into loops rather than leaving gaps — otherwise the torn pack shows
 * holes at the seam.
 *
 * Run with the TypeScript sources compiled on the fly by Node's type stripping:
 *   node scripts/verify-split.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { parseObj } = await import('../src/parseObj.ts');
const { splitGeometryByCut } = await import('../src/splitMesh.ts');

const obj = readFileSync(resolve(here, '..', 'assets', 'pack', 'models', 'pack.obj'), 'utf8');
const geometry = parseObj(obj);

function surfaceArea(g) {
  const p = g.getAttribute('position');
  let total = 0;
  for (let f = 0; f < p.count / 3; f++) {
    const [a, b, c] = [0, 1, 2].map((i) => [
      p.getX(f * 3 + i),
      p.getY(f * 3 + i),
      p.getZ(f * 3 + i),
    ]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    total += Math.hypot(
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ) / 2;
  }
  return total;
}

/** No vertex of a half may sit on the wrong side of the cut, beyond float noise. */
function straddlers(g, cut, sign) {
  const p = g.getAttribute('position');
  let worst = 0;
  for (let i = 0; i < p.count; i++) {
    const d = (p.getY(i) - cut(p.getX(i))) * sign;
    if (d < worst) worst = d;
  }
  return worst;
}

/** Every seam endpoint should be shared by exactly two segments if the cut closes. */
function openEnds(seam) {
  const counts = new Map();
  for (let i = 0; i < seam.length; i += 3) {
    const key = [seam[i], seam[i + 1], seam[i + 2]].map((n) => n.toFixed(4)).join(',');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].filter((n) => n % 2 === 1).length;
}

const bb = geometry.boundingBox;
console.log(
  `mesh: ${geometry.getAttribute('position').count / 3} triangles, ` +
    `bounds y ${bb.min.y.toFixed(3)}..${bb.max.y.toFixed(3)}, x ${bb.min.x.toFixed(3)}..${bb.max.x.toFixed(3)}`,
);

const span = bb.max.y - bb.min.y;
const tearY = bb.min.y + span * 0.8;

// TCGer authors its cuts on a 2.3 × 3.3 pack; this mesh is 4.554 × 8.144, so its
// fallback jag is restated here in mesh units to test what actually ships.
const X = 2.3 / (bb.max.x - bb.min.x);
const Y = span / 3.3;

const cuts = {
  'straight perforation': () => tearY,
  'drawn tear (one arc)': (x) => tearY + Math.sin(x * 1.4) * 0.35,
  'drawn tear (wobbly)': (x) => tearY + Math.sin(x * 3.1) * 0.3 + Math.sin(x * 7.7 + 1) * 0.12,
  "TCGer's fallback jag": (x) =>
    tearY + Math.sin(x * X * 23.7) * 0.012 * Y + Math.sin(x * X * 57.3 + 2) * 0.009 * Y,
  'steep diagonal': (x) => tearY + x * 0.35,
  'above the mesh (no-op)': () => bb.max.y + 1,
  'below the mesh (no-op)': () => bb.min.y - 1,
};

const whole = surfaceArea(geometry);
let failures = 0;

for (const [name, cut] of Object.entries(cuts)) {
  const { below, above, seam, levels } = splitGeometryByCut(geometry, cut);
  const areaBelow = surfaceArea(below);
  const areaAbove = surfaceArea(above);
  const drift = Math.abs(areaBelow + areaAbove - whole) / whole;
  const worstBelow = straddlers(below, cut, -1);
  const worstAbove = straddlers(above, cut, 1);
  const open = openEnds(seam);

  // Overshoot is judged against the refinement tolerance, not zero: a curved cut
  // is straight only within a triangle, so the bound is what was asked for.
  const tolerance = span * 0.001;
  const ok = drift < 1e-6 && worstBelow > -tolerance && worstAbove > -tolerance && open === 0;
  if (!ok) failures++;

  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(24)} ` +
      `L${levels} tris ${String(below.getAttribute('position').count / 3).padStart(5)}/${String(
        above.getAttribute('position').count / 3,
      ).padEnd(5)} ` +
      `area drift ${drift.toExponential(1)}  ` +
      `overshoot ${Math.min(worstBelow, worstAbove).toExponential(1)} (tol ${(-tolerance).toExponential(1)})  ` +
      `seam segs ${String(seam.length / 6).padStart(4)}, open ends ${open}`,
  );
}

process.exit(failures === 0 ? 0 : 1);
