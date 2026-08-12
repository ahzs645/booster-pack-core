import * as THREE from 'three';

/**
 * Minimal OBJ reader, ported from the original pack3d.html.
 *
 * Only v / vt / vn / f are meaningful for these meshes — no materials, no
 * groups — so this stays far smaller than three's OBJLoader and yields a single
 * non-indexed BufferGeometry ready for one draw call. Faces are fan-triangulated;
 * missing uvs fall back to (0,0) and missing normals to +Z, matching the original.
 */
export function parseObj(text: string): THREE.BufferGeometry {
  const V: number[][] = [];
  const VT: number[][] = [];
  const VN: number[][] = [];
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];

  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') V.push([+p[1], +p[2], +p[3]]);
    else if (p[0] === 'vt') VT.push([+p[1], +p[2]]);
    else if (p[0] === 'vn') VN.push([+p[1], +p[2], +p[3]]);
    else if (p[0] === 'f') {
      const vs = p.slice(1).map((t) => t.split('/').map((x) => (x ? +x - 1 : -1)));
      for (let i = 1; i < vs.length - 1; i++) {
        for (const a of [vs[0], vs[i], vs[i + 1]]) {
          const v = V[a[0]];
          pos.push(v[0], v[1], v[2]);
          const t = a[1] >= 0 ? VT[a[1]] : [0, 0];
          uv.push(t[0], t[1]);
          const n = a[2] >= 0 ? VN[a[2]] : [0, 0, 1];
          nor.push(n[0], n[1], n[2]);
        }
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.computeBoundingBox();
  return g;
}
