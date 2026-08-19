export type PackRarityTier = "common" | "uncommon" | "rare" | "ultra" | "chase";

export interface PackCard {
  id: string;
  name: string;
  rarity: string;
  tier: PackRarityTier;
  /** TCGdex localId within the card's set. */
  localId: string;
  imageRoot: string;
  tcg: "pokemon";
  setCode: string;
  setName: string;
  imageSource?: "tcgdex" | "pokemoncard";
}

export interface PulledCard extends PackCard {
  imageUrl: string;
  imageUrlSmall: string;
}

export interface PackOddsReference {
  title: string;
  url: string;
  sampleSize: number;
  note: string;
}

/**
 * Public provenance for every probability model used by the simulator.
 * Physical Pokémon pull rates are not published officially, so these models
 * cite the empirical observations they are based on and disclose where the
 * simulator simplifies real-world collation.
 */
export const PACK_ODDS_REFERENCES: Record<string, PackOddsReference> = {
  swsh7: {
    title: "Evolving Skies community pull data",
    url: "https://www.reddit.com/r/PokemonTCG/comments/paitho/evolving_skies_pull_data_from_10000_packs_opened/",
    sampleSize: 11_664,
    note: "Simplified rarity tiers informed by community openings; not official factory odds.",
  },
  base1: {
    title: "Pokémon Trading Card Sequences",
    url: "https://www.cs.sjsu.edu/~stamp/cv/papers/pokemon.pdf",
    sampleSize: 153,
    note: "Historical Base Set pack structure and one-in-three holo observation; not official factory odds.",
  },
  me5: {
    title: "Pitch Black pull rates — TCG Talk",
    url: "https://tcgtalk.com/guides/pitch-black-pull-rates",
    sampleSize: 753,
    note: "Observed rarity frequencies normalized to 100%; low-volume chase tiers are estimates, not official factory odds.",
  },
};

export function packOddsReference(packPool = "swsh7"): PackOddsReference {
  return PACK_ODDS_REFERENCES[packPool] ?? PACK_ODDS_REFERENCES.swsh7;
}

const EVOLVING_SKIES_IMAGE_ROOT = "https://assets.tcgdex.net/en/swsh/swsh7";
const BASE_SET_IMAGE_ROOT = "https://assets.tcgdex.net/en/base/base1";
const PITCH_BLACK_IMAGE_ROOT = "https://assets.tcgdex.net/en/me/me05";

export function packCardImageUrls(card: PackCard): {
  imageUrl: string;
  imageUrlSmall: string;
} {
  return {
    imageUrl: `${card.imageRoot}/${card.localId}/high.webp`,
    imageUrlSmall: `${card.imageRoot}/${card.localId}/low.webp`,
  };
}

/**
 * Every distinct card that the selected simulator pool can produce. This is
 * intentionally derived from the same rarity pools as `generatePack`, so the
 * host UIs never need a second, manually maintained set checklist.
 */
export function possiblePackCards(packPool = "swsh7"): PulledCard[] {
  const pool =
    packPool === "base1"
      ? BASE_SET_POOL
      : packPool === "me5"
        ? PITCH_BLACK_POOL
        : PACK_POOL;
  const seen = new Set<string>();

  return Object.values(pool)
    .flat()
    .filter((card) => {
      if (seen.has(card.id)) return false;
      seen.add(card.id);
      return true;
    })
    .map((card) => ({ ...card, ...packCardImageUrls(card) }));
}

