export type CoverId = string;
export type BaseId = string;
export type DecalId = string;

export interface Cover {
  /** Generic display name; the capture's product names are not carried over. */
  label: string;
  /** Baked cover sheet, artwork only. */
  plain: string;
  /** Baked cover sheet with the decal composited on top. */
  decaled: string;
  /** Pixel dimensions of the sheet, read from the PNG header at extraction time. */
  size: [number, number];
  /** The base field this cover was composited from, for the builder to preselect. */
  base: BaseId | null;
  /** Likewise the decal. */
  decal: DecalId | null;
}

export interface Manifest {
  mesh: string;
  /** Emissive rim colour, linear RGB. */
  rim: [number, number, number];
  covers: Record<CoverId, Cover>;
  /** Plain foil fields, without any decal. */
  bases: Record<BaseId, string>;
  /** Overlay marks that get layered onto a base. */
  decals: Record<DecalId, string>;
}
