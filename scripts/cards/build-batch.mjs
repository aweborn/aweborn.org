#!/usr/bin/env node
/**
 * Build a card print batch: print-ready fronts + the NFC encoding manifest (M6, Phase 08 8C/8D).
 *
 *   # Paid orders a person has approved (the normal path):
 *   MANA_ADMIN_TOKEN=… node scripts/cards/build-batch.mjs --orders
 *   # Any worlds (curated / event runs), N cards each:
 *   node scripts/cards/build-batch.mjs --worlds <id>[,<id>…] [--qty 50]
 *   # Every world of a card set (M6d; sets live on the sync-service, admin-cards.html → Sets):
 *   node scripts/cards/build-batch.mjs --set <set-id> [--qty 50]
 *
 * Options
 *   --status <s>       order status to print (default approved)
 *   --api <url>        sync-service (default https://sync.aweborn.org)
 *   --site <url>       site with /card-art.html (default https://aweborn.org). Its build talks to
 *                      its own sync-service, so pair them: --site http://localhost:5173 --api http://localhost:1234
 *   --out <dir>        default cards/batches/<YYYY-MM-DD-HHMM> (git-ignored: may hold buyers' photos)
 *   --ghost <id,…>     draw these worlds in the Dreamt ghost look. Orders already carry their edition
 *                      (ordered while the world was a Ghost → Dreamt); --worlds/--set use the world as it is now
 *   --creator-names    print the creator's character name (default "a fellow explorer"; see Phase 08)
 *   --dry-run          check worlds and write the manifests only (no art, no fronts)
 *
 * A world in a card set prints that set's name and number ("07 / 12"; none for one-card sets);
 * other worlds print "World Index", like their in-game card.
 *
 * Every world is checked first (Card Invariant #3): it must be in the universe and resolved, and its
 * name must be printable in the card font. Problems go to skipped.csv; the rest print.
 *
 * Output (in --out)
 *   fronts/NN-<world>.svg   self-contained 69 × 94 mm front (3 mm bleed): send these to the printer
 *   fronts/NN-<world>.png   300 dpi render of the same, for a look
 *   back.svg                the one static back (cards/templates/back.svg)
 *   proof.png               every front trimmed to 63 × 88 mm, side by side: approve from this
 *   manifest.csv            one row per front: order, world, quantity, URL, art, files, QR check
 *   encode.csv              one row per physical card: the URL its NFC tag gets (then lock the tag)
 *   skipped.csv             worlds that can't print, and why
 */
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import jsQR from "jsqr";
import * as fontkit from "fontkit";
import { renderFront, worldUrl } from "./lib/front.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "package.json"));

// Same QR as the Origin card (render-preview.mjs, explore-qr.mjs variant C): round dots, brand eyes, 12 mm.
const QR = { qrStyle: { shape: "dot", dot: 0.92, eyeOuter: "#2c5a86", eyeInner: "#5e3f7a" }, qrSize: 12 };
const ART = { w: 1100, h: 900 }; // 55 × 45 mm art window at ~508 dpi (photo-mode shots are this size too)
const DPI = 300;
const ORIGIN_ID = "5949dfc5-3a9b-46b7-a2c8-ad19323c5fa7"; // Alex's own print run (render-preview.mjs)
const WORLD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// ── Args ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};
const list = (s) => (s ? s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) : []);
const API = opt("api", "https://sync.aweborn.org").replace(/\/+$/, "");
const SITE = opt("site", "https://aweborn.org").replace(/\/+$/, "");
const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
const OUT = path.resolve(root, opt("out", `cards/batches/${stamp}`));
const GHOST = new Set(list(opt("ghost")));
const DRY = flag("dry-run");

function usage(msg) {
  if (msg) console.error(`✗ ${msg}\n`);
  console.error("Usage: MANA_ADMIN_TOKEN=… node scripts/cards/build-batch.mjs --orders [--status approved]");
  console.error("       node scripts/cards/build-batch.mjs --worlds <id>[,<id>…] [--qty N]");
  console.error("       node scripts/cards/build-batch.mjs --set <set-id> [--qty N]");
  console.error("Options: --api <url> --site <url> --out <dir> --ghost <id,…> --creator-names --dry-run");
  process.exit(2);
}

