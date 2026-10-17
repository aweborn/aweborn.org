#!/usr/bin/env node
/**
 * QR style exploration: render the Origin front with several QR treatments,
 * stress-test each one with jsQR (resolution, blur, print dot-gain/loss,
 * rotation), and write a comparison sheet.
 *
 *   node scripts/cards/explore-qr.mjs   →  cards/explore/qr-styles.png
 */
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import jsQR from "jsqr";
import { renderFront } from "./lib/front.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, "cards/explore");
const ID = "5949dfc5-3a9b-46b7-a2c8-ad19323c5fa7";
const URL = `https://aweborn.org/w/${ID}`;

const sample = {
  id: ID, name: "Origin", creator: "aweborn", coords: "(0, 0, 0)", sector: "0:0:0", setName: "Origin Set", setNumber: "",
};

// Brand eyes: darkened f1 palette so they stay ≥ 7:1 on the light tile.
const BLUE = "#2c5a86";
const PURPLE = "#5e3f7a";
export const variants = [
  { key: "A", label: "A  plain (current)", qrStyle: undefined },
  { key: "B", label: "B  dots + round eyes", qrStyle: { shape: "dot", dot: 0.92 } },
  { key: "C", label: "C  dots, brand eyes", qrStyle: { shape: "dot", dot: 0.92, eyeOuter: BLUE, eyeInner: PURPLE } },
  { key: "C+", label: "C+ as C, symbol 12 mm (+20%)", qrSize: 12, qrStyle: { shape: "dot", dot: 0.92, eyeOuter: BLUE, eyeInner: PURPLE } },
  { key: "C++", label: "C++ as C, symbol 13 mm (+30%)", qrSize: 13, qrStyle: { shape: "dot", dot: 0.92, eyeOuter: BLUE, eyeInner: PURPLE } },
  { key: "D", label: "D  inverted, brand eyes", qrStyle: { shape: "dot", dot: 0.92, ink: "#f4f4f5", tile: "#101013", eyeOuter: "#8fb6dc", eyeInner: "#e8c860" } },
];

const DPI = 300;
const px = (v, dpi) => Math.round((v / 25.4) * dpi);

async function gray(buf, w, h) {
  const { data, info } = await sharp(buf).resize(w, h).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: "attemptBoth" });
}

/** Crop the QR area (with margin) from a full-card PNG rendered at `dpi`, then apply a degradation. */
async function trial(frontPng, dpi, { blur = 0, gain = 0, rotate = 0 } = {}) {
  let img = sharp(frontPng).resize(px(69, dpi), px(94, dpi));
  const m = 4; // mm margin around the 12 mm tile
  let buf = await img.extract({ left: px(62 - 14.4 - m, dpi), top: px(75 - m, dpi), width: px(14.4 + 2 * m, dpi), height: px(14.4 + 2 * m, dpi) }).png().toBuffer();
  if (blur) buf = await sharp(buf).blur(blur).png().toBuffer();
  if (gain) {
    // dot gain/loss: blur then re-threshold; gain > 0 fattens dark ink, < 0 thins it.
    buf = await sharp(buf).blur(Math.max(0.3, Math.abs(gain) * 3)).linear(1, 0).threshold(128 - gain * 90).png().toBuffer();
  }
  if (rotate) buf = await sharp(buf).rotate(rotate, { background: "#ffffff" }).png().toBuffer();
  const { width, height } = await sharp(buf).metadata();
  const hit = await gray(buf, width, height);
  return hit?.data === URL;
}

const TRIALS = [
  ["600dpi", 600, {}],
  ["300dpi", 300, {}],
  ["150dpi", 150, {}],
  ["100dpi", 100, {}],
  ["blur 1.2", 300, { blur: 1.2 }],
  ["blur 2.0", 300, { blur: 2.0 }],
  ["gain +0.3", 300, { gain: 0.3 }],
  ["gain +0.6", 300, { gain: 0.6 }],
  ["loss -0.3", 300, { gain: -0.3 }],
  ["rot 17°", 300, { rotate: 17 }],
  ["150dpi rot 30°", 150, { rotate: 30 }],
];

const art = await readFile(path.join(root, "cards/samples/origin-tunnel.jpg"));
const artHref = `data:image/jpeg;base64,${art.toString("base64")}`;

await mkdir(outDir, { recursive: true });
const cells = [];
const results = {};
for (const v of variants) {
  const { svg, qr } = renderFront({ ...sample, artHref }, { qrStyle: v.qrStyle, qrSize: v.qrSize });
  const png = await sharp(Buffer.from(svg), { density: 144 }).resize(px(69, DPI), px(94, DPI)).png().toBuffer();
  results[v.key] = [];
  for (const [name, dpi, opt] of TRIALS) results[v.key].push([name, await trial(png, dpi, opt)]);
  // crop: bottom of the card at 300 dpi (trim area, footer incl. QR), plus a 4× QR close-up
  const footer = await sharp(png).extract({ left: px(3, DPI), top: px(70, DPI), width: px(63, DPI), height: px(21, DPI) }).png().toBuffer();
  const close = await sharp(png).extract({ left: px(48, DPI), top: px(73, DPI), width: px(16, DPI), height: px(16, DPI) })
    .resize(px(16, DPI) * 3, px(16, DPI) * 3, { kernel: "nearest" }).png().toBuffer();
  cells.push({ v, footer, close, qr, png });
}

// Sheet: one row per variant: label + footer + close-up + pass list.
const fw = px(63, DPI), fh = px(21, DPI), cw = px(16, DPI) * 3;
const rowH = Math.max(fh, cw) + 60, W = fw + cw + 420 + 90;
const rows = cells.map((c, i) => {
  const res = results[c.v.key].map(([n, ok]) => `<tspan x="${fw + cw + 60}" dy="22" fill="${ok ? "#7ddc9a" : "#ff7a7a"}">${ok ? "✓" : "✗"} ${n}</tspan>`).join("");
  return `<text x="20" y="${i * rowH + 36}" fill="#e4e4e7" font-family="Helvetica" font-size="26">${c.v.label} — ${c.qr.modules}×${c.qr.modules}, ${c.qr.moduleSize.toFixed(3)} mm/module</text>
  <text x="${fw + cw + 60}" y="${i * rowH + 36}" fill="#acacb4" font-family="Helvetica" font-size="20">${results[c.v.key].filter((r) => r[1]).length}/${TRIALS.length} decode</text>
  <text x="0" y="${i * rowH + 36}" font-family="Helvetica" font-size="20" fill="#acacb4">${res}</text>`;
}).join("");
// the pass-list tspans position themselves via x; give them a y start under the header
const sheet = sharp({ create: { width: W, height: rowH * cells.length + 20, channels: 4, background: "#0b0b0d" } })
  .composite([
    { input: Buffer.from(`<svg width="${W}" height="${rowH * cells.length + 20}" xmlns="http://www.w3.org/2000/svg">${rows}</svg>`), left: 0, top: 0 },
    ...cells.flatMap((c, i) => [
      { input: c.footer, left: 20, top: i * rowH + 56 },
      { input: c.close, left: fw + 40, top: i * rowH + 56 },
    ]),
  ])
  .png();
await sheet.toFile(path.join(outDir, "qr-styles.png"));

for (const k of Object.keys(results)) {
  console.log(k, results[k].map(([n, ok]) => `${ok ? "✓" : "✗"}${n}`).join("  "));
}
console.log(`Wrote ${path.relative(root, path.join(outDir, "qr-styles.png"))}`);
