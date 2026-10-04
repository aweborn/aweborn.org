#!/usr/bin/env node
/**
 * Exploration: number typeface + set-number format on the Origin front.
 *
 *   node scripts/cards/explore-numbers.mjs [art.jpg]
 *
 * Writes cards/explore/numbers.png (row of trimmed fronts, labelled below).
 */
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderFront } from "./lib/front.mjs";
import { outline } from "./lib/outline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artPath = path.resolve(root, process.argv[2] ?? "cards/samples/origin-tunnel.jpg");
const artHref = `data:image/jpeg;base64,${(await readFile(artPath)).toString("base64")}`;

const base = {
  id: "7c1e4b2a-9d3f-4e8a-b5c6-0f2d8a91e347",
  name: "Origin", creator: "aweborn", coords: "(0, 0, 0)", sector: "0:0:0",
  setName: "Origin Set", arrival: "orbit", artHref,
};
const variants = [
  { label: "A · JetBrains Mono · 001 / 001 (current)", setNumber: "001 / 001", numbers: "jetbrains" },
  { label: "B · Jost mono · 001 / 001", setNumber: "001 / 001" },
  { label: "C · Jost mono · 1 / 1", setNumber: "1 / 1" },
  { label: "D · Jost mono · no. 1", setNumber: "no. 1" },
  { label: "E · Jost mono · none", setNumber: "" },
];

const DPI = 200;
const mm = (v) => Math.round((v / 25.4) * DPI);
const [w, h, r, bleed, gap, labelH] = [mm(63), mm(88), mm(3), mm(3), mm(6), mm(8)];
const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`);

const tiles = [];
for (const [i, v] of variants.entries()) {
  const { svg } = renderFront({ ...base, setNumber: v.setNumber }, { numbers: v.numbers });
  const png = await sharp(Buffer.from(svg), { density: 144 }).resize(mm(69), mm(94)).png().toBuffer();
  const card = await sharp(png).extract({ left: bleed, top: bleed, width: w, height: h })
    .composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const left = gap + i * (w + gap);
  tiles.push({ input: card, left, top: gap });
  const lbl = outline(v.label, { font: "jost", wght: 400, size: 2.4, x: 0, y: 4, fill: "#a1a1aa", maxWidth: 62 });
  const lsvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${labelH}" viewBox="0 0 63 8">${lbl.svg}</svg>`;
  tiles.push({ input: await sharp(Buffer.from(lsvg)).resize(w, labelH).png().toBuffer(), left, top: gap * 2 + h - mm(3) });
}

await mkdir(path.join(root, "cards/explore"), { recursive: true });
await sharp({ create: { width: gap + variants.length * (w + gap), height: h + gap * 2 + labelH, channels: 4, background: "#0b0b0d" } })
  .composite(tiles).png().toFile(path.join(root, "cards/explore/numbers.png"));
console.log("Wrote cards/explore/numbers.png");
