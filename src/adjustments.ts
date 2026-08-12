import {
  DEFAULT_RECIPE,
  DEFAULT_TRANSFORM,
  type ArtTransform,
  type FitMode,
  type FurnitureMode,
  type Placement,
} from './composeCover';

/** Everything that turns a dropped image into the exported sheet. */
export interface Adjustments {
  placement: Placement;
  fit: FitMode;
  aspectCorrect: boolean;
  transform: ArtTransform;
  furniture: FurnitureMode;
  wrapBack: boolean;
  detail: boolean;
}

export interface Row {
  label: string;
  value: string;
  /** Differs from the value you would get by dropping an image and touching nothing. */
  changed: boolean;
}

function furnitureLabel(a: Adjustments): string {
  switch (a.furniture) {
    case 'procedural':
      return `procedural${a.detail ? ' + crimp/seams' : ''}`;
    case 'stretch':
      return 'artwork, stretched';
    case 'none':
      return 'nothing (transparent)';
  }
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(Math.round(n * 1000) / 10)}%`;

/**
 * A human-readable account of what was done to the source, with everything left
 * at its default marked as unchanged — so the list reads as "these are the edits".
 */
export function describe(a: Adjustments, stretch = 1): Row[] {
  const t = a.transform;
  const d = DEFAULT_TRANSFORM;
  const rows: Row[] = [
    {
      label: 'Artwork is',
      value: a.placement === 'sheet' ? 'a whole sheet' : 'panel art',
      changed: a.placement !== DEFAULT_RECIPE.placement,
    },
    {
      label: 'Fit',
      value: a.fit === 'cover' ? 'cover' : 'fit inside',
      changed: a.fit !== DEFAULT_RECIPE.fit,
    },
    {
      label: 'Pack stretch',
      value: a.aspectCorrect ? `corrected ${stretch.toFixed(2)}×` : 'raw',
      changed: a.aspectCorrect !== DEFAULT_RECIPE.aspectCorrect,
    },
    {
      label: 'Scale',
      value:
        t.zoomX === t.zoomY
          ? pct(t.zoomX)
          : `${pct(t.zoomX)} × ${pct(t.zoomY)} · squeezed ${(t.zoomX / t.zoomY).toFixed(2)}:1`,
      changed: t.zoomX !== d.zoomX || t.zoomY !== d.zoomY,
    },
    {
      label: 'Offset',
      value: `${signed(t.dx)}, ${signed(t.dy)}`,
      changed: t.dx !== d.dx || t.dy !== d.dy,
    },
    {
      label: 'Rotation',
      value: `${Math.round(t.rotation)}°`,
      changed: t.rotation !== d.rotation,
    },
    {
      label: 'Furniture',
      value: furnitureLabel(a),
      changed: a.furniture !== DEFAULT_RECIPE.furniture,
    },
  ];

  if (a.placement === 'panel') {
    rows.push({
      label: 'Wrap to back',
      value: a.wrapBack ? 'on' : 'off',
      changed: a.wrapBack !== DEFAULT_RECIPE.wrapBack,
    });
  }

  return rows;
}

export const toJSON = (a: Adjustments): string => JSON.stringify(a, null, 2);

/**
 * Parses a settings blob back into adjustments, keeping only fields of the right
 * shape so hand-edited or truncated JSON cannot produce a broken canvas.
 */
export function fromJSON(text: string): Partial<Adjustments> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const out: Partial<Adjustments> = {};

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

  if (o.placement === 'panel' || o.placement === 'sheet') out.placement = o.placement;
  if (o.fit === 'cover' || o.fit === 'contain') out.fit = o.fit;
  if (o.furniture === 'procedural' || o.furniture === 'stretch' || o.furniture === 'none') {
    out.furniture = o.furniture;
  }
  if (typeof o.aspectCorrect === 'boolean') out.aspectCorrect = o.aspectCorrect;
  if (typeof o.wrapBack === 'boolean') out.wrapBack = o.wrapBack;
  if (typeof o.detail === 'boolean') out.detail = o.detail;

  if (o.transform && typeof o.transform === 'object') {
    const t = o.transform as Record<string, unknown>;
    out.transform = {
      dx: num(t.dx) ?? DEFAULT_TRANSFORM.dx,
      dy: num(t.dy) ?? DEFAULT_TRANSFORM.dy,
      zoomX: num(t.zoomX) ?? DEFAULT_TRANSFORM.zoomX,
      zoomY: num(t.zoomY) ?? DEFAULT_TRANSFORM.zoomY,
      rotation: num(t.rotation) ?? DEFAULT_TRANSFORM.rotation,
    };
  }

  return out;
}
