import * as THREE from 'three';

export const REGIONS = [
  { id: 'front', label: 'Front', color: '#4da3ff' },
  { id: 'back', label: 'Back', color: '#ff8a5c' },
  { id: 'right', label: 'Right edge', color: '#5ad6a8' },
  { id: 'left', label: 'Left edge', color: '#c78bff' },
  { id: 'top', label: 'Top crimp', color: '#ffd166' },
  { id: 'bottom', label: 'Bottom crimp', color: '#ff6b9d' },
] as const;

export type RegionId = (typeof REGIONS)[number]['id'];

export interface UVFace {
  /** Face index — matches `intersection.faceIndex` from a raycast against the same geometry. */
  index: number;
  /** The three UV corners in texture pixels, y already flipped for screen space. */
  points: Array<[number, number]>;
  /** Which side of the pack this triangle sits on, by dominant geometric normal. */
  region: RegionId;
}

export interface UVAtlas {
  faces: UVFace[];
  width: number;
  height: number;
  /** Connected shells in UV space. The booster wrap is a single one. */
  shells: number;
  /** Fraction of the sheet the layout actually covers, 0–1. */
  coverage: number;
  counts: Record<RegionId, number>;
}

/** Quantised UV key, so vertices coinciding on the sheet compare equal despite float noise. */
const uvKey = (u: number, v: number) => `${u.toFixed(5)},${v.toFixed(5)}`;

function countShells(keys: string[][]): number {
  const parent = keys.map((_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };

  // Join faces sharing a full UV edge, not merely a corner.
  const edges = new Map<string, number>();
  keys.forEach((k, f) => {
    for (let c = 0; c < 3; c++) {
      const edge = [k[c], k[(c + 1) % 3]].sort().join('|');
      const other = edges.get(edge);
      if (other === undefined) edges.set(edge, f);
      else {
        const [ra, rb] = [find(other), find(f)];
        if (ra !== rb) parent[rb] = ra;
      }
    }
  });

  return new Set(keys.map((_, i) => find(i))).size;
}

/**
 * Flattens the mesh's uv attribute into screen-space triangles for the atlas view,
 * tagging each with the side of the pack it covers.
 *
 * The region comes from the triangle's geometric normal rather than the authored
 * vertex normals, which are smoothed across the pack's rounded edges and would
 * blur the boundaries. It is a dominant-axis bucket, so triangles on the curved
 * corners land in whichever side they lean toward.
 */
export function buildUVAtlas(
  geometry: THREE.BufferGeometry,
  width: number,
  height: number,
): UVAtlas {
  const pos = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const count = uv.count / 3;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const n = new THREE.Vector3();

  const faces: UVFace[] = [];
  const keys: string[][] = [];
  const counts = Object.fromEntries(REGIONS.map((r) => [r.id, 0])) as Record<RegionId, number>;
  let covered = 0;

  for (let f = 0; f < count; f++) {
    a.fromBufferAttribute(pos, f * 3);
    b.fromBufferAttribute(pos, f * 3 + 1);
    c.fromBufferAttribute(pos, f * 3 + 2);
    n.copy(c).sub(b).cross(ab.copy(a).sub(b)).normalize();

    const axes: Array<[RegionId, number]> = [
      ['right', n.x],
      ['left', -n.x],
      ['top', n.y],
      ['bottom', -n.y],
      ['front', n.z],
      ['back', -n.z],
    ];
    const region = axes.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
    counts[region]++;

    const points: Array<[number, number]> = [];
    const k: string[] = [];
    for (let i = 0; i < 3; i++) {
      const u = uv.getX(f * 3 + i);
      const v = uv.getY(f * 3 + i);
      // three's UV origin is bottom-left; the image's is top-left.
      points.push([u * width, (1 - v) * height]);
      k.push(uvKey(u, v));
    }

    const [[x0, y0], [x1, y1], [x2, y2]] = points;
    covered += Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / 2;

    faces.push({ index: f, points, region });
    keys.push(k);
  }

  relabelDisplayFace(faces, uv, counts);

  return {
    faces,
    width,
    height,
    shells: countShells(keys),
    coverage: covered / (width * height),
    counts,
  };
}

/**
 * `front` and `back` start out as bare +Z / -Z buckets, which is arbitrary: whichever
 * way the mesh happens to be authored decides them, and here it lands the wrong way
 * round. The display face is the one the sheet keeps in a single block — the wrap
 * seams always fall on the other — so detect that and swap the labels to match, and
 * to agree with `readSheetLayout`.
 */
function relabelDisplayFace(
  faces: UVFace[],
  uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  counts: Record<RegionId, number>,
) {
  const blocksIn = (region: RegionId) => {
    const spans = faces
      .filter((f) => f.region === region)
      .map((f) => {
        let u0 = 1;
        let u1 = 0;
        for (let i = 0; i < 3; i++) {
          const u = uv.getX(f.index * 3 + i);
          u0 = Math.min(u0, u);
          u1 = Math.max(u1, u);
        }
        return [u0, u1] as [number, number];
      })
      .sort((a, b) => a[0] - b[0]);

    let n = 0;
    let end = -1;
    for (const [u0, u1] of spans) {
      if (u0 > end + 0.002) n++;
      end = Math.max(end, u1);
    }
    return n;
  };

  if (blocksIn('front') <= blocksIn('back')) return;

  for (const f of faces) {
    if (f.region === 'front') f.region = 'back';
    else if (f.region === 'back') f.region = 'front';
  }
  [counts.front, counts.back] = [counts.back, counts.front];
}
