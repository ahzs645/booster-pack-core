"use client";

import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { SheetLayout } from "../index";

import { cn } from "./classNames";
import {
  packOddsReference,
  possiblePackCards,
  tierRank,
  type PulledCard,
} from "./pack-data";
import {
  generatePackForClass,
  recordOpeningProgress,
  rollPackClass,
} from "./pack-events";
import { PackBurstExperience } from "./pack-burst-scene";
import { createPackSound, type PackSound } from "./pack-burst-sound";
import { packGeometry } from "./pack-mesh";
import {
  PackExperience,
  PackCarousel,
  FoilEnvironment,
  type PackPhase,
  type PackSceneControls,
} from "./pack-scene";
import {
  VARIANT_SKINS,
  composeSkinFromImage,
  coverSkins,
  readImageFile,
  skinVariant,
  usePackManifest,
  useSkinTexture,
  type PackSkin,
} from "./pack-skins";
import type {
  PackOpeningMode,
  PackOpeningNativeCommand,
  PackOpeningPackClassResult,
  PackOpeningProps,
  PackOpeningPull,
  PackOpeningRecap,
  PackOpeningPullSession,
} from "./types";

const PHASE_HINTS: Partial<Record<PackPhase, string>> = {
  select: "Swipe or drag to browse · spin a pack or use the button to open",
  tear: "Swipe across the dotted line to tear the pack open",
  reveal: "Reveal cards one at a time or show all pulls",
};

const BURST_HINTS: Partial<Record<PackPhase, string>> = {
  tear: "Drag across the top to tear it open · or tap the pack",
  reveal: "Hover or tap a card for a closer look",
};

const PACK_COUNTS = [1, 5, 10] as const;

const OPENING_MODES: ReadonlyArray<{ id: PackOpeningMode; label: string }> = [
  { id: "normal", label: "Classic" },
  { id: "burst", label: "Burst" },
  { id: "quick", label: "Quick" },
];

const SOUND_MUTED_KEY = "tcger-pack-sound-muted";

const PACK_CLASS_RANK: Record<PackOpeningPackClassResult["id"], number> = {
  standard: 0,
  "hit-heavy": 1,
  "rare-pack": 2,
};

function pullForSession(card: PulledCard): PackOpeningPull {
  return {
    cardId: card.id,
    name: card.name,
    rarity: card.rarity,
    tier: card.tier,
    collectorNumber: card.localId,
    tcg: card.tcg,
    setCode: card.setCode,
    setName: card.setName,
    imageUrl: card.imageUrl,
    imageUrlSmall: card.imageUrlSmall,
  };
}

function rarestPackClass(
  packClasses: PackOpeningPackClassResult[],
): PackOpeningPackClassResult | undefined {
  return packClasses.reduce<PackOpeningPackClassResult | undefined>(
    (best, candidate) =>
      !best || PACK_CLASS_RANK[candidate.id] > PACK_CLASS_RANK[best.id]
        ? candidate
        : best,
    undefined,
  );
}

function playPackEventSound(packClass: PackOpeningPackClassResult): void {
  try {
    const AudioContextClass =
      globalThis.AudioContext ??
      (
        globalThis as typeof globalThis & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.75);
    gain.connect(context.destination);

    const frequencies =
      packClass.id === "rare-pack" ? [220, 440, 880] : [196, 392];
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = index === frequencies.length - 1 ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(context.currentTime + index * 0.11);
      oscillator.stop(context.currentTime + 0.72);
    });
    window.setTimeout(() => void context.close(), 900);
  } catch {
    // Audio is an enhancement; haptics and lighting still communicate the event.
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

/**
 * The HUD is a development aid, not part of the demo: it renders under
 * only when a developer explicitly opts in with `?debug=1`, so ordinary local
 * demos exercise the same interface as production.
 */
function useDebugHud(requested: boolean): boolean {
  const [enabled, setEnabled] = useState(requested);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEnabled(requested || params.get("debug") === "1");
  }, [requested]);

  return enabled;
}

const TIER_LABEL_CLASSES: Record<string, string> = {
  common: "text-slate-500 dark:text-slate-300",
  uncommon: "text-emerald-600 dark:text-emerald-300",
  rare: "text-sky-600 dark:text-sky-300",
  ultra: "text-violet-600 dark:text-violet-300",
  chase: "text-amber-600 dark:text-amber-300",
};