// ── Helpers ────────────────────────────────────────────────────────────
async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const err = new Error(`${res.status} ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "world";
const formatCoords = (p) => `(${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`;

// The card font (outline.mjs): a name with glyphs Jost lacks would print as boxes.
const jost = fontkit.openSync(path.join(root, "cards/fonts/Jost-Variable.ttf"));
const printable = (text) => !jost.layout(text).glyphs.some((g) => g.id === 0);

/** The creator line. Character names are only printed with --creator-names (their owner never agreed to print). */
async function creatorLabels(creators) {
  const out = new Map();
  const ids = [...new Set(creators.filter((c) => c && c !== "system" && !c.startsWith("guest")))];
  let names = {};
  if (flag("creator-names") && ids.length) {
    for (let i = 0; i < ids.length; i += 50) {
      const r = await getJson(`${API}/players/names?ids=${ids.slice(i, i + 50).map(encodeURIComponent).join(",")}`);
      names = { ...names, ...r.names };
    }
  }
  for (const c of creators) {
    out.set(c, !c ? "an explorer" : c === "system" ? "Aweborn" : names[c] ?? "a fellow explorer");
  }
  return out;
}

/** Card sets (M6d): world → { set, number } (first set wins), and the sets by id. Older servers have none. */
const sets = await getJson(`${API}/card-sets`).then((r) => r.sets ?? []).catch(() => []);
const setOf = new Map();
for (const s of sets) {
  s.worldIds.forEach((id, i) => {
    if (setOf.has(id)) return;
    // shared/cards.ts cardSetNumber(): "07 / 12", at least 2 digits, none for a one-card set
    const width = Math.max(2, String(s.worldIds.length).length);
    const number = s.worldIds.length > 1 ? `${String(i + 1).padStart(width, "0")} / ${String(s.worldIds.length).padStart(width, "0")}` : "";
    setOf.set(id, { name: s.name, number });
  });
}

// ── 1. What to print ───────────────────────────────────────────────────
/** @type {{ orderId: string, worldId: string, orderName?: string, quantity: number, art: "card"|"photo", dreamt?: boolean }[]} */
let items = [];
const qty = Math.max(1, Math.min(10_000, Math.round(Number(opt("qty", "1"))) || 1));
if (flag("orders")) {
  const token = process.env.MANA_ADMIN_TOKEN;
  if (!token) usage("--orders needs MANA_ADMIN_TOKEN (the admin token) in the environment");
  const status = opt("status", "approved");
  const { orders } = await getJson(`${API}/api/admin/cards?status=${encodeURIComponent(status)}`, { Authorization: `Bearer ${token}` });
  items = orders.map((o) => ({
    orderId: o.id, worldId: o.worldId, orderName: o.worldName, quantity: o.quantity, art: o.art ?? "card",
    dreamt: o.edition === "dreamt" || GHOST.has(o.worldId),
  }));
  console.log(`${orders.length} ${status} order(s) from ${API}`);
} else if (opt("set")) {
  const s = sets.find((x) => x.id === opt("set"));
  if (!s) usage(`no card set "${opt("set")}" on ${API} (sets: ${sets.map((x) => x.id).join(", ") || "none"})`);
  items = s.worldIds.map((worldId) => ({ orderId: "", worldId, quantity: qty, art: "card", dreamt: GHOST.has(worldId) || undefined }));
  console.log(`Set "${s.name}": ${s.worldIds.length} world(s) × ${qty}`);
} else if (opt("worlds")) {
  items = list(opt("worlds")).map((worldId) => ({ orderId: "", worldId, quantity: qty, art: "card", dreamt: GHOST.has(worldId) || undefined }));
} else {
  usage();
}
if (!items.length) {
  console.log("Nothing to print.");
  process.exit(0);
}

// ── 2. Check every world (Card Invariant #3) ───────────────────────────
const skipped = [];
const ready = [];
const originOrders = [];
for (const it of items) {
  const skip = (reason) => skipped.push([it.orderId, it.worldId, it.orderName ?? "", reason]);
  if (!WORLD_ID.test(it.worldId)) { skip("not a world id"); continue; }
  // Origin's front is Alex's own (render-preview.mjs, origin-tunnel art): no front here, but its
  // cards (event orders, M6e) still go into encode.csv with everything else.
  if (it.worldId === ORIGIN_ID && it.orderId) { originOrders.push(it); continue; }
  let w;
  try {
    w = await getJson(`${API}/worlds/${it.worldId}`);
  } catch (err) {
    skip(err.status === 404 ? "not in the universe (removed?)" : `lookup failed: ${err.message}`);
    continue;
  }
  if (!(w.resolvedAt > 0) && !w.isOrigin) { skip("position not resolved yet"); continue; }
  if (typeof w.resolvedAt !== "number") console.warn(`! ${it.worldId}: this sync-service doesn't report resolvedAt yet; resolution not checked`);
  // Print the name the order was checked and paid for; flag a rename so a person can look.
  const name = it.orderName || w.name;
  if (it.orderName && it.orderName !== w.name) console.warn(`! ${it.orderId}: world renamed since the order ("${it.orderName}" → "${w.name}"); printing the ordered name`);
  if (!printable(name)) { skip(`name "${name}" has characters the card font can't print`); continue; }
  ready.push({ ...it, world: w, name });
}
const creators = await creatorLabels(ready.map((r) => r.world.creator));

await mkdir(path.join(OUT, "fronts"), { recursive: true });
await writeFile(path.join(OUT, "skipped.csv"), csv([["order_id", "world_id", "world_name", "reason"], ...skipped]));
for (const s of skipped) console.warn(`✗ skip ${s[0] || s[1]}: ${s[3]}`);
if (!ready.length && !originOrders.length) {
  console.log(`No printable cards. See ${OUT}/skipped.csv`);
  process.exit(1);
}

// ── 3. Art: the order's photo, else the World Index picture (/card-art.html) ──
let browser = null;
async function worldIndexArt(worldId, dreamt) {
  if (!browser) {
    const puppeteer = require("puppeteer-core");
    browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--enable-webgl", "--ignore-gpu-blocklist"] });
  }
  const page = await browser.newPage();
  try {
    // true → Dreamt (ghost) look; false → solid; undefined → the world as it is now
    const ghost = dreamt === undefined ? "" : `&ghost=${dreamt ? 1 : 0}`;
    await page.goto(`${SITE}/card-art.html?w=${worldId}&size=${ART.w}x${ART.h}${ghost}`, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(() => document.body.dataset.ready, { timeout: 30_000 });
    const { url, error } = await page.evaluate(() => ({ url: window.__cardArt, error: window.__cardArtError }));
    if (!url) throw new Error(error || "no art");
    return url;
  } finally {
    await page.close();
  }
}
async function photoArt(orderId) {
  const res = await fetch(`${API}/cards/orders/${encodeURIComponent(orderId)}/photo`);
  if (!res.ok) return null;
  return `data:image/jpeg;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

// ── 4. Fronts, QR check, manifests ─────────────────────────────────────
const mm = (v, dpi = DPI) => Math.round((v / 25.4) * dpi);
async function qrDecodes(png, url) {
  for (const dpi of [300, 150]) {
    const { data, info } = await sharp(png)
      .resize(mm(69, dpi), mm(94, dpi))
      .extract({ left: mm(47, dpi), top: mm(73, dpi), width: mm(16, dpi), height: mm(16, dpi) })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data !== url) return false;
  }
  return true;
}

const manifest = [["n", "order_id", "world_id", "world_name", "quantity", "url", "set", "set_number", "edition", "art", "front_svg", "front_png", "qr_ok"]];
const encode = [["card_no", "order_id", "world_id", "url"]];
const trimmed = [];
let cardNo = 0;
let failures = 0;
const pad = String(ready.length).length;

for (const [i, r] of ready.entries()) {
  const n = String(i + 1).padStart(Math.max(2, pad), "0");
  const url = worldUrl(r.worldId);
  const base = `${n}-${slug(r.name)}`;
  const label = setOf.get(r.worldId) ?? { name: "World Index", number: "" };
  const edition = r.dreamt ? "dreamt" : r.dreamt === false ? "solid" : r.world.solidified === false ? "dreamt" : "solid";
  let art = r.art;
  let svgFile = "";
  let pngFile = "";
  let qrOk = "";
  if (!DRY) {
    let artHref = art === "photo" ? await photoArt(r.orderId) : null;
    if (art === "photo" && !artHref) {
      console.warn(`! ${r.orderId}: the photo is gone; printing the World Index picture`);
      art = "card";
    }
    try {
      artHref ??= await worldIndexArt(r.worldId, r.dreamt);
    } catch (err) {
      console.error(`✗ ${r.orderId || r.worldId}: couldn't render the art (${err.message}). Is ${SITE}/card-art.html deployed?`);
      skipped.push([r.orderId, r.worldId, r.name, `art failed: ${err.message}`]);
      failures++;
      continue;
    }
    const { svg } = renderFront(
      {
        id: r.worldId,
        name: r.name,
        creator: creators.get(r.world.creator),
        coords: formatCoords(r.world.position ?? { x: 0, y: 0, z: 0 }),
        sector: r.world.sector ?? "0:0:0",
        setName: label.name, // a card set's name, else "World Index" (what the in-game card footer says)
        setNumber: label.number,
        artHref,
      },
      QR,
    );
    // librsvg maps mm → px and sharp scales by density/72: oversample, then size to 69 × 94 mm at DPI.
    const png = await sharp(Buffer.from(svg), { density: 144 }).resize(mm(69), mm(94)).png().toBuffer();
    svgFile = `fronts/${base}.svg`;
    pngFile = `fronts/${base}.png`;
    await writeFile(path.join(OUT, svgFile), svg);
    await writeFile(path.join(OUT, pngFile), png);
    const ok = await qrDecodes(png, url);
    qrOk = ok ? "yes" : "NO";
    if (!ok) {
      failures++;
      console.error(`✗ ${base}: the QR didn't decode to ${url}. Don't print this one.`);
    }
    trimmed.push(
      await sharp(png)
        .extract({ left: mm(3), top: mm(3), width: mm(63), height: mm(88) })
        .composite([{ input: Buffer.from(`<svg width="${mm(63)}" height="${mm(88)}"><rect width="100%" height="100%" rx="${mm(3)}" fill="#fff"/></svg>`), blend: "dest-in" }])
        .png()
        .toBuffer(),
    );
  }
  manifest.push([n, r.orderId, r.worldId, r.name, r.quantity, url, label.name, label.number, edition, art, svgFile, pngFile, qrOk]);
  for (let q = 0; q < r.quantity; q++) encode.push([++cardNo, r.orderId, r.worldId, url]);
  console.log(`✓ ${n} ${r.name} ×${r.quantity} (${art}${edition === "dreamt" ? ", Dreamt" : ""}${label.number ? `, ${label.name} ${label.number}` : ""})${qrOk ? ` QR ${qrOk === "yes" ? "✓" : "✗"}` : ""}`);
}
await browser?.close();
for (const o of originOrders) {
  const url = worldUrl(ORIGIN_ID);
  const label = setOf.get(ORIGIN_ID) ?? { name: "World Index", number: "" };
  manifest.push(["origin", o.orderId, ORIGIN_ID, "Origin", o.quantity, url, label.name, label.number, "solid", "origin front (render-preview.mjs)", "", "", ""]);
  for (let q = 0; q < o.quantity; q++) encode.push([++cardNo, o.orderId, ORIGIN_ID, url]);
  console.log(`✓ Origin ×${o.quantity} (order ${o.orderId}): print the Origin front from render-preview.mjs; its cards are in encode.csv`);
}

await writeFile(path.join(OUT, "manifest.csv"), csv(manifest));
await writeFile(path.join(OUT, "encode.csv"), csv(encode));
await writeFile(path.join(OUT, "skipped.csv"), csv([["order_id", "world_id", "world_name", "reason"], ...skipped]));
if (!DRY) {
  await copyFile(path.join(root, "cards/templates/back.svg"), path.join(OUT, "back.svg"));
  if (trimmed.length) {
    const cols = Math.min(4, trimmed.length);
    const rows = Math.ceil(trimmed.length / cols);
    const [w, h, gap] = [mm(63), mm(88), mm(6)];
    await sharp({ create: { width: cols * w + (cols + 1) * gap, height: rows * h + (rows + 1) * gap, channels: 4, background: "#0b0b0d" } })
      .composite(trimmed.map((input, i) => ({ input, left: gap + (i % cols) * (w + gap), top: gap + Math.floor(i / cols) * (h + gap) })))
      .png()
      .toFile(path.join(OUT, "proof.png"));
  }
}

const rel = OUT.startsWith(root + path.sep) ? path.relative(root, OUT) : OUT;
console.log(`\n${manifest.length - 1 - originOrders.length} front(s)${originOrders.length ? ` + ${originOrders.length} Origin order(s)` : ""}, ${cardNo} card(s) to encode, ${skipped.length} skipped → ${rel}/`);
if (!DRY) console.log(`Next: look at ${rel}/proof.png, send fronts/*.svg + back.svg, encode + lock tags from encode.csv.`);
process.exit(failures ? 1 : 0);
