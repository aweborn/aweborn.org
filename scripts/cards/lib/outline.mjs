/**
 * Text → SVG outlines (no font dependency in the output).
 *
 * Fonts live in cards/fonts/ (SIL OFL / Ubuntu Font Licence). Variable fonts
 * are instanced at the requested weight before outlining.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";

const fontDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../cards/fonts");

export const FONTS = {
  jost: "Jost-Variable.ttf",
  mono: "JetBrainsMono-Variable.ttf",
  outfit: "Outfit-Variable.ttf",
  josefin: "JosefinSans-Variable.ttf",
  cormorant: "CormorantGaramond-Variable.ttf",
  cinzel: "Cinzel-Variable.ttf",
  quicksand: "Quicksand-Variable.ttf",
  comfortaa: "Comfortaa-Variable.ttf",
  spacegrotesk: "SpaceGrotesk-Variable.ttf",
  ubuntu: "Ubuntu-Light.ttf",
};

const cache = new Map();
function load(font, wght) {
  const key = `${font}@${wght}`;
  if (!cache.has(key)) {
    let f = fontkit.openSync(path.join(fontDir, FONTS[font] ?? font));
    if (wght && f.variationAxes?.wght) f = f.getVariation({ wght });
    cache.set(key, f);
  }
  return cache.get(key);
}

const fmt = (n) => +n.toFixed(4);

/**
 * Outline a single line of text.
 *
 * @param {string} text
 * @param {object} o
 * @param {string} o.font        key in FONTS (or a filename in cards/fonts/)
 * @param {number} [o.wght]      weight for variable fonts
 * @param {number} [o.size]      font size (em) in user units (mm on cards)
 * @param {number} [o.fitWidth]  instead of size: scale so the line is exactly this wide
 * @param {number} [o.maxWidth]  shrink (never grow) to fit this width
 * @param {number} [o.tracking]  extra letter spacing in em
 * @param {boolean} [o.mono]     monospace the run in this font: tabular figures, and every
 *                               glyph centered in a fixed cell (the width of a tabular "0")
 * @param {number} o.x           anchor x
 * @param {number} o.y           baseline y
 * @param {"start"|"middle"|"end"} [o.anchor]
 * @param {string} o.fill
 * @returns {{ svg: string, width: number, size: number }}
 */
export function outline(text, { font, wght, size, fitWidth, maxWidth, tracking = 0, mono = false, x, y, anchor = "start", fill }) {
  const f = load(font, wght);
  const features = mono && f.availableFeatures.includes("tnum") ? ["tnum"] : [];
  const run = f.layout(text, features);
  const cell = mono ? f.layout("0", features).positions[0].xAdvance : 0;
  const track = tracking * f.unitsPerEm;
  let adv = 0;
  const glyphs = run.glyphs.map((g, i) => {
    const step = mono ? cell : run.positions[i].xAdvance;
    const center = mono ? (cell - run.positions[i].xAdvance) / 2 : 0;
    const at = adv + center + run.positions[i].xOffset;
    adv += step + (i < run.glyphs.length - 1 ? track : 0);
    return { d: g.path.toSVG(), at };
  });

  let scale = fitWidth ? fitWidth / adv : size / f.unitsPerEm;
  if (maxWidth && adv * scale > maxWidth) scale = maxWidth / adv;
  const width = adv * scale;
  const x0 = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;

  const paths = glyphs
    .filter((g) => g.d)
    .map((g) => `<path transform="translate(${fmt(g.at)} 0)" d="${g.d}"/>`)
    .join("");
  // Glyph space is y-up; flip into SVG's y-down.
  const svg = `<g fill="${fill}" transform="translate(${fmt(x0)} ${fmt(y)}) scale(${fmt(scale * 1e3) / 1e3} ${-fmt(scale * 1e3) / 1e3})">${paths}</g>`;
  return { svg, width, size: scale * f.unitsPerEm };
}
