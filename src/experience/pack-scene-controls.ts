export interface PackSceneControls {
  timeScale: number;
  reducedMotion: boolean;
  openSelected?: () => void;
  revealNext?: (direction?: number) => void;
}
