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
