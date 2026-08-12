export type PackRarityTier = "common" | "uncommon" | "rare" | "ultra" | "chase";

export interface PackCard {
  id: string;
  name: string;
  rarity: string;
  tier: PackRarityTier;
  /** tcgdex localId within swsh7 (Evolving Skies) */
  localId: string;
}

export interface PulledCard extends PackCard {
  imageUrl: string;
  imageUrlSmall: string;
}

const IMAGE_ROOT = "https://assets.tcgdex.net/en/swsh/swsh7";

export function packCardImageUrls(card: PackCard): {
  imageUrl: string;
  imageUrlSmall: string;
} {
  return {
    imageUrl: `${IMAGE_ROOT}/${card.localId}/high.webp`,
    imageUrlSmall: `${IMAGE_ROOT}/${card.localId}/low.webp`,
  };
}

function card(
  localId: string,
  name: string,
  rarity: string,
  tier: PackRarityTier,
): PackCard {
  return { id: `swsh7-${localId}`, name, rarity, tier, localId };
}

/**
 * Curated pool from Evolving Skies (swsh7), verified against the tcgdex API —
 * names, rarities, and collector numbers are real so the CDN art matches.
 */
export const PACK_POOL: Record<PackRarityTier, PackCard[]> = {
  common: [
    card("44", "Bergmite", "Common", "common"),
    card("78", "Cutiefly", "Common", "common"),
    card("86", "Roggenrola", "Common", "common"),
    card("104", "Nickit", "Common", "common"),
    card("133", "Lillipup", "Common", "common"),
  ],
  uncommon: [
    card("12", "Crustle", "Uncommon", "uncommon"),
    card("25", "Golduck", "Uncommon", "uncommon"),
    card("89", "Palpitoad", "Uncommon", "uncommon"),
    card("130", "Vigoroth", "Uncommon", "uncommon"),
    card("141", "Aroma Lady", "Uncommon", "uncommon"),
    card("152", "Raihan", "Uncommon", "uncommon"),
  ],
  rare: [
    card("38", "Milotic", "Rare", "rare"),
    card("46", "Wishiwashi", "Rare", "rare"),
    card("119", "Drampa", "Rare", "rare"),
    card("4", "Jumpluff", "Holo Rare", "rare"),
    card("63", "Galarian Articuno", "Holo Rare", "rare"),
    card("118", "Zygarde", "Holo Rare", "rare"),
  ],
  ultra: [
    card("74", "Sylveon V", "Holo Rare V", "ultra"),
    card("110", "Rayquaza V", "Holo Rare V", "ultra"),
    card("174", "Glaceon V", "Ultra Rare", "ultra"),
    card("59", "Dracozolt VMAX", "Holo Rare VMAX", "ultra"),
    card("65", "Espeon VMAX", "Holo Rare VMAX", "ultra"),
    card("95", "Umbreon VMAX", "Holo Rare VMAX", "ultra"),
  ],
  chase: [
    card("205", "Leafeon VMAX", "Alt Art Secret", "chase"),
    card("209", "Glaceon VMAX", "Alt Art Secret", "chase"),
    card("212", "Sylveon VMAX", "Alt Art Secret", "chase"),
    card("215", "Umbreon VMAX", "Alt Art Secret", "chase"),
    card("218", "Rayquaza VMAX", "Alt Art Secret", "chase"),
    card("228", "Cresselia", "Gold Secret", "chase"),
  ],
};

export interface PackVariantPalette {
  top: string;
  mid: string;
  bottom: string;
  accent: string;
  glow: string;
}

export type PackMotif = "aurora" | "flame" | "wave" | "leaf";

export interface PackVariant {
  id: string;
  name: string;
  motif: PackMotif;
  palette: PackVariantPalette;
}

export const PACK_VARIANTS: PackVariant[] = [
  {
    id: "aurora",
    name: "Aurora",
    motif: "aurora",
    palette: {
      top: "#1a2a68",
      mid: "#4340a8",
      bottom: "#2a1a55",
      accent: "#7de3ff",
      glow: "#9fd8ff",
    },
  },
  {
    id: "ember",
    name: "Ember",
    motif: "flame",
    palette: {
      top: "#47130e",
      mid: "#b03a1c",
      bottom: "#330b07",
      accent: "#ffb547",
      glow: "#ff9d45",
    },
  },
  {
    id: "tide",
    name: "Tide",
    motif: "wave",
    palette: {
      top: "#0a3055",
      mid: "#1470b0",
      bottom: "#062545",
      accent: "#6fe3ff",
      glow: "#59c8ff",
    },
  },
  {
    id: "verdant",
    name: "Verdant",
    motif: "leaf",
    palette: {
      top: "#14401f",
      mid: "#2a9a4e",
      bottom: "#0d2c14",
      accent: "#a8ff8f",
      glow: "#7dff9b",
    },
  },
];

export function packVariantById(id: string): PackVariant {
  return PACK_VARIANTS.find((v) => v.id === id) ?? PACK_VARIANTS[0];
}

const TIER_ORDER: PackRarityTier[] = [
  "common",
  "uncommon",
  "rare",
  "ultra",
  "chase",
];

export function tierRank(tier: PackRarityTier): number {
  return TIER_ORDER.indexOf(tier);
}

function pick<T>(items: T[], exclude: Set<string>, keyOf: (item: T) => string): T {
  const available = items.filter((item) => !exclude.has(keyOf(item)));
  const source = available.length > 0 ? available : items;
  return source[Math.floor(Math.random() * source.length)];
}

function rollSlotFive(): PackRarityTier {
  const roll = Math.random();
  if (roll < 0.1) return "chase";
  if (roll < 0.4) return "ultra";
  return "rare";
}

/**
 * Generate a 5-card pack, TCG Pocket style: three commons, one uncommon-or-rare,
 * and a rare-or-better finisher. `forceChase` pins the last slot for testing.
 */
export function generatePack(forceChase = false): PulledCard[] {
  const used = new Set<string>();
  const tiers: PackRarityTier[] = [
    "common",
    "common",
    "common",
    Math.random() < 0.25 ? "rare" : "uncommon",
    forceChase ? "chase" : rollSlotFive(),
  ];
  return tiers.map((tier) => {
    const chosen = pick(PACK_POOL[tier], used, (c) => c.id);
    used.add(chosen.id);
    return { ...chosen, ...packCardImageUrls(chosen) };
  });
}
