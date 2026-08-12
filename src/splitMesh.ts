import * as THREE from 'three';

/**
 * The height the wrapper is torn at, as a function of position across it.
 *
 * Takes the mesh's local x and returns the local y the cut passes through there,
 * so a straight factory perforation is `() => y` and a hand-drawn tear is the
 * user's smoothed drag path.
 */
export type CutFn = (x: number) => number;

export interface SplitMesh {
  /** Everything below the cut — the part left in your hand. */
  below: THREE.BufferGeometry;
  /** Everything above it — the strip that comes away. */
  above: THREE.BufferGeometry;
  /**
   * The cut itself, as line segments: every triangle the cut passed through
   * contributes the one segment it was severed along. Build the tear's glowing
   * edge from this rather than re-deriving it from the cut function, so the
   * ribbon sits exactly on the torn boundary including around the pack's sides.
   */
  seam: Float32Array;
  /** How far the mesh had to be refined to follow this cut. */
  levels: number;
}

interface Sink {
  position: number[];
  uv: number[];
  normal: number[];
}

const newSink = (): Sink => ({ position: [], uv: [], normal: [] });

function toGeometry(sink: Sink): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(sink.position, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(sink.uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(sink.normal, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** One vertex's worth of every attribute, so intersections can be lerped as a unit. */
interface Vertex {
  px: number;
  py: number;
  pz: number;
  u: number;
  v: number;
  nx: number;
  ny: number;
  nz: number;
}

function read(
  pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null,
  nor: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null,
  i: number,
): Vertex {
  return {
    px: pos.getX(i),
    py: pos.getY(i),
    pz: pos.getZ(i),
    u: uv ? uv.getX(i) : 0,
    v: uv ? uv.getY(i) : 0,
    nx: nor ? nor.getX(i) : 0,
    ny: nor ? nor.getY(i) : 0,
    nz: nor ? nor.getZ(i) : 1,
  };
}

function lerp(a: Vertex, b: Vertex, t: number): Vertex {
  const m = (x: number, y: number) => x + (y - x) * t;
  const v: Vertex = {
    px: m(a.px, b.px),
    py: m(a.py, b.py),
    pz: m(a.pz, b.pz),
    u: m(a.u, b.u),
    v: m(a.v, b.v),
    nx: m(a.nx, b.nx),
    ny: m(a.ny, b.ny),
    nz: m(a.nz, b.nz),
  };
  const len = Math.hypot(v.nx, v.ny, v.nz) || 1;
  v.nx /= len;
  v.ny /= len;
  v.nz /= len;
  return v;
}

function push(sink: Sink, ...vs: Vertex[]) {
  for (const v of vs) {
    sink.position.push(v.px, v.py, v.pz);
    sink.uv.push(v.u, v.v);
    sink.normal.push(v.nx, v.ny, v.nz);
  }
}

/**
 * Where an edge crosses the cut.
 *
 * The linear guess `da / (da - db)` is only right if the cut runs straight along
 * the edge, and the shipped wrap's triangles are wide enough that it often does
 * not — so the guess is refined by bisecting the real cut function. This lands
 * the torn edge on the cut exactly, whatever the mesh's resolution; refinement
 * then handles the separate problem of the cut bending *between* two crossings.
 */
function crossing(a: Vertex, b: Vertex, da: number, cut: CutFn): Vertex {
  let lo = 0;
  let hi = 1;
  let dLo = da;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) * 0.5;
    const x = a.px + (b.px - a.px) * mid;
    const y = a.py + (b.py - a.py) * mid;
    const d = y - cut(x);
    if (d === 0) {
      lo = hi = mid;
      break;
    }
    if (d > 0 === dLo > 0) {
      lo = mid;
      dLo = d;
    } else {
      hi = mid;
    }
  }
  return lerp(a, b, (lo + hi) * 0.5);
}

/** Exactly halfway, computed commutatively so both sides of a shared edge agree bit for bit. */
function midpoint(a: Vertex, b: Vertex): Vertex {
  const m = (x: number, y: number) => (x + y) * 0.5;
  const v: Vertex = {
    px: m(a.px, b.px),
    py: m(a.py, b.py),
    pz: m(a.pz, b.pz),
    u: m(a.u, b.u),
    v: m(a.v, b.v),
    nx: m(a.nx, b.nx),
    ny: m(a.ny, b.ny),
    nz: m(a.nz, b.nz),
  };
  const len = Math.hypot(v.nx, v.ny, v.nz) || 1;
  v.nx /= len;
  v.ny /= len;
  v.nz /= len;
  return v;
}

/**
 * Splits every triangle into four on its edge midpoints.
 *
 * Uniform rather than adaptive on purpose: refining only the triangles near the
 * cut would leave T-junctions against their unrefined neighbours, and those show
 * as hairline cracks along the tear. Because each midpoint is derived from the
 * two endpoints alone, adjacent triangles land on identical vertices and the
 * surface stays watertight.
 */
function subdivideOnce(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv') ?? null;
  const nor = geometry.getAttribute('normal') ?? null;
  const out = newSink();

  for (let f = 0; f < pos.count / 3; f++) {
    const a = read(pos, uv, nor, f * 3);
    const b = read(pos, uv, nor, f * 3 + 1);
    const c = read(pos, uv, nor, f * 3 + 2);
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    push(out, a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  return toGeometry(out);
}

const subdivisions = new WeakMap<THREE.BufferGeometry, Map<number, THREE.BufferGeometry>>();

/** Refined copies are cached per level: they depend on the mesh alone, not on the cut. */
export function subdivide(geometry: THREE.BufferGeometry, levels: number): THREE.BufferGeometry {
  if (levels <= 0) return geometry;
  let byLevel = subdivisions.get(geometry);
  if (!byLevel) {
    byLevel = new Map();
    subdivisions.set(geometry, byLevel);
  }
  const cached = byLevel.get(levels);
  if (cached) return cached;
  const refined = subdivideOnce(subdivide(geometry, levels - 1));
  byLevel.set(levels, refined);
  return refined;
}

/**
 * Coarsest refinement at which the cut stays within `tolerance` of straight across
 * one triangle.
 *
 * Capped at 3 — 282 triangles become 18,048, which is still one cheap draw call,
 * where a fourth level would be 72,192 to chase detail finer than the tear ever
 * needs. A cut that wiggles faster than L3 resolves is reproduced as the chord
 * across each triangle rather than exactly; `splitGeometryByCut` reports the level
 * it settled on so a caller can tell when that happened.
 */
const MAX_SUBDIVISION = 3;

export function subdivisionFor(
  geometry: THREE.BufferGeometry,
  cut: CutFn,
  tolerance: number,
): number {
  const bb = geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(
    geometry.getAttribute('position') as THREE.BufferAttribute,
  );
  const x0 = bb.min.x;
  const x1 = bb.max.x;

  // The widest triangle sets how far the cut must hold straight; refining halves it.
  const pos = geometry.getAttribute('position');
  let widest = 0;
  for (let f = 0; f < pos.count / 3; f++) {
    const xs = [pos.getX(f * 3), pos.getX(f * 3 + 1), pos.getX(f * 3 + 2)];
    widest = Math.max(widest, Math.max(...xs) - Math.min(...xs));
  }

  /** How far the cut bows away from its own chord over a window this wide. */
  const bow = (w: number): number => {
    if (w <= 0) return 0;
    let worst = 0;
    const steps = 256;
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0 - w) * i) / steps;
      const chord = (cut(x) + cut(x + w)) * 0.5;
      worst = Math.max(worst, Math.abs(cut(x + w * 0.5) - chord));
    }
    return worst;
  };

  for (let k = 0; k < MAX_SUBDIVISION; k++) {
    if (bow(widest / 2 ** k) <= tolerance) return k;
  }
  return MAX_SUBDIVISION;
}

