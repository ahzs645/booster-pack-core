import type { Rect, SheetLayout } from './layout';

export type FurnitureMode = 'procedural' | 'stretch' | 'none';
export type FitMode = 'cover' | 'contain';
/** Whether the artwork is a panel illustration or an entire pre-laid-out sheet. */
export type Placement = 'panel' | 'sheet';

export interface ArtTransform {
  /** Offset from the panel centre, in panel-widths / panel-heights. */
  dx: number;
  dy: number;
  /**
   * Multipliers on top of the fit scale, per axis. Independent so a source whose
   * proportions differ from the target's can be squeezed to match instead of only
   * scaled uniformly.
   */
  zoomX: number;
  zoomY: number;
  /** Degrees. */
  rotation: number;
}

export const DEFAULT_TRANSFORM: ArtTransform = {
  dx: 0,
  dy: 0,
  zoomX: 1,
  zoomY: 1,
  rotation: 0,
};

export interface CoverRecipe {
  art: HTMLImageElement | null;
  transform: ArtTransform;
  fit: FitMode;
  /** `panel` clips the art to the display face; `sheet` lays it over the whole wrap. */
  placement: Placement;
  /** Pre-stretch the artwork to cancel the wrap's non-uniform UV mapping. */
  aspectCorrect: boolean;
  furniture: FurnitureMode;
  /** Continue the artwork across the two blocks the reverse face samples. */
  wrapBack: boolean;
  /** Draw the crimp dashes and seam shading in procedural mode. */
  detail: boolean;
}

export const DEFAULT_RECIPE: Omit<CoverRecipe, 'art'> = {
  transform: DEFAULT_TRANSFORM,
  fit: 'cover',
  placement: 'panel',
  aspectCorrect: false,
  furniture: 'procedural',
  wrapBack: false,
  detail: true,
};

/** Average colour of an image, via a tiny downsample. Used to tint procedural furniture. */
export function samplePalette(img: HTMLImageElement, steps = 5): string[] {
  const N = 16;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, N, N);
  const { data } = g.getImageData(0, 0, N, N);

  // Bucket by luminance, then average each bucket, so the ramp spans dark to light.
  const buckets: Array<[number, number, number, number]> = Array.from({ length: steps }, () => [
    0, 0, 0, 0,
  ]);
  for (let i = 0; i < data.length; i += 4) {
    const [r, gg, b] = [data[i], data[i + 1], data[i + 2]];
    const lum = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255;
    const k = Math.min(steps - 1, Math.floor(lum * steps));
    buckets[k][0] += r;
    buckets[k][1] += gg;
    buckets[k][2] += b;
    buckets[k][3]++;
  }

  const out = buckets
    .filter((b) => b[3] > 0)
    .map((b) => `rgb(${(b[0] / b[3]) | 0} ${(b[1] / b[3]) | 0} ${(b[2] / b[3]) | 0})`);
  return out.length ? out : ['#2a2d36', '#8a8f9c'];
}

/** Scale that makes `img` cover (or fit inside) `rect`. */
function fitScale(img: HTMLImageElement, rect: Rect, mode: FitMode): number {
  const sx = rect.w / img.naturalWidth;
  const sy = rect.h / img.naturalHeight;
  return mode === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
}

function clipRect(g: CanvasRenderingContext2D, r: Rect) {
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
}

/**
 * Draws `art` into `rect` under the given transform.
 *
 * `panel` is the rect the transform is expressed relative to, which differs from
 * `rect` when the artwork is continued across the reverse face's blocks — there,
 * each block is a window onto the same virtual panel so the art stays continuous.
 */
function drawArt(
  g: CanvasRenderingContext2D,
  art: HTMLImageElement,
  rect: Rect,
  panel: Rect,
  t: ArtTransform,
  fit: FitMode,
  stretch = 1,
) {
  const scale = fitScale(art, panel, fit);
  // Split the correction across both axes so the artwork keeps roughly the area it
  // had — stretching X alone would push a third of the sheet out of frame.
  const k = Math.sqrt(stretch);
  g.save();
  clipRect(g, rect);
  g.translate(panel.x + panel.w / 2 + t.dx * panel.w, panel.y + panel.h / 2 + t.dy * panel.h);
  g.rotate((t.rotation * Math.PI) / 180);
  g.scale(scale * t.zoomX * k, (scale * t.zoomY) / k);
  g.drawImage(art, -art.naturalWidth / 2, -art.naturalHeight / 2);
  g.restore();
}

/**
 * The zoom that makes the artwork's drawn extent along one axis equal `target`.
 *
 * Used by the fit-to-panel actions: the source is scaled to the sheet, so matching
 * the display panel's height means solving for the multiplier rather than guessing.
 */
export function zoomToMatch(
  art: HTMLImageElement,
  layout: SheetLayout,
  recipe: Pick<CoverRecipe, 'fit' | 'placement' | 'aspectCorrect'>,
  axis: 'x' | 'y',
  target: Rect,
): number {
  const panel: Rect =
    recipe.placement === 'sheet'
      ? { x: 0, y: 0, w: layout.width, h: layout.height }
      : layout.front;
  const scale = fitScale(art, panel, recipe.fit);
  const k = Math.sqrt(recipe.aspectCorrect ? layout.stretch : 1);
  return axis === 'x'
    ? target.w / (scale * k * art.naturalWidth)
    : (target.h * k) / (scale * art.naturalHeight);
}