function pitchBlackCards(
  rarity: string,
  tier: PackRarityTier,
  rows: Array<[string, string]>,
): PackCard[] {
  return rows.map(([localId, name]) => ({
    id: `me05-${localId.padStart(3, "0")}`,
    name,
    rarity,
    tier,
    localId: localId.padStart(3, "0"),
    imageRoot: PITCH_BLACK_IMAGE_ROOT,
    tcg: "pokemon" as const,
    setCode: "me05",
    setName: "Pitch Black",
  }));
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
    tcg: "pokemon",
    setCode: "swsh7",
    setName: "Evolving Skies",
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
    tcg: "pokemon" as const,
    setCode: "base1",
    setName: "Base Set",
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
 * advertises 11 cards. Historical box data shows five non-energy commons, two
 * common Energy cards, three uncommons, and one rare-or-holo card.
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

const PITCH_BLACK_COMMONS = pitchBlackCards("Common", "common", [
  ["1", "Tropius"],
  ["2", "Grubbin"],
  ["3", "Fomantis"],
  ["5", "Poltchageist"],
  ["9", "Sizzlipede"],
  ["10", "Centiskorch"],
  ["11", "Charcadet"],
  ["13", "Goldeen"],
  ["15", "Wailmer"],
  ["18", "Popplio"],
  ["19", "Brionne"],
  ["21", "Finizen"],
  ["23", "Electrike"],
  ["25", "Charjabug"],
  ["29", "Slowpoke"],
  ["32", "Jynx"],
  ["33", "Shuppet"],
  ["36", "Litwick"],
  ["42", "Mankey"],
  ["43", "Primeape"],
  ["44", "Cranidos"],
  ["46", "Drilbur"],
  ["49", "Vullaby"],
  ["50", "Mandibuzz"],
  ["51", "Inkay"],
  ["53", "Nickit"],
  ["57", "Maschiff"],
  ["58", "Mabosstiff"],
  ["60", "Skarmory"],
  ["61", "Shieldon"],
  ["63", "Bronzor"],
  ["66", "Pikipek"],
  ["67", "Trumbeak"],
  ["69", "Type: Null"],
  ["71", "Bombirdier"],
  ["72", "Antique Armor Fossil"],
  ["73", "Antique Skull Fossil"],
]);

const PITCH_BLACK_UNCOMMONS = pitchBlackCards("Uncommon", "uncommon", [
  ["6", "Sinistcha"],
  ["7", "Heatran"],
  ["14", "Seaking"],
  ["17", "Relicanth"],
  ["22", "Palafin"],
  ["24", "Manectric"],
  ["26", "Vikavolt"],
  ["30", "Slowbro"],
  ["34", "Banette"],
  ["37", "Lampent"],
  ["39", "Dhelmise"],
  ["40", "Marshadow"],
  ["41", "Annihilape"],
  ["52", "Malamar"],
  ["54", "Thievul"],
  ["64", "Bronzong"],
  ["68", "Toucannon"],
  ["74", "Backtrack Badge"],
  ["75", "Dark Bell"],
  ["76", "Fossil Quarry"],
  ["77", "Gladion's Final Battle"],
  ["78", "Gwynn"],
  ["79", "Jett"],
  ["80", "Misty's Vitality"],
  ["81", "Rust Syndicate Grunt"],
  ["82", "Tremendous Bomb"],
]);

const PITCH_BLACK_REGULAR_RARES = pitchBlackCards("Rare", "rare", [
  ["12", "Armarouge"],
  ["20", "Primarina"],
  ["28", "Miraidon"],
  ["35", "Spiritomb"],
  ["47", "Koraidon"],
  ["56", "Zarude"],
  ["59", "Chi-Yu"],
  ["62", "Bastiodon"],
  ["70", "Silvally"],
]);

const PITCH_BLACK_HOLO_ENERGIES = pitchBlackCards("Holo Energy", "rare", [
  ["83", "Shadowy Darkness Energy"],
  ["84", "Voltaic Lightning Energy"],
]);

const PITCH_BLACK_DOUBLE_RARES = pitchBlackCards("Double Rare", "ultra", [
  ["4", "Lurantis ex"],
  ["8", "Mega Delphox ex"],
  ["16", "Wailord ex"],
  ["27", "Mega Zeraora ex"],
  ["31", "Mega Slowbro ex"],
  ["38", "Mega Chandelure ex"],
  ["45", "Rampardos ex"],
  ["48", "Mega Darkrai ex"],
  ["55", "Morpeko ex"],
  ["65", "Mega Excadrill ex"],
]);

const PITCH_BLACK_ILLUSTRATION_RARES = pitchBlackCards(
  "Illustration Rare",
  "ultra",
  [
    ["85", "Fomantis"],
    ["86", "Armarouge"],
    ["87", "Goldeen"],
    ["88", "Primarina"],
    ["89", "Manectric"],
    ["90", "Slowbro"],
    ["91", "Dhelmise"],
    ["92", "Thievul"],
    ["93", "Bastiodon"],
    ["94", "Toucannon"],
    ["95", "Silvally"],
  ],
);

const PITCH_BLACK_ULTRA_RARES = pitchBlackCards("Ultra Rare", "ultra", [
  ["96", "Lurantis ex"],
  ["97", "Wailord ex"],
  ["98", "Mega Zeraora ex"],
  ["99", "Mega Chandelure ex"],
  ["100", "Rampardos ex"],
  ["101", "Mega Darkrai ex"],
  ["102", "Morpeko ex"],
  ["103", "Mega Excadrill ex"],
  ["104", "Brave Bangle"],
  ["105", "Crushing Hammer"],
  ["106", "Dark Bell"],
  ["107", "Energy Switch"],
  ["108", "Gladion's Final Battle"],
  ["109", "Gwynn"],
  ["110", "Iron Defender"],
  ["111", "Misty's Vitality"],
  ["112", "Rust Syndicate Grunt"],
  ["113", "Tremendous Bomb"],
]);

const PITCH_BLACK_SPECIAL_ILLUSTRATION_RARES = pitchBlackCards(
  "Special Illustration Rare",
  "chase",
  [
    ["114", "Mega Zeraora ex"],
    ["115", "Mega Chandelure ex"],
    ["116", "Mega Darkrai ex"],
    ["117", "Morpeko ex"],
    ["118", "Gladion's Final Battle"],
    ["119", "Gwynn"],
  ],
);

const PITCH_BLACK_MEGA_HYPER_RARES = pitchBlackCards(
  "Mega Hyper Rare",
  "chase",
  [["120", "Mega Darkrai ex"]],
);

/**
 * Complete English Pitch Black (ME05) pool, verified against TCGdex rarity
 * metadata. The generator below uses the narrower rarity arrays so each hit
 * class can follow its own measured rate.
 */
export const PITCH_BLACK_POOL: Record<PackRarityTier, PackCard[]> = {
  common: PITCH_BLACK_COMMONS,
  uncommon: PITCH_BLACK_UNCOMMONS,
  rare: [...PITCH_BLACK_REGULAR_RARES, ...PITCH_BLACK_HOLO_ENERGIES],
  ultra: [
    ...PITCH_BLACK_DOUBLE_RARES,
    ...PITCH_BLACK_ILLUSTRATION_RARES,
    ...PITCH_BLACK_ULTRA_RARES,
  ],
  chase: [
    ...PITCH_BLACK_SPECIAL_ILLUSTRATION_RARES,
    ...PITCH_BLACK_MEGA_HYPER_RARES,
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

function pick<T>(
  items: T[],
  exclude: Set<string>,
  keyOf: (item: T) => string,
  random: () => number = Math.random,
): T {
  const available = items.filter((item) => !exclude.has(keyOf(item)));
  const source = available.length > 0 ? available : items;
  return source[Math.floor(random() * source.length)];
}

export const EVOLVING_SKIES_SIMULATOR_RATES = {
  fourthSlotRare: 0.25,
  finalSlotChase: 0.1,
  finalSlotUltra: 0.3,
  finalSlotRare: 0.6,
} as const;

function rollSlotFive(random: () => number): PackRarityTier {
  const roll = random();
  if (roll < EVOLVING_SKIES_SIMULATOR_RATES.finalSlotChase) return "chase";
  if (
    roll <
    EVOLVING_SKIES_SIMULATOR_RATES.finalSlotChase +
      EVOLVING_SKIES_SIMULATOR_RATES.finalSlotUltra
  ) {
    return "ultra";
  }
  return "rare";
}

function generateFromTiers(
  pool: Record<PackRarityTier, PackCard[]>,
  tiers: PackRarityTier[],
  random: () => number = Math.random,
): PulledCard[] {
  const used = new Set<string>();
  return tiers.map((tier) => {
    const chosen = pick(pool[tier], used, (candidate) => candidate.id, random);
    used.add(chosen.id);
    return { ...chosen, ...packCardImageUrls(chosen) };
  });
}

function generateBaseSetPack(
  forceChase: boolean,
  random: () => number,
): PulledCard[] {
  const used = new Set<string>();
  const cards: PulledCard[] = [];
  const energy = new Set(["97", "98", "99", "100", "101", "102"]);
  const commonPool = BASE_SET_POOL.common.filter(
    (card) => !energy.has(card.localId),
  );
  const energyPool = BASE_SET_POOL.common.filter((card) =>
    energy.has(card.localId),
  );

  const append = (pool: PackCard[], count: number) => {
    for (let index = 0; index < count; index += 1) {
      const chosen = pick(pool, used, (candidate) => candidate.id, random);
      used.add(chosen.id);
      cards.push({ ...chosen, ...packCardImageUrls(chosen) });
    }
  };
  append(commonPool, 5);
  append(energyPool, 2);
  append(BASE_SET_POOL.uncommon, 3);

  const holoPool = [...BASE_SET_POOL.ultra, ...BASE_SET_POOL.chase];
  const finalPool = forceChase
    ? BASE_SET_POOL.chase
    : random() < BASE_SET_PULL_RATES.holo
      ? holoPool
      : BASE_SET_POOL.rare;
  const chosen = pick(finalPool, used, (candidate) => candidate.id, random);
  return [...cards, { ...chosen, ...packCardImageUrls(chosen) }];
}

export const BASE_SET_PULL_RATES = {
  holo: 1 / 3,
  regularRare: 2 / 3,
} as const;

/**
 * Mutually exclusive last-slot outcomes from a 753-pack community sample.
 * Lower-volume SIR/MHR observations are estimates, not manufacturer odds.
 * The holo-energy remainder keeps the distribution normalized to 100%.
 */
export const PITCH_BLACK_PULL_RATES = {
  regularRare: 0.534,
  doubleRare: 0.25,
  illustrationRare: 0.116,
  ultraRare: 0.036,
  specialIllustrationRare: 0.008,
  megaHyperRare: 0.0013,
  holoEnergy: 0.0547,
} as const;

type PitchBlackHit = keyof typeof PITCH_BLACK_PULL_RATES;

function rollPitchBlackHit(random: () => number): PitchBlackHit {
  const roll = random();
  let threshold = 0;
  for (const [rarity, probability] of Object.entries(
    PITCH_BLACK_PULL_RATES,
  ) as Array<[PitchBlackHit, number]>) {
    threshold += probability;
    if (roll < threshold) return rarity;
  }
  return "regularRare";
}

function pitchBlackHitPool(hit: PitchBlackHit): PackCard[] {
  switch (hit) {
    case "regularRare":
      return PITCH_BLACK_REGULAR_RARES;
    case "doubleRare":
      return PITCH_BLACK_DOUBLE_RARES;
    case "illustrationRare":
      return PITCH_BLACK_ILLUSTRATION_RARES;
    case "ultraRare":
      return PITCH_BLACK_ULTRA_RARES;
    case "specialIllustrationRare":
      return PITCH_BLACK_SPECIAL_ILLUSTRATION_RARES;
    case "megaHyperRare":
      return PITCH_BLACK_MEGA_HYPER_RARES;
    case "holoEnergy":
      return PITCH_BLACK_HOLO_ENERGIES;
  }
}

function generatePitchBlackPack(
  forceChase: boolean,
  random: () => number,
): PulledCard[] {
  const cards = generateFromTiers(
    PITCH_BLACK_POOL,
    [
      "common",
      "common",
      "common",
      "common",
      "uncommon",
      "uncommon",
      "uncommon",
    ],
    random,
  );
  const used = new Set(cards.map((card) => card.id));
  const reversePool = [
    ...PITCH_BLACK_COMMONS,
    ...PITCH_BLACK_UNCOMMONS,
    ...PITCH_BLACK_REGULAR_RARES,
  ];

  for (let index = 0; index < 2; index += 1) {
    const chosen = pick(reversePool, used, (candidate) => candidate.id, random);
    used.add(chosen.id);
    cards.push({
      ...chosen,
      rarity: `Reverse Holo ${chosen.rarity}`,
      ...packCardImageUrls(chosen),
    });
  }

  const hitPool = forceChase
    ? [
        ...PITCH_BLACK_SPECIAL_ILLUSTRATION_RARES,
        ...PITCH_BLACK_MEGA_HYPER_RARES,
      ]
    : pitchBlackHitPool(rollPitchBlackHit(random));
  const hit = pick(hitPool, used, (candidate) => candidate.id, random);
  cards.push({ ...hit, ...packCardImageUrls(hit) });
  return cards;
}

/**
 * Generate a 5-card pack, TCG Pocket style: three commons, one uncommon-or-rare,
 * and a rare-or-better finisher. `forceChase` pins the last slot for testing.
 */
export function generatePack(
  forceChase = false,
  packPool = "swsh7",
  random: () => number = Math.random,
): PulledCard[] {
  if (packPool === "base1") {
    return generateBaseSetPack(forceChase, random);
  }
  if (packPool === "me5") {
    return generatePitchBlackPack(forceChase, random);
  }
  const tiers: PackRarityTier[] = [
    "common",
    "common",
    "common",
    random() < EVOLVING_SKIES_SIMULATOR_RATES.fourthSlotRare
      ? "rare"
      : "uncommon",
    forceChase ? "chase" : rollSlotFive(random),
  ];
  return generateFromTiers(PACK_POOL, tiers, random);
}
