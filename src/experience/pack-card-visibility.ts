/** Minimal shape needed to synchronize card groups without coupling to Three. */
interface VisibleCardGroup {
  visible: boolean;
}

/**
 * During a backwards flip, isolate the rotating card so the next card cannot
 * show through it edge-on. Outside a flip, preserve the remaining stack.
 */
export function shouldShowBackwardsCard(
  index: number,
  topIndex: number,
  isolatedIndex: number | null,
): boolean {
  return isolatedIndex === null ? index >= topIndex : index === isolatedIndex;
}

export function syncBackwardsCardVisibility(
  groups: readonly (VisibleCardGroup | null)[],
  topIndex: number,
  isolatedIndex: number | null = null,
): void {
  groups.forEach((group, index) => {
    if (group) {
      group.visible = shouldShowBackwardsCard(index, topIndex, isolatedIndex);
    }
  });
}
