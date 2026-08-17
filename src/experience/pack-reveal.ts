export type CardDismissDirection = -1 | 1;

export type BackwardsRevealAction =
  | { kind: "flip"; index: number }
  | {
      kind: "dismiss";
      index: number;
      direction: CardDismissDirection;
      nextTopIndex: number;
    }
  | { kind: "none" };

interface BackwardsRevealInput {
  topIndex: number;
  cardCount: number;
  faceUp: boolean;
  direction?: number;
}

export function cardDismissDirection(
  index: number,
  direction?: number,
): CardDismissDirection {
  if (direction === undefined || direction === 0) {
    return index % 2 === 0 ? 1 : -1;
  }
  return direction > 0 ? 1 : -1;
}

/**
 * Backwards reveals have two distinct gestures: first turn the top card face
 * up, then slide that revealed face away without flipping it back over.
 */
export function nextBackwardsRevealAction({
  topIndex,
  cardCount,
  faceUp,
  direction,
}: BackwardsRevealInput): BackwardsRevealAction {
  if (topIndex < 0 || topIndex >= cardCount) return { kind: "none" };
  if (!faceUp) return { kind: "flip", index: topIndex };

  return {
    kind: "dismiss",
    index: topIndex,
    direction: cardDismissDirection(topIndex, direction),
    nextTopIndex: topIndex + 1,
  };
}
