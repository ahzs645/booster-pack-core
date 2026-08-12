"use client";

import {
  DEFAULT_TRANSFORM,
  composeCover,
  type Manifest,
  type SheetLayout,
} from "../index";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";

import { PACK_VARIANTS, packVariantById, type PackVariant } from "./pack-data";
import { SHEET_H, SHEET_W, packManifest } from "./pack-mesh";
import { paintVariantSheet } from "./pack-sheet";

/**
 * What the pack is wearing.
 *
 * All three end up as the same thing — one 1024×512 sheet on the shared mesh —
 * they just differ in where it came from: painted from a palette, baked in the
 * studio and committed to the shared assets, or composed here from an image you
 * dropped in.
 */
export type PackSkin =
  | { kind: "variant"; id: string; label: string }
  | {
      kind: "cover";
      id: string;
      label: string;
      url: string;
      packPool?: string;
      accentVariant?: string;
    }
  | { kind: "custom"; id: string; label: string; texture: THREE.CanvasTexture };

/** Skins keep a variant for their accent colours; the tear glow and charge-up need one. */
export function skinVariant(skin: PackSkin): PackVariant {
  const variantId =
    skin.kind === "variant"
      ? skin.id
      : skin.kind === "cover"
        ? skin.accentVariant
        : undefined;
  return packVariantById(variantId ?? PACK_VARIANTS[0].id);
}

export const VARIANT_SKINS: PackSkin[] = PACK_VARIANTS.map((v) => ({
  kind: "variant",
  id: v.id,
  label: v.name,
}));

export function coverSkins(manifest: Manifest | null): PackSkin[] {
  if (!manifest) return [];
  return Object.entries(manifest.covers).map(([id, cover]) => ({
    kind: "cover",
    id,
    label: cover.label,
    packPool: cover.packPool,
    accentVariant: cover.accentVariant,
    // The plain sheet: the decaled variant differs only by an overlay mark, and
    // offering both doubles the picker for a difference you cannot see at chip size.
    url: cover.plain,
  }));
}

/** The cover sheets shipped in the shared assets, once the manifest arrives. */
export function usePackManifest(assetBase = ""): Manifest | null {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  useEffect(() => {
    let live = true;
    packManifest(assetBase)
      .then((m) => live && setManifest(m))
      .catch(() => {
        // The variants are painted, not loaded, so the picker still works without it.
      });
    return () => {
      live = false;
    };
  }, [assetBase]);
  return manifest;
}

/**
 * The texture for a skin.
 *
 * Variants are painted on demand — they cost nothing to keep and change with the
 * layout — while covers are fetched. A custom skin already carries its texture,
 * because composing it is what produced the skin in the first place.
 */
export function useSkinTexture(
  skin: PackSkin,
  layout: SheetLayout | null,
  onError?: (message: string) => void,
): THREE.Texture | null {
  const [loaded, setLoaded] = useState<THREE.Texture | null>(null);

  const painted = useMemo(() => {
    if (skin.kind !== "variant" || !layout) return null;
    return paintVariantSheet(packVariantById(skin.id), layout);
  }, [skin, layout]);

  useEffect(() => {
    if (skin.kind !== "cover") {
      setLoaded(null);
      return;
    }
    let live = true;
    const loader = new THREE.TextureLoader();
    loader.load(
      skin.url,
      (tex) => {
        if (!live) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.needsUpdate = true;
        setLoaded(tex);
      },
      undefined,
      () => {
        if (!live) return;
        setLoaded(null);
        onError?.(`Pack artwork failed to load: ${skin.label}`);
      },
    );
    return () => {
      live = false;
    };
  }, [onError, skin]);

  if (skin.kind === "custom") return skin.texture;
  if (skin.kind === "cover") return loaded;
  return painted;
}

/**
 * Composes a dropped image into a wrap sheet, the way the studio would.
 *
 * Same compositor, same layout, so what you get here is what you would get by
 * dropping the file into the builder and exporting — auto-fitted to the display
 * panel, continued across the reverse face, with procedural furniture sampled
 * from the image filling everything the artwork does not cover.
 */
export function composeSkinFromImage(
  image: HTMLImageElement,
  layout: SheetLayout,
  label: string,
): PackSkin {
  const canvas = document.createElement("canvas");
  composeCover(canvas, layout, {
    art: image,
    transform: DEFAULT_TRANSFORM,
    fit: "cover",
    placement: "panel",
    // The wrap's UVs are not area-preserving, so artwork drawn square comes out
    // squashed on the pack unless it is pre-stretched.
    aspectCorrect: true,
    furniture: "procedural",
    wrapBack: true,
    detail: true,
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;

  return { kind: "custom", id: `custom-${label}`, label, texture };
}

/** Decodes a picked file, rejecting anything that is not an image the browser can read. */
export function readImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error(`${file.name} is not an image`));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`could not decode ${file.name}`));
    };
    img.src = url;
  });
}

export { SHEET_H, SHEET_W };
