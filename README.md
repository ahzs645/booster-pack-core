# Booster Pack Core

The booster pack itself — mesh, runtime cover composition, and the code that reads remote sheets — shared by
[booster-pack-studio](https://github.com/ahzs645/booster-pack-studio), which authors covers, and
TCGer, which opens packs wearing them.

It exists because the two were drifting: the studio wrapped a real 282-triangle mesh in one
1024×512 sheet, while TCGer painted two 512×768 canvases onto a procedural slab. Nothing an artist
made in one could be seen in the other. Everything that has to agree between them now lives here.

Consumed as a git submodule, not a published package. Source-only TypeScript — the consumer's
bundler compiles it, and `three` comes from the consumer as a peer.

## What's in it

```
src/
  types.ts       manifest shape — covers, bases, decals
  parseObj.ts    OBJ → non-indexed BufferGeometry, three verts per face
  layout.ts      panel / seam / crimp rects, read off the mesh rather than hardcoded
  uvFaces.ts     UV triangles, region classification, shell count
  splitMesh.ts   cuts the wrapper along a tear line
  manifest.ts    asset loading, re-anchored to whatever base path the app deploys under
  experience/    the pack-opening experience itself: carousel, tear, reveal, results
assets/pack/     the mesh, card back, and an empty local cover manifest
scripts/
  sync-assets.mjs   copy assets into a consuming app's public dir
  verify-assets.mjs reject published wrapper art or populated registries in Git
  verify-split.mjs  conservation checks on the splitter
```

## Consuming it

```bash
git submodule add https://github.com/ahzs645/booster-pack-core.git packages/pack-core
node packages/pack-core/scripts/sync-assets.mjs public
```

The sync step copies `assets/pack/` into the app's static directory, because neither Vite nor Next
serves files out of a submodule. Gitignore the copy and re-run it after every submodule bump.

Paths supplied by a remote `manifest.json` are root-absolute. Pass the app's asset origin or base
path to `loadManifest({ base })` and every URL is re-anchored. The bundled manifest intentionally
has empty cover, base, and decal registries: generated skins provide the offline fallback, while
published projected wrappers live in object storage instead of Git.

## Pack artwork rule

Published wrapper artwork must live in the `tcger-assets` R2 bucket, never in
this repository or an embedded consumer bundle. R2 objects use content-addressed
`/pack/objects/<sha256>.<ext>` keys with immutable caching; `/pack/manifest.json`
is the short-lived pointer that supplies the pack metadata and object URLs.

To publish studio exports, use the repository-level publisher:

```bash
npm run assets:r2:publish-pack-assets -- \
  --projected-dir "/path/to/projected exports" \
  --bucket tcger-assets \
  --wrangler
```

Do not add raster files under `assets/pack/covers`, `assets/pack/bases`, or
`assets/pack/decals`, and do not populate those registries in the bundled
manifest. `npm run verify-assets` enforces both requirements. Generated skins
remain the offline fallback when the remote manifest is unavailable.

## Opening styles

`PackOpening` has three, chosen with the `setOpeningMode` command or the built-in picker:

| Mode | What happens |
| --- | --- |
| `normal` | Draw a tear across the wrapper, then reveal the cards one at a time. |
| `quick` | No animation: straight to the results. |
| `burst` | The strip peels with the hand, the deck fires out of the wrapper, unwinds through a ring and lands face up in a row. |

Quick and burst apply to single packs. A bulk opening keeps its one-cut stack and grouped results
whichever is selected, so no host has to special-case it.

### Burst

```
src/experience/
  pack-burst-math.ts     springs, the rolled tear line, the unwind path, the table layout — no Three, no DOM
  pack-burst-effects.ts  the peel vertex patch, the torn metal edge, the fan of light
  pack-burst-sound.ts    every sound, synthesised with Web Audio
  pack-burst-scene.tsx   the scene: one simulation from first touch to cards on the table
```

It is a separate scene rather than a flag on `PackExperience`, so the classic flow is untouched.
What makes it feel different is mostly a handful of decisions:

- **Everything is a spring, not a tween.** `Spring(response, bounce)` drives the pack, the strip and
  every card, stepped at 240 Hz inside the frame. A gesture interrupted half way keeps its velocity,
  and a slow frame cannot destabilise a stiff spring.
- **The tear line is rolled, not drawn.** `rollTearLine` gives every pack its own climb, bow, wander
  and snags before the first touch. The mesh is split along it once, just after the pack appears
  (25–70 ms), so the gesture itself only moves a uniform — no re-split while the hand is moving.
- **The strip is bent in its vertex shader.** `splitGeometryByCut` still does the cutting; the strip
  half then carries each vertex behind the tear tip along a curve whose curvature grows with distance
  from the tip, so it rolls up instead of hinging like a door. A tear only moves forward: let go
  before 55% and the strip relaxes where it is, past that it finishes by itself. A press with no drag
  tears it for you.
- **Cards land on a path that is a pure function of time.** Once the deck clears the wrapper,
  `orbitPose` owns each card until it reaches its slot, so every card arrives exactly in place
  whatever the frame rate. Springs take over again only once it has landed.
- **Hover is judged against where cards rest, not where they are.** `slotAt` hit-tests the layout, so
  a card that lifts and tilts under the pointer cannot slide out from under it and flicker, and each
  visible sliver of an overlapped row is its own target.
- **Cards are layered by draw order, not depth.** Overlapping cards can tilt freely without cutting
  through each other; they still write depth, which is what hides the wrapper's back panel behind
  the deck while it is inside.
- **`fanLayout` picks the rows.** One row with gaps when there is room, a hand of overlapping cards
  when there is not, more rows on a tall screen — scored by card size and how much of each card
  stays visible, for 5-card and 11-card packs alike.
- **Sound follows the hand.** The tear is a loop held at silence whose level tracks tear speed, so a
  slow pull is single crackles and a flick is one rip. Everything tonal shares a pentatonic scale.
  Nothing plays before the first press; `soundMuted` or the `setSoundMuted` command silences it.

The fanned cards are pixels in a canvas, so `PackOpening` mirrors them as a visually hidden list:
focusing an entry lifts that card (`controls.focusCard`), arrow keys walk the row, and activating one
emits `inspectRequested` — the same event a click or second tap on a card sends. Under
`prefers-reduced-motion` the pack opens and the cards are simply placed.

Hosts with native controls need no new plumbing: the phases are the existing ones, `revealedCount`
equals `totalCards` as soon as the cards land, and `advance` during the reveal moves on to the
summary. `npm run verify-burst` checks the springs, tear line, layout and unwind under plain Node.

## Tearing the pack

TCGer lets you tear the wrapper along the path you drag. Its old slab was subdivided plane geometry,
so the cut could be baked into vertex positions; a fixed mesh can't do that, so `splitGeometryByCut`
severs it at render time:

```ts
const { below, above, seam } = splitGeometryByCut(geometry, (x) => tearY + Math.sin(x * 1.4) * 0.35);
```

Triangles wholly on one side pass through untouched; the ones the cut crosses are severed with new
vertices interpolated across position, uv and normal, so the cover sheet stays continuous to the torn
edge and both halves keep the original's winding. `seam` is the severed boundary as line segments —
build the tear's glow from that rather than re-deriving it, and it stays on the edge around the
pack's sides too.

Two separate things have to be right, and they need different fixes:

- **Which side a vertex ends up on.** Crossings are found by bisecting the real cut function, not by
  interpolating the corner distances — so a crossing lands on the cut exactly however coarse the
  triangle. Measured overshoot is ~2e-7 mesh units on every cut tested.
- **How closely the torn edge follows the curve.** Within one triangle the cut is drawn as a chord,
  and the shipped mesh's median triangle spans 0.87 of a 4.55-wide pack — about five across the
  face. So the mesh is refined first, uniformly (1→4 on edge midpoints, which leaves no T-junctions
  and therefore no hairline cracks), to the coarsest level at which the cut stays within tolerance
  of straight across one triangle. A straight perforation needs no refinement at all and stays at
  282 triangles; a drawn tear goes to level 3, 18k triangles and ~280 seam segments. Refined copies
  are cached per level, so dragging a new tear path re-splits but never re-refines.

`npm run verify-split` checks, over a straight perforation, three drawn tears, a diagonal, and cuts
that miss the mesh entirely, that surface area is conserved to 1e-8, that no vertex sits on the wrong
side, and that the seam closes with no open ends.
