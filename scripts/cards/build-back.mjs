#!/usr/bin/env node
/**
 * Build the final static card back → cards/templates/back.svg
 *
 *   node scripts/cards/build-back.mjs
 *
 * Decisions (2026-10-04, see phases/08-nfc-trading-cards.md):
 *   lines     frame + orbit ring
 *   palette   f1 favicon (steel blue / lilac / gold) on charcoal; navy frame + ring
 *   wordmark  "aweborn", lowercase, Jost 400, steel blue #a9c1da (AAA 8.4:1), outlined to paths
 *
 * Template + colours: scripts/cards/lib/back.mjs (BACK_DEFAULTS).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderBack } from "./lib/back.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const back = renderBack();
await writeFile(path.join(root, "cards/templates/back.svg"), back);
console.log("Wrote cards/templates/back.svg");

// In-game copy for face-down World Index cards: same art, cropped to the
// 63 × 88 trim (no bleed) and sized by CSS.
const trimmed = back.replace(/width="69mm" height="94mm" viewBox="0 0 69 94"/, 'viewBox="3 3 63 88"');
if (trimmed === back) throw new Error("back.svg header changed: update the trim crop");
await mkdir(path.join(root, "public/cards"), { recursive: true });
await writeFile(path.join(root, "public/cards/back.svg"), trimmed);
console.log("Wrote public/cards/back.svg");
