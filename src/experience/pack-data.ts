export type PackRarityTier = "common" | "uncommon" | "rare" | "ultra" | "chase";

export interface PackCard {
  id: string;
  name: string;
  rarity: string;
  tier: PackRarityTier;
  /** TCGdex localId within the card's set. */
  localId: string;
  imageRoot: string;
}

export interface PulledCard extends PackCard {
  imageUrl: string;
  imageUrlSmall: string;
}

const EVOLVING_SKIES_IMAGE_ROOT = "https://assets.tcgdex.net/en/swsh/swsh7";
const BASE_SET_IMAGE_ROOT = "https://assets.tcgdex.net/en/base/base1";

export function packCardImageUrls(card: PackCard): {
  imageUrl: string;
  imageUrlSmall: string;
} {
  return {
    imageUrl: `${card.imageRoot}/${card.localId}/high.webp`,
    imageUrlSmall: `${card.imageRoot}/${card.localId}/low.webp`,
  };
}

function card(
  localId: string,
  name: string,
  rarity: string,
  tier: PackRarityTier,
): PackCard {
  return {
    id: `swsh7-${localId}`,
    name,
    rarity,
    tier,
    localId,
    imageRoot: EVOLVING_SKIES_IMAGE_ROOT,
  };
}

function baseCards(
  rarity: string,
  tier: PackRarityTier,
  rows: Array<[string, string]>,
): PackCard[] {
  return rows.map(([localId, name]) => ({
    id: `base1-${localId}`,
    name,
    rarity,
    tier,
    localId,
    imageRoot: BASE_SET_IMAGE_ROOT,
  }));
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

/**
 * Base Set collector numbers form stable rarity bands. The classic wrapper
 * advertises 11 cards, so its opening uses seven commons, three uncommons, and
 * one rare-or-better card instead of the five-card Pocket-style demo recipe.
 */
export const BASE_SET_POOL: Record<PackRarityTier, PackCard[]> = {
  common: baseCards("Common", "common", [
    ["43", "Abra"],
    ["44", "Bulbasaur"],
    ["45", "Caterpie"],
    ["46", "Charmander"],
    ["47", "Diglett"],
    ["48", "Doduo"],
    ["49", "Drowzee"],
    ["50", "Gastly"],
    ["51", "Koffing"],
    ["52", "Machop"],
    ["53", "Magnemite"],
    ["54", "Metapod"],
    ["55", "Nidoran♂"],
    ["56", "Onix"],
    ["57", "Pidgey"],
    ["58", "Pikachu"],
    ["59", "Poliwag"],
    ["60", "Ponyta"],
    ["61", "Rattata"],
    ["62", "Sandshrew"],
    ["63", "Squirtle"],
    ["64", "Starmie"],
    ["65", "Staryu"],
    ["66", "Tangela"],
    ["67", "Voltorb"],
    ["68", "Vulpix"],
    ["69", "Weedle"],
    ["91", "Bill"],
    ["92", "Energy Removal"],
    ["93", "Gust of Wind"],
    ["94", "Potion"],
    ["95", "Switch"],
    ["97", "Fighting Energy"],
    ["98", "Fire Energy"],
    ["99", "Grass Energy"],
    ["100", "Lightning Energy"],
    ["101", "Psychic Energy"],
    ["102", "Water Energy"],
  ]),
  uncommon: baseCards("Uncommon", "uncommon", [
    ["23", "Arcanine"],
    ["24", "Charmeleon"],
    ["25", "Dewgong"],
    ["26", "Dratini"],
    ["27", "Farfetch'd"],
    ["28", "Growlithe"],
    ["29", "Haunter"],
    ["30", "Ivysaur"],
    ["31", "Jynx"],
    ["32", "Kadabra"],
    ["33", "Kakuna"],
    ["34", "Machoke"],
    ["35", "Magikarp"],
    ["36", "Magmar"],
    ["37", "Nidorino"],
    ["38", "Poliwhirl"],
    ["39", "Porygon"],
    ["40", "Raticate"],
    ["41", "Seel"],
    ["42", "Wartortle"],
    ["80", "Defender"],
    ["81", "Energy Retrieval"],
    ["82", "Full Heal"],
    ["83", "Maintenance"],
    ["84", "PlusPower"],
    ["85", "Pokémon Center"],
    ["86", "Pokémon Flute"],
    ["87", "Pokédex"],
    ["88", "Professor Oak"],
    ["89", "Revive"],
    ["90", "Super Potion"],
    ["96", "Double Colorless Energy"],
  ]),
  rare: baseCards("Rare", "rare", [
    ["17", "Beedrill"],
    ["18", "Dragonair"],
    ["19", "Dugtrio"],
    ["20", "Electabuzz"],
    ["21", "Electrode"],
    ["22", "Pidgeotto"],
    ["70", "Clefairy Doll"],
    ["71", "Computer Search"],
    ["72", "Devolution Spray"],
    ["73", "Impostor Professor Oak"],
    ["74", "Item Finder"],
    ["75", "Lass"],
    ["76", "Pokémon Breeder"],
    ["77", "Pokémon Trader"],
    ["78", "Scoop Up"],
    ["79", "Super Energy Removal"],
  ]),
  ultra: baseCards("Holo Rare", "ultra", [
    ["1", "Alakazam"],
    ["2", "Blastoise"],
    ["3", "Chansey"],
    ["5", "Clefairy"],
    ["6", "Gyarados"],
    ["7", "Hitmonchan"],
    ["8", "Machamp"],
    ["9", "Magneton"],
    ["10", "Mewtwo"],
    ["11", "Nidoking"],
    ["12", "Ninetales"],
    ["13", "Poliwrath"],
    ["14", "Raichu"],
    ["15", "Venusaur"],
    ["16", "Zapdos"],
  ]),
  chase: baseCards("Holo Rare", "chase", [["4", "Charizard"]]),
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

function pick<T>(
  items: T[],
  exclude: Set<string>,
  keyOf: (item: T) => string,
): T {
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

function rollBaseRare(): PackRarityTier {
  const roll = Math.random();
  if (roll < 0.02) return "chase";
  if (roll < 0.33) return "ultra";
  return "rare";
}

function generateFromTiers(
  pool: Record<PackRarityTier, PackCard[]>,
  tiers: PackRarityTier[],
): PulledCard[] {
  const used = new Set<string>();
  return tiers.map((tier) => {
    const chosen = pick(pool[tier], used, (candidate) => candidate.id);
    used.add(chosen.id);
    return { ...chosen, ...packCardImageUrls(chosen) };
  });
}

/**
 * Generate a 5-card pack, TCG Pocket style: three commons, one uncommon-or-rare,
 * and a rare-or-better finisher. `forceChase` pins the last slot for testing.
 */
export function generatePack(
  forceChase = false,
  packPool = "swsh7",
): PulledCard[] {
  if (packPool === "base1") {
    return generateFromTiers(BASE_SET_POOL, [
      "common",
      "common",
      "common",
      "common",
      "common",
      "common",
      "common",
      "uncommon",
      "uncommon",
      "uncommon",
      forceChase ? "chase" : rollBaseRare(),
    ]);
  }
  const tiers: PackRarityTier[] = [
    "common",
    "common",
    "common",
    Math.random() < 0.25 ? "rare" : "uncommon",
    forceChase ? "chase" : rollSlotFive(),
  ];
  return generateFromTiers(PACK_POOL, tiers);
}
