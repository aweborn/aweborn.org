#!/usr/bin/env node
/**
 * Exploration: card-back wordmark + line colours (the mark stays the favicon palette).
 *
 *   node scripts/cards/explore-back-colors.mjs
 *
 * Writes cards/explore/back-colors.png. Each label shows the lowest wordmark
 * contrast across the vignette.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderBack, wordmarkContrast } from "./lib/back.mjs";
import { outline } from "./lib/outline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const variants = [
  { label: "Before · lavender + navy lines", o: { ink: "#c9b7d6" } },
  { label: "1 · silver + neutral lines", o: { ink: "#d4d4d8", frame: "#3f3f46", ring: "#2e2e33" } },
  { label: "2 · silver + navy lines", o: { ink: "#d4d4d8" } },
  { label: "3 · warm ivory", o: { ink: "#ebe3d3", frame: "#46413a", ring: "#302d28" } },
  { label: "4 · soft gold", o: { ink: "#dcc47e", frame: "#4a4331", ring: "#312c21" } },
  { label: "5 · steel blue", o: { ink: "#a9c1da", frame: "#34465c", ring: "#263240" } },
  { label: "6 · steel blue + navy lines (final)", o: {} },
];

const DPI = 200;
const mm = (v) => Math.round((v / 25.4) * DPI);
const [w, h, r, bleed, gap, labelH] = [mm(63), mm(88), mm(3), mm(3), mm(6), mm(9)];
const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`);
const cols = 3;

const tiles = [];
for (const [i, v] of variants.entries()) {
  const png = await sharp(Buffer.from(renderBack(v.o)), { density: 144 }).resize(mm(69), mm(94)).png().toBuffer();
  const card = await sharp(png).extract({ left: bleed, top: bleed, width: w, height: h })
    .composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const [cx, cy] = [i % cols, Math.floor(i / cols)];
  const left = gap + cx * (w + gap);
  const top = gap + cy * (h + labelH + gap);
  tiles.push({ input: card, left, top });
  const t = outline(`${v.label} · ${wordmarkContrast(v.o).toFixed(1)}:1`, { font: "jost", wght: 400, size: 2.3, x: 0, y: 4, fill: "#a1a1aa", maxWidth: 62 });
  const lsvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${labelH}" viewBox="0 0 63 9">${t.svg}</svg>`;
  tiles.push({ input: await sharp(Buffer.from(lsvg)).resize(w, labelH).png().toBuffer(), left, top: top + h + mm(1.5) });
}

await mkdir(path.join(root, "cards/explore"), { recursive: true });
const rows = Math.ceil(variants.length / cols);
await sharp({ create: { width: gap + cols * (w + gap), height: gap + rows * (h + labelH + gap), channels: 4, background: "#0b0b0d" } })
  .composite(tiles).png().toFile(path.join(root, "cards/explore/back-colors.png"));
console.log("Wrote cards/explore/back-colors.png");
