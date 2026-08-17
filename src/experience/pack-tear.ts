import * as THREE from "three";

import { splitGeometryByCut, type CutFn, type SplitMesh } from "../index";
import { PACK_H } from "./pack-mesh";

const TEAR_FRAC = 0.8;

export const TEAR_Y = PACK_H * (TEAR_FRAC - 0.5);

// How far the cut may wander from the perforation: generous downward into the
// art, bounded above by the crimp.
export const CUT_MIN = TEAR_Y - 0.55 * (PACK_H / 3.3);
export const CUT_MAX = TEAR_Y + 0.34 * (PACK_H / 3.3);

/**
 * Piecewise-linear cut line through the user's actual drag path — lightly
 * smoothed so pointer noise doesn't spike, but the drawn shape is kept.
 */
export function buildCutFnFromPath(
  path: { x: number; y: number }[],
): CutFn {
  const sorted = path
    .filter((point, index, points) =>
      index === 0 || Math.abs(point.x - points[index - 1].x) > 0.015,
    )
    .sort((a, b) => a.x - b.x);
  // 3-tap moving average preserves the drawn line while killing jitter.
  const points = sorted.map((point, index, allPoints) => {
    const previous = allPoints[Math.max(0, index - 1)];
    const next = allPoints[Math.min(allPoints.length - 1, index + 1)];
    return { x: point.x, y: (previous.y + point.y + next.y) / 3 };
  });

  return (x: number) => {
    let base = TEAR_Y;
    if (points.length >= 2) {
      if (x <= points[0].x) base = points[0].y;
      else if (x >= points[points.length - 1].x) {
        base = points[points.length - 1].y;
      } else {
        for (let index = 1; index < points.length; index += 1) {
          if (x <= points[index].x) {
            const progress =
              (x - points[index - 1].x) /
              (points[index].x - points[index - 1].x || 1);
            base = THREE.MathUtils.lerp(
              points[index - 1].y,
              points[index].y,
              progress,
            );
            break;
          }
        }
      }
    }
    // No artificial jag: the cut is exactly the user's (smoothed) drag path.
    return THREE.MathUtils.clamp(base, CUT_MIN, CUT_MAX);
  };
}

/** Jagged-but-centered cut for skip-tear / fallback opens. */
export const DEFAULT_TORN_CUT: CutFn = (x) =>
  TEAR_Y + Math.sin(x * 23.7) * 0.012 + Math.sin(x * 57.3 + 2) * 0.009;

/** Split the fixed wrapper mesh along the current tear. */
export function buildCutSet(
  geometry: THREE.BufferGeometry,
  cutFn: CutFn,
): SplitMesh {
  return splitGeometryByCut(geometry, cutFn);
}

/**
 * Build a ribbon that hugs the severed boundary. A mesh is used because WebGL
 * clamps line width to one pixel on essentially every platform.
 */
export function seamRibbonGeometry(
  seam: Float32Array,
  side: 1 | -1,
): THREE.BufferGeometry {
  const width = 0.06 * (PACK_H / 3.3);
  const lift = 0.012;
  const vertices: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let index = 0; index < seam.length; index += 6) {
    a.set(seam[index], seam[index + 1], seam[index + 2]);
    b.set(seam[index + 3], seam[index + 4], seam[index + 5]);

    // Push outward from the pack's vertical axis so side seams are not buried.
    normal.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1);
    normal.normalize().multiplyScalar(lift);

    const ax = a.x + normal.x;
    const az = a.z + normal.z;
    const bx = b.x + normal.x;
    const bz = b.z + normal.z;
    const ay = a.y;
    const by = b.y;
    const ay2 = a.y + side * width;
    const by2 = b.y + side * width;

    vertices.push(ax, ay, az, bx, by, bz, bx, by2, bz);
    vertices.push(ax, ay, az, bx, by2, bz, ax, ay2, az);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.computeBoundingSphere();
  return geometry;
}
