export interface PackSceneControls {
  timeScale: number;
  reducedMotion: boolean;
  openSelected?: () => void;
  revealNext?: (direction?: number) => void;
  /**
   * Burst opening only: lift the card at this index as if it were hovered, or
   * pass null to let it settle. Lets keyboard focus drive the same showcase a
   * pointer gets.
   */
  focusCard?: (index: number | null) => void;
}
