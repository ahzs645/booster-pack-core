import {
  generatePack,
  possiblePackCards,
  tierRank,
  type PulledCard,
} from "./pack-data";
import type {
  PackOpeningAchievement,
  PackOpeningPackClassID,
  PackOpeningPackClassResult,
  PackOpeningProgressSnapshot,
  PackOpeningRecap,
} from "./types";

type PackClassDefinition = PackOpeningPackClassResult;

export interface PackClassConfiguration {
  packPool: string;
  classes: readonly PackClassDefinition[];
}

const STANDARD_ONLY: readonly PackClassDefinition[] = [
  {
    id: "standard",
    label: "Normal Pack",
    probability: 1,
    description: "The set's regular slot layout and pull rates.",
  },
];

const MODERN_RARE_PACK_EVENTS: readonly PackClassDefinition[] = [
  {
    id: "standard",
    label: "Normal Pack",
    probability: 0.96,
    description: "The set's regular slot layout and pull rates.",
  },
  {
    id: "hit-heavy",
    label: "Semi-God Pack",
    probability: 0.03,
    description: "At least three premium cards, scaled for larger packs.",
  },
  {
    id: "rare-pack",
    label: "God Pack",
    probability: 0.01,
    description: "Every card is rare or better.",
  },
];

/**
 * Event names and weights belong to the set, rather than the UI. New sets can
 * opt into a different table (or historically accurate event names) here.
 */
export const PACK_CLASS_CONFIGURATIONS: Record<string, PackClassConfiguration> =
  {
    swsh7: { packPool: "swsh7", classes: MODERN_RARE_PACK_EVENTS },
    me5: { packPool: "me5", classes: MODERN_RARE_PACK_EVENTS },
    base1: { packPool: "base1", classes: STANDARD_ONLY },
  };

export function packClassConfiguration(
  packPool: string,
): PackClassConfiguration {
  const configuration = PACK_CLASS_CONFIGURATIONS[packPool];
  if (!configuration) throw new Error(`Unknown pack pool: ${packPool}`);
  return configuration;
}

export function rollPackClass(
  packPool: string,
  random: () => number = Math.random,
): PackOpeningPackClassResult {
  const classes = packClassConfiguration(packPool).classes;
  const roll = Math.max(0, Math.min(0.999999999, random()));
  let threshold = 0;
  for (const definition of classes) {
    threshold += definition.probability;
    if (roll < threshold) return { ...definition };
  }
  return { ...classes[classes.length - 1] };
}

function premiumCards(
  count: number,
  packPool: string,
  excluded: Set<string>,
  random: () => number,
): PulledCard[] {
  const premiumPool = possiblePackCards(packPool).filter(
    (card) => tierRank(card.tier) >= tierRank("rare"),
  );
  const cards: PulledCard[] = [];
  for (let index = 0; index < count; index += 1) {
    const available = premiumPool.filter((card) => !excluded.has(card.id));
    const source = available.length > 0 ? available : premiumPool;
    const selected = source[Math.floor(random() * source.length)];
    excluded.add(selected.id);
    cards.push(selected);
  }
  return cards;
}

export function generatePackForClass(
  packClass: PackOpeningPackClassResult,
  forceChase = false,
  packPool = "swsh7",
  random: () => number = Math.random,
): PulledCard[] {
  const regularPack = generatePack(forceChase, packPool, random);
  if (packClass.id === "standard") return regularPack;

  const premiumCount =
    packClass.id === "rare-pack"
      ? regularPack.length
      : Math.max(3, Math.ceil(regularPack.length * 0.4));
  const retained = regularPack.slice(0, regularPack.length - premiumCount);
  return [
    ...retained,
    ...premiumCards(
      premiumCount,
      packPool,
      new Set(retained.map((card) => card.id)),
      random,
    ),
  ];
}

interface StoredOpeningProgress {
  version: 1;
  totalPacks: number;
  packClassCounts: Record<PackOpeningPackClassID, number>;
  setPackCounts: Record<string, number>;
  collectedCardIDs: Record<string, string[]>;
  unlockedAchievementIDs: string[];
  recentOpeningIDs: string[];
}

export interface RecordOpeningProgressInput {
  openingID: string;
  packPool: string;
  setName: string;
  packs: PulledCard[][];
  packClasses: PackOpeningPackClassResult[];
}

const PROGRESS_STORAGE_KEY = "tcger.pack-opening.progress.v1";

export function emptyOpeningProgress(): StoredOpeningProgress {
  return {
    version: 1,
    totalPacks: 0,
    packClassCounts: { standard: 0, "hit-heavy": 0, "rare-pack": 0 },
    setPackCounts: {},
    collectedCardIDs: {},
    unlockedAchievementIDs: [],
    recentOpeningIDs: [],
  };
}

function normalizedProgress(value: unknown): StoredOpeningProgress {
  if (!value || typeof value !== "object") return emptyOpeningProgress();
  const candidate = value as Partial<StoredOpeningProgress>;
  const classCounts =
    candidate.packClassCounts ?? emptyOpeningProgress().packClassCounts;
  return {
    version: 1,
    totalPacks: Number.isFinite(candidate.totalPacks)
      ? candidate.totalPacks!
      : 0,
    packClassCounts: {
      standard: classCounts.standard ?? 0,
      "hit-heavy": classCounts["hit-heavy"] ?? 0,
      "rare-pack": classCounts["rare-pack"] ?? 0,
    },
    setPackCounts: { ...(candidate.setPackCounts ?? {}) },
    collectedCardIDs: Object.fromEntries(
      Object.entries(candidate.collectedCardIDs ?? {}).map(([key, ids]) => [
        key,
        [...ids],
      ]),
    ),
    unlockedAchievementIDs: [...(candidate.unlockedAchievementIDs ?? [])],
    recentOpeningIDs: [...(candidate.recentOpeningIDs ?? [])],
  };
}