/** Foil-ish field: a diagonal ramp through the sampled palette plus soft streaks. */
function drawProceduralField(g: CanvasRenderingContext2D, L: SheetLayout, palette: string[]) {
  const ramp = g.createLinearGradient(0, 0, L.width, L.height);
  palette.forEach((c, i) => ramp.addColorStop(palette.length === 1 ? 0 : i / (palette.length - 1), c));
  g.fillStyle = ramp;
  g.fillRect(0, 0, L.width, L.height);

  g.save();
  g.globalCompositeOperation = 'overlay';
  for (let i = 0; i < 40; i++) {
    const x = (i / 40) * L.width * 1.6 - L.width * 0.3;
    g.strokeStyle = i % 2 ? 'rgb(255 255 255 / 6%)' : 'rgb(0 0 0 / 6%)';
    g.lineWidth = 6 + (i % 5) * 5;
    g.beginPath();
    g.moveTo(x, -20);
    g.lineTo(x + L.width * 0.35, L.height + 20);
    g.stroke();
  }
  g.restore();
}

/** The serrations that read as the crimped ends, drawn just inside the panels. */
function drawCrimpDashes(g: CanvasRenderingContext2D, L: SheetLayout) {
  const band = 16;
  const inner = [
    { y: L.front.y + 6, h: band },
    { y: L.front.y + L.front.h - band - 6, h: band },
  ];
  const x0 = Math.min(...L.back.map((r) => r.x), L.front.x);
  const x1 = Math.max(...L.back.map((r) => r.x + r.w), L.front.x + L.front.w);

  g.save();
  g.fillStyle = 'rgb(0 0 0 / 45%)';
  for (const { y, h } of inner) {
    for (let x = x0; x < x1; x += 8) g.fillRect(x, y, 4, h);
  }
  g.restore();
}

/** Soft darkening down the fold lines, so the seams read on the mesh. */
function drawSeams(g: CanvasRenderingContext2D, L: SheetLayout) {
  g.save();
  for (const s of L.seams) {
    const grad = g.createLinearGradient(s.x, 0, s.x + s.w, 0);
    grad.addColorStop(0, 'rgb(0 0 0 / 0%)');
    grad.addColorStop(0.5, 'rgb(0 0 0 / 38%)');
    grad.addColorStop(1, 'rgb(0 0 0 / 0%)');
    g.fillStyle = grad;
    g.fillRect(s.x, 0, s.w, L.height);
  }
  g.restore();
}

/**
 * Paints one 1024×512 cover sheet.
 *
 * Every rect comes from `readSheetLayout`, so the artwork lands on the pack's
 * display face without any hardcoded pixel bands.
 */
export function composeCover(
  canvas: HTMLCanvasElement,
  layout: SheetLayout,
  recipe: CoverRecipe,
): void {
  canvas.width = layout.width;
  canvas.height = layout.height;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, layout.width, layout.height);
  g.imageSmoothingQuality = 'high';

  // 1 — furniture: whatever fills the sheet behind the artwork
  if (recipe.furniture === 'stretch' && recipe.art) {
    // The artwork itself, stretched edge to edge and untransformed. Squeezing the
    // art exposes the sheet's outer bands; filling them from the same image keeps
    // the palette continuous instead of revealing a mismatched foil underneath.
    g.drawImage(recipe.art, 0, 0, layout.width, layout.height);
  } else if (recipe.furniture === 'procedural') {
    const palette = recipe.art ? samplePalette(recipe.art) : ['#14161d', '#3a3f4d'];
    drawProceduralField(g, layout, palette);
  }
  // 'none' leaves the sheet transparent.

  // 2 — artwork, either over the whole wrap or on the display face
  const stretch = recipe.aspectCorrect ? layout.stretch : 1;
  if (recipe.art && recipe.placement === 'sheet') {
    // An already-laid-out sheet: cover the full texture, no clipping and no seam
    // splitting — the source is assumed to carry its own front/back arrangement.
    const full: Rect = { x: 0, y: 0, w: layout.width, h: layout.height };
    drawArt(g, recipe.art, full, full, recipe.transform, recipe.fit, stretch);
  } else if (recipe.art) {
    drawArt(g, recipe.art, layout.front, layout.front, recipe.transform, recipe.fit, stretch);

    if (recipe.wrapBack) {
      // The reverse face is cut by the seams; treat each block as a window onto a
      // single virtual panel laid out left-to-right, so the art runs continuously.
      const total = layout.back.reduce((s, r) => s + r.w, 0);
      let consumed = 0;
      for (const block of layout.back) {
        const virtual: Rect = {
          x: block.x - consumed,
          y: block.y,
          w: total,
          h: block.h,
        };
        drawArt(g, recipe.art, block, virtual, recipe.transform, recipe.fit, stretch);
        consumed += block.w;
      }
    }
  }

  // 3 — procedural detailing sits above the art so the crimp reads on top of it
  if (recipe.furniture === 'procedural' && recipe.detail) {
    drawCrimpDashes(g, layout);
    drawSeams(g, layout);
  }

}
