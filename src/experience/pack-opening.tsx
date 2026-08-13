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
import { generatePack, tierRank, type PulledCard } from "./pack-data";
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
  PackOpeningNativeCommand,
  PackOpeningProps,
  PackOpeningPullSession,
} from "./types";

const PHASE_HINTS: Partial<Record<PackPhase, string>> = {
  select: "Swipe or drag to browse · spin a pack or use the button to open",
  tear: "Swipe across the dotted line to tear the pack open",
  reveal: "Reveal cards one at a time or show all pulls",
};

const PACK_COUNTS = [1, 5, 10] as const;

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
  onEvent,
}: PackOpeningProps = {}) {
  const [phase, setPhase] = useState<PackPhase>("select");
  const [packCount, setPackCount] = useState<number>(1);
  const [browseSkin, setBrowseSkin] = useState<PackSkin>(VARIANT_SKINS[0]);
  const [openedSkin, setOpenedSkin] = useState<PackSkin | null>(null);
  const [uploads, setUploads] = useState<PackSkin[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [artworkWarning, setArtworkWarning] = useState<string | null>(null);
  const [packs, setPacks] = useState<PulledCard[][]>([]);
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

  useEffect(() => {
    controls.current.timeScale = slowMo ? 0.25 : 1;
  }, [slowMo]);

  useEffect(() => {
    controls.current.reducedMotion = prefersReducedMotion;
  }, [prefersReducedMotion]);

  const startPacks = useCallback(
    (skin: PackSkin) => {
      setArtworkWarning(null);
      setOpeningID(
        globalThis.crypto?.randomUUID?.() ??
          `opening-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      setOpenedAt(new Date().toISOString());
      setOpenedSkin(skin);
      setPacks(
        Array.from({ length: packCount }, () =>
          generatePack(
            forceChase,
            skin.packPool,
          ),
        ),
      );
      setPackIndex(0);
      setRevealedCount(0);
      setRemountKey((k) => k + 1);
      setPhase("tear");
    },
    [packCount, forceChase],
  );

  const rerollCurrent = useCallback(() => {
    setOpeningID(
      globalThis.crypto?.randomUUID?.() ??
        `opening-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    setOpenedAt(new Date().toISOString());
    const packPool = openedSkin?.packPool;
    setPacks((prev) =>
      prev.map((p, i) =>
        i === packIndex ? generatePack(forceChase, packPool) : p,
      ),
    );
    setRevealedCount(0);
    setRemountKey((k) => k + 1);
    setPhase("tear");
  }, [packIndex, forceChase, openedSkin]);

  const requestSave = useCallback(() => {
    if (!openingID || packs.length === 0) return;
    const session: PackOpeningPullSession = {
      id: openingID,
      packLabel: openedSkin?.label ?? "Booster pack",
      openedAt,
      packs: packs.map((pack) =>
        pack.map((card) => ({
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
      ),
    };
    onEvent?.({ type: "saveRequested", session });
  }, [openedAt, openedSkin?.label, openingID, onEvent, packs]);

  const completedSession = useMemo<PackOpeningPullSession | undefined>(() => {
    if (!openingID || packs.length === 0) return undefined;
    return {
      id: openingID,
      packLabel: openedSkin?.label ?? "Booster pack",
      openedAt,
      packs: packs.map((pack) =>
        pack.map((card) => ({
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
      ),
    };
  }, [openedAt, openedSkin?.label, openingID, packs]);

  const backToSelect = useCallback(() => {
    setPhase("select");
    setPacks([]);
    setOpenedSkin(null);
    setPackIndex(0);
    setRevealedCount(0);
  }, []);

  const handleTorn = useCallback(() => {
    onEvent?.({ type: "haptic", style: "impact" });
    setPhase("opening");
  }, [onEvent]);
  // Bulk opens skip the card-by-card ritual: one tear, all results at once,
  // matching the reference app's multi-pack flow.
  const handleOpened = useCallback(() => {
    if (packs.length > 1) {
      setPhase("final");
    } else {
      setPhase("reveal");
      setRevealedCount(1);
    }
  }, [packs.length]);
  const handleReveal = useCallback(
    (count: number) => setRevealedCount(count),
    [],
  );
  const handleAllRevealed = useCallback(() => {
    onEvent?.({ type: "haptic", style: "success" });
    setPhase("summary");
  }, [onEvent]);
  const handleFlash = useCallback(() => {
    onEvent?.({ type: "haptic", style: "selection" });
    setFlashKey((k) => k + 1);
  }, [onEvent]);

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
  const revealed = currentPack ? currentPack.slice(0, revealedCount) : [];
  const canvasVisible =
    phase === "select" ||
    phase === "tear" ||
    phase === "opening" ||
    phase === "reveal";

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
          else if (phase === "reveal") controls.current.revealNext?.();
          break;
        case "showAll":
          if (phase === "reveal") handleAllRevealed();
          break;
        case "savePulls":
          requestSave();
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
    handleAllRevealed,
    handleTorn,
    layout,
    nativeControls,
    phase,
    requestSave,
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
        packOptions: skins.map(
          ({ id, label, setID, setLabel, variationLabel }) => ({
            id,
            label,
            setID,
            setLabel,
            variationLabel,
          }),
        ),
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
    nativeControls,
    onEvent,
    packCount,
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
          ? "h-dvh min-h-0 rounded-none border-0"
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
                onSelect={() => startPacks(browseSkin)}
              />
            ) : currentPack && variant ? (
              <PackExperience
                assetBase={assetBase}
                key={`${packIndex}-${remountKey}`}
                cards={currentPack}
                variant={variant}
                sheet={openingSheet}
                packCount={packs.length}
                phase={phase}
                controls={controls}
                onTorn={handleTorn}
                onOpened={handleOpened}
                onReveal={handleReveal}
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
      {!nativeControls && PHASE_HINTS[phase] && (
        <p
          className={cn(
            "pointer-events-none absolute left-1/2 z-10 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full border border-border bg-background/85 px-3 py-1.5 text-center text-xs font-medium text-muted-foreground shadow-sm backdrop-blur sm:text-sm",
            phase === "select"
              ? "bottom-[9.25rem] sm:bottom-56"
              : phase === "tear" || phase === "reveal"
                ? "bottom-24"
                : "bottom-3",
          )}
        >
          {phase === "tear" && packs.length > 1
            ? `Tear once to open all ${packs.length} packs`
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
                : () => controls.current.revealNext?.()
            }
            aria-label={
              phase === "reveal"
                ? currentPack && revealedCount >= currentPack.length
                  ? "Finish reveal"
                  : "Reveal next card"
                : undefined
            }
            className="min-h-11 rounded-full border border-border bg-background/90 px-4 py-2.5 text-sm font-semibold shadow-sm backdrop-blur transition hover:bg-muted"
          >
            {phase === "tear"
              ? prefersReducedMotion
                ? "Open pack"
                : "Skip tear animation"
              : currentPack && revealedCount >= currentPack.length
                ? "Finish reveal"
                : "Reveal next"}
          </button>
          {phase === "reveal" && (
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
        {phase === "reveal" && currentPack
          ? `${revealedCount} of ${currentPack.length} cards revealed`
          : (PHASE_HINTS[phase] ?? `Pack opening phase: ${phase}`)}
      </p>

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
