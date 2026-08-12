export type PackOpeningPhase =
  | "select"
  | "tear"
  | "opening"
  | "reveal"
  | "summary"
  | "final";

export type PackOpeningEvent =
  | { type: "ready" }
  | { type: "phaseChanged"; phase: PackOpeningPhase }
  | { type: "haptic"; style: "selection" | "impact" | "success" }
  | { type: "error"; message: string };

export interface PackOpeningProps {
  /** Base URL for pack-core's `assets/pack` directory. */
  assetBase?: string;
  /** Removes the website card frame and fills the host viewport. */
  embedded?: boolean;
  /** Enables the diagnostic HUD without requiring a query parameter. */
  debug?: boolean;
  /** Receives lifecycle and tactile events from the shared experience. */
  onEvent?: (event: PackOpeningEvent) => void;
}
