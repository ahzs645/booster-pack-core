"use client";

import {
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import { splitGeometryByCut, type CutFn, type SplitMesh } from "../index";
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
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { tierRank, type PackVariant, type PulledCard } from "./pack-data";
import { PACK_H, PACK_W, packGeometry } from "./pack-mesh";
import { paintVariantSheet } from "./pack-sheet";
import type { PackOpeningPhase as PackPhase } from "./types";

export type { PackOpeningPhase as PackPhase } from "./types";

export interface PackSceneControls {
  timeScale: number;
  reducedMotion: boolean;
  openSelected?: () => void;
  revealNext?: () => void;
}

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
  onInspect: (card: PulledCard) => void;
  onAllRevealed: () => void;
  onFlash: () => void;
}

const TEAR_FRAC = 0.8;
const TEAR_Y = PACK_H * (TEAR_FRAC - 0.5);
const CARD_W = 2.02;
const CARD_H = CARD_W * (88 / 63);
// Standard trading-card corners are approximately a 3 mm radius on a 63 mm
// card. Keep this ratio as the single silhouette source for every card layer.
const CARD_CORNER_RADIUS = CARD_W * (3 / 63);
const GOLD = new THREE.Color("#ffd76a");

/* ---------------------------------- helpers --------------------------------- */

// how far the cut may wander from the perforation: generous downward into the
// art, bounded above by the crimp
const CUT_MIN = TEAR_Y - 0.55 * (PACK_H / 3.3);
const CUT_MAX = TEAR_Y + 0.34 * (PACK_H / 3.3);

/**
 * One rounded silhouette for the scan, holo pass, and card back. Using geometry
 * instead of source-image alpha also clips scans whose corner pixels are opaque.
 */
function makeRoundedCardGeometry(): THREE.ShapeGeometry {
  const halfWidth = CARD_W / 2;
  const halfHeight = CARD_H / 2;
  const radius = CARD_CORNER_RADIUS;
  const shape = new THREE.Shape();

  shape.moveTo(-halfWidth + radius, -halfHeight);
  shape.lineTo(halfWidth - radius, -halfHeight);
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + radius);
  shape.lineTo(halfWidth, halfHeight - radius);
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - radius, halfHeight);
  shape.lineTo(-halfWidth + radius, halfHeight);
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - radius);
  shape.lineTo(-halfWidth, -halfHeight + radius);
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + radius, -halfHeight);

  const geometry = new THREE.ShapeGeometry(shape, 8);
  const positions = geometry.getAttribute("position");
  const uvs = new Float32Array(positions.count * 2);
  for (let index = 0; index < positions.count; index += 1) {
    uvs[index * 2] = (positions.getX(index) + halfWidth) / CARD_W;
    uvs[index * 2 + 1] = (positions.getY(index) + halfHeight) / CARD_H;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  return geometry;
}

/**
 * Piecewise-linear cut line through the user's actual drag path — lightly
 * smoothed so pointer noise doesn't spike, but the drawn shape is kept.
 */
function buildCutFnFromPath(path: { x: number; y: number }[]): CutFn {
  const sorted = path
    .filter((p, i, arr) => i === 0 || Math.abs(p.x - arr[i - 1].x) > 0.015)
    .sort((a, b) => a.x - b.x);
  // 3-tap moving average preserves the drawn line while killing jitter
  const pts = sorted.map((p, i, arr) => {
    const prev = arr[Math.max(0, i - 1)];
    const next = arr[Math.min(arr.length - 1, i + 1)];
    return { x: p.x, y: (prev.y + p.y + next.y) / 3 };
  });
  return (x: number) => {
    let base = TEAR_Y;
    if (pts.length >= 2) {
      if (x <= pts[0].x) base = pts[0].y;
      else if (x >= pts[pts.length - 1].x) base = pts[pts.length - 1].y;
      else {
        for (let i = 1; i < pts.length; i++) {
          if (x <= pts[i].x) {
            const t = (x - pts[i - 1].x) / (pts[i].x - pts[i - 1].x || 1);
            base = THREE.MathUtils.lerp(pts[i - 1].y, pts[i].y, t);
            break;
          }
        }
      }
    }
    // no artificial jag: the cut is exactly the user's (smoothed) drag path
    return THREE.MathUtils.clamp(base, CUT_MIN, CUT_MAX);
  };
}

