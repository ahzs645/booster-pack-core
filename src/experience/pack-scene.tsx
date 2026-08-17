"use client";

import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import type { SplitMesh } from "../index";
import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

import { tierRank, type PackVariant, type PulledCard } from "./pack-data";
import {
  CARD_WIDTH,
  LoadedCardStack,
  holoIntensityFor,
} from "./pack-card-stack";
import { syncBackwardsCardVisibility } from "./pack-card-visibility";
import {
  cardDismissDirection,
  nextBackwardsRevealAction,
} from "./pack-reveal";
import { PACK_H, PACK_W, packGeometry } from "./pack-mesh";
import type { PackSceneControls } from "./pack-scene-controls";
import {
  openingPackBaseY,
  openingPackScale,
  PACK_STACK_DEPTH,
  PACK_STACK_LIFT,
  packStackProgress,
} from "./pack-scene-layout";
import {
  FoilMaterial,
  makeGlowTexture,
  makeHoloMaterial,
  makeWrinkleNormalTexture,
} from "./pack-scene-effects";
import { paintVariantSheet } from "./pack-sheet";
import {
  buildCutFnFromPath,
  buildCutSet,
  CUT_MAX,
  CUT_MIN,
  DEFAULT_TORN_CUT,
  seamRibbonGeometry,
  TEAR_Y,
} from "./pack-tear";
import type { PackOpeningPhase as PackPhase } from "./types";

export type { PackOpeningPhase as PackPhase } from "./types";
export { FoilEnvironment } from "./pack-scene-effects";
export type { PackSceneControls } from "./pack-scene-controls";

interface PackExperienceProps {
  assetBase?: string;
  cards: PulledCard[];
  variant: PackVariant;
  /** Overrides the painted variant sheet — a studio cover, or a composed upload. */
  sheet?: THREE.Texture | null;
  /** total packs being opened — bulk opens render the whole stack and one tear cuts all of them */
  packCount: number;
  /** Keeps the deliberately flipped carousel orientation through the tear. */
  backwards?: boolean;
  /** Leaves extra breathing room around cards beneath native host controls. */
  nativeLayout?: boolean;
  phase: PackPhase;
  controls: React.MutableRefObject<PackSceneControls>;
  onTorn: () => void;
  onOpened: () => void;
  onReveal: (revealedCount: number) => void;
  onCardFaceChanged: (faceUp: boolean) => void;
  onAllRevealed: () => void;
  onFlash: () => void;
}

const GOLD = new THREE.Color("#ffd76a");

/* ---------------------------------- helpers --------------------------------- */

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number): number {
  return t * t * t;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}


export { PackCarousel } from "./pack-carousel";
/* ---------------------------------- scene ----------------------------------- */

