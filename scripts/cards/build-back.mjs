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
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderBack } from "./lib/back.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
await writeFile(path.join(root, "cards/templates/back.svg"), renderBack());
console.log("Wrote cards/templates/back.svg");
