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

export interface PackOpeningNativePackOption {
  id: string;
  label: string;
  setID: string;
  setLabel: string;
  variationLabel: string;
}

export interface PackOpeningNativeState {
  phase: PackOpeningPhase;
  selectedPackID: string;
  selectedPackLabel: string;
  packCount: number;
  packOptions: PackOpeningNativePackOption[];
  revealedCount: number;
  totalCards: number;
  currentPackNumber: number;
  totalPacks: number;
  canSave: boolean;
  warning?: string;
  session?: PackOpeningPullSession;
}

export type PackOpeningNativeCommand =
  | { type: "selectPack"; id: string }
  | { type: "setPackCount"; count: number }
  | { type: "openPack" }
  | { type: "backToPacks" }
  | { type: "advance" }
  | { type: "showAll" }
  | { type: "savePulls" }
  | { type: "uploadArtwork"; dataURL: string; label: string };

export type PackOpeningEvent =
  | { type: "ready" }
  | { type: "phaseChanged"; phase: PackOpeningPhase }
  | { type: "nativeState"; state: PackOpeningNativeState }
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
  /** Hides web controls and exposes state/actions to a native host. */
  nativeControls?: boolean;
  /** Adds a host-owned persistence action to completed opening results. */
  completionActionLabel?: string;
  /** Receives lifecycle and tactile events from the shared experience. */
  onEvent?: (event: PackOpeningEvent) => void;
}