export function PackOpening({
  assetBase = "",
  embedded = false,
  debug = false,
  nativeControls = false,
  completionActionLabel,
  soundMuted: hostSoundMuted,
  onEvent,
}: PackOpeningProps = {}) {
  const [phase, setPhase] = useState<PackPhase>("select");
  const [packCount, setPackCount] = useState<number>(1);
  const [openingMode, setOpeningMode] = useState<PackOpeningMode>("normal");
  const [packBackwards, setPackBackwards] = useState(false);
  const [currentCardFaceUp, setCurrentCardFaceUp] = useState(true);
  const [browseSkin, setBrowseSkin] = useState<PackSkin>(VARIANT_SKINS[0]);
  const [openedSkin, setOpenedSkin] = useState<PackSkin | null>(null);
  const [uploads, setUploads] = useState<PackSkin[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [artworkWarning, setArtworkWarning] = useState<string | null>(null);
  const [packs, setPacks] = useState<PulledCard[][]>([]);
  const [packClasses, setPackClasses] = useState<PackOpeningPackClassResult[]>(
    [],
  );
  const [openingRecap, setOpeningRecap] = useState<PackOpeningRecap>();
  const [openingID, setOpeningID] = useState("");
  const [openedAt, setOpenedAt] = useState("");
  const [packIndex, setPackIndex] = useState(0);
  const [remountKey, setRemountKey] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [forceChase, setForceChase] = useState(false);
  const [slowMo, setSlowMo] = useState(false);
  const showHud = useDebugHud(debug);
  const prefersReducedMotion = usePrefersReducedMotion();
  const controls = useRef<PackSceneControls>({
    timeScale: 1,
    reducedMotion: false,
  });
  const experienceRef = useRef<HTMLDivElement>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousPhaseRef = useRef<PackPhase | null>(null);
  const recordedOpeningIDsRef = useRef(new Set<string>());
  const playedOmenIDsRef = useRef(new Set<string>());
  const tornAtRef = useRef(0);
  const openingCompletionTimerRef = useRef<number | undefined>(undefined);
  const soundRef = useRef<PackSound | null>(null);
  const [storedSoundMuted, setStoredSoundMuted] = useState(false);
  const soundMuted = hostSoundMuted ?? storedSoundMuted;
  // A bulk opening is one cut and a grouped summary in every mode.
  const burst = openingMode === "burst" && packs.length === 1;
  const selectedOddsReference = useMemo(
    () => packOddsReference(browseSkin.packPool),
    [browseSkin.packPool],
  );

  useEffect(() => {
    controls.current.timeScale = slowMo ? 0.25 : 1;
  }, [slowMo]);

  useEffect(() => {
    controls.current.reducedMotion = prefersReducedMotion;
  }, [prefersReducedMotion]);

  useEffect(() => {
    try {
      setStoredSoundMuted(
        window.localStorage.getItem(SOUND_MUTED_KEY) === "1",
      );
    } catch {
      // Storage can be unavailable in an embedded web view.
    }
  }, []);
  useEffect(() => {
    soundRef.current?.setMuted(soundMuted);
  }, [soundMuted]);
  useEffect(
    () => () => {
      soundRef.current?.dispose();
      soundRef.current = null;
    },
    [],
  );
  // Browsers only start audio from a gesture, so the synthesiser is built on
  // the first press made while the burst opening is selected.
  const wakeSound = useCallback(() => {
    if (openingMode !== "burst") return;
    if (!soundRef.current) {
      soundRef.current = createPackSound();
      soundRef.current?.setMuted(soundMuted);
    }
    soundRef.current?.resume();
  }, [openingMode, soundMuted]);
  const changeSoundMuted = useCallback((muted: boolean) => {
    setStoredSoundMuted(muted);
    if (!muted) soundRef.current?.tick();
    try {
      window.localStorage.setItem(SOUND_MUTED_KEY, muted ? "1" : "0");
    } catch {
      // The choice still holds for this session.
    }
  }, []);

  const startPacks = useCallback(
    (skin: PackSkin, backwards = false) => {
      window.clearTimeout(openingCompletionTimerRef.current);
      setArtworkWarning(null);
      setOpeningID(
        globalThis.crypto?.randomUUID?.() ??
          `opening-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      setOpenedAt(new Date().toISOString());
      setOpenedSkin(skin);
      setOpeningRecap(undefined);
      setPackBackwards(backwards);
      setCurrentCardFaceUp(!backwards);
      const nextPackClasses = Array.from({ length: packCount }, () =>
        rollPackClass(skin.packPool),
      );
      setPackClasses(nextPackClasses);
      setPacks(
        nextPackClasses.map((packClass) =>
          generatePackForClass(packClass, forceChase, skin.packPool),
        ),
      );
      setPackIndex(0);
      setRevealedCount(0);
      setRemountKey((k) => k + 1);
      // Quick Open is only for a single pack. Bulk openings keep the stacked
      // one-cut ritual, then go directly to their grouped results.
      setPhase(openingMode === "quick" && packCount === 1 ? "final" : "tear");
    },
    [forceChase, openingMode, packCount],
  );

  const rerollCurrent = useCallback(() => {
    setOpeningID(
      globalThis.crypto?.randomUUID?.() ??
        `opening-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    setOpenedAt(new Date().toISOString());
    const packPool = openedSkin?.packPool;
    if (!packPool) return;
    const nextPackClass = rollPackClass(packPool);
    setOpeningRecap(undefined);
    setPackClasses((previous) =>
      previous.map((value, index) =>
        index === packIndex ? nextPackClass : value,
      ),
    );
    setPacks((prev) =>
      prev.map((p, i) =>
        i === packIndex
          ? generatePackForClass(nextPackClass, forceChase, packPool)
          : p,
      ),
    );
    setRevealedCount(0);
    setRemountKey((k) => k + 1);
    setPhase("tear");
  }, [packIndex, forceChase, openedSkin]);

  const completedSession = useMemo<PackOpeningPullSession | undefined>(() => {
    if (!openingID || packs.length === 0) return undefined;
    return {
      id: openingID,
      packLabel: openedSkin?.label ?? "Booster pack",
      openedAt,
      packs: packs.map((pack) => pack.map(pullForSession)),
      packClasses,
      recap: openingRecap,
    };
  }, [
    openedAt,
    openedSkin?.label,
    openingID,
    openingRecap,
    packClasses,
    packs,
  ]);

  const requestSave = useCallback(() => {
    if (completedSession)
      onEvent?.({ type: "saveRequested", session: completedSession });
  }, [completedSession, onEvent]);

  const backToSelect = useCallback(() => {
    window.clearTimeout(openingCompletionTimerRef.current);
    setPhase("select");
    setPacks([]);
    setPackClasses([]);
    setOpeningRecap(undefined);
    setOpenedSkin(null);
    setPackIndex(0);
    setRevealedCount(0);
    setCurrentCardFaceUp(true);
  }, []);

  const handleTorn = useCallback(() => {
    tornAtRef.current = performance.now();
    // The burst scene reports its own impact at the moment the strip lets go,
    // which may be a beat after a button asked for the pack to be opened.
    if (!burst) onEvent?.({ type: "haptic", style: "impact" });
    setPhase("opening");
  }, [burst, onEvent]);
  // Multi-pack opens are one ritual followed by a grouped summary. Requiring
  // five or ten separate tears and dozens of card swipes makes bulk opening
  // feel like a queue instead of a payoff.
  const handleOpened = useCallback(() => {
    const finish = () => {
      if (openingMode === "quick" || packs.length > 1) {
        setPhase("final");
      } else if (burst) {
        // Every card is already face up on the table.
        setPhase("reveal");
        setRevealedCount(packs[0]?.length ?? 0);
        setCurrentCardFaceUp(true);
      } else {
        setPhase("reveal");
        setRevealedCount(packBackwards ? 0 : 1);
        setCurrentCardFaceUp(!packBackwards);
      }
    };
    const eventClass = rarestPackClass(packClasses);
    const minimumOmenDuration =
      eventClass && eventClass.id !== "standard" ? 900 : 0;
    const remaining =
      minimumOmenDuration - (performance.now() - tornAtRef.current);
    if (remaining > 0) {
      window.clearTimeout(openingCompletionTimerRef.current);
      openingCompletionTimerRef.current = window.setTimeout(finish, remaining);
    } else {
      finish();
    }
  }, [burst, openingMode, packBackwards, packClasses, packs]);
  const handleReveal = useCallback(
    (count: number) => setRevealedCount(count),
    [],
  );
  const handleAllRevealed = useCallback(() => {
    if (openingMode === "normal" && packIndex < packs.length - 1) {
      onEvent?.({ type: "haptic", style: "selection" });
      setPackIndex((index) => index + 1);
      setRevealedCount(0);
      setRemountKey((key) => key + 1);
      setPhase("tear");
      return;
    }
    onEvent?.({ type: "haptic", style: "success" });
    setPhase("summary");
  }, [onEvent, openingMode, packIndex, packs.length]);
  const skipToResults = useCallback(() => {
    window.clearTimeout(openingCompletionTimerRef.current);
    onEvent?.({ type: "haptic", style: "success" });
    setPhase("final");
  }, [onEvent]);
  const handleFlash = useCallback(() => {
    onEvent?.({ type: "haptic", style: "selection" });
    setFlashKey((k) => k + 1);
  }, [onEvent]);
  const handleHaptic = useCallback(
    (style: "selection" | "impact" | "success") =>
      onEvent?.({ type: "haptic", style }),
    [onEvent],
  );
  const handleInspect = useCallback(
    (index: number) => {
      const card = packs[packIndex]?.[index];
      if (card) {
        onEvent?.({ type: "inspectRequested", pull: pullForSession(card) });
      }
    },
    [onEvent, packIndex, packs],
  );

  // The skin decides the sheet; a variant still comes along for the accent
  // colours the tear glow and charge-up are tinted with.
  const skin = openedSkin ?? browseSkin;
  const variant = openedSkin ? skinVariant(openedSkin) : null;
  const manifest = usePackManifest(assetBase);
  const [layout, setLayout] = useState<SheetLayout | null>(null);
  useEffect(() => {
    let live = true;
    packGeometry(assetBase)
      .then((p) => {
        if (!live) return;
        setLayout(p.layout);
        onEvent?.({ type: "ready" });
      })
      .catch((error: unknown) => {
        if (!live) return;
        onEvent?.({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Pack assets failed to load",
        });
      });
    return () => {
      live = false;
    };
  }, [assetBase, onEvent]);

  useEffect(() => {
    onEvent?.({ type: "phaseChanged", phase });
  }, [onEvent, phase]);

  useEffect(() => {
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = phase;
    if (previousPhase === null || previousPhase === phase) return;

    const frame = window.requestAnimationFrame(() => {
      const focusTarget =
        phase === "summary" || phase === "final"
          ? resultsHeadingRef.current
          : primaryActionRef.current;
      const target = focusTarget ?? experienceRef.current;
      target?.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "center",
      });
      target?.focus({
        preventScroll: true,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [phase, prefersReducedMotion]);

  const skins = useMemo(() => {
    const publishedCovers = coverSkins(manifest);
    const setsWithPublishedArtwork = new Set(
      publishedCovers.map((cover) => cover.setID),
    );
    // Real published booster art replaces the generated fallback choices for
    // its set. This keeps Base Set to Charizard/Blastoise/Venusaur instead of
    // mixing those with unrelated demo wrappers, while offline-only sets still
    // remain usable.
    const generatedFallbacks = VARIANT_SKINS.filter(
      (skin) => !setsWithPublishedArtwork.has(skin.setID),
    );
    return [...publishedCovers, ...generatedFallbacks, ...uploads];
  }, [manifest, uploads]);
  const nativeCardPools = useMemo(() => {
    const pools = new Map<string, { id: string; label: string }>();
    for (const option of skins) {
      if (!pools.has(option.packPool)) {
        pools.set(option.packPool, {
          id: option.packPool,
          label: option.setLabel,
        });
      }
    }
    return [...pools.values()].map((pool) => ({
      ...pool,
      cards: possiblePackCards(pool.id).map((card) => ({
        cardId: card.id,
        name: card.name,
        rarity: card.rarity,
        tier: card.tier,
        collectorNumber: card.localId,
        tcg: card.tcg,
        setCode: card.setCode,
        setName: card.setName,
        imageUrl: card.imageUrl,
        imageUrlSmall: card.imageUrlSmall,
      })),
    }));
  }, [skins]);
  useEffect(() => {
    if (skins.some((option) => option.id === browseSkin.id)) return;
    const replacement =
      skins.find((option) => option.setID === browseSkin.setID) ?? skins[0];
    if (replacement) setBrowseSkin(replacement);
  }, [browseSkin, skins]);
  const browseSheet = useSkinTexture(browseSkin, layout);
  const handleSkinError = useCallback(
    (message: string) =>
      setArtworkWarning(`${message}. Using a generated wrapper instead.`),
    [],
  );
  const openedSheet = useSkinTexture(skin, layout, handleSkinError);
  // The pack that leaves the carousel must retain the same GPU texture through
  // the tear stage. Repainting/reloading an equivalent sheet here caused a
  // visible exposure and artwork pop during the component handoff.
  const openingSheet = skin.id === browseSkin.id ? browseSheet : openedSheet;

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file || !layout) return;
      setUploadError(null);
      try {
        const image = await readImageFile(file);
        const next = composeSkinFromImage(
          image,
          layout,
          file.name.replace(/\.[^.]+$/, ""),
        );
        setUploads((prev) => [...prev, next]);
        setBrowseSkin(next);
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "could not read that file",
        );
      }
    },
    [layout],
  );
  const currentPack = packs[packIndex] ?? null;
  const openingEventClass = useMemo(
    () => rarestPackClass(packClasses),
    [packClasses],
  );
  const revealed = currentPack ? currentPack.slice(0, revealedCount) : [];
  const canvasVisible =
    phase === "select" ||
    phase === "tear" ||
    phase === "opening" ||
    phase === "reveal";

  useEffect(() => {
    if (
      (phase !== "summary" && phase !== "final") ||
      !openingID ||
      !openedSkin ||
      packs.length === 0 ||
      packClasses.length !== packs.length ||
      recordedOpeningIDsRef.current.has(openingID)
    ) {
      return;
    }
    recordedOpeningIDsRef.current.add(openingID);
    setOpeningRecap(
      recordOpeningProgress({
        openingID,
        packPool: openedSkin.packPool,
        setName: packs[0]?.[0]?.setName ?? openedSkin.setLabel,
        packs,
        packClasses,
      }),
    );
  }, [openedSkin, openingID, packClasses, packs, phase]);

  useEffect(() => {
    if (
      phase !== "opening" ||
      !openingEventClass ||
      openingEventClass.id === "standard"
    ) {
      return;
    }
    const omenID = `${openingID}:${packIndex}`;
    if (playedOmenIDsRef.current.has(omenID)) return;
    playedOmenIDsRef.current.add(omenID);
    playPackEventSound(openingEventClass);
    onEvent?.({ type: "haptic", style: "selection" });
    const timer = window.setTimeout(
      () => onEvent?.({ type: "haptic", style: "success" }),
      openingEventClass.id === "rare-pack" ? 260 : 180,
    );
    return () => window.clearTimeout(timer);
  }, [onEvent, openingEventClass, openingID, packIndex, phase]);

  useEffect(
    () => () => window.clearTimeout(openingCompletionTimerRef.current),
    [],
  );

  useEffect(() => {
    if (!nativeControls) return;

    const handleCommand = (event: Event) => {
      const command = (event as CustomEvent<PackOpeningNativeCommand>).detail;
      switch (command.type) {
        case "selectPack": {
          const next = skins.find((option) => option.id === command.id);
          if (next) setBrowseSkin(next);
          break;
        }
        case "setPackCount":
          if (
            PACK_COUNTS.includes(command.count as (typeof PACK_COUNTS)[number])
          ) {
            setPackCount(command.count);
          }
          break;
        case "setOpeningMode":
          setOpeningMode(command.mode);
          break;
        case "togglePackOrientation":
          setPackBackwards((value) => {
            const next = !value;
            setCurrentCardFaceUp(!next);
            return next;
          });
          break;
        case "openPack":
          if (controls.current.openSelected) {
            controls.current.openSelected();
          } else {
            startPacks(browseSkin);
          }
          break;
        case "backToPacks":
          backToSelect();
          break;
        case "advance":
          if (phase === "tear") handleTorn();
          else if (phase === "reveal" && burst) handleAllRevealed();
          else if (phase === "reveal") controls.current.revealNext?.();
          break;
        case "showAll":
          if (phase === "reveal" || phase === "tear" || phase === "opening") {
            skipToResults();
          }
          break;
        case "savePulls":
          requestSave();
          break;
        case "setSoundMuted":
          changeSoundMuted(command.muted);
          break;
        case "uploadArtwork": {
          if (!layout) break;
          const image = new Image();
          image.onload = () => {
            try {
              const next = composeSkinFromImage(image, layout, command.label);
              setUploads((previous) => [...previous, next]);
              setBrowseSkin(next);
              setUploadError(null);
            } catch (error) {
              setUploadError(
                error instanceof Error
                  ? error.message
                  : "could not read that image",
              );
            }
          };
          image.onerror = () => setUploadError("could not read that image");
          image.src = command.dataURL;
          break;
        }
      }
    };

    window.addEventListener("tcger-pack-command", handleCommand);
    return () =>
      window.removeEventListener("tcger-pack-command", handleCommand);
  }, [
    backToSelect,
    browseSkin,
    burst,
    changeSoundMuted,
    handleAllRevealed,
    handleTorn,
    layout,
    nativeControls,
    phase,
    requestSave,
    skipToResults,
    skins,
    startPacks,
  ]);

  useEffect(() => {
    if (!nativeControls) return;
    onEvent?.({
      type: "nativeState",
      state: {
        phase,
        selectedPackID: (phase === "select" ? browseSkin : skin).id,
        selectedPackLabel: (phase === "select" ? browseSkin : skin).label,
        packCount,
        openingMode,
        packBackwards,
        currentCardFaceUp,
        packOptions: skins.map(
          ({ id, label, setID, setLabel, variationLabel, packPool }) => ({
            id,
            label,
            setID,
            setLabel,
            variationLabel,
            packPoolID: packPool,
            oddsReference: packOddsReference(packPool),
          }),
        ),
        cardPools: nativeCardPools,
        revealedCount,
        totalCards: currentPack?.length ?? 0,
        currentPackNumber: packs.length > 0 ? packIndex + 1 : 0,
        totalPacks: packs.length,
        canSave: Boolean(
          completionActionLabel && (phase === "summary" || phase === "final"),
        ),
        warning: artworkWarning ?? uploadError ?? undefined,
        // Native image loading has a separate cache from WKWebView. Share the
        // pulls as soon as a pack exists so iOS can prefetch thumbnails while
        // the user is tearing and revealing, before the result grid appears.
        session: phase === "select" ? undefined : completedSession,
      },
    });
  }, [
    artworkWarning,
    browseSkin,
    completionActionLabel,
    completedSession,
    currentPack?.length,
    currentCardFaceUp,
    nativeControls,
    nativeCardPools,
    onEvent,
    packCount,
    openingMode,
    packBackwards,
    packIndex,
    packs.length,
    phase,
    revealedCount,
    skin,
    skins,
    uploadError,
  ]);

  return (
    <div
      ref={experienceRef}
      tabIndex={-1}
      onPointerDownCapture={wakeSound}
      onKeyDownCapture={wakeSound}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const target = event.target as HTMLElement;
        if (
          target.closest(
            "button, a, input, select, textarea, [role='button'], [contenteditable='true']",
          )
        ) {
          return;
        }
        if (phase === "tear") {
          event.preventDefault();
          handleTorn();
        } else if (phase === "reveal") {
          event.preventDefault();
          controls.current.revealNext?.();
        }
      }}
      aria-label="Pack opening experience"
      className={cn(
        "relative isolate w-full overflow-hidden bg-gradient-to-b from-muted/40 via-background to-primary/5",
        embedded
          ? "h-full min-h-0 rounded-none border-0"
          : "h-[calc(100dvh-15rem)] min-h-[30rem] rounded-2xl border md:h-[72vh] md:min-h-[540px]",
      )}
    >
      {canvasVisible && (
        <Canvas
          className="touch-none"
          camera={{ position: [0, 0, 7], fov: 40 }}
          dpr={[1, 1.75]}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
          }}
          onCreated={({ gl }) => {
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 0.86;
          }}
        >
          <Suspense fallback={null}>
            {/* One persistent light/environment rig spans selection and opening
                so the chosen pack never changes exposure at the handoff. */}
            <FoilEnvironment />
            <ambientLight intensity={0.3} />
            <directionalLight position={[3, 5, 6]} intensity={0.5} />
            <directionalLight
              position={[-4, -2, 4]}
              intensity={0.1}
              color="#8fb7ff"
            />
            {phase === "select" ? (
              <PackCarousel
                assetBase={assetBase}
                variant={skinVariant(browseSkin)}
                sheet={browseSheet}
                reducedMotion={prefersReducedMotion}
                controls={controls}
                packCount={packCount}
                onSelect={(backwards) => startPacks(browseSkin, backwards)}
              />
            ) : currentPack && variant && burst ? (
              <PackBurstExperience
                assetBase={assetBase}
                key={`burst-${packIndex}-${remountKey}`}
                cards={currentPack}
                variant={variant}
                sheet={openingSheet}
                backwards={packBackwards}
                nativeLayout={nativeControls}
                phase={phase}
                controls={controls}
                sound={soundRef}
                onTorn={handleTorn}
                onOpened={handleOpened}
                onFlash={handleFlash}
                onHaptic={handleHaptic}
                onInspect={handleInspect}
              />
            ) : currentPack && variant ? (
              <PackExperience
                assetBase={assetBase}
                key={`${packIndex}-${remountKey}`}
                cards={currentPack}
                variant={variant}
                sheet={openingSheet}
                // Keep the unopened stack visible in both modes. A single
                // Normal pack reveals card-by-card; multi-pack and Quick opens
                // go directly to the grouped results.
                packCount={Math.max(1, packs.length - packIndex)}
                backwards={packBackwards}
                nativeLayout={nativeControls}
                phase={phase}
                controls={controls}
                onTorn={handleTorn}
                onOpened={handleOpened}
                onReveal={handleReveal}
                onCardFaceChanged={setCurrentCardFaceUp}
                onAllRevealed={handleAllRevealed}
                onFlash={handleFlash}
              />
            ) : null}
          </Suspense>
        </Canvas>
      )}

      {/* reveal flash */}
      {flashKey > 0 && (
        <div
          key={flashKey}
          className="pointer-events-none absolute inset-0 animate-[pack-flash_0.6s_ease-out_forwards]"
          style={{
            background:
              "radial-gradient(circle at center, rgba(255,255,255,1) 0%, rgba(147,197,253,0.7) 40%, rgba(147,197,253,0) 75%)",
          }}
        />
      )}
      {phase === "opening" &&
        openingEventClass &&
        openingEventClass.id !== "standard" && (
          <div
            className={cn(
              "pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden",
              openingEventClass.id === "rare-pack"
                ? "bg-amber-300/10"
                : "bg-violet-400/10",
            )}
            role="status"
            aria-live="assertive"
          >
            <div
              className={cn(
                "absolute -inset-1/2 animate-[pack-omen-spin_2.8s_linear_infinite] opacity-75",
                openingEventClass.id === "rare-pack"
                  ? "bg-[conic-gradient(from_90deg,transparent,#fde68a,transparent,#f0abfc,transparent,#7dd3fc,transparent)]"
                  : "bg-[conic-gradient(from_90deg,transparent,#c4b5fd,transparent,#7dd3fc,transparent)]",
              )}
            />
            <div className="relative animate-[pack-omen-in_0.5s_ease-out_both] rounded-full border border-white/35 bg-black/55 px-5 py-3 text-center text-sm font-semibold tracking-wide text-white shadow-2xl backdrop-blur-md sm:text-base">
              Something feels different…
            </div>
          </div>
        )}
      {artworkWarning && !nativeControls && (
        <p
          role="status"
          className="pointer-events-none absolute left-1/2 top-16 z-20 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full border border-amber-500/40 bg-background/90 px-3 py-1.5 text-center text-xs font-medium text-foreground shadow-sm backdrop-blur"
        >
          {artworkWarning}
        </p>
      )}
      <style>{`
        @keyframes pack-flash { 0% { opacity: 0.9; } 100% { opacity: 0; } }
        @keyframes pack-omen-in {
          0% { opacity: 0; transform: translateY(8px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes pack-omen-spin { to { transform: rotate(360deg); } }
        @keyframes pack-card-in {
          0% { opacity: 0; transform: translateY(14px) scale(0.94); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {/* back out of an opening without the HUD — the bottom offsets keep the
          overlays clear of the fixed mobile nav, like the shell's pb-16 md:pb-0 */}
      {!nativeControls &&
        !showHud &&
        (phase === "tear" || phase === "opening" || phase === "reveal") && (
          <button
            type="button"
            onClick={backToSelect}
            className="absolute right-3 top-3 min-h-10 rounded-full border border-border bg-background/80 px-4 py-2 text-xs font-semibold backdrop-blur transition hover:bg-muted"
          >
            Back to packs
          </button>
        )}

      {/* phase hint */}
      {!nativeControls && (burst ? BURST_HINTS[phase] : PHASE_HINTS[phase]) && (
        <p
          className={cn(
            "pointer-events-none absolute left-1/2 z-10 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full border border-border bg-background/85 px-3 py-1.5 text-center text-xs font-medium text-muted-foreground shadow-sm backdrop-blur sm:text-sm",
            phase === "select"
              ? packCount === 1
                ? "bottom-[12rem] sm:bottom-[16.75rem]"
                : "bottom-[9.25rem] sm:bottom-56"
              : phase === "tear" || phase === "reveal"
                ? "bottom-24"
                : "bottom-3",
          )}
        >
          {burst
            ? BURST_HINTS[phase]
            : phase === "tear" && packs.length > 1
            ? `Tear once to open all ${packs.length} packs`
            : phase === "reveal" && packBackwards
              ? currentCardFaceUp
                ? "Swipe card away"
                : "Tap to flip"
              : PHASE_HINTS[phase]}
        </p>
      )}

      {!nativeControls && (phase === "tear" || phase === "reveal") && (
        <div className="absolute inset-x-3 bottom-5 z-10 flex flex-wrap justify-center gap-2">
          <button
            ref={primaryActionRef}
            type="button"
            onClick={
              phase === "tear"
                ? handleTorn
                : burst
                  ? handleAllRevealed
                  : () => controls.current.revealNext?.()
            }
            aria-label={
              burst
                ? undefined
                : phase === "reveal"
                ? currentPack && revealedCount >= currentPack.length
                  ? "Finish reveal"
                  : packBackwards
                    ? currentCardFaceUp
                      ? "Slide current card away"
                      : "Flip current card"
                    : "Reveal next card"
                : undefined
            }
            className="min-h-11 rounded-full border border-border bg-background/90 px-4 py-2.5 text-sm font-semibold shadow-sm backdrop-blur transition hover:bg-muted"
          >
            {phase === "tear"
              ? prefersReducedMotion || burst
                ? "Open pack"
                : "Skip tear animation"
              : burst
                ? "See results"
              : currentPack && revealedCount >= currentPack.length
                ? "Finish reveal"
                : packBackwards
                  ? currentCardFaceUp
                    ? "Slide card away"
                    : "Flip card"
                  : "Reveal next"}
          </button>
          {phase === "reveal" && !burst && (
            <button
              type="button"
              onClick={handleAllRevealed}
              aria-label="Show all pulls"
              className="min-h-11 rounded-full border border-border bg-background/90 px-4 py-2.5 text-sm font-semibold shadow-sm backdrop-blur transition hover:bg-muted"
            >
              Show all
            </button>
          )}
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {phase === "reveal" && currentPack && burst
          ? `Pack opened: ${currentPack.map((card) => card.name).join(", ")}.`
          : phase === "reveal" && currentPack
            ? `${revealedCount} of ${currentPack.length} cards revealed`
            : ((burst ? BURST_HINTS[phase] : undefined) ??
              PHASE_HINTS[phase] ??
              `Pack opening phase: ${phase}`)}
      </p>

      {/* The fanned cards are pixels in a canvas, so the keyboard and screen
          readers get them as a list: focusing an entry lifts that card just
          as hovering it does, and activating it asks the host to inspect it. */}
      {burst && phase === "reveal" && currentPack && (
        <ul
          className="sr-only"
          aria-label="Cards in this pack"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button",
              ),
            ];
            const at = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next = Math.min(
              buttons.length - 1,
              Math.max(0, at + (event.key === "ArrowLeft" ? -1 : 1)),
            );
            buttons[next]?.focus();
            event.preventDefault();
          }}
        >
          {currentPack.map((card, index) => (
            <li key={card.id}>
              <button
                type="button"
                onFocus={() => controls.current.focusCard?.(index)}
                onBlur={() => controls.current.focusCard?.(null)}
                onClick={() => handleInspect(index)}
              >
                {card.name}, {card.rarity}, card {index + 1} of{" "}
                {currentPack.length}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!nativeControls && openingMode === "burst" && canvasVisible && (
        <button
          type="button"
          onClick={() => changeSoundMuted(!soundMuted)}
          aria-label="Mute sound"
          aria-pressed={soundMuted}
          className="absolute left-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full border border-border bg-background/80 text-foreground backdrop-blur transition hover:bg-muted"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z" fill="currentColor" />
            <g
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              {soundMuted ? (
                <path d="M16 9.5l5 5m0-5l-5 5" />
              ) : (
                <>
                  <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />
                  <path d="M18.2 6.8a7.5 7.5 0 0 1 0 10.4" />
                </>
              )}
            </g>
          </svg>
        </button>
      )}

      {/* texture + pack count pickers on select screen */}
      {!nativeControls && phase === "select" && (
        <div className="absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-2 rounded-xl border border-border bg-background/90 p-2 shadow-lg backdrop-blur sm:bottom-10">
          <div className="flex w-full max-w-full gap-1.5 overflow-x-auto pb-0.5 sm:gap-2 sm:pb-1">
            {skins.map((s) => {
              const active = browseSkin.id === s.id;
              const tint =
                s.kind === "variant" ? skinVariant(s).palette.mid : null;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setBrowseSkin(s)}
                  className={cn(
                    "min-h-9 shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold transition sm:min-h-10 sm:py-2",
                    // Hovering must not repaint a selected chip: bg-muted under
                    // text-primary-foreground is dark on dark, so the label
                    // disappears under the cursor that just picked it.
                    !active && "hover:bg-muted",
                    // A variant chip wears its own palette, so its label goes to
                    // the background colour to stay legible on it; anything else
                    // uses the primary fill and must not also take that class.
                    active && tint && "text-background",
                    active &&
                      !tint &&
                      "border-primary bg-primary text-primary-foreground hover:bg-primary",
                  )}
                  style={
                    active && tint
                      ? { background: tint, borderColor: tint }
                      : undefined
                  }
                  aria-pressed={active}
                >
                  {s.label}
                </button>
              );
            })}
            {/* The studio's flow, minus the authoring panel: the same compositor
                fits the image to the display panel and wraps it round the back. */}
            <label
              className={cn(
                "min-h-9 cursor-pointer rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted sm:min-h-10 sm:py-2",
                !layout && "pointer-events-none opacity-50",
              )}
            >
              Upload image
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  void handleUpload(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {uploadError && (
            <p className="text-xs font-medium text-destructive">
              {uploadError}
            </p>
          )}
          <details className="max-w-2xl text-center text-[11px] leading-snug text-muted-foreground sm:text-xs">
            <summary className="cursor-pointer font-semibold text-foreground">
              Odds source
            </summary>
            <p className="mt-1">
              <a
                href={selectedOddsReference.url}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-foreground underline underline-offset-2"
              >
                {selectedOddsReference.title}
              </a>{" "}
              · {selectedOddsReference.sampleSize.toLocaleString()} packs.{" "}
              {selectedOddsReference.note}
            </p>
          </details>
          {packCount === 1 && (
            <div
              role="radiogroup"
              aria-label="Opening style"
              className="flex justify-center gap-1 rounded-full bg-muted p-1"
            >
              {OPENING_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  role="radio"
                  aria-checked={openingMode === mode.id}
                  onClick={() => setOpeningMode(mode.id)}
                  className={cn(
                    "min-h-8 rounded-full px-3 py-1 text-xs font-semibold transition",
                    openingMode === mode.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:flex-col">
            <div className="flex shrink-0 justify-center gap-1.5 sm:gap-2">
              {PACK_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPackCount(n)}
                  className={cn(
                    "min-h-9 rounded-full border border-border px-3 py-1.5 text-sm font-semibold transition hover:bg-muted sm:min-h-10 sm:px-4 sm:py-2",
                    packCount === n &&
                      "border-primary bg-primary text-primary-foreground hover:bg-primary",
                  )}
                  aria-pressed={packCount === n}
                  aria-label={`Open ${n} ${n === 1 ? "pack" : "packs"}`}
                >
                  ×{n}
                </button>
              ))}
            </div>
            <button
              ref={phase === "select" ? primaryActionRef : undefined}
              type="button"
              onClick={() => startPacks(browseSkin)}
              className="min-h-10 min-w-0 flex-1 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90 sm:min-h-11 sm:flex-none sm:px-6 sm:py-2.5"
            >
              Open {packCount === 1 ? "pack" : `${packCount} packs`}
            </button>
          </div>
        </div>
      )}

      {/* single-pack summary */}
      {!nativeControls && phase === "summary" && currentPack && (
        <div className="absolute inset-0 flex flex-col items-center justify-start gap-6 overflow-y-auto p-6 pb-24 md:justify-center md:pb-6">
          <h2
            ref={resultsHeadingRef}
            tabIndex={-1}
            className="text-xl font-heading font-semibold text-foreground outline-none"
          >
            Pack results
          </h2>
          {completedSession && <OpeningRecapPanel session={completedSession} />}
          <div className="flex flex-wrap items-start justify-center gap-4">
            {currentPack.map((card, i) => (
              <PackResultCard key={card.id} card={card} index={i} />
            ))}
          </div>
          {!nativeControls && (
            <div className="flex flex-wrap justify-center gap-2">
              {completionActionLabel && (
                <button
                  ref={primaryActionRef}
                  type="button"
                  onClick={requestSave}
                  className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
                >
                  {completionActionLabel}
                </button>
              )}
              <button
                ref={completionActionLabel ? undefined : primaryActionRef}
                type="button"
                onClick={backToSelect}
                className="rounded-lg border border-border bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted"
              >
                Open more packs
              </button>
            </div>
          )}
        </div>
      )}

      {/* combined results across all packs */}
      {!nativeControls && phase === "final" && (
        <div className="absolute inset-0 flex flex-col items-center gap-6 overflow-y-auto p-6 pb-24 md:pb-6">
          <h2
            ref={resultsHeadingRef}
            tabIndex={-1}
            className="text-xl font-heading font-semibold text-foreground outline-none"
          >
            All results · {packs.length} packs ·{" "}
            {openedSkin?.label ?? variant?.name}
          </h2>
          {completedSession && <OpeningRecapPanel session={completedSession} />}
          {(() => {
            const best = packs
              .flatMap((pack, i) =>
                pack.map((card, j) => ({ card, key: `${i}-${j}` })),
              )
              .filter(({ card }) => tierRank(card.tier) >= 3)
              .sort((a, b) => tierRank(b.card.tier) - tierRank(a.card.tier));
            if (best.length === 0) return null;
            return (
              <section className="w-full max-w-4xl space-y-2">
                <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-300">
                  Best pulls
                </h3>
                <div className="flex flex-wrap gap-4">
                  {best.map(({ card, key }, i) => (
                    <PackResultCard key={key} card={card} index={i} />
                  ))}
                </div>
              </section>
            );
          })()}
          {packs.map((pack, i) => (
            <section key={i} className="w-full max-w-4xl space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Pack {i + 1}
                {packClasses[i]?.id !== "standard"
                  ? ` · ${packClasses[i]?.label}`
                  : ""}
              </h3>
              <div className="flex flex-wrap gap-3">
                {pack.map((card, j) => (
                  <PackResultCard
                    key={`${i}-${card.id}`}
                    card={card}
                    small
                    index={
                      packs
                        .slice(0, i)
                        .reduce((sum, item) => sum + item.length, 0) + j
                    }
                  />
                ))}
              </div>
            </section>
          ))}
          {!nativeControls && (
            <div className="mb-4 flex flex-wrap justify-center gap-2">
              {completionActionLabel && (
                <button
                  ref={primaryActionRef}
                  type="button"
                  onClick={requestSave}
                  className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
                >
                  {completionActionLabel}
                </button>
              )}
              <button
                ref={completionActionLabel ? undefined : primaryActionRef}
                type="button"
                onClick={backToSelect}
                className="rounded-lg border border-border bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted"
              >
                Open more packs
              </button>
            </div>
          )}
        </div>
      )}

      {/* dev HUD — dev builds only, or ?debug=1 */}
      {showHud && (
        <div className="absolute right-3 top-3 w-52 space-y-2 rounded-lg border border-border bg-background/80 p-3 font-mono text-[11px] text-foreground/85 backdrop-blur">
          <p className="flex justify-between">
            <span className="text-muted-foreground">phase</span>
            <span>{phase}</span>
          </p>
          {packs.length > 0 && (
            <p className="flex justify-between">
              <span className="text-muted-foreground">packs</span>
              <span>
                ×{packs.length} · {openedSkin?.label ?? variant?.name}
              </span>
            </p>
          )}
          <p className="flex justify-between">
            <span className="text-muted-foreground">revealed</span>
            <span>
              {revealedCount}/{currentPack?.length ?? 0}
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {phase !== "select" && (
              <>
                <HudButton onClick={rerollCurrent}>Reroll</HudButton>
                <HudButton onClick={backToSelect}>Packs</HudButton>
              </>
            )}
            {phase === "tear" && (
              <HudButton onClick={handleTorn}>Skip tear</HudButton>
            )}
            <HudButton
              active={forceChase}
              onClick={() => setForceChase((v) => !v)}
            >
              Force chase
            </HudButton>
            <HudButton active={slowMo} onClick={() => setSlowMo((v) => !v)}>
              Slow-mo
            </HudButton>
          </div>
          {revealed.length > 0 && phase === "reveal" && (
            <ul className="space-y-0.5 border-t border-border pt-1.5">
              {revealed.map((card) => (
                <li key={card.id} className="flex justify-between gap-2">
                  <span className="truncate">{card.name}</span>
                  <span
                    className={cn("shrink-0", TIER_LABEL_CLASSES[card.tier])}
                  >
                    {card.tier}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function OpeningRecapPanel({ session }: { session: PackOpeningPullSession }) {
  const [shareStatus, setShareStatus] = useState("");
  const eventPacks = (session.packClasses ?? []).filter(
    (packClass) => packClass.id !== "standard",
  );
  const rarestEvent = rarestPackClass(eventPacks);
  const recap = session.recap;

  const shareRecap = async () => {
    if (!rarestEvent) return;
    const bestPull = session.packs
      .flat()
      .reduce<
        PackOpeningPull | undefined
      >((best, pull) => (!best || tierRank(pull.tier) > tierRank(best.tier) ? pull : best), undefined);
    const text = [
      `I found a ${rarestEvent.label} opening ${session.packLabel}!`,
      bestPull ? `Best pull: ${bestPull.name} (${bestPull.rarity}).` : "",
      recap
        ? `${recap.progress.totalPacks} packs opened in the TCGer minigame.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    try {
      if (navigator.share) {
        await navigator.share({ title: "Rare pack recap", text });
        setShareStatus("Shared");
      } else {
        await navigator.clipboard.writeText(text);
        setShareStatus("Copied");
      }
    } catch {
      setShareStatus("");
    }
  };

  if (!recap && eventPacks.length === 0) return null;
  return (
    <section
      className={cn(
        "w-full max-w-4xl rounded-2xl border p-4 shadow-lg",
        rarestEvent?.id === "rare-pack"
          ? "border-amber-300/70 bg-gradient-to-br from-amber-100/90 via-background to-fuchsia-100/70 dark:from-amber-950/70 dark:to-fuchsia-950/50"
          : rarestEvent
            ? "border-violet-300/60 bg-gradient-to-br from-violet-100/80 via-background to-sky-100/60 dark:from-violet-950/60 dark:to-sky-950/40"
            : "border-border bg-background/85",
      )}
      aria-label="Opening minigame recap"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {rarestEvent ? (
            <>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
                Rare pack event
              </p>
              <h3 className="mt-1 text-xl font-heading font-bold">
                {rarestEvent.label}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {eventPacks.length > 1
                  ? `${eventPacks.length} special packs in this opening · `
                  : ""}
                {rarestEvent.description}
              </p>
            </>
          ) : (
            <h3 className="font-heading text-lg font-bold">Opening progress</h3>
          )}
        </div>
        {rarestEvent && (
          <button
            type="button"
            onClick={() => void shareRecap()}
            className="pointer-events-auto min-h-10 rounded-full border border-border bg-background/80 px-4 py-2 text-xs font-semibold shadow-sm transition hover:bg-muted"
          >
            {shareStatus || "Share recap"}
          </button>
        )}
      </div>
      {recap && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <ProgressStat
              label="Packs opened"
              value={recap.progress.totalPacks}
            />
            <ProgressStat
              label="Set found"
              value={`${recap.progress.uniqueCards}/${recap.progress.possibleCards}`}
            />
            <ProgressStat label="New cards" value={`+${recap.newCards}`} />
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 via-violet-500 to-amber-400"
              style={{ width: `${recap.progress.completionPercentage}%` }}
            />
          </div>
          <p className="mt-1 text-right text-[11px] font-semibold text-muted-foreground">
            {recap.progress.completionPercentage}% minigame set complete
          </p>
          {recap.unlockedAchievements.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {recap.unlockedAchievements.map((achievement) => (
                <span
                  key={achievement.id}
                  title={achievement.description}
                  className="rounded-full border border-amber-400/45 bg-amber-300/15 px-3 py-1 text-xs font-bold text-amber-800 dark:text-amber-200"
                >
                  Achievement · {achievement.title}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ProgressStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl bg-background/65 px-2 py-2.5">
      <p className="text-base font-bold sm:text-lg">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">
        {label}
      </p>
    </div>
  );
}

function PackResultCard({
  card,
  small = false,
  index = 0,
}: {
  card: PulledCard;
  small?: boolean;
  index?: number;
}) {
  return (
    <figure
      className={cn(
        "animate-[pack-card-in_0.45s_both] text-center",
        small ? "w-24" : "w-32 sm:w-36",
      )}
      style={{ animationDelay: `${index * 55}ms` }}
    >
      <img
        src={card.imageUrlSmall}
        alt={card.name}
        width={245}
        height={342}
        loading="eager"
        className={cn(
          "w-full rounded-lg shadow-lg",
          tierRank(card.tier) >= 3 &&
            "ring-2 ring-amber-300/80 shadow-amber-400/30",
        )}
      />
      <figcaption
        className={cn(
          "mt-1.5 text-foreground/85",
          small ? "text-[10px]" : "text-xs",
        )}
      >
        {card.name}
        <span
          className={cn(
            "block uppercase tracking-wide",
            small ? "text-[9px]" : "text-[10px]",
            TIER_LABEL_CLASSES[card.tier],
          )}
        >
          {card.rarity}
        </span>
      </figcaption>
    </figure>
  );
}

function HudButton({
  children,
  onClick,
  active = false,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded border border-border px-2 py-1 transition hover:bg-muted",
        active &&
          "border-amber-500/60 bg-amber-400/15 text-amber-600 dark:text-amber-200",
      )}
    >
      {children}
    </button>
  );
}
