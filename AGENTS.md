# Pack-core asset rule

- Never commit projected/generated pack wrapper artwork to this package or copy
  it into a consumer bundle.
- Publish wrapper images with the repository's
  `assets:r2:publish-pack-assets` command. Assets must use content-addressed
  `/pack/objects/<sha256>.<ext>` R2 keys and be referenced through the remote
  `/pack/manifest.json`.
- Keep `assets/pack/manifest.json` cover, base, and decal registries empty. The
  local asset tree may contain the shared mesh and generic card back only.
- Run `npm run verify-assets` and `npm run typecheck` after pack-core changes.
- If R2 is unavailable, use generated wrapper skins as the fallback; do not add
  bundled copies of published cover art.