/** Jagged-but-centered cut for skip-tear / fallback opens. */
const DEFAULT_TORN_CUT: CutFn = (x) =>
  TEAR_Y + Math.sin(x * 23.7) * 0.012 + Math.sin(x * 57.3 + 2) * 0.009;

/**
 * The wrapper, severed along the tear.
 *
 * The pack used to be planes whose vertices were generated from the cut, so a new
 * tear meant rebuilding them; it is now a fixed mesh, and the cut is applied to
 * it. `splitGeometryByCut` refines the mesh as far as the curve needs and returns
 * the two halves plus the severed boundary, which is what the glow traces —
 * derived from the actual cut rather than drawn along a guess at it, so it stays
 * on the edge around the pack's sides too.
 */
function buildCutSet(geometry: THREE.BufferGeometry, cutFn: CutFn): SplitMesh {
  return splitGeometryByCut(geometry, cutFn);
}

/**
 * The severed boundary as a ribbon that hugs the torn edge.
 *
 * Not `lineSegments`: WebGL clamps `lineWidth` to 1px on essentially every
 * platform, so the glow would be a hairline you cannot see against the artwork.
 * Each seam segment becomes a quad instead, extended away from the cut — down for
 * the half that stays, up for the strip — so both edges glow along the side they
 * are about to part from.
 *
 * The ribbon is pushed slightly outward from the pack's axis rather than along
 * +Z, because the seam runs around the wrap's sides as well as across its face,
 * and a flat Z offset would bury it in the gussets.
 */
function seamRibbonGeometry(
  seam: Float32Array,
  side: 1 | -1,
): THREE.BufferGeometry {
  const width = 0.06 * (PACK_H / 3.3);
  const lift = 0.012;
  const out: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < seam.length; i += 6) {
    a.set(seam[i], seam[i + 1], seam[i + 2]);
    b.set(seam[i + 3], seam[i + 4], seam[i + 5]);

    // Outward from the pack's vertical axis; degenerate only dead-centre, where
    // there is no surface anyway.
    n.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    if (n.lengthSq() < 1e-8) n.set(0, 0, 1);
    n.normalize().multiplyScalar(lift);

    const ax = a.x + n.x;
    const az = a.z + n.z;
    const bx = b.x + n.x;
    const bz = b.z + n.z;
    const ay = a.y;
    const by = b.y;
    const ay2 = a.y + side * width;
    const by2 = b.y + side * width;

    out.push(ax, ay, az, bx, by, bz, bx, by2, bz);
    out.push(ax, ay, az, bx, by2, bz, ax, ay2, az);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  geo.computeBoundingSphere();
  return geo;
}

/** Procedural crinkle normal map so the foil catches light unevenly. */
function makeWrinkleNormalTexture(): THREE.DataTexture {
  const w = 128;
  const h = 192;
  const height = new Float32Array(w * h);
  // soft random bumps
  for (let k = 0; k < 70; k++) {
    const cx = Math.random() * w;
    const cy = Math.random() * h;
    const r = 4 + Math.random() * 16;
    const amp = (Math.random() - 0.5) * 1.8;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
        if (d2 < 1) height[y * w + x] += amp * Math.exp(-d2 * 3);
      }
    }
  }
  // fine crinkle
  for (let i = 0; i < height.length; i++)
    height[i] += (Math.random() - 0.5) * 0.3;

  const data = new Uint8Array(w * h * 4);
  const strength = 1.6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xm = height[y * w + Math.max(0, x - 1)];
      const xp = height[y * w + Math.min(w - 1, x + 1)];
      const ym = height[Math.max(0, y - 1) * w + x];
      const yp = height[Math.min(h - 1, y + 1) * w + x];
      const n = new THREE.Vector3(
        -(xp - xm) * strength,
        -(yp - ym) * strength,
        1,
      ).normalize();
      const i = (y * w + x) * 4;
      data[i] = Math.round(n.x * 127 + 128);
      data[i + 1] = Math.round(n.y * 127 + 128);
      data[i + 2] = Math.round(n.z * 127 + 128);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

function makeGlowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const HOLO_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDirW = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const HOLO_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  uniform float uTime;
  uniform float uIntensity;
  uniform vec2 uTilt;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    float facing = clamp(dot(normalize(vViewDirW), normalize(vNormalW)), 0.0, 1.0);
    float fres = pow(1.0 - facing, 1.2) * 0.6 + 0.4;
    float band1 = sin((vUv.x + vUv.y) * 11.0 + uTilt.x * 5.0 + uTime * 0.7);
    float band2 = sin((vUv.x - vUv.y) * 8.0 - uTilt.y * 5.0 - uTime * 0.5);
    float mask =
      smoothstep(0.55, 0.95, band1 * 0.5 + 0.5) * 0.7 +
      smoothstep(0.6, 0.95, band2 * 0.5 + 0.5) * 0.5;
    vec3 col = hsv2rgb(vec3(
      fract(vUv.x * 0.5 + vUv.y * 0.35 + uTilt.x * 0.25 + uTime * 0.02),
      0.65,
      1.0
    ));
    gl_FragColor = vec4(col * mask * fres * uIntensity, 0.0);
  }
`;

function makeHoloMaterial(intensity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: HOLO_VERTEX,
    fragmentShader: HOLO_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: intensity },
      uTilt: { value: new THREE.Vector2() },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number): number {
  return t * t * t;
}

// kept subtle: the additive holo shine must never wash out the card art
function holoIntensityFor(card: PulledCard): number {
  const rank = tierRank(card.tier);
  if (rank >= 4) return 0.45; // chase
  if (rank >= 3) return 0.3; // ultra
  if (rank >= 2) return 0.18; // rare / holo
  return 0;
}

/** Procedural indoor environment so the foil has something to reflect. */
export function FoilEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

interface FoilMaterialProps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  materialRef?: (mat: THREE.MeshPhysicalMaterial | null) => void;
  /** pitched slats face the bright env "ceiling" — dim them or they blow out */
  dim?: boolean;
  /** side walls render double-sided so winding never culls them */
  doubleSide?: boolean;
}

function FoilMaterial({
  map,
  normalMap,
  materialRef,
  dim = false,
  doubleSide = false,
}: FoilMaterialProps) {
  return (
    <meshPhysicalMaterial
      ref={materialRef}
      side={doubleSide ? THREE.DoubleSide : THREE.FrontSide}
      map={map}
      normalMap={normalMap}
      normalScale={new THREE.Vector2(0.035, 0.035)}
      // Keep the wrapper readable. Published scans already contain their
      // printed foil/highlights, so scene lighting should shape the mesh rather
      // than paint another glare layer over the artwork.
      metalness={0}
      roughness={dim ? 0.9 : 0.82}
      clearcoat={dim ? 0.04 : 0.08}
      clearcoatRoughness={0.78}
      clearcoatNormalMap={normalMap}
      clearcoatNormalScale={new THREE.Vector2(0.012, 0.012)}
      ior={1.46}
      specularIntensity={dim ? 0.06 : 0.1}
      iridescence={0}
      iridescenceIOR={1.3}
      envMapIntensity={dim ? 0.025 : 0.05}
      transparent
      alphaTest={0.02}
    />
  );
}

/* ------------------------------- pack select -------------------------------- */

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

function openingPackScale(viewportWidth: number, viewportHeight: number) {
  return THREE.MathUtils.clamp(
    Math.min(
      (viewportWidth * 0.78) / PACK_W,
      (viewportHeight * 0.68) / PACK_H,
    ),
    0.72,
    1,
  );
}

const PACK_STACK_LIFT = PACK_H * 0.11;
const PACK_STACK_DEPTH = PACK_W * 0.16;

function packStackProgress(index: number, packCount: number) {
  const visibleCount = Math.min(packCount, 10);
  return visibleCount > 1 ? index / (visibleCount - 1) : 0;
}

function openingPackBaseY(compact: boolean, packCount: number) {
  // Anchor the highest wrapper at the same vertical line for ×1, ×5 and ×10.
  // The whole stack has one fixed lift, divided across however many wrappers
  // are visible, so ×10 stays as compact and aligned as ×5.
  const singlePackY = compact ? -1.12 : -0.2;
  const stackLift = packCount > 1 ? PACK_STACK_LIFT : 0;
  return singlePackY - stackLift;
}

interface LoadedCardStackProps {
  assetBase: string;
  cards: PulledCard[];
  holoMaterials: THREE.ShaderMaterial[];
  stackRef: React.RefObject<THREE.Group | null>;
  cardRefs: React.RefObject<(THREE.Group | null)[]>;
  readyRef: React.RefObject<boolean>;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
}

function rendererAssetURL(url: string): string {
  if (
    globalThis.location?.protocol !== "tcger-pack:" ||
    !url.startsWith("https://")
  ) {
    return url;
  }
  // Keep textures on the document's custom-scheme origin. WebKit applies
  // origin checks to different hosts even when one scheme handler owns both.
  return `tcger-pack://assets/remote-image?url=${encodeURIComponent(url)}`;
}

