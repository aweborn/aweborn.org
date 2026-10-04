#!/usr/bin/env node
/**
 * Card-back exploration sheets.
 *
 *   node scripts/cards/back-variations.mjs
 *
 * Writes three contact sheets to cards/explore/, each varying ONE axis while
 * holding the others fixed, so differences are easy to judge:
 *   1-lines.png      frame / orbit ring on or off
 *   2-colors.png     palettes from logo-concepts/ (m*, f*, o*, c*)
 *   3-wordmark.png   no name vs. candidate typefaces
 *
 * Wordmarks are converted to vector outlines with fontkit (exactly what a
 * printer needs), so renders don't depend on installed fonts. All fonts in
 * cards/fonts/ are OFL / Ubuntu Font Licence (free for commercial print).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "cards/explore");
const fontPath = (f) => path.join(root, "cards/fonts", f);

// ─── Palettes (mark colors = [large r55, medium r34, small r21]) ───────────────
const BG = {
  charcoal: ["#232327", "#141416"],
  navy: ["#1f2340", "#12142a"], // from logo-concepts gradient #1a1a2e → #16213e
  warm: ["#24211e", "#151311"],
};
const PALETTES = {
  zinc: { mark: ["#d4d4d8", "#a1a1aa", "#ffffff"], ink: "#a1a1aa", line: "#3f3f46", ring: "#2a2a2f" },
  m6CoolGrays: { mark: ["#475569", "#94a3b8", "#f1f5f9"], ink: "#94a3b8", line: "#334155", ring: "#262c45" },
  m5WarmGrays: { mark: ["#5c534a", "#a89f96", "#f5f0eb"], ink: "#a89f96", line: "#45403a", ring: "#2e2a26" },
  f1Favicon: { mark: ["#5b8cb8", "#a480b8", "#e8c860"], ink: "#c9b7d6", line: "#3a4064", ring: "#2a2f50" },
  f3Twilight: { mark: ["#6272a4", "#b07cc8", "#f0b080"], ink: "#c4b0d8", line: "#3a4064", ring: "#2a2f50" },
  o4CoolCosmic: { mark: ["#7c8db5", "#a894bd", "#d4e4f7"], ink: "#a9b6d3", line: "#3a4064", ring: "#2a2f50" },
  c2WarmSunset: { mark: ["#c2694f", "#d4899b", "#f5d472"], ink: "#d9a99a", line: "#45403a", ring: "#2e2a26" },
  goldAccent: { mark: ["#d4d4d8", "#a1a1aa", "#e8c860"], ink: "#a1a1aa", line: "#3f3f46", ring: "#2a2a2f" },
};

// ─── Wordmark typefaces ─────────────────────────────────────────────────────
const FONTS = {
  outfit: { file: "Outfit-Variable.ttf", wght: 300 },
  jost: { file: "Jost-Variable.ttf", wght: 400 },
  josefin: { file: "JosefinSans-Variable.ttf", wght: 300 },
  cormorant: { file: "CormorantGaramond-Variable.ttf", wght: 500 },
  cinzel: { file: "Cinzel-Variable.ttf", wght: 400 },
  quicksand: { file: "Quicksand-Variable.ttf", wght: 400 },
  comfortaa: { file: "Comfortaa-Variable.ttf", wght: 300 },
  spacegrotesk: { file: "SpaceGrotesk-Variable.ttf", wght: 300 },
  ubuntu: { file: "Ubuntu-Light.ttf" },
};
const fontCache = {};
function loadFont(key) {
  if (fontCache[key]) return fontCache[key];
  const { file, wght } = FONTS[key];
  let font = fontkit.openSync(fontPath(file));
  if (wght && font.variationAxes?.wght) font = font.getVariation({ wght });
  return (fontCache[key] = font);
}

/**
 * Outline `text` as SVG paths, centered on (cx, baseline), scaled so the
 * visual width equals `width` mm. `tracking` is in em.
 */
function outlineText(text, { font: key, width, tracking = 0, cx, baseline, fill }) {
  const font = loadFont(key);
  const run = font.layout(text);
  const upm = font.unitsPerEm;
  const track = tracking * upm;
  let x = 0;
  const parts = [];
  run.glyphs.forEach((g, i) => {
    const pos = run.positions[i];
    const d = g.path.toSVG();
    if (d) parts.push(`<path transform="translate(${x + pos.xOffset} 0)" d="${d}"/>`);
    x += pos.xAdvance + (i < run.glyphs.length - 1 ? track : 0);
  });
  const s = width / x;
  // fontkit glyph space is y-up; flip to SVG y-down.
  return `<g fill="${fill}" transform="translate(${cx - width / 2} ${baseline}) scale(${s} ${-s})">${parts.join("")}</g>`;
}