export interface SplitOptions {
  /**
   * How far the cut may stray from straight across a single triangle before the
   * mesh is refined, in mesh units. Defaults to 0.1% of the mesh's height.
   */
  tolerance?: number;
  /** Refinement level, if you would rather pin it than have it derived from the cut. */
  levels?: number;
}

/** Discards slivers left when the cut passes through a vertex, rather than emitting zero-area faces. */
const MIN_AREA = 1e-9;

function area(a: Vertex, b: Vertex, c: Vertex): number {
  const ux = b.px - a.px;
  const uy = b.py - a.py;
  const uz = b.pz - a.pz;
  const vx = c.px - a.px;
  const vy = c.py - a.py;
  const vz = c.pz - a.pz;
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

function emit(sink: Sink, a: Vertex, b: Vertex, c: Vertex) {
  if (area(a, b, c) > MIN_AREA) push(sink, a, b, c);
}

/**
 * Cuts a wrapper mesh in two along a tear line.
 *
 * Triangles wholly on one side are passed through untouched; the ones the cut
 * crosses are severed, with new vertices interpolated across every attribute so
 * the cover sheet stays continuous right up to the torn edge. Winding is
 * preserved, so both halves keep the original's facing.
 *
 * Expects the non-indexed, three-vertices-per-face geometry `parseObj` produces —
 * the same layout `buildUVAtlas` and `readSheetLayout` assume.
 */
export function splitGeometryByCut(
  geometry: THREE.BufferGeometry,
  cut: CutFn,
  options: SplitOptions = {},
): SplitMesh {
  const bb = geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(
    geometry.getAttribute('position') as THREE.BufferAttribute,
  );
  const tolerance = options.tolerance ?? (bb.max.y - bb.min.y) * 0.001;
  const levels = options.levels ?? subdivisionFor(geometry, cut, tolerance);
  const source = subdivide(geometry, levels);

  const pos = source.getAttribute('position');
  const uv = source.getAttribute('uv') ?? null;
  const nor = source.getAttribute('normal') ?? null;

  const below = newSink();
  const above = newSink();
  const seam: number[] = [];

  for (let f = 0; f < pos.count / 3; f++) {
    const tri = [read(pos, uv, nor, f * 3), read(pos, uv, nor, f * 3 + 1), read(pos, uv, nor, f * 3 + 2)];
    const d = tri.map((v) => v.py - cut(v.px));

    if (d[0] >= 0 && d[1] >= 0 && d[2] >= 0) {
      emit(above, tri[0], tri[1], tri[2]);
      continue;
    }
    if (d[0] <= 0 && d[1] <= 0 && d[2] <= 0) {
      emit(below, tri[0], tri[1], tri[2]);
      continue;
    }

    // Rotate so the vertex on its own side of the cut comes first; the two edges
    // that leave it are then the two the cut crosses, and (lone, p1, p2) keeps
    // the original winding.
    const lone = [0, 1, 2].find((i) => (d[i] > 0) !== (d[(i + 1) % 3] > 0) && (d[i] > 0) !== (d[(i + 2) % 3] > 0));
    if (lone === undefined) continue;

    const a = tri[lone];
    const b = tri[(lone + 1) % 3];
    const c = tri[(lone + 2) % 3];
    const da = d[lone];
    const dc = d[(lone + 2) % 3];

    const pAB = crossing(a, b, da, cut);
    const pCA = crossing(c, a, dc, cut);

    const loneSink = da > 0 ? above : below;
    const restSink = da > 0 ? below : above;

    emit(loneSink, a, pAB, pCA);
    emit(restSink, pAB, b, c);
    emit(restSink, pAB, c, pCA);

    seam.push(pAB.px, pAB.py, pAB.pz, pCA.px, pCA.py, pCA.pz);
  }

  return { below: toGeometry(below), above: toGeometry(above), seam: new Float32Array(seam), levels };
}