export function PackExperience({
  assetBase = "",
  cards,
  variant,
  sheet,
  packCount,
  backwards = false,
  nativeLayout = false,
  phase,
  controls,
  onTorn,
  onOpened,
  onReveal,
  onCardFaceChanged,
  onAllRevealed,
  onFlash,
}: PackExperienceProps) {
  const stackCount = Math.min(packCount, 10);
  const viewport = useThree((state) => state.viewport);
  const compact = viewport.width < 4.4;
  const packScale = openingPackScale(viewport.width, viewport.height);
  // Leave the reveal card clear of phone-sized host controls. The old fixed
  // 1.12 scale nearly filled a portrait canvas, so native top/bottom overlays
  // appeared to crop the scan even though the WebGL scene itself was intact.
  const revealScale = THREE.MathUtils.clamp(
    (viewport.width * (nativeLayout ? 0.66 : 0.72)) / CARD_WIDTH,
    nativeLayout ? 0.72 : 0.76,
    nativeLayout ? 0.98 : 1.05,
  );
  // bulk stacks sit lower so the upward cascade stays in frame
  const packBaseY = openingPackBaseY(compact, stackCount);
  const [cutGeos, setCutGeos] = useState<SplitMesh | null>(null);
  const cutBuiltRef = useRef(false);
  const pack = use(packGeometry(assetBase));

  const sheetTex = useMemo(
    () => sheet ?? paintVariantSheet(variant, pack.layout),
    [sheet, variant, pack.layout],
  );
  const normalTex = useMemo(() => makeWrinkleNormalTexture(), []);
  const glowTex = useMemo(() => makeGlowTexture(), []);
  const accentColor = useMemo(
    () => new THREE.Color(variant.palette.accent),
    [variant],
  );
  const glowColor = useMemo(
    () => new THREE.Color(variant.palette.glow),
    [variant],
  );
  // Interaction feedback must sit just outside whichever wrapper face is
  // currently visible. When the pack is backwards, positive local Z rotates
  // behind the pack and a front-sided hit plane cannot receive the swipe.
  const visibleFaceDirection = backwards ? -1 : 1;
  const packFacingRotationY = backwards ? Math.PI : 0;
  const tearFeedbackZ = visibleFaceDirection * (pack.faceZ + 0.05);
  const tearHitZ = visibleFaceDirection * 0.3;

  // Sealed, the pack is whole: the factory perforation is printed on the sheet,
  // not cut into the mesh, so nothing is split until there is an actual tear.
  const seamGeos = useMemo(
    () =>
      cutGeos
        ? {
            below: seamRibbonGeometry(cutGeos.seam, -1),
            above: seamRibbonGeometry(cutGeos.seam, 1),
          }
        : null,
    [cutGeos],
  );

  const holoMaterials = useMemo(
    () => cards.map((card) => makeHoloMaterial(holoIntensityFor(card))),
    [cards],
  );

  const packRef = useRef<THREE.Group>(null);
  const stripRefs = useRef<(THREE.Group | null)[]>([]);
  const bodyRefs = useRef<(THREE.Group | null)[]>([]);
  const stackRef = useRef<THREE.Group>(null);
  const cardRefs = useRef<(THREE.Group | null)[]>([]);
  const cardAssetsReadyRef = useRef(false);
  const tearHeadRef = useRef<THREE.Sprite>(null);
  // glowing polyline tracing the user's actual drag path
  const tearTrail = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(80 * 3), 3),
    );
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color("#bffcff"),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.renderOrder = 8;
    return line;
  }, []);
  // WebGL lines are 1px — glow points along the same path give it body
  const tearTrailPoints = useMemo(() => {
    const pts = new THREE.Points(
      tearTrail.geometry,
      new THREE.PointsMaterial({
        map: glowTex,
        size: 0.16,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        color: new THREE.Color("#dffcff"),
      }),
    );
    pts.frustumCulled = false;
    pts.renderOrder = 8;
    return pts;
  }, [tearTrail, glowTex]);
  const chargeGlowRef = useRef<THREE.Sprite>(null);
  const edgeBodyMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const edgeStripMatRef = useRef<THREE.MeshBasicMaterial>(null);

  const wrapperMaterials = useRef<THREE.MeshPhysicalMaterial[]>([]);

  const anim = useRef({
    torn: false,
    openT: 0,
    openedNotified: false,
    topIndex: 0,
    maxRevealedIndex: backwards ? -1 : 0,
    faceUp: !backwards,
    cardFlip: {
      active: false,
      t: 0,
      index: 0,
    },
    charge: { t: 0, done: false },
    dismiss: new Map<number, { t: number; dir: number }>(),
    allNotified: false,
    cardSwipe: {
      active: false,
      startX: 0,
      startY: 0,
    },
    tear: {
      active: false,
      startX: 0,
      dir: 1,
      progress: 0,
      path: [] as { x: number; y: number }[],
    },
  });

  // pointer-up anywhere ends the tear drag
  useEffect(() => {
    const end = () => {
      anim.current.tear.active = false;
    };
    window.addEventListener("pointerup", end);
    return () => window.removeEventListener("pointerup", end);
  }, []);

  useEffect(() => {
    if (phase !== "tear") return;
    const a = anim.current;
    a.faceUp = !backwards;
    a.maxRevealedIndex = backwards ? -1 : 0;
    a.cardFlip = { active: false, t: 0, index: 0 };
    for (const card of cardRefs.current) {
      if (card) {
        card.rotation.y = backwards ? Math.PI : 0;
        card.visible = true;
      }
    }
    onCardFaceChanged(!backwards);
  }, [backwards, onCardFaceChanged, phase]);

  const registerWrapperMaterial = (mat: THREE.MeshPhysicalMaterial | null) => {
    if (mat && !wrapperMaterials.current.includes(mat)) {
      mat.transparent = true;
      wrapperMaterials.current.push(mat);
    }
  };

  const recordTearPoint = (e: ThreeEvent<PointerEvent>) => {
    // convert to pack-local space so the recorded path is exact even while
    // the pack is tilted mid-float
    const local = packRef.current
      ? packRef.current.worldToLocal(e.point.clone())
      : e.point;
    return {
      x: local.x,
      // clamp at record time so the live trail shows exactly what the cut gets
      y: THREE.MathUtils.clamp(local.y, CUT_MIN, CUT_MAX),
    };
  };

  const handleTearDown = (e: ThreeEvent<PointerEvent>) => {
    if (phase !== "tear") return;
    e.stopPropagation();
    anim.current.tear.active = true;
    anim.current.tear.startX = e.point.x;
    anim.current.tear.path = [recordTearPoint(e)];
  };

  const handleTearMove = (e: ThreeEvent<PointerEvent>) => {
    const tear = anim.current.tear;
    if (phase !== "tear" || !tear.active || anim.current.torn) return;
    const dx = e.point.x - tear.startX;
    if (Math.abs(dx) > 0.01) tear.dir = Math.sign(dx);
    if (tear.path.length < 80) tear.path.push(recordTearPoint(e));
    tear.progress = THREE.MathUtils.clamp(Math.abs(dx) / (PACK_W * 0.72), 0, 1);
    if (tear.progress >= 1) {
      anim.current.torn = true;
      tear.active = false;
      // the cut follows the drag path, so every tear is a little different
      cutBuiltRef.current = true;
      setCutGeos(buildCutSet(pack.geometry, buildCutFnFromPath(tear.path)));
      onTorn();
    }
  };

  const revealNext = useCallback((direction?: number) => {
    if (phase !== "reveal") return;
    const a = anim.current;
    const idx = a.topIndex;
    if (
      idx >= cards.length ||
      a.cardFlip.active ||
      a.dismiss.size > 0
    ) {
      return;
    }

    if (backwards) {
      const action = nextBackwardsRevealAction({
        topIndex: idx,
        cardCount: cards.length,
        faceUp: a.faceUp,
        direction,
      });
      if (action.kind === "flip") {
        a.faceUp = true;
        a.cardFlip = {
          active: true,
          t: 0,
          index: action.index,
        };
        syncBackwardsCardVisibility(cardRefs.current, idx, action.index);
        if (idx > a.maxRevealedIndex) {
          a.maxRevealedIndex = idx;
          onReveal(idx + 1);
        }
        onCardFaceChanged(true);
      } else if (action.kind === "dismiss") {
        a.dismiss.set(action.index, {
          t: 0,
          dir: action.direction,
        });
        a.topIndex = action.nextTopIndex;
        a.faceUp = false;
        a.charge = { t: 0, done: false };
        onCardFaceChanged(false);
      }
      return;
    }

    const isBig = tierRank(cards[idx].tier) >= 3;
    if (isBig && !a.charge.done) {
      a.charge.done = true;
      if (!controls.current.reducedMotion) {
        onFlash();
      }
    }
    a.dismiss.set(idx, {
      t: 0,
      dir: cardDismissDirection(idx, direction),
    });
    a.topIndex = idx + 1;
    a.charge = { t: 0, done: false };
    if (a.topIndex < cards.length && a.topIndex > a.maxRevealedIndex) {
      a.maxRevealedIndex = a.topIndex;
      onReveal(a.maxRevealedIndex + 1);
    }
  }, [backwards, cards, controls, onCardFaceChanged, onFlash, onReveal, phase]);

  useEffect(() => {
    controls.current.revealNext = revealNext;
    return () => {
      if (controls.current.revealNext === revealNext) {
        controls.current.revealNext = undefined;
      }
    };
  }, [controls, revealNext]);

  const handleStackPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (phase !== "reveal") return;
    e.stopPropagation();
    anim.current.cardSwipe = {
      active: true,
      startX: e.nativeEvent.clientX,
      startY: e.nativeEvent.clientY,
    };
  };

  useEffect(() => {
    const finishCardSwipe = (event: PointerEvent) => {
      const swipe = anim.current.cardSwipe;
      if (!swipe.active) return;
      swipe.active = false;

      const deltaX = event.clientX - swipe.startX;
      const deltaY = event.clientY - swipe.startY;
      if (backwards) {
        const isTap = Math.hypot(deltaX, deltaY) < 24;
        const isHorizontalSwipe =
          Math.abs(deltaX) >= 44 && Math.abs(deltaX) > Math.abs(deltaY);
        if (!anim.current.faceUp) {
          if (isTap || isHorizontalSwipe) revealNext();
        } else if (isHorizontalSwipe) {
          revealNext(deltaX);
        }
        return;
      }
      if (Math.abs(deltaX) < 44 || Math.abs(deltaX) <= Math.abs(deltaY)) {
        return;
      }

      revealNext(deltaX);
    };
    const cancelCardSwipe = () => {
      anim.current.cardSwipe.active = false;
    };

    window.addEventListener("pointerup", finishCardSwipe);
    window.addEventListener("pointercancel", cancelCardSwipe);
    return () => {
      window.removeEventListener("pointerup", finishCardSwipe);
      window.removeEventListener("pointercancel", cancelCardSwipe);
    };
  }, [backwards, revealNext]);

  useFrame((state, rawDelta) => {
    const reducedMotion = controls.current.reducedMotion;
    const ts = controls.current.timeScale;
    const dt = Math.min(rawDelta, 0.05) * ts;
    const t = state.clock.elapsedTime;
    const a = anim.current;
    const pointer = state.pointer;

    // cards stay hidden inside the sealed pack — transparent-object depth
    // sorting otherwise draws them over the wrapper as the pack tilts
    if (stackRef.current) {
      stackRef.current.visible =
        phase === "reveal" || (phase === "opening" && a.openT > 0.3);
    }

    // skip-tear / fallback opens still get a (jagged, centered) cut edge
    if (phase === "opening" && !cutGeos && !cutBuiltRef.current) {
      cutBuiltRef.current = true;
      setCutGeos(buildCutSet(pack.geometry, DEFAULT_TORN_CUT));
    }

    // glowing cut edge, pulsing like the reference
    const glowPulse = reducedMotion ? 0.7 : 0.55 + Math.sin(t * 9) * 0.25;
    if (edgeBodyMatRef.current) {
      edgeBodyMatRef.current.opacity = cutGeos
        ? glowPulse * (wrapperMaterials.current[0]?.opacity ?? 1)
        : 0;
    }
    if (edgeStripMatRef.current) {
      edgeStripMatRef.current.opacity = cutGeos ? glowPulse : 0;
    }

    // --- pack idle float + tilt toward pointer -------------------------------
    const tear = a.tear;
    if (packRef.current) {
      const pack = packRef.current;
      if (phase === "tear") {
        // The tear target must stay completely stationary while waiting and
        // while the user swipes. This keeps the trace aligned with their finger
        // and avoids an idle hover being mistaken for interaction feedback.
        pack.position.set(0, packBaseY, 0);
        pack.rotation.x = 0;
        pack.rotation.z = 0;
        pack.rotation.y = reducedMotion
          ? packFacingRotationY
          : THREE.MathUtils.damp(
              pack.rotation.y,
              packFacingRotationY,
              9,
              dt,
            );
      }
    }

    // --- tear feedback: glowing trail along the actual drag path -------------
    if (phase === "tear" && !tear.active && !a.torn && tear.progress > 0) {
      tear.progress = Math.max(0, tear.progress - dt * 1.6); // spring back
    }
    const trailVisible =
      phase === "tear" &&
      !a.torn &&
      tear.path.length > 1 &&
      (tear.active || tear.progress > 0.01);
    tearTrail.visible = trailVisible;
    tearTrailPoints.visible = trailVisible;
    if (trailVisible) {
      (tearTrailPoints.material as THREE.PointsMaterial).opacity =
        0.25 + tear.progress * 0.55;
      const posAttr = tearTrail.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      for (let i = 0; i < tear.path.length; i++) {
        const p = tear.path[i];
        posAttr.setXYZ(i, p.x, p.y, tearFeedbackZ);
      }
      posAttr.needsUpdate = true;
      tearTrail.geometry.setDrawRange(0, tear.path.length);
      (tearTrail.material as THREE.LineBasicMaterial).opacity =
        0.35 + tear.progress * 0.65;
    }
    if (tearHeadRef.current) {
      const last = tear.path[tear.path.length - 1];
      tearHeadRef.current.visible = trailVisible && !!last;
      if (last) {
        tearHeadRef.current.position.set(
          last.x,
          last.y,
          tearFeedbackZ + visibleFaceDirection * 0.01,
        );
      }
      const s = 0.3 + tear.progress * 0.5 + Math.sin(t * 20) * 0.05;
      tearHeadRef.current.scale.setScalar(s);
    }

    // --- opening timeline ----------------------------------------------------
    // Keep the already-visible wrapper in place if the user skips the tear
    // before the hidden card scans finish warming. Once ready, the ordinary
    // opening timeline begins without ever exposing an empty canvas.
    if (phase === "opening" && cardAssetsReadyRef.current) {
      const duration = 1.7 + (stackCount - 1) * 0.12;
      a.openT = reducedMotion ? 1 : Math.min(1, a.openT + dt / duration);
      const T = a.openT * (duration / 1.7); // in single-pack time units

      if (packRef.current) {
        packRef.current.rotation.x = THREE.MathUtils.damp(
          packRef.current.rotation.x,
          0,
          6,
          dt,
        );
        packRef.current.rotation.y = THREE.MathUtils.damp(
          packRef.current.rotation.y,
          packFacingRotationY,
          6,
          dt,
        );
      }

      // 0 → 0.45 (+stagger per pack): every strip in the stack shears off
      stripRefs.current.forEach((g, i) => {
        if (!g) return;
        const s = easeInCubic(
          THREE.MathUtils.clamp((T - i * 0.07) / 0.45, 0, 1),
        );
        g.position.x = s * 3.4;
        g.position.y = s * 1.6;
        g.rotation.z = -s * 0.9;
        g.visible = s < 1;
      });
      // 0.3 → 0.8 (+stagger): wrapper bodies slide down + fade
      const slide = easeInCubic(THREE.MathUtils.clamp((T - 0.3) / 0.5, 0, 1));
      bodyRefs.current.forEach((g, i) => {
        if (!g) return;
        const s = easeInCubic(
          THREE.MathUtils.clamp((T - 0.3 - i * 0.05) / 0.5, 0, 1),
        );
        g.position.y = -s * 4.2;
        g.visible = s < 1;
      });
      for (const mat of wrapperMaterials.current) {
        mat.opacity = 1 - slide;
      }
      // 0.45 → 1: cards rise and settle center-stage
      const rise = easeOutCubic(THREE.MathUtils.clamp((T - 0.45) / 0.55, 0, 1));
      if (stackRef.current) {
        stackRef.current.position.y = -0.15 + rise * 0.15;
        stackRef.current.position.z = rise * 0.9;
        const sc = THREE.MathUtils.lerp(0.92, revealScale, rise);
        stackRef.current.scale.setScalar(sc);
      }
      if (T >= 1 && !a.openedNotified) {
        a.openedNotified = true;
        onOpened();
      }
    }

    // --- reveal phase --------------------------------------------------------
    if (phase === "reveal") {
      const idx = a.topIndex;
      const top = idx < cards.length ? cards[idx] : null;
      const faceVisible = !backwards || (a.faceUp && !a.cardFlip.active);
      const isBig = top && faceVisible ? tierRank(top.tier) >= 3 : false;

      const flip = a.cardFlip;
      if (flip.active) {
        const group = cardRefs.current[flip.index];
        flip.t = reducedMotion ? 1 : Math.min(1, flip.t + dt / 0.42);
        if (group) {
          const eased = easeInOutCubic(flip.t);
          group.rotation.y = Math.PI * (1 - eased);
          const scale = 1 - Math.sin(eased * Math.PI) * 0.06;
          group.scale.setScalar(scale);
        }

        if (flip.t >= 1) {
          flip.active = false;
          if (group) group.scale.setScalar(1);
          syncBackwardsCardVisibility(cardRefs.current, a.topIndex);
        }
      }

      // charge-up before big reveals
      if (top && isBig && !a.charge.done && reducedMotion) {
        a.charge.done = true;
      } else if (top && isBig && !a.charge.done) {
        a.charge.t += dt / 1.4;
        if (a.charge.t >= 1) {
          a.charge.done = true;
          onFlash();
        }
      }
      const charging = top && isBig && !a.charge.done;
      if (chargeGlowRef.current) {
        const glowMat = chargeGlowRef.current.material as THREE.SpriteMaterial;
        if (charging) {
          chargeGlowRef.current.visible = true;
          const pulse = a.charge.t * (3 + Math.sin(t * 14) * 0.4) + 1.5;
          chargeGlowRef.current.scale.setScalar(pulse);
          glowMat.opacity = 0.15 + a.charge.t * 0.5;
          glowMat.color.copy(top!.tier === "chase" ? GOLD : glowColor);
        } else {
          glowMat.opacity = THREE.MathUtils.damp(glowMat.opacity, 0, 8, dt);
          if (glowMat.opacity < 0.01) chargeGlowRef.current.visible = false;
        }
      }

      // stack tilt toward pointer
      if (stackRef.current) {
        const shake =
          charging && !reducedMotion ? Math.sin(t * 55) * 0.02 * a.charge.t : 0;
        stackRef.current.scale.setScalar(
          THREE.MathUtils.damp(stackRef.current.scale.x, revealScale, 7, dt),
        );
        stackRef.current.rotation.y = THREE.MathUtils.damp(
          stackRef.current.rotation.y,
          reducedMotion ? 0 : pointer.x * 0.4,
          5,
          dt,
        );
        stackRef.current.rotation.x = THREE.MathUtils.damp(
          stackRef.current.rotation.x,
          reducedMotion ? 0 : -pointer.y * 0.25,
          5,
          dt,
        );
        stackRef.current.position.x = shake;
      }

      // dismiss animations
      for (const [cardIdx, d] of a.dismiss) {
        const group = cardRefs.current[cardIdx];
        if (!group) continue;
        d.t = reducedMotion ? 1 : Math.min(1, d.t + dt / 0.45);
        const e = easeInCubic(d.t);
        group.position.x = d.dir * e * 5.5;
        group.position.y = e * 1.4;
        group.rotation.z = -d.dir * e * 0.5;
        if (d.t >= 1) {
          group.visible = false;
          a.dismiss.delete(cardIdx);
          if (cardIdx === cards.length - 1 && !a.allNotified) {
            a.allNotified = true;
            onAllRevealed();
          }
        }
      }

      // pop-in scale for the current top card after a big reveal
      const topGroup = cardRefs.current[idx];
      if (topGroup && top && !flip.active) {
        const target = charging ? 0.97 : 1;
        topGroup.scale.setScalar(
          THREE.MathUtils.damp(topGroup.scale.x, target, 6, dt),
        );
      }
    }

    // --- card holo shader uniforms ------------------------------------------
    for (const mat of holoMaterials) {
      mat.uniforms.uTime.value = reducedMotion ? 0 : t;
      mat.uniforms.uTilt.value.set(
        reducedMotion ? 0 : pointer.x,
        reducedMotion ? 0 : pointer.y,
      );
    }
  });

  const cardsVisible = phase !== "summary" && phase !== "final";

  return (
    <group>
      {/* charge glow behind the stack */}
      <sprite ref={chargeGlowRef} position={[0, 0, 0.3]} visible={false}>
        <spriteMaterial
          map={glowTex}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0}
        />
      </sprite>

      {/* Start fetching scans behind the sealed wrapper during the tear phase.
          Its local boundary keeps a slow card request from hiding the pack. */}
      {cardsVisible && (
        <Suspense fallback={null}>
          <LoadedCardStack
            assetBase={assetBase}
            cards={cards}
            backwards={backwards}
            holoMaterials={holoMaterials}
            stackRef={stackRef}
            cardRefs={cardRefs}
            readyRef={cardAssetsReadyRef}
            onPointerDown={handleStackPointerDown}
          />
        </Suspense>
      )}

      {/* booster pack stack — bulk opens cascade upward so every pack peeks
          out above the one in front, like the reference app */}
      {cardsVisible && (
        <group ref={packRef} position={[0, packBaseY, 0]} scale={packScale}>
          {Array.from({ length: stackCount }).map((_, i) => (
            // all packs upright and parallel, each directly behind the one in
            // front, peeking above it — reference-app stack
            <group
              key={i}
              position={[
                0,
                packStackProgress(i, stackCount) * PACK_STACK_LIFT - PACK_H / 2,
                -packStackProgress(i, stackCount) * PACK_STACK_DEPTH,
              ]}
            >
              <group position={[0, PACK_H / 2, 0]}>
                {/* Below the tear: what stays in your hand. Until there is a cut
                  the whole shell lives here, so a sealed pack is one mesh and
                  there is no seam to see. */}
                <group
                  ref={(g) => {
                    bodyRefs.current[i] = g;
                  }}
                >
                  <mesh
                    geometry={cutGeos ? cutGeos.below : pack.geometry}
                    renderOrder={5}
                  >
                    <FoilMaterial
                      map={sheetTex}
                      normalMap={normalTex}
                      materialRef={registerWrapperMaterial}
                      dim={i !== 0}
                      doubleSide
                    />
                  </mesh>
                  {i === 0 && seamGeos && (
                    <mesh geometry={seamGeos.below} renderOrder={7}>
                      <meshBasicMaterial
                        ref={edgeBodyMatRef}
                        color="#bffcff"
                        transparent
                        opacity={0}
                        blending={THREE.AdditiveBlending}
                        depthWrite={false}
                        side={THREE.DoubleSide}
                      />
                    </mesh>
                  )}
                </group>

                {/* Above the tear: the strip that shears away. */}
                <group
                  ref={(g) => {
                    stripRefs.current[i] = g;
                  }}
                >
                  {cutGeos && (
                    <mesh geometry={cutGeos.above} renderOrder={5}>
                      <FoilMaterial
                        map={sheetTex}
                        normalMap={normalTex}
                        materialRef={registerWrapperMaterial}
                        dim={i !== 0}
                        doubleSide
                      />
                    </mesh>
                  )}
                  {i === 0 && seamGeos && (
                    <mesh geometry={seamGeos.above} renderOrder={7}>
                      <meshBasicMaterial
                        ref={edgeStripMatRef}
                        color="#bffcff"
                        transparent
                        opacity={0}
                        blending={THREE.AdditiveBlending}
                        depthWrite={false}
                        side={THREE.DoubleSide}
                      />
                    </mesh>
                  )}
                </group>
              </group>
            </group>
          ))}

          {/* tear hit area + glow feedback */}
          {phase === "tear" && (
            <>
              <mesh
                position={[0, (CUT_MIN + CUT_MAX) / 2, tearHitZ]}
                onPointerDown={handleTearDown}
                onPointerMove={handleTearMove}
              >
                <planeGeometry args={[PACK_W * 1.5, CUT_MAX - CUT_MIN + 0.5]} />
                <meshBasicMaterial
                  transparent
                  opacity={0}
                  depthWrite={false}
                  side={THREE.DoubleSide}
                />
              </mesh>
              <primitive object={tearTrail} />
              <primitive object={tearTrailPoints} />
              <sprite
                ref={tearHeadRef}
                position={[0, TEAR_Y, tearFeedbackZ]}
                visible={false}
              >
                <spriteMaterial
                  map={glowTex}
                  color={accentColor}
                  transparent
                  depthWrite={false}
                  blending={THREE.AdditiveBlending}
                />
              </sprite>
            </>
          )}
        </group>
      )}
    </group>
  );
}
