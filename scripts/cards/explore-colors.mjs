#!/usr/bin/env node
/**
 * Exploration: AAA (≥ 7:1) text palettes for the card front.
 *
 *   node scripts/cards/explore-colors.mjs [art.jpg]
 *
 * Writes cards/explore/colors.png. Row 1 is the screen render. Row 2 is a rough
 * simulation of print on dark stock: ink spread thins light type (a slight blur)
 * and matte stock prints darker (brightness × 0.85).
 * Each label shows the lowest text contrast on the card background.
 *
 * Chosen 2026-10-04: B (one neutral secondary grey, #acacb4 = 7.9:1, small text at Jost 450).
 * The template now has a single `muted` secondary colour. Before, "faint" (#71717a) was
 * used for the data line and hint and failed at 3.7:1.
 */
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderFront, C, contrast, TEXT_COLORS as TEXT } from "./lib/front.mjs";
import { outline } from "./lib/outline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artPath = path.resolve(root, process.argv[2] ?? "cards/samples/origin-tunnel.jpg");
const artHref = `data:image/jpeg;base64,${(await readFile(artPath)).toString("base64")}`;
const sample = {
  id: "7c1e4b2a-9d3f-4e8a-b5c6-0f2d8a91e347", name: "Origin", creator: "aweborn",
  coords: "(0, 0, 0)", sector: "0:0:0", setName: "Origin Set", setNumber: "", arrival: "orbit", artHref,
};

const variants = [
  { label: "Before (fails)", colors: { muted: "#71717a" }, smallWght: 400 },
  { label: "A · lighter grey", colors: { muted: "#b4b4bc" }, smallWght: 450 },
  { label: "B · neutral grey (chosen)", colors: { muted: "#acacb4" }, smallWght: 450 },
  { label: "C · lavender grey", colors: { muted: "#b2abc1" }, smallWght: 450 },
];

const DPI = 200;
const mm = (v) => Math.round((v / 25.4) * DPI);
const [w, h, r, bleed, gap, labelH] = [mm(63), mm(88), mm(3), mm(3), mm(6), mm(9)];
const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`);
const label = async (text, color = "#a1a1aa") => {
  const t = outline(text, { font: "jost", wght: 400, size: 2.3, x: 0, y: 4, fill: color, maxWidth: 62 });
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${labelH}" viewBox="0 0 63 9">${t.svg}</svg>`)).resize(w, labelH).png().toBuffer();
};

const tiles = [];
for (const [i, v] of variants.entries()) {
  const pal = { ...C, ...v.colors };
  const min = Math.min(...TEXT.map((k) => contrast(pal[k], pal.bg)));
  const { svg } = renderFront(sample, { colors: v.colors, smallWght: v.smallWght, enforceAAA: false });
  const png = await sharp(Buffer.from(svg), { density: 144 }).resize(mm(69), mm(94)).png().toBuffer();
  const card = await sharp(png).extract({ left: bleed, top: bleed, width: w, height: h })
    .composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const print = await sharp(card).blur(0.7).modulate({ brightness: 0.85 })
    .composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const left = gap + i * (w + gap);
  tiles.push({ input: card, left, top: gap });
  tiles.push({ input: await label(`${v.label} · min ${min.toFixed(1)}:1 · wt ${v.smallWght}`, min >= 7 ? "#a1a1aa" : "#e07a7a"), left, top: gap + h + mm(1.5) });
  tiles.push({ input: print, left, top: gap * 2 + h + labelH });
  tiles.push({ input: await label("print simulation"), left, top: gap * 2 + h * 2 + labelH + mm(1.5) });
}

await mkdir(path.join(root, "cards/explore"), { recursive: true });
await sharp({ create: { width: gap + variants.length * (w + gap), height: gap * 2 + (h + labelH) * 2, channels: 4, background: "#0b0b0d" } })
  .composite(tiles).png().toFile(path.join(root, "cards/explore/colors.png"));
for (const v of variants) {
  const pal = { ...C, ...v.colors };
  console.log(v.label.padEnd(26), TEXT.map((k) => `${k} ${contrast(pal[k], pal.bg).toFixed(1)}`).join("  "));
}
console.log("Wrote cards/explore/colors.png");
