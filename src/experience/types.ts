export type PackOpeningPhase =
  | "select"
  | "tear"
  | "opening"
  | "reveal"
  | "summary"
  | "final";

export interface PackOpeningPull {
  cardId: string;
  name: string;
  rarity: string;
  tier: "common" | "uncommon" | "rare" | "ultra" | "chase";
  collectorNumber: string;
  tcg: string;
  setCode: string;
  setName: string;
  imageUrl: string;
  imageUrlSmall: string;
}

export interface PackOpeningPullSession {
  id: string;
  packLabel: string;
  openedAt: string;
  packs: PackOpeningPull[][];
}

export type PackOpeningEvent =
  | { type: "ready" }
  | { type: "phaseChanged"; phase: PackOpeningPhase }
  | { type: "haptic"; style: "selection" | "impact" | "success" }
  | { type: "saveRequested"; session: PackOpeningPullSession }
  | { type: "error"; message: string };

export interface PackOpeningProps {
  /** Base URL for pack-core's `assets/pack` directory. */
  assetBase?: string;
  /** Removes the website card frame and fills the host viewport. */
  embedded?: boolean;
  /** Enables the diagnostic HUD without requiring a query parameter. */
  debug?: boolean;
  /** Adds a host-owned persistence action to completed opening results. */
  completionActionLabel?: string;
  /** Receives lifecycle and tactile events from the shared experience. */
  onEvent?: (event: PackOpeningEvent) => void;
}
