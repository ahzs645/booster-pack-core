import type * as THREE from 'three';
import { parseObj } from './parseObj';
import type { Manifest } from './types';

const cache = new Map<string, Promise<unknown>>();

/**
 * Where the pack assets are served from, relative to the site root.
 *
 * Remote manifests store root-absolute paths like `/pack/objects/hash.png`, which
 * only resolve when the app is served from the asset origin. Consumers deploy
 * under a prefix at least some of the time — a GitHub project page lives at
 * `/<repo>/`, and TCGer's static demo export honours `basePath` — so every path is
 * re-anchored to a base the app supplies.
 */
export interface AssetBase {
  /** e.g. Vite's `import.meta.env.BASE_URL`, or Next's `basePath`. Defaults to the root. */
  base?: string;
}

export function asset(path: string, base = ''): string {
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  return base.replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`);
}

/** Fetch once per URL and hand the same promise to every caller, so `use()` can suspend on it. */
function once<T>(url: string, load: (url: string) => Promise<T>): Promise<T> {
  let p = cache.get(url) as Promise<T> | undefined;
  if (!p) {
    p = load(url);
    cache.set(url, p);
  }
  return p;
}

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  // WKURLSchemeHandler-backed fetches are valid but WebKit exposes them with
  // status 0 because they have no HTTP status line.
  if (!r.ok && r.status !== 0) throw new Error(`${url} → ${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

/** Re-anchors every URL the manifest carries, so callers never think about the base path. */
export function resolveManifest(m: Manifest, base = ''): Manifest {
  const map = (r: Record<string, string>) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, asset(v, base)]));
  return {
    ...m,
    mesh: asset(m.mesh, base),
    covers: Object.fromEntries(
      Object.entries(m.covers).map(([k, c]) => [
        k,
        { ...c, plain: asset(c.plain, base), decaled: asset(c.decaled, base) },
      ]),
    ),
    bases: map(m.bases),
    decals: map(m.decals),
  };
}

export const MANIFEST_PATH = '/pack/manifest.json';

export function loadManifest({ base = '', path = MANIFEST_PATH } = {}) {
  return once(asset(path, base), (url) => json<Manifest>(url).then((m) => resolveManifest(m, base)));
}

export const loadGeometry = (url: string): Promise<THREE.BufferGeometry> =>
  once(`geo:${url}`, async () => {
    const r = await fetch(url);
    if (!r.ok && r.status !== 0) throw new Error(`${url} → ${r.status} ${r.statusText}`);
    return parseObj(await r.text());
  });

/** Fetches the raw OBJ text, for exporters that re-emit the mesh rather than render it. */
export const loadMeshSource = (url: string): Promise<string> =>
  once(`obj:${url}`, async () => {
    const r = await fetch(url);
    if (!r.ok && r.status !== 0) throw new Error(`${url} → ${r.status} ${r.statusText}`);
    return r.text();
  });
