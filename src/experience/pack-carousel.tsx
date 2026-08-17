"use client";

import { useFrame, useThree } from "@react-three/fiber";
import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

import type { PackVariant } from "./pack-data";
import { PACK_H, PACK_W, packGeometry } from "./pack-mesh";
import type { PackSceneControls } from "./pack-scene-controls";
import {
  openingPackBaseY,
  openingPackScale,
} from "./pack-scene-layout";
import { FoilMaterial, makeWrinkleNormalTexture } from "./pack-scene-effects";
import { paintVariantSheet } from "./pack-sheet";

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

interface PackCarouselProps {
  assetBase?: string;
  /** the ring shows identical copies of this pack — you pick "your" pack */
  variant: PackVariant;
  /**
   * The sheet to wrap every copy in. A studio-built cover or a composed upload
   * arrives here; without one the variant is painted into a sheet instead.
   */
  sheet?: THREE.Texture | null;
  reducedMotion?: boolean;
  controls: React.MutableRefObject<PackSceneControls>;
  packCount: number;
  onSelect: (backwards: boolean) => void;
}

const CAROUSEL_COPIES = 8;
const CAROUSEL_STEP = (Math.PI * 2) / CAROUSEL_COPIES;
const CAROUSEL_R = 3.4;
const TWO_PI = Math.PI * 2;

/**
 * Pocket-style select carousel: a ring of identical packs of the chosen
 * variant. Swipe anywhere to rotate the ring, drag on a pack to spin it fully
 * around (the rotation you leave it at is kept), tap a side pack to focus it,
 * tap the focused pack to open that one.
 */