function makeCardCanvasTexture(
  title: string,
  subtitle: string,
  detail: string,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 630;
  canvas.height = 880;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 630, 880);
  gradient.addColorStop(0, "#172554");
  gradient.addColorStop(0.52, "#312e81");
  gradient.addColorStop(1, "#111827");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 630, 880);
  context.strokeStyle = "rgba(255,255,255,0.45)";
  context.lineWidth = 10;
  context.strokeRect(28, 28, 574, 824);
  context.fillStyle = "rgba(255,255,255,0.12)";
  context.beginPath();
  context.arc(315, 345, 122, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "white";
  context.textAlign = "center";
  context.font = "700 42px system-ui, sans-serif";
  context.fillText(title.slice(0, 23), 315, 610);
  context.font = "600 27px system-ui, sans-serif";
  context.fillStyle = "rgba(255,255,255,0.78)";
  context.fillText(subtitle, 315, 662);
  context.font = "500 23px system-ui, sans-serif";
  context.fillStyle = "rgba(255,255,255,0.62)";
  context.fillText(detail, 315, 756);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeOfflineCardTexture(card: PulledCard): THREE.Texture {
  return makeCardCanvasTexture(
    card.name,
    `${card.setName} · ${card.localId}`,
    "Artwork unavailable offline",
  );
}

function makeGenericCardBackTexture(): THREE.Texture {
  return makeCardCanvasTexture("TCGer", "Trading Card", "Card back");
}

/**
 * Card artwork is intentionally isolated behind its own Suspense boundary.
 * Loading remote scans must never suspend the sealed wrapper that is already
 * on screen; the cards can warm invisibly while the user tears the pack.
 */
function LoadedCardStack({
  assetBase,
  cards,
  holoMaterials,
  stackRef,
  cardRefs,
  readyRef,
  onPointerDown,
}: LoadedCardStackProps) {
  const [frontTextures, setFrontTextures] = useState<THREE.Texture[] | null>(
    null,
  );
  const [backTexture, setBackTexture] = useState<THREE.Texture | null>(null);
  const cardGeometry = useMemo(() => makeRoundedCardGeometry(), []);

  useEffect(() => {
    let live = true;
    readyRef.current = false;
    const loader = new THREE.TextureLoader();
    const load = (url: string, fallback: () => THREE.Texture) =>
      new Promise<THREE.Texture>((resolve) => {
        loader.load(
          rendererAssetURL(url),
          resolve,
          undefined,
          () => resolve(fallback()),
        );
      });

    const fronts = cards.map((card) =>
      load(card.imageUrl, () => makeOfflineCardTexture(card)),
    );
    const back = load(
      `${assetBase.replace(/\/$/, "")}/pack/card-backs/pokemon.png`,
      makeGenericCardBackTexture,
    );

    void Promise.all([Promise.all(fronts), back]).then(
      ([loadedFronts, loadedBack]) => {
        const textures = [...loadedFronts, loadedBack];
        if (!live) {
          textures.forEach((texture) => texture.dispose());
          return;
        }
        for (const texture of textures) {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 8;
          texture.needsUpdate = true;
        }
        setFrontTextures(loadedFronts);
        setBackTexture(loadedBack);
        readyRef.current = true;
      },
    );

    return () => {
      live = false;
      readyRef.current = false;
    };
  }, [assetBase, cards, readyRef]);

  useEffect(() => () => cardGeometry.dispose(), [cardGeometry]);
  useEffect(
    () => () => {
      frontTextures?.forEach((texture) => texture.dispose());
      backTexture?.dispose();
    },
    [backTexture, frontTextures],
  );

  if (!frontTextures || !backTexture) return null;

  return (
    <group
      ref={stackRef}
      position={[0, -0.15, 0]}
      scale={0.92}
      visible={false}
      onPointerDown={onPointerDown}
    >
      {cards.map((card, index) => (
        <group
          key={card.id}
          ref={(group) => {
            cardRefs.current[index] = group;
          }}
          position={[0, 0, -index * 0.012]}
        >
          <mesh>
            <primitive object={cardGeometry} attach="geometry" />
            {/* unlit + untonemapped: card scans render exactly as-is */}
            <meshBasicMaterial
              map={frontTextures[index]}
              transparent
              alphaTest={0.05}
              toneMapped={false}
            />
          </mesh>
          {holoIntensityFor(card) > 0 && (
            <mesh position={[0, 0, 0.002]} material={holoMaterials[index]}>
              <primitive object={cardGeometry} attach="geometry" />
            </mesh>
          )}
          <mesh rotation={[0, Math.PI, 0]} position={[0, 0, -0.003]}>
            <primitive object={cardGeometry} attach="geometry" />
            <meshBasicMaterial map={backTexture} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

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
  onInspect,
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
    (viewport.width * (nativeLayout ? 0.66 : 0.72)) / CARD_W,
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
    charge: { t: 0, done: false },
    dismiss: new Map<number, { t: number; dir: number }>(),
    allNotified: false,
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

  const revealNext = useCallback(() => {
    if (phase !== "reveal") return;
    const a = anim.current;
    const idx = a.topIndex;
    if (idx >= cards.length) return;
    const isBig = tierRank(cards[idx].tier) >= 3;
    if (isBig && !a.charge.done) {
      a.charge.done = true;
      if (!controls.current.reducedMotion) {
        onFlash();
      }
    }
    a.dismiss.set(idx, { t: 0, dir: idx % 2 === 0 ? 1 : -1 });
    a.topIndex = idx + 1;
    a.charge = { t: 0, done: false };
    if (a.topIndex < cards.length) onReveal(a.topIndex + 1);
  }, [cards, controls, onFlash, onReveal, phase]);

  useEffect(() => {
    controls.current.revealNext = revealNext;
    return () => {
      if (controls.current.revealNext === revealNext) {
        controls.current.revealNext = undefined;
      }
    };
  }, [controls, revealNext]);

  const handleStackClick = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const card = cards[anim.current.topIndex];
    if (phase === "reveal" && card) onInspect(card);
  };

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
          ? backwards ? Math.PI : 0
          : THREE.MathUtils.damp(
              pack.rotation.y,
              backwards ? Math.PI : 0,
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
        posAttr.setXYZ(i, p.x, p.y, pack.faceZ + 0.05);
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
        tearHeadRef.current.position.set(last.x, last.y, pack.faceZ + 0.06);
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
          0,
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
      const isBig = top ? tierRank(top.tier) >= 3 : false;

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
      if (topGroup && top) {
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
            holoMaterials={holoMaterials}
            stackRef={stackRef}
            cardRefs={cardRefs}
            readyRef={cardAssetsReadyRef}
            onPointerDown={handleStackClick}
          />
        </Suspense>
      )}

      {/* booster pack stack — bulk opens cascade upward so every pack peeks
          out above the one in front, like the reference app */}
      {cardsVisible && (
        <group
          ref={packRef}
          position={[0, packBaseY, 0]}
          scale={packScale}
        >
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
                position={[0, (CUT_MIN + CUT_MAX) / 2, 0.3]}
                onPointerDown={handleTearDown}
                onPointerMove={handleTearMove}
              >
                <planeGeometry args={[PACK_W * 1.5, CUT_MAX - CUT_MIN + 0.5]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
              <primitive object={tearTrail} />
              <primitive object={tearTrailPoints} />
              <sprite
                ref={tearHeadRef}
                position={[0, TEAR_Y, 0.32]}
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
