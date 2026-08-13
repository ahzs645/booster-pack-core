import type { SheetLayout } from "../index";
import * as THREE from "three";

import type { PackVariant } from "./pack-data";

export interface PackSheetMetadata {
  setName: string;
  variationName: string;
  cardCount: number;
}

/**
 * Paints a variant as a wrap sheet.
 *
 * The old painter drew a 512×768 face and TCGer wore two of them, one per side of
 * a slab. The pack is now the real mesh, which samples a single 1024×512 sheet
 * laid out `[back | FRONT | back]`, so a variant has to be painted into that
 * instead — into the rects `readSheetLayout` reads off the mesh, never hardcoded
 * bands, so a re-authored UV layout keeps working.
 *
 * The result is interchangeable with the sheets the studio exports: same size,
 * same layout, same mesh. A variant is just a sheet nobody had to draw.
 */

/**
 * The wrap's UVs are not area-preserving — a texture pixel lands wider than tall
 * on the display face — so anything that should read as a circle or as upright
 * text is pre-stretched to cancel it. `layout.stretch` is measured from the mesh.
 * Abstract motifs skip this; only the emblem and the wordmark care.
 */
function withAspect(
  ctx: CanvasRenderingContext2D,
  layout: SheetLayout,
  cx: number,
  cy: number,
  draw: () => void,
) {
  const k = Math.sqrt(layout.stretch);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(k, 1 / k);
  ctx.translate(-cx, -cy);
  draw();
  ctx.restore();
}