export function PackCarousel({
  assetBase = "",
  variant,
  sheet,
  reducedMotion = false,
  controls,
  packCount,
  onSelect,
}: PackCarouselProps) {
  const [hovered, setHovered] = useState(false);
  // On phones, put the adjacent pack centres close to the viewport edges. This
  // leaves a deliberate half-pack peek on each side instead of overlapping the
  // focused pack like a stack of cards.
  const viewport = useThree((s) => s.viewport);
  const compact = viewport.width < 4.4;
  const radius = THREE.MathUtils.clamp(
    viewport.width * (compact ? 0.72 : 0.5),
    compact ? 1.8 : 1.5,
    CAROUSEL_R,
  );
  const focusedScale = compact
    ? THREE.MathUtils.clamp((viewport.width * 0.5) / PACK_W, 0.5, 0.64)
    : 0.88;
  const restingScale = focusedScale * (compact ? 0.67 : 0.7);
  const selectedScale = openingPackScale(viewport.width, viewport.height);
  const selectedY = openingPackBaseY(compact, packCount);
  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const pack = use(packGeometry(assetBase));
  const normalTex = useMemo(() => makeWrinkleNormalTexture(), []);
  const packSheet = useMemo(() => {
    const map = sheet ?? paintVariantSheet(variant, pack.layout);
    return map;
  }, [variant, sheet, pack.layout]);

  const ring = useRef({
    angle: 0,
    vel: 0,
    goto: null as number | null,
    spin: Array.from({ length: CAROUSEL_COPIES }, () => 0),
    spinVel: Array.from({ length: CAROUSEL_COPIES }, () => 0),
    drag: null as null | {
      mode: "ring" | "pack";
      idx: number;
      lastX: number;
      moved: number;
    },
    resumeAutoAt: 0,
    transition: null as null | {
      index: number;
      elapsed: number;
      fired: boolean;
      backwards: boolean;
      poses: Array<{
        position: THREE.Vector3;
        rotationY: number;
        scale: number;
      } | null>;
    },
  });

  const focusedIndex = () => {
    const st = ring.current;
    const n = CAROUSEL_COPIES;
    return ((Math.round(-st.angle / CAROUSEL_STEP) % n) + n) % n;
  };

  const beginSelection = useCallback(() => {
    const st = ring.current;
    if (st.transition) return;
    const index = focusedIndex();
    const poses = groupRefs.current.map((group) =>
      group
        ? {
            position: group.position.clone(),
            rotationY: group.rotation.y,
            scale: group.scale.x,
          }
        : null,
    );
    const selectedPose = poses[index];
    const backwards = selectedPose
      ? Math.cos(selectedPose.rotationY) < 0
      : false;
    if (reducedMotion || !selectedPose) {
      onSelect(backwards);
      return;
    }

    st.drag = null;
    st.vel = 0;
    st.goto = null;
    st.transition = { index, elapsed: 0, fired: false, backwards, poses };
  }, [onSelect, reducedMotion]);

  useEffect(() => {
    controls.current.openSelected = beginSelection;
    return () => {
      if (controls.current.openSelected === beginSelection) {
        controls.current.openSelected = undefined;
      }
    };
  }, [beginSelection, controls]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const st = ring.current;
      if (!st.drag) return;
      const dx = e.clientX - st.drag.lastX;
      st.drag.lastX = e.clientX;
      st.drag.moved += Math.abs(dx);
      if (st.drag.mode === "ring") {
        st.angle += dx * 0.006;
        st.vel = dx * 0.006 * 30;
        st.goto = null;
      } else {
        st.spin[st.drag.idx] += dx * 0.012;
        st.spinVel[st.drag.idx] = dx * 0.012 * 30;
      }
    };
    const onUp = () => {
      const st = ring.current;
      if (!st.drag) return;
      const { mode, idx, moved } = st.drag;
      st.drag = null;
      st.resumeAutoAt = performance.now() + 1600;
      if (mode === "pack" && moved < 6) {
        // a tap, not a drag
        if (idx === focusedIndex()) {
          beginSelection();
        } else {
          // bring the tapped pack to the front (closest turn direction)
          const target = -idx * CAROUSEL_STEP;
          const k = Math.round((st.angle - target) / TWO_PI);
          st.goto = target + k * TWO_PI;
          st.vel = 0;
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [beginSelection]);

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const st = ring.current;

    if (st.transition) {
      const transition = st.transition;
      transition.elapsed = Math.min(0.56, transition.elapsed + dt);
      const progress = easeOutCubic(transition.elapsed / 0.56);

      groupRefs.current.forEach((group, index) => {
        const pose = transition.poses[index];
        if (!group || !pose) return;

        if (index === transition.index) {
          const baseTargetRotation = transition.backwards ? Math.PI : 0;
          const targetRotation =
            baseTargetRotation +
            Math.round((pose.rotationY - baseTargetRotation) / TWO_PI) * TWO_PI;
          group.position.set(
            THREE.MathUtils.lerp(pose.position.x, 0, progress),
            THREE.MathUtils.lerp(pose.position.y, selectedY, progress),
            THREE.MathUtils.lerp(pose.position.z, 0, progress),
          );
          group.rotation.y = THREE.MathUtils.lerp(
            pose.rotationY,
            targetRotation,
            progress,
          );
          group.scale.setScalar(
            THREE.MathUtils.lerp(pose.scale, selectedScale, progress),
          );
        } else {
          group.position.set(
            pose.position.x * (1 + progress * 0.3),
            pose.position.y,
            pose.position.z - progress * 1.4,
          );
          group.scale.setScalar(
            THREE.MathUtils.lerp(pose.scale, pose.scale * 0.16, progress),
          );
        }
      });

      if (transition.elapsed >= 0.56 && !transition.fired) {
        transition.fired = true;
        onSelect(transition.backwards);
      }
      return;
    }

    // ring physics: momentum → snap to the nearest slot (or an explicit goto)
    if (!st.drag || st.drag.mode !== "ring") {
      if (reducedMotion) {
        if (st.goto !== null) {
          st.angle = st.goto;
          st.goto = null;
        } else {
          st.angle = Math.round(st.angle / CAROUSEL_STEP) * CAROUSEL_STEP;
        }
        st.vel = 0;
      } else {
        st.angle += st.vel * dt;
        st.vel = THREE.MathUtils.damp(st.vel, 0, 3, dt);
        if (st.goto !== null) {
          st.angle = THREE.MathUtils.damp(st.angle, st.goto, 6, dt);
          if (Math.abs(st.angle - st.goto) < 0.005) {
            st.goto = null;
            st.resumeAutoAt = performance.now() + 1200;
          }
        } else if (Math.abs(st.vel) < 0.4) {
          if (performance.now() >= st.resumeAutoAt) {
            st.angle += dt * 0.13;
          } else {
            const nearest =
              Math.round(st.angle / CAROUSEL_STEP) * CAROUSEL_STEP;
            st.angle = THREE.MathUtils.damp(st.angle, nearest, 4, dt);
          }
        }
      }
    }

    for (let i = 0; i < CAROUSEL_COPIES; i++) {
      // per-pack free spin with inertia — the rotation you leave it at is
      // kept, no snap-back
      const draggingThis = st.drag?.mode === "pack" && st.drag.idx === i;
      if (!draggingThis && !reducedMotion) {
        st.spin[i] += st.spinVel[i] * dt;
        st.spinVel[i] = THREE.MathUtils.damp(st.spinVel[i], 0, 1.6, dt);
      } else if (reducedMotion) {
        st.spinVel[i] = 0;
      }

      const group = groupRefs.current[i];
      if (!group) continue;
      const a = st.angle + i * CAROUSEL_STEP;
      group.position.set(
        Math.sin(a) * radius,
        (compact ? 0.18 : 0) +
          (reducedMotion ? 0 : Math.sin(t * 1.2 + i * 1.1) * 0.05),
        -radius + Math.cos(a) * radius,
      );
      group.rotation.y = a * 0.82 + st.spin[i];
      const focus = (Math.cos(a) + 1) / 2;
      group.scale.setScalar(
        THREE.MathUtils.lerp(restingScale, focusedScale, focus),
      );
    }
  });

  return (
    <group>
      {/* backdrop drag-catcher: swiping empty space rotates the ring */}
      <mesh
        position={[0, 0, -6]}
        onPointerDown={(e) => {
          ring.current.resumeAutoAt = performance.now() + 1800;
          ring.current.drag = {
            mode: "ring",
            idx: -1,
            lastX: e.nativeEvent.clientX,
            moved: 0,
          };
        }}
      >
        <planeGeometry args={[60, 30]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {Array.from({ length: CAROUSEL_COPIES }).map((_, i) => (
        <group
          key={i}
          ref={(g) => {
            groupRefs.current[i] = g;
          }}
          scale={0.62}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
          }}
          onPointerOut={() => setHovered(false)}
          onPointerDown={(e) => {
            e.stopPropagation();
            ring.current.resumeAutoAt = performance.now() + 1800;
            ring.current.drag = {
              mode: "pack",
              idx: i,
              lastX: e.nativeEvent.clientX,
              moved: 0,
            };
          }}
        >
          {/* One mesh, one sheet: the wrap is a single continuous shell, so the
              front, back and both side gussets come from the same draw. */}
          <mesh geometry={pack.geometry}>
            <FoilMaterial map={packSheet} normalMap={normalTex} />
          </mesh>
          {/* floor reflection */}
          <mesh
            geometry={pack.geometry}
            scale={[1, -1, 1]}
            position={[0, -PACK_H * 1.02, 0]}
          >
            <meshBasicMaterial
              map={packSheet}
              transparent
              opacity={0.09}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

