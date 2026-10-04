#!/usr/bin/env node
/**
 * Render card previews.
 *
 *   node scripts/cards/render-preview.mjs
 *
 * Builds a sample front with scripts/cards/lib/front.mjs (outlined text, real QR,
 * embedded art), reads the static back from cards/templates/back.svg, verifies
 * both are self-contained, and writes SVG + 300 dpi PNG previews (plus a trimmed
 * side-by-side) to cards/previews/.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import jsQR from "jsqr";
import { renderFront, assertSelfContained } from "./lib/front.mjs";
import { originArt } from "./lib/art/origin.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "cards/previews");
const DPI = 300;

// The Origin Set: a single card (no set number: it would add nothing) for Origin, the Aweborn Portal at
// the universe origin (0, 0, 0), sector 0:0:0. Milestone 8A must register the
// portal as a real world entry with a permanent UUIDv4 so /w/<uuid> resolves.
// The name is deliberately open-ended: the world can grow into its identity.
const sample = {
  id: "7c1e4b2a-9d3f-4e8a-b5c6-0f2d8a91e347", // placeholder UUIDv4: replace with the portal's real world ID after Milestone 8A
  name: "Origin",
  creator: "aweborn",
  coords: "(0, 0, 0)",
  sector: "0:0:0",
  setName: "Origin Set",
  setNumber: "", // multi-card sets print e.g. "01 / 12" (pad to the set's width)
  arrival: "orbit",
};

// Usage: node scripts/cards/render-preview.mjs [art.jpg|art.png] [outDir]
// Default art: painted Origin (tunnel). Pass "vector" for lib/art/origin.mjs.
const artArg = process.argv[2] ?? "cards/samples/origin-tunnel.jpg";
const outArg = process.argv[3];

async function main() {
  const outDir = outArg ? path.resolve(root, outArg) : out;
  await mkdir(outDir, { recursive: true });

  let artOpt;
  if (artArg === "vector") {
    artOpt = { artSvg: originArt() };
  } else {
    const buf = await readFile(path.resolve(root, artArg));
    const mime = artArg.endsWith(".png") ? "image/png" : "image/jpeg";
    artOpt = { artHref: `data:${mime};base64,${buf.toString("base64")}` };
  }
  const { svg: front, url, qr } = renderFront({ ...sample, ...artOpt });
  const back = await readFile(path.join(root, "cards/templates/back.svg"), "utf8");
  assertSelfContained(back);

  const pngs = {};
  for (const [name, svg] of Object.entries({ front, back })) {
    await writeFile(path.join(outDir, `${name}.svg`), svg);
    // librsvg already maps mm → px and sharp then scales by density/72, so
    // oversample and resize to the exact 69 × 94 mm canvas at DPI.
    pngs[name] = await sharp(Buffer.from(svg), { density: 144 })
      .resize(Math.round((69 / 25.4) * DPI), Math.round((94 / 25.4) * DPI))
      .png()
      .toBuffer();
    await writeFile(path.join(outDir, `${name}.png`), pngs[name]);
  }

  // Side-by-side, trimmed to the 63 × 88 mm cut line with rounded corners.
  const mm = (v) => Math.round((v / 25.4) * DPI);
  const [w, h, r, bleed, gap] = [mm(63), mm(88), mm(3), mm(3), mm(8)];
  const mask = Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`,
  );
  const trim = (buf) =>
    sharp(buf)
      .extract({ left: bleed, top: bleed, width: w, height: h })
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
  const [f, b] = await Promise.all([trim(pngs.front), trim(pngs.back)]);
  await sharp({
    create: { width: w * 2 + gap * 3, height: h + gap * 2, channels: 4, background: "#0b0b0d" },
  })
    .composite([
      { input: f, left: gap, top: gap },
      { input: b, left: w + gap * 2, top: gap },
    ])
    .png()
    .toFile(path.join(outDir, "side-by-side.png"));

  // Scan the QR straight off the rendered front, at print (300 dpi) and a
  // low-res 150 dpi pass, and make sure it decodes to the exact card URL.
  for (const dpi of [300, 150]) {
    const px = (v) => Math.round((v / 25.4) * dpi);
    const { data, info } = await sharp(pngs.front)
      .resize(px(69), px(94))
      .extract({ left: px(49), top: px(74), width: px(14), height: px(14) })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const hit = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    if (hit?.data !== url) throw new Error(`QR check failed at ${dpi} dpi: got ${JSON.stringify(hit?.data)}`);
  }

  console.log(`Front URL : ${url}`);
  console.log(`QR        : v${qr.version}, ${qr.modules}×${qr.modules}, ${qr.moduleSize.toFixed(3)} mm/module — decodes ✓ (300 + 150 dpi)`);
  console.log(`Wrote previews to ${path.relative(root, outDir)}/ (both SVGs verified self-contained)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
