import * as THREE from 'three';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetLayout {
  width: number;
  height: number;
  /** The contiguous block the pack's display face samples — where cover art belongs. */
  front: Rect;
  /**
   * The opposite face, cut by the wrap seams into blocks laid either side of the
   * front on the sheet.
   *
   * Ordered by position around the pack, NOT by position on the sheet — the seam
   * puts the sheet's rightmost block first physically. Artwork continued across
   * the back must follow this order to stay unbroken on the mesh.
   */
  back: Rect[];
  /** Narrow vertical strips the side gussets sample, at the seams flanking the front. */
  seams: Rect[];
  /** Thin horizontal strips the crimped ends sample, at the very top and bottom. */
  crimps: Rect[];
  /** Which way the display face points along Z, so a viewer can turn it to camera. */
  displayFaceZ: 1 | -1;
  /**
   * How much wider than tall a texture pixel lands once mapped onto the display
   * face — the UV region's aspect divided by the face's real aspect.
   *
   * The wrap's UVs are not area-preserving, so artwork drawn square on the sheet
   * appears squashed on the pack. Pre-stretching by this factor cancels it out.
   */
  stretch: number;
}

const EPS = 0.002;

interface Block {
  u0: number;
  u1: number;
  /** Mean 3D x of the triangles in this block. */
  x: number;
}

/** Merge u-spans that touch, revealing the gaps the wrap seams cut into a panel. */
function mergeSpans(spans: Array<{ u0: number; u1: number; x: number }>): Block[] {
  const out: Array<Block & { n: number }> = [];
  for (const s of [...spans].sort((a, b) => a.u0 - b.u0)) {
    const last = out[out.length - 1];
    if (last && s.u0 <= last.u1 + EPS) {
      last.u1 = Math.max(last.u1, s.u1);
      last.x += s.x;
      last.n++;
    } else {
      out.push({ u0: s.u0, u1: s.u1, x: s.x, n: 1 });
    }
  }
  return out.map(({ u0, u1, x, n }) => ({ u0, u1, x: x / n }));
}

/**
 * Reads the sheet's regions off the mesh itself rather than hardcoding pixel bands,
 * so a different mesh or a re-authored UV layout stays correct.
 *
 * Only strongly axis-aligned triangles are considered — the pack's corners are
 * rounded, and including them would smear every region's bounds into its neighbours.
 */
export function readSheetLayout(
  geometry: THREE.BufferGeometry,
  width: number,
  height: number,
): SheetLayout {
  const pos = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const n = new THREE.Vector3();

  type Span = { u0: number; u1: number; x: number };
  interface Bucket {
    spans: Span[];
    v0: number;
    v1: number;
    /** World-space extent, for comparing against the UV extent. */
    wx0: number;
    wx1: number;
    wy0: number;
    wy1: number;
  }
  const buckets = new Map<string, Bucket>();

  for (let f = 0; f < uv.count / 3; f++) {
    a.fromBufferAttribute(pos, f * 3);
    b.fromBufferAttribute(pos, f * 3 + 1);
    c.fromBufferAttribute(pos, f * 3 + 2);
    n.copy(c).sub(b).cross(ab.copy(a).sub(b)).normalize();

    const axes: Array<[string, number]> = [
      ['+Z', n.z],
      ['-Z', -n.z],
      ['+X', n.x],
      ['-X', -n.x],
      ['+Y', n.y],
      ['-Y', -n.y],
    ];
    const [axis, dot] = axes.reduce((p, q) => (q[1] > p[1] ? q : p));
    if (dot < 0.9) continue;

    let u0 = 1;
    let u1 = 0;
    let v0 = 1;
    let v1 = 0;
    for (let i = 0; i < 3; i++) {
      const u = uv.getX(f * 3 + i);
      const v = uv.getY(f * 3 + i);
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }

    const bucket = buckets.get(axis) ?? {
      spans: [],
      v0: 1,
      v1: 0,
      wx0: Infinity,
      wx1: -Infinity,
      wy0: Infinity,
      wy1: -Infinity,
    };
    // Mean 3D x of the triangle, used to recover the wrap order of split panels.
    bucket.spans.push({ u0, u1, x: (a.x + b.x + c.x) / 3 });
    bucket.v0 = Math.min(bucket.v0, v0);
    bucket.v1 = Math.max(bucket.v1, v1);
    for (const p of [a, b, c]) {
      bucket.wx0 = Math.min(bucket.wx0, p.x);
      bucket.wx1 = Math.max(bucket.wx1, p.x);
      bucket.wy0 = Math.min(bucket.wy0, p.y);
      bucket.wy1 = Math.max(bucket.wy1, p.y);
    }
    buckets.set(axis, bucket);
  }

  // UV origin is bottom-left, the sheet's is top-left.
  const toRect = (u0: number, u1: number, v0: number, v1: number): Rect => ({
    x: u0 * width,
    y: (1 - v1) * height,
    w: (u1 - u0) * width,
    h: (v1 - v0) * height,
  });

  const blocks = (axis: string): Block[] => mergeSpans(buckets.get(axis)?.spans ?? []);

  const rects = (axis: string): Rect[] => {
    const bucket = buckets.get(axis);
    if (!bucket) return [];
    return blocks(axis).map((b) => toRect(b.u0, b.u1, bucket.v0, bucket.v1));
  };

  // The display face is whichever of the two large panels the sheet keeps in one
  // piece; the wrap seams always fall on the other one.
  const zNeg = blocks('-Z');
  const zPos = blocks('+Z');
  const frontAxis = zNeg.length <= zPos.length ? '-Z' : '+Z';
  const backAxis = frontAxis === '-Z' ? '+Z' : '-Z';
  const frontBucket = buckets.get(frontAxis)!;
  const backBucket = buckets.get(backAxis)!;

  const front = toRect(
    blocks(frontAxis)[0].u0,
    blocks(frontAxis)[0].u1,
    frontBucket.v0,
    frontBucket.v1,
  );

  // Sort by position around the pack, so artwork continued across the seam stays
  // unbroken on the mesh even though the blocks sit at opposite ends of the sheet.
  const back = blocks(backAxis)
    .sort((p, q) => p.x - q.x)
    .map((b) => toRect(b.u0, b.u1, backBucket.v0, backBucket.v1));

  return {
    width,
    height,
    front,
    back,
    seams: [...rects('+X'), ...rects('-X')].sort((p, q) => p.x - q.x),
    crimps: [...rects('+Y'), ...rects('-Y')].sort((p, q) => p.y - q.y),
    displayFaceZ: frontAxis === '+Z' ? 1 : -1,
    stretch:
      front.w / front.h / ((frontBucket.wx1 - frontBucket.wx0) / (frontBucket.wy1 - frontBucket.wy0)),
  };
}
