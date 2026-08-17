import * as THREE from "three";

import { PACK_H, PACK_W } from "./pack-mesh";

export function openingPackScale(
  viewportWidth: number,
  viewportHeight: number,
): number {
  return THREE.MathUtils.clamp(
    Math.min((viewportWidth * 0.78) / PACK_W, (viewportHeight * 0.68) / PACK_H),
    0.72,
    1,
  );
}

export const PACK_STACK_LIFT = PACK_H * 0.11;
export const PACK_STACK_DEPTH = PACK_W * 0.16;

export function packStackProgress(index: number, packCount: number): number {
  const visibleCount = Math.min(packCount, 10);
  return visibleCount > 1 ? index / (visibleCount - 1) : 0;
}

export function openingPackBaseY(
  compact: boolean,
  packCount: number,
): number {
  // Anchor the highest wrapper at the same vertical line for ×1, ×5 and ×10.
  // The whole stack has one fixed lift, divided across however many wrappers
  // are visible, so ×10 stays as compact and aligned as ×5.
  const singlePackY = compact ? -1.12 : -0.2;
  const stackLift = packCount > 1 ? PACK_STACK_LIFT : 0;
  return singlePackY - stackLift;
}
