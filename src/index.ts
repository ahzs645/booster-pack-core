export type { Cover, CoverId, BaseId, DecalId, Manifest } from './types';
export { parseObj } from './parseObj';
export { readSheetLayout, type Rect, type SheetLayout } from './layout';
export { buildUVAtlas, REGIONS, type RegionId, type UVAtlas, type UVFace } from './uvFaces';
export { splitGeometryByCut, type CutFn, type SplitMesh } from './splitMesh';
export {
  asset,
  resolveManifest,
  loadManifest,
  loadGeometry,
  loadMeshSource,
  MANIFEST_PATH,
  type AssetBase,
} from './manifest';
export {
  composeCover,
  samplePalette,
  zoomToMatch,
  DEFAULT_RECIPE,
  DEFAULT_TRANSFORM,
  type ArtTransform,
  type CoverRecipe,
  type FitMode,
  type FurnitureMode,
  type Placement,
} from './composeCover';
export { describe, fromJSON, toJSON, type Adjustments } from './adjustments';
