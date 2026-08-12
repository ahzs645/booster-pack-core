import {
  loadGeometry,
  loadManifest,
  readSheetLayout,
  type Manifest,
  type SheetLayout,
} from "../index";
import * as THREE from "three";

/**
 * The shared booster pack mesh, brought into TCGer's world.
 *
 * The pack used to be a slab built out of subdivided planes, sized to whatever
 * framed well. It is now the same 282-triangle mesh the studio wraps, so a cover
 * authored there is worn here unchanged — which means adopting its proportions
 * too. The mesh is slenderer than the old slab: matching the width the cards need
 * makes the pack taller than 3.3 was, and that is what a booster actually looks
 * like.
 */

/** Cards are 2.02 wide and have to fit inside, so width is what gets pinned. */
export const PACK_W = 2.3;

/**
 * Extents of the shipped mesh in its own units, used to derive the constants
 * below at module scope. `preparePackGeometry` checks the mesh it actually loads
 * against these and warns if a re-authored mesh has moved them.
 */
const MESH_W = 4.554;
const MESH_H = 8.144;

const PACK_SCALE = PACK_W / MESH_W;

/** 4.11 — taller than the slab's 3.3, because the real pack is. */
export const PACK_H = MESH_H * PACK_SCALE;

/** The sheet every cover is authored at. */
export const SHEET_W = 1024;
export const SHEET_H = 512;

export interface PreparedPack {
  geometry: THREE.BufferGeometry;
  layout: SheetLayout;
  /** Front face's z, for floating the tear trail just clear of the surface. */
  faceZ: number;
}

/**
 * Centres the mesh on the origin, scales it into TCGer's units, and turns it to
 * face the camera.
 *
 * The transform is baked into the geometry rather than applied to a wrapping
 * group so that everything downstream — the tear path the pointer records, the
 * cut function that splits it — works in one coordinate space. A cut is defined
 * in the geometry's own coordinates, so a scale left on a parent group would
 * silently put the tear in the wrong place.
 */
export function preparePackGeometry(raw: THREE.BufferGeometry): PreparedPack {
  const geometry = raw.clone();
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());

  if (Math.abs(size.x - MESH_W) > 0.01 || Math.abs(size.y - MESH_H) > 0.01) {
    console.warn(
      `pack mesh is ${size.x.toFixed(3)}×${size.y.toFixed(3)}, not the ` +
        `${MESH_W}×${MESH_H} PACK_H was derived from — update pack-mesh.ts`,
    );
  }

  const centre = bb.getCenter(new THREE.Vector3());
  const scale = PACK_W / size.x;

  // The mesh's display face may point away from the camera; readSheetLayout knows
  // which it is, because the wrap seams always fall on the other panel.
  const facing = readSheetLayout(geometry, SHEET_W, SHEET_H).displayFaceZ;

  geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
  geometry.applyMatrix4(new THREE.Matrix4().makeScale(scale, scale, scale));
  if (facing < 0) geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
  geometry.computeBoundingBox();

  return {
    geometry,
    layout: readSheetLayout(geometry, SHEET_W, SHEET_H),
    faceZ: geometry.boundingBox!.max.z,
  };
}

const preparedByBase = new Map<string, Promise<PreparedPack>>();
const manifestByBase = new Map<string, Promise<Manifest>>();

/** The manifest of cover sheets, shared with the studio. */
export function packManifest(assetBase = ""): Promise<Manifest> {
  let manifest = manifestByBase.get(assetBase);
  if (!manifest) {
    manifest = loadManifest({ base: assetBase });
    manifestByBase.set(assetBase, manifest);
  }
  return manifest;
}

/**
 * The prepared mesh. One promise for the whole app so every pack on screen shares
 * a single geometry — the carousel alone shows eight.
 */
export function packGeometry(assetBase = ""): Promise<PreparedPack> {
  let prepared = preparedByBase.get(assetBase);
  if (!prepared) {
    prepared = packManifest(assetBase)
      .then((m) => loadGeometry(m.mesh))
      .then(preparePackGeometry);
    preparedByBase.set(assetBase, prepared);
  }
  return prepared;
}