// ─── Card back builder (69 × 94 mm canvas incl. 3 mm bleed) ──────────────────
const MARK = (c) => `
  <g transform="translate(34.5 43) scale(0.264) translate(-201.5 -198)">
    <circle cx="177" cy="198" r="55" fill="${c[0]}"/>
    <circle cx="247" cy="217" r="34" fill="${c[1]}"/>
    <circle cx="234" cy="173" r="21" fill="${c[2]}"/>
  </g>`;

let uid = 0;
function back({ bg = "charcoal", palette = "zinc", frame = true, ring = true, word = { font: "outfit" }, markY = 0 }) {
  const id = `v${uid++}`;
  const p = PALETTES[palette];
  const [c0, c1] = BG[bg];
  const lines = [
    frame && `<rect x="6.5" y="6.5" width="56" height="81" rx="2" fill="none" stroke="${p.line}" stroke-width="0.2"/>`,
    ring && `<circle cx="34.5" cy="${43 + markY}" r="23.5" fill="none" stroke="${p.ring}" stroke-width="0.15"/>`,
  ].filter(Boolean).join("");
  let wm = "";
  if (word) {
    const caps = word.caps ?? false;
    wm = outlineText(caps ? "AWEBORN" : "aweborn", {
      font: word.font,
      width: word.width ?? (caps ? 30 : 24),
      tracking: word.tracking ?? (caps ? 0.28 : 0.12),
      cx: 34.5,
      baseline: 77,
      fill: word.fill ?? p.ink,
    });
  }
  return `
    <defs><radialGradient id="${id}" cx="50%" cy="46%" r="70%">
      <stop offset="0%" stop-color="${c0}"/><stop offset="100%" stop-color="${c1}"/>
    </radialGradient></defs>
    <rect width="69" height="94" fill="url(#${id})"/>
    ${lines}
    <g transform="translate(0 ${markY})">${MARK(p.mark)}</g>
    ${wm}`;
}

