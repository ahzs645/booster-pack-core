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

import {
  BODY_PATCH,
  makeLipMaterial,
  makePeelUniforms,
  makeStripPatch,
} from "./pack-burst-effects";
import {
  Spring,
  clamp,
  fanLayout,
  orbitPose,
  rollTearLine,
  slotAt,
  stepSprings,
  type FanSlot,
} from "./pack-burst-math";
import type { PackSound } from "./pack-burst-sound";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  LoadedCardStack,
  holoIntensityFor,
} from "./pack-card-stack";
import { tierRank, type PackVariant, type PulledCard } from "./pack-data";
import { PACK_H, PACK_W, packGeometry } from "./pack-mesh";
import type { PackSceneControls } from "./pack-scene-controls";
import {
  FoilMaterial,
  makeHoloMaterial,
  makeWrinkleNormalTexture,
} from "./pack-scene-effects";
import { openingPackBaseY, openingPackScale } from "./pack-scene-layout";
import { paintVariantSheet } from "./pack-sheet";
import {
  buildCutSet,
  seamRibbonGeometry,
  TEAR_Y,
} from "./pack-tear";
import type { PackOpeningPhase } from "./types";

interface PackBurstExperienceProps {
  assetBase?: string;
  cards: PulledCard[];
  variant: PackVariant;
  /** Overrides the painted variant sheet — a studio cover, or a composed upload. */
  sheet?: THREE.Texture | null;
  /** Keeps the deliberately flipped carousel orientation through the tear. */
  backwards?: boolean;
  /** Leaves extra breathing room around cards beneath native host controls. */
  nativeLayout?: boolean;
  phase: PackOpeningPhase;
  controls: React.MutableRefObject<PackSceneControls>;
  sound: React.RefObject<PackSound | null>;
  /** The user tore the wrapper open themselves. */
  onTorn: () => void;
  /** Every card has landed face up. */
  onOpened: () => void;
  onFlash: () => void;
  onHaptic: (style: "selection" | "impact" | "success") => void;
  onInspect: (index: number) => void;
}

/** Seconds the ring of cards takes to open out into the row. */
const UNWIND = 1.25;
/** World gravity. A pack is ~4 units tall, so this reads as a brisk real fall. */
const GRAVITY = 27;
/**
 * The burst tear runs a little above the classic perforation: the strip that
 * peels away is then thin enough to roll up, the way a real one does.
 */
const BURST_TEAR_Y = TEAR_Y + PACK_H * 0.055;
/** Cards sit a little small inside the wrapper so they clear its sides. */
const INSIDE_SCALE = 0.94;

const between = (a: number, b: number) => a + Math.random() * (b - a);
const BIT_COLOURS = [
  "#ff4f7a",
  "#ff9a48",
  "#ffd85a",
  "#58dba6",
  "#58b6ff",
  "#9478ff",
  "#ff6bd0",
  "#ffffff",
].map(
  (hex) => new THREE.Color(hex),
);

type CardPhase = "in" | "shot" | "orbit" | "spread";

interface CardSim {
  p: Record<"x" | "y" | "z" | "rx" | "ry" | "rz" | "s", Spring>;
  phase: CardPhase;
  from: number;
  x0: number;
  y0: number;
  vy0: number;
  rz0: number;
  landAt: number;
  lifted: boolean;
  /** Stays drawn on top until it has sunk back past its neighbours. */
  up: boolean;
  u: number;
  v: number;
  rank: number;
}

interface Bit {
  inside: boolean;
  lx: number;
  ly: number;
  lz: number;
  rise: number;
  aim: number;
  speed: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  r0: number;
  spin: number;
  drag: number;
  slip: number;
  glide: number;
  size: number;
  wave: number;
  age: number;
  tint: number;
  live: boolean;
}

interface DragState {
  id: number;
  x0: number;
  y0: number;
  p0: number;
  moved: boolean;
  dy: number;
}

function makeSim() {
  const spring = (response: number, bounce: number) =>
    new Spring(0, response, bounce);
  return {
    stage: "idle" as "idle" | "open" | "spread",
    t: 0,
    P: {
      x: spring(0.7, 0.28),
      y: spring(0.7, 0.28),
      rx: spring(0.7, 0.28),
      ry: spring(0.7, 0.28),
      rz: spring(0.7, 0.28),
    },
    squeeze: spring(0.3, 0.45),
    tear: {
      p: spring(0.1, 0),
      lift: spring(0.28, 0.35),
      pitch: spring(0.3, 0.2),
      dir: 1,
      last: 0,
      held: false,
      mark: 0,
    },
    drag: null as DragState | null,
    openedAt: 0,
    nudgeAt: 5,
    unwoundAt: 0,
    landed: false,
    notified: false,
    fly: null as null | {
      vx: number;
      vy: number;
      spin: number;
      tumble: number;
    },
    fall: null as null | { y: number; v: number },
    cards: [] as CardSim[],
    bits: [] as Bit[],
    focus: null as number | null,
    sticky: null as number | null,
    pointerIn: false,
    touch: false,
    hot: -1,
  };
}

