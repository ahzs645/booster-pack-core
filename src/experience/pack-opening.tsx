"use client";

import { Canvas } from "@react-three/fiber";
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
import type { PackOpeningProps } from "./types";

const PHASE_HINTS: Partial<Record<PackPhase, string>> = {
  select: "Swipe or drag to browse · spin a pack or use the button to open",
  tear: "Swipe across the dotted line to tear the pack open",
  reveal: "Tap the stack to reveal the next card",
};

const PACK_COUNTS = [1, 5, 10] as const;

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
  onEvent,
}: PackOpeningProps = {}) {
  const [phase, setPhase] = useState<PackPhase>("select");
  const [packCount, setPackCount] = useState<number>(1);
  const [browseSkin, setBrowseSkin] = useState<PackSkin>(VARIANT_SKINS[0]);
  const [openedSkin, setOpenedSkin] = useState<PackSkin | null>(null);
  const [uploads, setUploads] = useState<PackSkin[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [packs, setPacks] = useState<PulledCard[][]>([]);
  const [packIndex, setPackIndex] = useState(0);
  const [remountKey, setRemountKey] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [forceChase, setForceChase] = useState(false);
  const [slowMo, setSlowMo] = useState(false);
  const showHud = useDebugHud(debug);
  const controls = useRef<PackSceneControls>({ timeScale: 1 });

  useEffect(() => {
    controls.current.timeScale = slowMo ? 0.25 : 1;
  }, [slowMo]);

  const startPacks = useCallback(
    (skin: PackSkin) => {
      setOpenedSkin(skin);
      setPacks(
        Array.from({ length: packCount }, () =>
          generatePack(
            forceChase,
            skin.kind === "cover" ? skin.packPool : undefined,
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
    const packPool =
      openedSkin?.kind === "cover" ? openedSkin.packPool : undefined;
    setPacks((prev) =>
      prev.map((p, i) =>
        i === packIndex ? generatePack(forceChase, packPool) : p,
      ),
    );
    setRevealedCount(0);
    setRemountKey((k) => k + 1);
    setPhase("tear");
  }, [packIndex, forceChase, openedSkin]);

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

  const skins = useMemo(
    () => [...VARIANT_SKINS, ...coverSkins(manifest), ...uploads],
    [manifest, uploads],
  );
  const browseSheet = useSkinTexture(browseSkin, layout);
  const openedSheet = useSkinTexture(skin, layout);

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

  return (
    <div
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
        >
          <Suspense fallback={null}>
            {phase === "select" ? (
              <PackCarousel
                assetBase={assetBase}
                variant={skinVariant(browseSkin)}
                sheet={browseSheet}
                onSelect={() => startPacks(browseSkin)}
              />
            ) : currentPack && variant ? (
              <PackExperience
                assetBase={assetBase}
                key={`${packIndex}-${remountKey}`}
                cards={currentPack}
                variant={variant}
                sheet={openedSheet}
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
      <style>{`
        @keyframes pack-flash { 0% { opacity: 0.9; } 100% { opacity: 0; } }
        @keyframes pack-card-in {
          0% { opacity: 0; transform: translateY(14px) scale(0.94); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {/* back out of an opening without the HUD — the bottom offsets keep the
          overlays clear of the fixed mobile nav, like the shell's pb-16 md:pb-0 */}
      {!showHud &&
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
      {PHASE_HINTS[phase] && (
        <p
          className={cn(
            "pointer-events-none absolute inset-x-4 text-center text-xs font-medium text-muted-foreground sm:text-sm",
            phase === "select" ? "bottom-64 sm:bottom-56" : "bottom-3",
          )}
        >
          {phase === "tear" && packs.length > 1
            ? `Tear once to open all ${packs.length} packs`
            : PHASE_HINTS[phase]}
        </p>
      )}

      {(phase === "tear" || phase === "reveal") && (
        <div className="absolute inset-x-4 bottom-10 z-10 flex justify-center">
          <button
            type="button"
            onClick={phase === "tear" ? handleTorn : handleAllRevealed}
            className="min-h-11 rounded-full border border-border bg-background/90 px-5 py-2.5 text-sm font-semibold shadow-sm backdrop-blur transition hover:bg-muted"
          >
            {phase === "tear" ? "Skip tear animation" : "Show all pulls"}
          </button>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {phase === "reveal" && currentPack
          ? `${revealedCount} of ${currentPack.length} cards revealed`
          : (PHASE_HINTS[phase] ?? `Pack opening phase: ${phase}`)}
      </p>

      {/* texture + pack count pickers on select screen */}
      {phase === "select" && (
        <div className="absolute inset-x-3 bottom-12 flex flex-col items-center gap-2 rounded-xl border border-border bg-background/85 p-2 shadow-lg backdrop-blur sm:bottom-10">
          <div className="flex w-full max-w-full gap-2 overflow-x-auto pb-1">
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
                    "min-h-10 shrink-0 rounded-full border border-border px-3 py-2 text-xs font-semibold transition",
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
                "min-h-10 cursor-pointer rounded-full border border-dashed border-border px-3 py-2 text-xs font-semibold transition hover:bg-muted",
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
          <div className="flex justify-center gap-2">
            {PACK_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPackCount(n)}
                className={cn(
                  "min-h-10 rounded-full border border-border px-4 py-2 text-sm font-semibold transition hover:bg-muted",
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
            type="button"
            onClick={() => startPacks(browseSkin)}
            className="min-h-11 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90"
          >
            Open {packCount === 1 ? "this pack" : `${packCount} packs`}
          </button>
        </div>
      )}

      {/* single-pack summary */}
      {phase === "summary" && currentPack && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 overflow-y-auto p-6 pb-24 md:pb-6">
          <h2 className="text-xl font-heading font-semibold text-foreground">
            Pack results
          </h2>
          <div className="flex flex-wrap items-start justify-center gap-4">
            {currentPack.map((card, i) => (
              <PackResultCard key={card.id} card={card} index={i} />
            ))}
          </div>
          <button
            type="button"
            onClick={backToSelect}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Open more packs
          </button>
        </div>
      )}

      {/* combined results across all packs */}
      {phase === "final" && (
        <div className="absolute inset-0 flex flex-col items-center gap-6 overflow-y-auto p-6 pb-24 md:pb-6">
          <h2 className="text-xl font-heading font-semibold text-foreground">
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
          <button
            type="button"
            onClick={backToSelect}
            className="mb-4 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Open more packs
          </button>
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