// ─── Contact sheet ──────────────────────────────────────────────────────────
const PX_PER_MM = 6; // ≈152 dpi, plenty for on-screen judging
async function sheet(file, title, cols, items) {
  const cw = 63 * PX_PER_MM, ch = 88 * PX_PER_MM, gap = 60, label = 70, head = 110;
  const rows = Math.ceil(items.length / cols);
  const W = cols * cw + (cols + 1) * gap;
  const H = head + rows * (ch + label) + (rows + 1) * gap - gap / 2;
  const cells = items.map(({ name, note, spec }, i) => {
    const x = gap + (i % cols) * (cw + gap);
    const y = head + gap / 2 + Math.floor(i / cols) * (ch + label + gap);
    return `
      <clipPath id="clip${i}"><rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="${3 * PX_PER_MM}"/></clipPath>
      <g clip-path="url(#clip${i})">
        <svg x="${x}" y="${y}" width="${cw}" height="${ch}" viewBox="3 3 63 88">${back(spec)}</svg>
      </g>
      <text x="${x}" y="${y + ch + 34}" font-family="Helvetica Neue" font-size="26" font-weight="bold" fill="#e4e4e7">${name}</text>
      <text x="${x}" y="${y + ch + 62}" font-family="Helvetica Neue" font-size="20" fill="#71717a">${note ?? ""}</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#0b0b0d"/>
    <text x="${gap}" y="72" font-family="Helvetica Neue" font-size="40" font-weight="300" fill="#f4f4f5">${title}</text>
    ${cells.join("")}
  </svg>`;
  await writeFile(path.join(out, file.replace(".png", ".svg")), svg);
  await sharp(Buffer.from(svg)).png().toFile(path.join(out, file));
}

await mkdir(out, { recursive: true });

await sheet("1-lines.png", "Lines: frame and orbit ring (zinc mono, Outfit wordmark)", 4, [
  { name: "A · Frame + ring", note: "current v1", spec: { frame: true, ring: true } },
  { name: "B · Frame only", note: "classic deck border", spec: { frame: true, ring: false } },
  { name: "C · Ring only", note: "orbit, no border", spec: { frame: false, ring: true } },
  { name: "D · No lines", note: "purest", spec: { frame: false, ring: false } },
]);

await sheet("2-colors.png", "Color: palettes from logo-concepts (frame + ring, Outfit)", 4, [
  { name: "Zinc mono", note: "current v1 · aweborn-logo.svg", spec: { palette: "zinc" } },
  { name: "Zinc + gold sun", note: "mono with one accent", spec: { palette: "goldAccent" } },
  { name: "m6 Cool grays", note: "on navy", spec: { palette: "m6CoolGrays", bg: "navy" } },
  { name: "m5 Warm grays", note: "on warm charcoal", spec: { palette: "m5WarmGrays", bg: "warm" } },
  { name: "f1 Favicon", note: "on navy · matches site icon", spec: { palette: "f1Favicon", bg: "navy" } },
  { name: "f1 Favicon", note: "on charcoal", spec: { palette: "f1Favicon", bg: "charcoal" } },
  { name: "f3 Twilight", note: "on navy", spec: { palette: "f3Twilight", bg: "navy" } },
  { name: "o4 Cool cosmic", note: "on navy", spec: { palette: "o4CoolCosmic", bg: "navy" } },
]);

await sheet("3-wordmark.png", "Wordmark: name or no name, and typeface (zinc mono, frame + ring)", 4, [
  { name: "No name", note: "mark centered, symbol-only", spec: { word: null, markY: 4 } },
  { name: "Outfit Light", note: "site font · geometric, soft", spec: { word: { font: "outfit" } } },
  { name: "Jost", note: "Futura lineage · geometric, timeless", spec: { word: { font: "jost" } } },
  { name: "Quicksand", note: "rounded · friendly, echoes circles", spec: { word: { font: "quicksand" } } },
  { name: "Comfortaa Light", note: "rounded geometric · playful", spec: { word: { font: "comfortaa" } } },
  { name: "Ubuntu Light", note: "used in earlier lockups (l1–l4)", spec: { word: { font: "ubuntu" } } },
  { name: "Space Grotesk Light", note: "techy · sci-fi / startup", spec: { word: { font: "spacegrotesk" } } },
  { name: "Cormorant Garamond", note: "classical serif · reverent", spec: { word: { font: "cormorant", width: 25 } } },
  { name: "OUTFIT CAPS", note: "site font, wide tracking", spec: { word: { font: "outfit", caps: true } } },
  { name: "JOSEFIN SANS CAPS", note: "vintage geometric · expedition", spec: { word: { font: "josefin", caps: true } } },
  { name: "CINZEL", note: "inscribed Roman · mythic", spec: { word: { font: "cinzel", caps: true, tracking: 0.2 } } },
  { name: "CORMORANT CAPS", note: "classical, spaced", spec: { word: { font: "cormorant", caps: true } } },
]);

// ─── Type specimen: wordmarks at large size, next to a small mark ──────────────
{
  const rows = [
    ["Outfit Light", { font: "outfit" }],
    ["Jost", { font: "jost" }],
    ["Quicksand", { font: "quicksand" }],
    ["Comfortaa Light", { font: "comfortaa" }],
    ["Ubuntu Light", { font: "ubuntu" }],
    ["Space Grotesk Light", { font: "spacegrotesk" }],
    ["Cormorant Garamond", { font: "cormorant" }],
    ["Outfit caps", { font: "outfit", caps: true }],
    ["Josefin Sans caps", { font: "josefin", caps: true }],
    ["Cinzel", { font: "cinzel", caps: true, tracking: 0.2 }],
    ["Cormorant caps", { font: "cormorant", caps: true }],
  ];
  const rowH = 150, W = 1800, head = 110;
  const body = rows.map(([name, w], i) => {
    const y = head + i * rowH;
    const caps = w.caps ?? false;
    // 1 unit = 1 px here; wordmark ~900 px wide, baseline in row
    const word = outlineText(caps ? "AWEBORN" : "aweborn", {
      font: w.font, width: caps ? 560 : 460, tracking: w.tracking ?? (caps ? 0.28 : 0.12),
      cx: 1180, baseline: y + 100, fill: "#e4e4e7",
    });
    const mark = `<g transform="translate(560 ${y + 72}) scale(0.62) translate(-201.5 -198)">
      <circle cx="177" cy="198" r="55" fill="#d4d4d8"/><circle cx="247" cy="217" r="34" fill="#a1a1aa"/><circle cx="234" cy="173" r="21" fill="#fff"/></g>`;
    return `<line x1="60" y1="${y}" x2="${W - 60}" y2="${y}" stroke="#1f1f23"/>
      <text x="60" y="${y + 85}" font-family="Helvetica Neue" font-size="26" fill="#a1a1aa">${name}</text>${mark}${word}`;
  });
  const H = head + rows.length * rowH + 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#0b0b0d"/>
    <text x="60" y="72" font-family="Helvetica Neue" font-size="40" font-weight="300" fill="#f4f4f5">Wordmark specimen (large, beside the mark)</text>
    ${body.join("")}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(out, "4-type-specimen.png"));
}

console.log(`Wrote sheets to ${path.relative(root, out)}/`);