function readStoredProgress(): StoredOpeningProgress {
  try {
    const raw = globalThis.localStorage?.getItem(PROGRESS_STORAGE_KEY);
    return raw ? normalizedProgress(JSON.parse(raw)) : emptyOpeningProgress();
  } catch {
    return emptyOpeningProgress();
  }
}

function writeStoredProgress(progress: StoredOpeningProgress): void {
  try {
    globalThis.localStorage?.setItem(
      PROGRESS_STORAGE_KEY,
      JSON.stringify(progress),
    );
  } catch {
    // The opening remains playable when a host uses ephemeral or blocked web storage.
  }
}

function achievementCandidates(
  progress: StoredOpeningProgress,
  packPool: string,
  setName: string,
  possibleCards: number,
): PackOpeningAchievement[] {
  const collected = new Set(progress.collectedCardIDs[packPool] ?? []).size;
  return [
    progress.totalPacks >= 1
      ? {
          id: "packs-1",
          title: "First Pack",
          description: "Opened your first simulated booster.",
        }
      : null,
    progress.totalPacks >= 36
      ? {
          id: "packs-36",
          title: "Booster Box",
          description: "Opened 36 packs in the minigame.",
        }
      : null,
    progress.totalPacks >= 100
      ? {
          id: "packs-100",
          title: "Triple Digits",
          description: "Opened 100 packs in the minigame.",
        }
      : null,
    progress.totalPacks >= 500
      ? {
          id: "packs-500",
          title: "Seasoned Ripper",
          description: "Opened 500 packs in the minigame.",
        }
      : null,
    progress.packClassCounts["hit-heavy"] >= 1
      ? {
          id: "first-hit-heavy",
          title: "Something Different",
          description: "Found your first hit-heavy pack.",
        }
      : null,
    progress.packClassCounts["rare-pack"] >= 1
      ? {
          id: "first-rare-pack",
          title: "Against the Odds",
          description: "Found your first rare pack event.",
        }
      : null,
    possibleCards > 0 && collected >= possibleCards
      ? {
          id: `master-set-${packPool}`,
          title: `Master Set · ${setName}`,
          description:
            "Opened every card available in this set's minigame pool.",
        }
      : null,
  ].filter(
    (achievement): achievement is PackOpeningAchievement =>
      achievement !== null,
  );
}

function snapshot(
  progress: StoredOpeningProgress,
  packPool: string,
): PackOpeningProgressSnapshot {
  const possibleCards = possiblePackCards(packPool).length;
  const uniqueCards = new Set(progress.collectedCardIDs[packPool] ?? []).size;
  return {
    totalPacks: progress.totalPacks,
    setPacks: progress.setPackCounts[packPool] ?? 0,
    uniqueCards,
    possibleCards,
    completionPercentage:
      possibleCards === 0
        ? 0
        : Math.round((uniqueCards / possibleCards) * 1000) / 10,
    standardPacks: progress.packClassCounts.standard,
    hitHeavyPacks: progress.packClassCounts["hit-heavy"],
    rarePacks: progress.packClassCounts["rare-pack"],
  };
}

export function updateOpeningProgress(
  previous: StoredOpeningProgress,
  input: RecordOpeningProgressInput,
): { progress: StoredOpeningProgress; recap: PackOpeningRecap } {
  const progress = normalizedProgress(previous);
  if (progress.recentOpeningIDs.includes(input.openingID)) {
    return {
      progress,
      recap: {
        newCards: 0,
        progress: snapshot(progress, input.packPool),
        unlockedAchievements: [],
      },
    };
  }

  const previousCards = new Set(
    progress.collectedCardIDs[input.packPool] ?? [],
  );
  const collectedCards = new Set(previousCards);
  input.packs.flat().forEach((card) => collectedCards.add(card.id));
  input.packClasses.forEach((packClass) => {
    progress.packClassCounts[packClass.id] += 1;
  });
  progress.totalPacks += input.packs.length;
  progress.setPackCounts[input.packPool] =
    (progress.setPackCounts[input.packPool] ?? 0) + input.packs.length;
  progress.collectedCardIDs[input.packPool] = [...collectedCards];
  progress.recentOpeningIDs = [
    ...progress.recentOpeningIDs,
    input.openingID,
  ].slice(-100);

  const alreadyUnlocked = new Set(progress.unlockedAchievementIDs);
  const unlockedAchievements = achievementCandidates(
    progress,
    input.packPool,
    input.setName,
    possiblePackCards(input.packPool).length,
  ).filter((achievement) => !alreadyUnlocked.has(achievement.id));
  progress.unlockedAchievementIDs = [
    ...progress.unlockedAchievementIDs,
    ...unlockedAchievements.map((achievement) => achievement.id),
  ];

  return {
    progress,
    recap: {
      newCards: collectedCards.size - previousCards.size,
      progress: snapshot(progress, input.packPool),
      unlockedAchievements,
    },
  };
}

export function recordOpeningProgress(
  input: RecordOpeningProgressInput,
): PackOpeningRecap {
  const result = updateOpeningProgress(readStoredProgress(), input);
  writeStoredProgress(result.progress);
  return result.recap;
}
