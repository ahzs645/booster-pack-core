"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";

import { tierRank, type PulledCard } from "./pack-data";

export const CARD_WIDTH = 2.02;
const CARD_HEIGHT = CARD_WIDTH * (88 / 63);
// Standard trading-card corners are approximately a 3 mm radius on a 63 mm
// card. Keep this ratio as the single silhouette source for every card layer.
const CARD_CORNER_RADIUS = CARD_WIDTH * (3 / 63);

interface LoadedCardStackProps {
  assetBase: string;
  cards: PulledCard[];
  backwards: boolean;
  holoMaterials: THREE.ShaderMaterial[];
  stackRef: React.RefObject<THREE.Group | null>;
  cardRefs: React.RefObject<(THREE.Group | null)[]>;
  readyRef: React.RefObject<boolean>;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
}

/**
 * One rounded silhouette for the scan, holo pass, and card back. Using geometry
 * also clips scans whose corner pixels are opaque.
 */
function makeRoundedCardGeometry(): THREE.ShapeGeometry {
  const halfWidth = CARD_WIDTH / 2;
  const halfHeight = CARD_HEIGHT / 2;
  const radius = CARD_CORNER_RADIUS;
  const shape = new THREE.Shape();

  shape.moveTo(-halfWidth + radius, -halfHeight);
  shape.lineTo(halfWidth - radius, -halfHeight);
  shape.quadraticCurveTo(
    halfWidth,
    -halfHeight,
    halfWidth,
    -halfHeight + radius,
  );
  shape.lineTo(halfWidth, halfHeight - radius);
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - radius, halfHeight);
  shape.lineTo(-halfWidth + radius, halfHeight);
  shape.quadraticCurveTo(
    -halfWidth,
    halfHeight,
    -halfWidth,
    halfHeight - radius,
  );
  shape.lineTo(-halfWidth, -halfHeight + radius);
  shape.quadraticCurveTo(
    -halfWidth,
    -halfHeight,
    -halfWidth + radius,
    -halfHeight,
  );

  const geometry = new THREE.ShapeGeometry(shape, 8);
  const positions = geometry.getAttribute("position");
  const uvs = new Float32Array(positions.count * 2);
  for (let index = 0; index < positions.count; index += 1) {
    uvs[index * 2] = (positions.getX(index) + halfWidth) / CARD_WIDTH;
    uvs[index * 2 + 1] = (positions.getY(index) + halfHeight) / CARD_HEIGHT;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  return geometry;
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

/** Kept subtle: the additive holo shine must never wash out card art. */
export function holoIntensityFor(card: PulledCard): number {
  const rank = tierRank(card.tier);
  if (rank >= 4) return 0.45;
  if (rank >= 3) return 0.3;
  if (rank >= 2) return 0.18;
  return 0;
}

/**
 * Card artwork is intentionally isolated behind its own Suspense boundary.
 * Loading remote scans must never suspend the sealed wrapper already on screen.
 */
export function LoadedCardStack({
  assetBase,
  cards,
  backwards,
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
        loader.load(rendererAssetURL(url), resolve, undefined, () =>
          resolve(fallback()),
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
          rotation={[0, backwards ? Math.PI : 0, 0]}
        >
          <mesh>
            <primitive object={cardGeometry} attach="geometry" />
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