function drawMotif(
  ctx: CanvasRenderingContext2D,
  variant: PackVariant,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const { motif, palette } = variant;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x, y);

  if (motif === "aurora") {
    for (let i = 0; i < 5; i++) {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "rgba(64,224,208,0)");
      g.addColorStop(0.5, `rgba(${80 + i * 30},${200 - i * 20},255,0.12)`);
      g.addColorStop(1, "rgba(64,224,208,0)");
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-0.5 + i * 0.22);
      ctx.fillRect(-w, -40 - i * 26, w * 2, 60);
      ctx.restore();
    }
  } else if (motif === "flame") {
    for (let i = 0; i < 7; i++) {
      const cx = (0.12 + i * 0.13) * w;
      const base = h * (0.78 + (i % 2) * 0.05);
      const fh = h * (0.22 + (i % 3) * 0.08);
      const grad = ctx.createLinearGradient(0, base, 0, base - fh);
      grad.addColorStop(0, "rgba(255,80,20,0.05)");
      grad.addColorStop(0.6, "rgba(255,140,40,0.22)");
      grad.addColorStop(1, "rgba(255,220,120,0.05)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx - 26, base);
      ctx.bezierCurveTo(cx - 30, base - fh * 0.45, cx + 18, base - fh * 0.5, cx, base - fh);
      ctx.bezierCurveTo(cx + 34, base - fh * 0.45, cx + 26, base, cx + 26, base);
      ctx.closePath();
      ctx.fill();
    }
  } else if (motif === "wave") {
    for (let i = 0; i < 4; i++) {
      const amp = h * (0.05 + i * 0.012);
      const yy = h * (0.3 + i * 0.16);
      ctx.strokeStyle = `rgba(160,230,255,${0.16 - i * 0.025})`;
      ctx.lineWidth = 14 + i * 5;
      ctx.beginPath();
      for (let px = 0; px <= w; px += 8) {
        const py = yy + Math.sin((px / w) * Math.PI * 3 + i) * amp;
        if (px === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  } else {
    // leaf
    for (let i = 0; i < 9; i++) {
      const cx = (0.1 + (i % 3) * 0.34) * w;
      const cy = (0.18 + Math.floor(i / 3) * 0.3) * h;
      const r = w * 0.13;
      ctx.fillStyle = `rgba(150,255,170,${0.06 + (i % 3) * 0.02})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.45, (i * Math.PI) / 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = `${palette.accent}0d`;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Fine ridges along the strips the mesh's crimped ends sample. */
function drawCrimps(ctx: CanvasRenderingContext2D, layout: SheetLayout, variant: PackVariant) {
  // The crimp rects are only a couple of pixels tall — the physical fold is thin —
  // so the visible band is grown around them rather than drawn at their exact
  // height, where it would vanish.
  const band = layout.height * 0.05;
  for (const crimp of layout.crimps) {
    const y0 = Math.max(0, crimp.y + crimp.h / 2 - band / 2);
    for (let x = 0; x < layout.width; x += 4) {
      const lum = 150 + Math.sin(x * 1.1) * 22 + Math.random() * 12;
      ctx.fillStyle = `rgb(${lum},${lum},${lum + 8})`;
      ctx.fillRect(x, y0, 4, band);
    }
    ctx.fillStyle = `${variant.palette.mid}44`;
    ctx.fillRect(0, y0, layout.width, band);
    for (let yy = y0 + 3; yy < y0 + band; yy += 6) {
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(0, yy, layout.width, 1);
    }
  }
}

/** Soft darkening down the fold lines, so the pack's edges read as edges. */
function drawSeams(ctx: CanvasRenderingContext2D, layout: SheetLayout) {
  for (const s of layout.seams) {
    const grad = ctx.createLinearGradient(s.x, 0, s.x + s.w, 0);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.38)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(s.x, 0, s.w, layout.height);
  }
}

export function paintVariantSheet(
  variant: PackVariant,
  layout: SheetLayout,
  metadata?: PackSheetMetadata,
): THREE.CanvasTexture {
  const { width, height } = layout;
  const { palette } = variant;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  // The gradient runs down the sheet, which is down the pack: the sheet's y axis
  // is the pack's height on every panel, front and back alike.
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, palette.top);
  sky.addColorStop(0.45, palette.mid);
  sky.addColorStop(1, palette.bottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  drawMotif(ctx, variant, layout.front.x, layout.front.y, layout.front.w, layout.front.h);
  for (const block of layout.back) {
    drawMotif(ctx, variant, block.x, block.y, block.w, block.h);
  }

  for (let i = 0; i < 90; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const r = Math.random() * 1.4 + 0.3;
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.35 + 0.08})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- display face furniture -------------------------------------------------
  const f = layout.front;
  const cx = f.x + f.w / 2;
  const emblemY = f.y + f.h * 0.46;
  // Sized off the panel's width, at the same fraction the old 512-wide face used
  // (150px of 512). Taking it off the width matters: the display panel is 367×468
  // where the old canvas was 512×768, so a radius keyed to height would grow the
  // emblem by half and swamp the wordmark.
  const emblemR = f.w * 0.293;

  withAspect(ctx, layout, cx, emblemY, () => {
    const emblem = ctx.createRadialGradient(cx, emblemY, emblemR * 0.07, cx, emblemY, emblemR);
    emblem.addColorStop(0, "rgba(255,255,255,0.7)");
    emblem.addColorStop(0.35, `${palette.accent}55`);
    emblem.addColorStop(1, `${palette.accent}00`);
    ctx.fillStyle = emblem;
    ctx.beginPath();
    ctx.arc(cx, emblemY, emblemR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, emblemY, f.w * 0.1875, 0, Math.PI * 2);
    ctx.stroke();
  });

  ctx.textAlign = "center";
  withAspect(ctx, layout, cx, f.y + f.h * 0.5, () => {
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(f.w * 0.18)}px system-ui, sans-serif`;
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = 24;
    ctx.fillText("TCGer", cx, f.y + f.h * 0.26);
    ctx.shadowBlur = 0;
    ctx.font = `700 ${Math.round(f.w * 0.067)}px system-ui, sans-serif`;
    ctx.fillStyle = palette.accent;
    ctx.fillText(
      (metadata?.setName ?? variant.name).toUpperCase(),
      cx,
      f.y + f.h * 0.325,
    );
    ctx.font = `600 ${Math.round(f.w * 0.055)}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(
      (metadata?.variationName ?? "Demo booster").toUpperCase(),
      cx,
      f.y + f.h * 0.64,
    );
    ctx.font = `500 ${Math.round(f.w * 0.041)}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(
      metadata
        ? `${metadata.cardCount} CARDS · ${metadata.setName.toUpperCase()} POOL`
        : "5 CARDS · EVOLVING SKIES POOL",
      cx,
      f.y + f.h * 0.895,
    );
  });

  // Reverse face gets the wordmark only, like the back of a real wrapper.
  for (const block of layout.back) {
    ctx.font = `600 ${Math.round(block.h * 0.055)}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText(
      `TCGer · ${(metadata?.setName ?? variant.name).toUpperCase()}`,
      block.x + block.w / 2,
      block.y + block.h * 0.5,
    );
  }

  drawSeams(ctx, layout);
  drawCrimps(ctx, layout, variant);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