export function PackBurstExperience({
  assetBase = "",
  cards,
  variant,
  sheet,
  backwards = false,
  nativeLayout = false,
  phase,
  controls,
  sound,
  onTorn,
  onOpened,
  onFlash,
  onHaptic,
  onInspect,
}: PackBurstExperienceProps) {
  const viewport = useThree((state) => state.viewport);
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);
  const compact = viewport.width < 4.4;
  const packScale = openingPackScale(viewport.width, viewport.height);
  const packBaseY = openingPackBaseY(compact, 1);
  const worldPerPixel = viewport.height / Math.max(1, size.height);
  const face = backwards ? -1 : 1;
  const coarse = useMemo(
    () => globalThis.matchMedia?.("(pointer: coarse)").matches ?? false,
    [],
  );

  const pack = use(packGeometry(assetBase));
  const sheetTex = useMemo(
    () => sheet ?? paintVariantSheet(variant, pack.layout),
    [sheet, variant, pack.layout],
  );
  const normalTex = useMemo(() => makeWrinkleNormalTexture(), []);

  // Every pack rolls its own tear line. Splitting the mesh along it takes a
  // few tens of milliseconds, so it happens once, just after the pack is on
  // screen, and the gesture itself only ever moves a uniform.
  const line = useMemo(
    () =>
      rollTearLine(Math.random, {
        halfWidth: PACK_W / 2,
        baseY: BURST_TEAR_Y,
        minY: BURST_TEAR_Y - PACK_H * 0.055,
        maxY: BURST_TEAR_Y + PACK_H * 0.05,
        scale: PACK_H,
      }),
    [],
  );
  const [cut, setCut] = useState<SplitMesh | null>(null);
  useEffect(() => {
    let built: SplitMesh | null = null;
    const timer = window.setTimeout(() => {
      built = buildCutSet(pack.geometry, line.cut);
      setCut(built);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      built?.above.dispose();
      built?.below.dispose();
    };
  }, [line, pack.geometry]);
  const lipGeometry = useMemo(
    () => (cut ? seamRibbonGeometry(cut.seam, -1, 0.026) : null),
    [cut],
  );
  useEffect(() => () => lipGeometry?.dispose(), [lipGeometry]);

  const peel = useMemo(() => makePeelUniforms(), []);
  const stripPatch = useMemo(() => makeStripPatch(peel), [peel]);
  const lipMaterial = useMemo(() => makeLipMaterial(peel), [peel]);
  const holoMaterials = useMemo(
    () => cards.map((card) => makeHoloMaterial(holoIntensityFor(card))),
    [cards],
  );
  useEffect(
    () => () => {
      lipMaterial.dispose();
      normalTex.dispose();
    },
    [lipMaterial, normalTex],
  );
  useEffect(
    () => () => holoMaterials.forEach((material) => material.dispose()),
    [holoMaterials],
  );

  /* -------------------------------- confetti ------------------------------- */

  const bitCount = coarse ? 90 : 160;
  const confetti = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(0.075, 0.12);
    const material = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, bitCount);
    mesh.frustumCulled = false;
    mesh.renderOrder = 60;
    mesh.count = 0;
    // Allocates the per-instance colour buffer; each frame refills it.
    for (let i = 0; i < bitCount; i += 1) {
      mesh.setColorAt(i, BIT_COLOURS[i % BIT_COLOURS.length]);
    }
    return mesh;
  }, [bitCount]);
  useEffect(
    () => () => {
      confetti.geometry.dispose();
      (confetti.material as THREE.Material).dispose();
      confetti.dispose();
    },
    [confetti],
  );

  /* --------------------------------- layout -------------------------------- */

  const slots = useMemo<FanSlot[]>(
    () =>
      fanLayout({
        count: cards.length,
        viewWidth: viewport.width,
        viewHeight: viewport.height,
        cardWidth: CARD_WIDTH,
        cardHeight: CARD_HEIGHT,
        // Host chrome is laid out in pixels, so the clearance is too.
        padTop: (nativeLayout ? 104 : 60) * worldPerPixel,
        padBottom: (nativeLayout ? 168 : 140) * worldPerPixel,
        padSide: 16 * worldPerPixel,
      }),
    [cards.length, nativeLayout, viewport.height, viewport.width, worldPerPixel],
  );
  const bestIndex = useMemo(() => {
    let best = -1;
    cards.forEach((card, index) => {
      if (tierRank(card.tier) < 3) return;
      if (best < 0 || tierRank(card.tier) >= tierRank(cards[best].tier)) {
        best = index;
      }
    });
    return best;
  }, [cards]);

  const packRef = useRef<THREE.Group>(null);
  const stripRef = useRef<THREE.Group>(null);
  const stackRef = useRef<THREE.Group>(null);
  const cardRefs = useRef<(THREE.Group | null)[]>([]);
  const cardsReadyRef = useRef(false);
  const cardsPreparedRef = useRef(false);
  const sim = useMemo(makeSim, []);
  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      euler: new THREE.Euler(),
      scale: new THREE.Vector3(),
      order: [] as number[],
    }),
    [],
  );

  /* -------------------------------- gestures ------------------------------- */

  const finishTear = useCallback(
    (response: number) => {
      const tear = sim.tear;
      if (tear.p.to === 0) tear.dir = Math.random() < 0.5 ? -1 : 1;
      tear.held = true;
      tear.p.tune(response);
      tear.p.to = 1;
      tear.lift.to = between(0.3, 0.55);
      tear.pitch.to = between(0.4, 0.8);
    },
    [sim],
  );

  const letGo = useCallback(
    (pointerId?: number) => {
      const drag = sim.drag;
      if (!drag || (pointerId !== undefined && pointerId !== drag.id)) return;
      sim.drag = null;
      if (sim.stage !== "idle") return;
      const tear = sim.tear;
      if (!drag.moved) {
        // A press tears it for you; pressing a half-torn pack rips the rest.
        finishTear(tear.p.to > 0 ? 0.18 : 0.55);
        return;
      }
      if (tear.p.to > 0.55) {
        finishTear(0.18);
        return;
      }
      // Let go early and the strip relaxes where it is: a tear never heals.
      if (tear.held) sound.current?.settle();
      tear.held = false;
      tear.lift.to = 0.08 + tear.p.to * 0.2;
      tear.pitch.to = 0.1 + tear.p.to * 0.28;
    },
    [finishTear, sim, sound],
  );

  useEffect(() => {
    const packPixels = (PACK_W * packScale) / worldPerPixel;
    const move = (event: PointerEvent) => {
      const drag = sim.drag;
      if (!drag || event.pointerId !== drag.id || sim.stage !== "idle") return;
      if (event.pointerType === "mouse" && event.buttons === 0) {
        letGo(event.pointerId);
        return;
      }
      const tear = sim.tear;
      const dx = event.clientX - drag.x0;
      let dy = event.clientY - drag.y0;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < 6) return;
        drag.moved = true;
        tear.p.tune(0.1);
      }
      if (tear.p.to === 0) {
        // Nothing tears until the hand really goes sideways, and only then is
        // the side chosen. Until that it is just a tug on the pack.
        drag.dy = dy;
        if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 0.5) return;
        tear.dir = dx < 0 ? -1 : 1;
        drag.x0 = event.clientX - tear.dir * 8;
        drag.y0 = event.clientY;
        dy = 0;
      }
      tear.held = true;
      const travelled = drag.p0 > 0 ? Math.abs(dx) : dx * tear.dir;
      // A tear only moves forward.
      tear.p.to = clamp(
        drag.p0 + travelled / (packPixels * 0.85),
        tear.p.to,
        1,
      );
      const up = -dy * worldPerPixel;
      tear.lift.to = 0.16 + tear.p.to * 0.3 + clamp(up * 0.28, -0.12, 0.38);
      tear.pitch.to = 0.2 + tear.p.to * 0.45 + clamp(up * 0.35, 0, 0.42);
    };
    const up = (event: PointerEvent) => letGo(event.pointerId);
    const blur = () => letGo();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", blur);
    };
  }, [letGo, packScale, sim, worldPerPixel]);

  const handlePackDown = (event: ThreeEvent<PointerEvent>) => {
    if (phase !== "tear" || sim.stage !== "idle" || sim.drag || !cut) return;
    if (event.nativeEvent.button > 0) return;
    event.stopPropagation();
    sound.current?.resume();
    sound.current?.grab();
    sim.squeeze.v -= 4;
    sim.drag = {
      id: event.nativeEvent.pointerId,
      x0: event.nativeEvent.clientX,
      y0: event.nativeEvent.clientY,
      p0: sim.tear.p.to,
      moved: false,
      dy: 0,
    };
  };

  // Cards on the table: hover lifts one, a click or second tap inspects it.
  useEffect(() => {
    const canvas = gl.domElement;
    let down: { x: number; y: number; id: number } | null = null;
    const enter = (event: PointerEvent) => {
      sim.pointerIn = true;
      sim.touch = event.pointerType !== "mouse";
    };
    const leave = () => {
      sim.pointerIn = false;
    };
    const press = (event: PointerEvent) => {
      sim.pointerIn = true;
      sim.touch = event.pointerType !== "mouse";
      down = { x: event.clientX, y: event.clientY, id: event.pointerId };
    };
    const release = (event: PointerEvent) => {
      const start = down;
      down = null;
      if (event.pointerType !== "mouse") sim.pointerIn = false;
      if (!start || start.id !== event.pointerId || sim.stage !== "spread") {
        return;
      }
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
        return;
      }
      const bounds = canvas.getBoundingClientRect();
      const x = (event.clientX - bounds.left - bounds.width / 2) * worldPerPixel;
      const y = (bounds.top + bounds.height / 2 - event.clientY) * worldPerPixel;
      const hit = slotAt(x, y, slots, CARD_WIDTH, CARD_HEIGHT);
      if (!hit) {
        sim.sticky = null;
        return;
      }
      // Touch has no hover: the first tap lifts a card, the second opens it.
      if (event.pointerType !== "mouse" && sim.sticky !== hit.index) {
        sim.sticky = hit.index;
        const card = sim.cards[hit.index];
        if (card) {
          card.u = hit.u;
          card.v = hit.v;
        }
        return;
      }
      onInspect(hit.index);
    };
    canvas.addEventListener("pointerenter", enter);
    canvas.addEventListener("pointermove", enter);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("pointerdown", press);
    canvas.addEventListener("pointerup", release);
    return () => {
      canvas.removeEventListener("pointerenter", enter);
      canvas.removeEventListener("pointermove", enter);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("pointerdown", press);
      canvas.removeEventListener("pointerup", release);
      canvas.style.cursor = "";
    };
  }, [gl, onInspect, sim, slots, worldPerPixel]);

  // Frames stop in a hidden tab and on unmount, so nothing else would ever
  // turn a tear that was in progress back down to silence.
  useEffect(() => {
    const hush = () => {
      if (document.hidden) sound.current?.rip(0);
    };
    document.addEventListener("visibilitychange", hush);
    return () => {
      document.removeEventListener("visibilitychange", hush);
      sound.current?.rip(0);
    };
  }, [sound]);

  useEffect(() => {
    const focusCard = (index: number | null) => {
      sim.focus = index;
    };
    controls.current.focusCard = focusCard;
    return () => {
      if (controls.current.focusCard === focusCard) {
        controls.current.focusCard = undefined;
      }
    };
  }, [controls, sim]);

  /* ---------------------------------- frame -------------------------------- */

  useFrame((state, rawDelta) => {
    const reduced = controls.current.reducedMotion;
    const motion = reduced ? 0 : 1;
    const dt = Math.min(rawDelta, 0.05) * controls.current.timeScale;
    sim.t += dt;
    const t = sim.t;
    const { P, tear, squeeze } = sim;
    const packGroup = packRef.current;
    const pointer = state.pointer;
    const audio = sound.current;
    const cardsReady = cardsReadyRef.current && cardRefs.current.length > 0;

    // Card meshes are layered by draw order instead of depth, so cards that
    // overlap on the table can tilt freely without cutting through each other.
    // They still write depth, which is what hides the wrapper's back panel
    // behind the deck while it is inside the pack.
    if (cardsReady && !cardsPreparedRef.current) {
      cardsPreparedRef.current = true;
      for (const group of cardRefs.current) {
        group?.traverse((object) => {
          const material = (object as THREE.Mesh).material as
            | THREE.Material
            | undefined;
          if (material) material.depthFunc = THREE.AlwaysDepth;
        });
      }
      if (stackRef.current) {
        stackRef.current.position.set(0, 0, 0);
        stackRef.current.scale.setScalar(1);
      }
    }

    // The host can open the pack too: a button, the keyboard, a native control.
    if (phase === "opening" && sim.stage === "idle" && cut && tear.p.to < 1) {
      finishTear(reduced ? 0.1 : 0.45);
    }

    /* ------------------------------ pack, idle ----------------------------- */
    if (sim.stage === "idle") {
      const drag = sim.drag;
      const pull = drag?.moved && tear.p.to === 0 ? -drag.dy * worldPerPixel : 0;
      // Pulled up or down instead of across, it stretches after the hand and
      // springs back when let go.
      const tug = motion * Math.sign(pull) * 1.7 * (1 - 1 / (1 + Math.abs(pull) / 1.7));
      squeeze.to = tug ? -Math.abs(tug) / 0.9 : tear.held ? motion : 0;
      const hold = (drag?.moved ? 0.25 : 1) * (reduced ? 0.5 : 1);
      P.y.to = Math.sin(t * 1.4) * 0.07 * motion + tug;
      P.ry.to = pointer.x * 0.38 * hold;
      P.rx.to = -pointer.y * 0.28 * hold + squeeze.x * 0.1;
      // Leans away from the pull, but only while it is being pulled.
      P.rz.to =
        Math.sin(t * 0.9) * 0.028 * motion +
        (tear.held && tear.p.x > 0 ? tear.dir * tear.p.x * 0.05 : 0);
      if (motion && !drag && tear.p.to < 1 && t > sim.nudgeAt) {
        // Left alone it gives a little wiggle, and a half-torn one flicks its strip.
        P.rz.v += (Math.random() < 0.5 ? -1 : 1) * 1.2;
        if (tear.p.to > 0) tear.lift.v += 2.1;
        sim.nudgeAt = t + between(4, 7);
      }
    }

    const springs: Spring[] = [
      P.x,
      P.y,
      P.rx,
      P.ry,
      P.rz,
      squeeze,
      tear.p,
      tear.lift,
      tear.pitch,
    ];
    for (const card of sim.cards) springs.push(...Object.values(card.p));
    stepSprings(springs, dt);

    /* --------------------------------- tear -------------------------------- */
    const progress = clamp(tear.p.x, 0, 1);
    const localDir = tear.dir * face;
    const tipX = localDir * (progress * (PACK_W + 0.06) - PACK_W / 2 - 0.03);
    if (sim.stage === "idle" && tear.p.x > 0) {
      const advance = progress - tear.last;
      tear.last = progress;
      // The foil is only as loud as the hand is fast: slow is single crackles,
      // a flick is one long rip.
      audio?.rip(advance > 0 ? (advance / Math.max(dt, 0.004) / 4) ** 0.6 : 0);
      if (advance > 0 && motion) {
        // Each bit of tear jolts the pack.
        P.rz.v += between(-1, 1) * Math.min(advance, 0.02) * 15;
        P.y.v -= advance * 4.2;
        tear.lift.v += advance * 5;
        squeeze.v += advance * 20;
      }
      const quarter = Math.floor(progress * 4);
      if (quarter > tear.mark && quarter < 4) onHaptic("selection");
      tear.mark = Math.max(tear.mark, quarter);
      if (progress > 0.985 && tear.p.to >= 1 && cardsReady) {
        /* ------------------------------- open ------------------------------ */
        sim.stage = "open";
        sim.openedAt = t;
        sim.drag = null;
        tear.p.snap(1);
        P.rx.tune(0.3, 0).to = 0;
        P.ry.tune(0.3, 0).to = 0;
        audio?.rip(0);
        audio?.pop(!reduced);
        onHaptic("impact");
        if (phase === "tear") onTorn();
        if (!reduced) {
          sim.fly = {
            vx: tear.dir * 2.4,
            vy: 19,
            spin: -tear.dir * 9,
            tumble: 5.5,
          };
          // Recoil, and then the deck kicks the wrapper down as it leaves.
          P.y.v -= 3.2;
          P.rz.v += tear.dir * 0.7;
          for (let i = 0; i < bitCount; i += 1) {
            const lx = between(-0.44, 0.44) * PACK_W;
            const settle = 2.6 + 4 * Math.random() ** 1.5;
            sim.bits.push({
              inside: true,
              lx,
              ly: line.cut(lx) - between(0.04, 0.66),
              lz: between(0.02, 0.08) * face,
              rise: between(9, 26),
              aim:
                (lx / (PACK_W / 2) + between(-0.5, 0.5)) *
                clamp(viewport.width / 10, 0.5, 1),
              speed: between(5, 27),
              x: 0,
              y: 0,
              z: 0,
              vx: 0,
              vy: 0,
              vz: 0,
              r: between(0, Math.PI * 2),
              r0: 0,
              spin: between(-12, 12),
              drag: GRAVITY / settle / settle,
              slip: between(9, 26),
              glide: Math.sign(lx) * between(-2, 9),
              size: between(0.75, 1.5),
              wave: between(0, Math.PI * 2),
              age: i < 50 ? 0 : -between(0, 0.22),
              tint: i % BIT_COLOURS.length,
              live: true,
            });
          }
        }
        const packY = packBaseY + P.y.x;
        const insideY =
          packY + (line.lowest - 0.03 - (CARD_HEIGHT * INSIDE_SCALE) / 2) * packScale;
        sim.cards = cards.map((_, index) => {
          const make = (value: number) => new Spring(value, 0.55, 0.22);
          const card: CardSim = {
            p: {
              x: make(P.x.x),
              y: make(insideY),
              z: make(0.03 - index * 0.012),
              rx: make(0),
              ry: make(0),
              rz: make(P.rz.x),
              s: make(packScale * INSIDE_SCALE),
            },
            phase: "in",
            from: 0,
            x0: 0,
            y0: 0,
            vy0: 0,
            rz0: 0,
            landAt: 0,
            lifted: false,
            up: false,
            u: 0.5,
            v: 0.5,
            rank: index,
          };
          if (reduced) {
            const slot = slots[index];
            card.phase = "spread";
            card.landAt = t - 1;
            card.p.x.snap(slot.x);
            card.p.y.snap(slot.y);
            card.p.z.snap(slot.z);
            card.p.rz.snap(slot.rz);
            card.p.s.snap(slot.scale);
          }
          return card;
        });
      }
    }

    // Curl: the loose end rolls up on itself, a little tighter as the tear runs on.
    const curl = (0.75 + 0.25 * progress) * line.roll;
    const flutter =
      sim.stage === "idle" && !sim.drag && tear.p.x > 0
        ? motion * (Math.sin(t * 5.3) + Math.sin(t * 8.7) * 0.5) * 0.02
        : 0;
    const shiver = 1 + Math.sin(t * 16) * Math.min(1, Math.abs(tear.p.v) * 0.4) * 0.08 * motion;
    peel.uDir.value = localDir;
    peel.uFace.value = face;
    peel.uTip.value = tear.p.x > 0 ? tipX : -localDir * 100;
    peel.uTipY.value = line.cut(tipX);
    peel.uCurl.value = curl * 0.5 * shiver;
    peel.uCurl2.value = curl * 1.5 * shiver;
    peel.uLift.value = tear.lift.x + flutter;
    peel.uPitch.value = tear.pitch.x + flutter * 1.5;

    /* ----------------------------- pack and strip --------------------------- */
    if (sim.stage === "open" && !sim.fall && !reduced && t - sim.openedAt > 0.02) {
      sim.fall = { y: 0, v: 15 * packScale };
    }
    if (sim.fall && sim.fall.y < viewport.height * 1.6) {
      sim.fall.v += GRAVITY * dt;
      sim.fall.y += sim.fall.v * dt;
      P.rz.to = -tear.dir * 0.16;
    }
    const fallen = sim.fall?.y ?? 0;
    const packGone = reduced ? sim.stage !== "idle" : fallen > viewport.height * 1.4;
    if (packGroup) {
      packGroup.visible = !packGone;
      packGroup.position.set(P.x.x, packBaseY + P.y.x - fallen, 0);
      packGroup.rotation.set(
        P.rx.x,
        (backwards ? Math.PI : 0) + P.ry.x,
        P.rz.x,
      );
      // Clenches while it is being torn, lets go once it rips.
      packGroup.scale.set(
        packScale * (1 + 0.03 * squeeze.x),
        packScale * (1 - 0.06 * squeeze.x),
        packScale,
      );
    }
    const strip = stripRef.current;
    if (strip && packGroup) {
      if (sim.fly) {
        const fly = sim.fly;
        fly.vy -= GRAVITY * dt;
        strip.position.x += fly.vx * dt;
        strip.position.y += fly.vy * dt;
        strip.rotation.z += fly.spin * dt;
        strip.rotation.x += fly.tumble * dt;
        if (t - sim.openedAt > 1.6) {
          sim.fly = null;
          strip.visible = false;
        }
      } else if (sim.stage === "idle") {
        strip.position.copy(packGroup.position);
        strip.quaternion.copy(packGroup.quaternion);
        strip.scale.copy(packGroup.scale);
      } else if (reduced) {
        strip.visible = false;
      }
    }

    const since = t - sim.openedAt;
    /* --------------------------------- cards -------------------------------- */
    if (stackRef.current) stackRef.current.visible = sim.stage !== "idle";
    const stageCentreY =
      slots.reduce((sum, slot) => sum + slot.y, 0) / Math.max(1, slots.length) +
      0.12;
    const mouthY = packBaseY + P.y.x - fallen + line.lowest * packScale;
    if (
      sim.stage === "open" &&
      !sim.unwoundAt &&
      sim.cards.length > 0 &&
      sim.cards.every(
        (card) =>
          card.phase === "shot" &&
          card.p.y.x - CARD_HEIGHT * card.p.s.x * 0.36 > mouthY,
      )
    ) {
      // The deck is clear of the wrapper: from here each card's path is a pure
      // function of time, so it lands exactly on its slot.
      sim.unwoundAt = t;
      audio?.swirl(UNWIND);
      sim.cards.forEach((card, index) => {
        card.phase = "orbit";
        card.from = t + index * 0.03;
        card.x0 = card.p.x.x;
        card.y0 = card.p.y.x;
        card.vy0 = card.p.y.v;
        card.rz0 = card.p.rz.x;
        card.p.s.to = slots[index].scale;
        for (const key of ["x", "y", "z", "rx", "ry", "rz"] as const) {
          card.p[key].release();
        }
      });
    }

    let hot = -1;
    if (sim.stage !== "idle" && sim.pointerIn && !sim.touch) {
      const hit = slotAt(
        (pointer.x * viewport.width) / 2,
        (pointer.y * viewport.height) / 2,
        slots,
        CARD_WIDTH,
        CARD_HEIGHT,
      );
      if (hit && sim.cards[hit.index]?.phase === "spread") {
        hot = hit.index;
        sim.cards[hot].u = hit.u;
        sim.cards[hot].v = hit.v;
      }
    }
    if (hot !== sim.hot) {
      sim.hot = hot;
      gl.domElement.style.cursor = hot >= 0 ? "pointer" : "";
    }

    sim.cards.forEach((card, index) => {
      const p = card.p;
      const slot = slots[index];
      if (card.phase === "in" && since > index * 0.022) {
        // Fired straight up the pack, guided by its walls.
        card.phase = "shot";
        p.s.to = packScale;
        p.y.release();
        p.y.damping = 1.2;
        p.y.v = Math.min(between(12.5, 14.5) * packScale, viewport.height * 2.6);
      }
      if (card.phase === "orbit") {
        const elapsed = Math.max(0, t - card.from);
        const pose = orbitPose({
          progress: elapsed / UNWIND,
          index,
          count: sim.cards.length,
          from: { x: card.x0, y: card.y0, rz: card.rz0 },
          coastY: card.y0 + (card.vy0 / 9) * (1 - Math.exp(-9 * elapsed)),
          slot,
          centreY: stageCentreY,
          radiusX: Math.min(viewport.width * 0.33, 4.3),
          radiusY: Math.min(viewport.width * 0.33, 4.3) * 0.2,
          radiusZ: 1.4,
        });
        p.x.x = pose.x;
        p.y.x = pose.y;
        p.z.x = pose.z;
        p.rx.x = pose.rx;
        p.ry.x = pose.ry;
        p.rz.x = pose.rz;
        if (elapsed >= UNWIND) {
          card.phase = "spread";
          card.landAt = t;
          for (const spring of Object.values(p)) spring.tune(0.5, 0.22);
          audio?.land(
            clamp((slot.x / (viewport.width / 2)) * 0.6, -0.6, 0.6),
            index === bestIndex,
          );
          if (index === bestIndex && tierRank(cards[index].tier) >= 4) {
            onFlash();
          }
        }
      }
      if (card.phase === "spread") {
        const focused = sim.focus === index;
        const lifted = index === hot || sim.sticky === index || focused;
        if (focused && index !== hot && sim.sticky !== index) {
          // Picked with the keyboard, it shows off its foil by itself.
          card.u = 0.5 + Math.sin(t * 1.7) * 0.22 * motion;
          card.v = 0.5 + Math.cos(t * 1.3) * 0.16 * motion;
        }
        if (lifted !== card.lifted) {
          card.lifted = lifted;
          if (lifted) {
            audio?.lift(clamp((slot.x / (viewport.width / 2)) * 0.6, -0.6, 0.6));
          }
        }
        const sway = t * 0.8 + index * 1.9;
        p.x.to = slot.x;
        p.s.to = slot.scale * (lifted ? 1.05 : 1);
        p.y.to = slot.y + (lifted ? 0.16 : Math.sin(sway * 1.2) * 0.05 * motion);
        p.z.to = slot.z + (lifted ? 0.55 : 0);
        p.rz.to = lifted ? slot.rz * 0.3 : slot.rz;
        // Under the pointer the card tips away from it, like a pressed corner.
        p.rx.to = lifted ? -(card.v - 0.5) * 0.63 : Math.cos(sway * 0.9) * 0.07 * motion;
        p.ry.to = lifted ? (card.u - 0.5) * 0.7 : Math.sin(sway) * 0.14 * motion;
        card.up = lifted || (card.up && p.z.x > slot.z + 0.15);
      }
    });

    if (sim.stage === "open" && sim.cards.length > 0 && !sim.landed) {
      sim.landed = sim.cards.every((card) => card.phase === "spread");
    }
    if (
      sim.stage === "open" &&
      sim.landed &&
      !sim.notified &&
      (reduced || sim.cards.every((card) => t > card.landAt + 0.3))
    ) {
      sim.notified = true;
      sim.stage = "spread";
      onHaptic("success");
      onOpened();
    }

    // Painter's order: lifted cards on top, the ring by depth, the row left to right.
    scratch.order.length = 0;
    sim.cards.forEach((_, index) => scratch.order.push(index));
    const key = (index: number) => {
      const card = sim.cards[index];
      if (card.up) return 1000 + index;
      // Ties keep the deck's own order, so nothing swaps as the ring forms.
      if (card.phase === "orbit") return card.p.z.x * 100 - index * 0.001;
      return card.phase === "spread" ? index : -index;
    };
    scratch.order.sort((a, b) => key(a) - key(b));
    scratch.order.forEach((index, rank) => {
      sim.cards[index].rank = rank;
    });

    sim.cards.forEach((card, index) => {
      const group = cardRefs.current[index];
      if (!group) return;
      const p = card.p;
      const loose = card.phase === "spread" || card.phase === "orbit";
      // Inside the pack a card copies its tilt so it never pokes through the
      // wrapper; once out, motion leans it like a card moving through air.
      const rx = loose ? p.rx.x + clamp(-p.y.v * 0.0105, -0.14, 0.14) : P.rx.x;
      const ry = loose ? p.ry.x + clamp(p.x.v * 0.014, -0.21, 0.21) : P.ry.x;
      group.visible = true;
      group.position.set(p.x.x, p.y.x, p.z.x);
      group.rotation.set(rx, ry, p.rz.x);
      group.scale.setScalar(p.s.x);
      // Below the wrapper's draw order while inside it, above once out.
      const base = loose ? 10 + card.rank : 1 + card.rank * 0.2;
      group.children.forEach((child, layer) => {
        child.renderOrder = base + layer * 0.05;
      });

      const holo = holoMaterials[index];
      // The foil holds still in the air and eases in once the card has landed.
      const settled =
        card.phase === "spread"
          ? reduced
            ? 1
            : clamp((t - card.landAt - 0.2) / 0.5, 0, 1)
          : 0;
      holo.uniforms.uTime.value = reduced ? 0 : t;
      holo.uniforms.uTilt.value.set(
        clamp(ry / 0.42, -1, 1) * settled,
        clamp(-rx / 0.42, -1, 1) * settled,
      );
      holo.uniforms.uIntensity.value =
        holoIntensityFor(cards[index]) * (card.lifted ? 1.7 : 1) * (0.4 + 0.6 * settled);
    });

    /* -------------------------------- confetti ------------------------------ */
    // Paper in still air: gravity pulls it as hard as it pulls the pack; drag,
    // which grows with the square of the speed, kills the pop in a moment and
    // then sets how fast each piece can fall.
    let drawn = 0;
    if (sim.bits.length > 0 && packGroup) {
      const floor = -viewport.height / 2 - 0.4;
      for (const bit of sim.bits) {
        if (!bit.live) continue;
        bit.age += dt;
        if (bit.age < 0) continue;
        if (bit.inside) {
          // Hidden by the front of the pack until it clears the torn edge.
          bit.ly += (bit.rise * dt) / packScale;
          bit.r += bit.spin * dt;
          if (bit.ly < line.cut(bit.lx)) continue;
          scratch.position.set(bit.lx, bit.ly, bit.lz);
          packGroup.localToWorld(scratch.position);
          bit.x = scratch.position.x;
          bit.y = scratch.position.y;
          bit.z = scratch.position.z;
          bit.inside = false;
          bit.age = 0;
          bit.r0 = bit.r;
          bit.vx = Math.sin(bit.aim) * bit.speed;
          bit.vy = Math.cos(bit.aim) * bit.speed;
          bit.vz = between(0, 1.6);
        }
        bit.vy -= GRAVITY * dt;
        // Flat paper slips from side to side as it tumbles.
        bit.vx += (Math.sin(bit.wave) * bit.slip + bit.glide) * dt;
        const speed = Math.hypot(bit.vx, bit.vy);
        // A clump thrown together cuts through the air, so each piece only
        // feels its full drag once the clump has opened up. Solved implicitly
        // so a hard pop cannot overshoot and reverse.
        const slow =
          1 / (1 + bit.drag * Math.min(1, 0.06 + bit.age / 0.45) * speed * dt);
        const tumble = 0.35 + speed / 8;
        bit.vx *= slow;
        bit.vy *= slow;
        bit.x += bit.vx * dt;
        bit.y += bit.vy * dt;
        bit.z += bit.vz * dt;
        bit.r += bit.spin * tumble * dt;
        bit.wave += 7 * tumble * dt;
        if (bit.y < floor) {
          bit.live = false;
          continue;
        }
        scratch.position.set(bit.x, bit.y, bit.z);
        scratch.euler.set(0, 0, bit.r);
        scratch.quaternion.setFromEuler(scratch.euler);
        // Its height foreshortens as it turns over.
        scratch.scale.set(
          bit.size,
          bit.size * Math.cos((bit.r - bit.r0) * 0.7),
          1,
        );
        scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
        confetti.setMatrixAt(drawn, scratch.matrix);
        confetti.setColorAt(drawn, BIT_COLOURS[bit.tint]);
        drawn += 1;
      }
      if (drawn === 0 && sim.bits.every((bit) => !bit.live)) sim.bits = [];
    }
    confetti.count = drawn;
    if (drawn > 0) {
      confetti.instanceMatrix.needsUpdate = true;
      if (confetti.instanceColor) confetti.instanceColor.needsUpdate = true;
    }
  });

  const bodyGeometry = cut ? cut.below : pack.geometry;

  return (
    <group>
      <Suspense fallback={null}>
        <LoadedCardStack
          assetBase={assetBase}
          cards={cards}
          backwards={false}
          holoMaterials={holoMaterials}
          stackRef={stackRef}
          cardRefs={cardRefs}
          readyRef={cardsReadyRef}
          onPointerDown={noop}
        />
      </Suspense>

      <group ref={packRef} position={[0, packBaseY, 0]} scale={packScale}>
        <mesh geometry={bodyGeometry} renderOrder={5}>
          <FoilMaterial
            map={sheetTex}
            normalMap={normalTex}
            doubleSide
            patch={BODY_PATCH}
          />
        </mesh>
        {lipGeometry && (
          <mesh geometry={lipGeometry} material={lipMaterial} renderOrder={7} />
        )}
        {phase === "tear" && (
          // Reaches past the edges: people grab a pack by its top.
          <mesh
            position={[0, 0.12, face * (pack.faceZ + 0.3)]}
            onPointerDown={handlePackDown}
            onPointerOver={() => {
              gl.domElement.style.cursor = "grab";
            }}
            onPointerOut={() => {
              gl.domElement.style.cursor = "";
            }}
          >
            <planeGeometry args={[PACK_W + 0.5, PACK_H + 0.5]} />
            <meshBasicMaterial
              transparent
              opacity={0}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        )}
      </group>

      {/* the tear strip, bent in its vertex shader; it leaves the pack when it flies off */}
      <group ref={stripRef} position={[0, packBaseY, 0]} scale={packScale}>
        {cut && (
          <mesh geometry={cut.above} renderOrder={6} frustumCulled={false}>
            <FoilMaterial
              map={sheetTex}
              normalMap={normalTex}
              doubleSide
              patch={stripPatch}
            />
          </mesh>
        )}
      </group>

      <primitive object={confetti} />
    </group>
  );
}

const noop = () => {};
