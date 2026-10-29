#!/usr/bin/env node
/**
 * Cross-engine determinism harness for the shared sim (Phase 09, 9A).
 *
 * Bundles `shared/sim/replay-fixture.ts` for a bare JS engine, runs
 * `determinismReport()` in every engine it can find, and checks that all of
 * them produce the same bits (replay hash vs GOLDEN_REPLAY, plus a sweep of
 * every dmath kernel).
 *
 * Engines:
 *  - Node (V8)                          always
 *  - JavaScriptCore (Safari's engine)   macOS `jsc` helper, or $JSC
 *  - Chromium (V8 in a browser)         $CHROME or the macOS Chrome app (puppeteer-core)
 *  - SpiderMonkey (Firefox)             $SPIDERMONKEY (`js` shell), when present
 *
 * Missing engines are reported as SKIPPED, never as passing.
 *
 * Run: node scripts/sim-determinism/run.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const outDir = join(here, ".out");
const bundle = join(outDir, "replay.js");
mkdirSync(outDir, { recursive: true });

// ── Bundle (rolldown, the bundler Vite already ships) ──
const require = createRequire(join(root, "package.json"));
const { build } = require("rolldown");
await build({
  input: join(root, "shared/sim/replay-fixture.ts"),
  output: { file: bundle, format: "iife", name: "SimReplay" },
  platform: "neutral",
  logLevel: "silent",
});
const code = readFileSync(bundle, "utf8");
const goldenMatch = /GOLDEN_REPLAY\s*=\s*"([0-9a-f]{8})"/.exec(readFileSync(join(root, "shared/sim/replay-fixture.ts"), "utf8"));
const GOLDEN = goldenMatch?.[1];

const results = [];
function record(engine, fn) {
  try {
    const r = fn();
    if (r === null) results.push({ engine, status: "SKIPPED" });
    else results.push({ engine, status: "RAN", ...r });
  } catch (e) {
    results.push({ engine, status: "ERROR", error: String(e).slice(0, 300) });
  }
}

// ── Node ──
record("node (V8)", () => {
  const ctx = vm.createContext({});
  vm.runInContext(code, ctx);
  return vm.runInContext("SimReplay.determinismReport()", ctx);
});

// ── JavaScriptCore ──
record("jsc (JavaScriptCore)", () => {
  const jsc = process.env.JSC || "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc";
  if (!existsSync(jsc)) return null;
  const file = join(outDir, "replay-jsc.js");
  writeFileSync(file, `${code}\nprint(JSON.stringify(SimReplay.determinismReport()));\n`);
  return JSON.parse(execFileSync(jsc, [file], { encoding: "utf8" }).trim().split("\n").pop());
});

// ── SpiderMonkey shell ──
record("spidermonkey (Firefox)", () => {
  const js = process.env.SPIDERMONKEY;
  if (!js || !existsSync(js)) return null;
  const file = join(outDir, "replay-sm.js");
  writeFileSync(file, `${code}\nprint(JSON.stringify(SimReplay.determinismReport()));\n`);
  return JSON.parse(execFileSync(js, [file], { encoding: "utf8" }).trim().split("\n").pop());
});

// ── Chromium ──
{
  const chrome = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (!existsSync(chrome)) {
    results.push({ engine: "chromium (V8)", status: "SKIPPED" });
  } else {
    try {
      const puppeteer = require("puppeteer-core");
      const browser = await puppeteer.launch({ executablePath: chrome, headless: "new", args: process.env.CI ? ["--no-sandbox"] : [] });
      const page = await browser.newPage();
      const r = await page.evaluate(`${code}\n;SimReplay.determinismReport()`);
      await browser.close();
      results.push({ engine: "chromium (V8)", status: "RAN", ...r });
    } catch (e) {
      results.push({ engine: "chromium (V8)", status: "ERROR", error: String(e).slice(0, 300) });
    }
  }
}

// ── Compare ──
const ran = results.filter((r) => r.status === "RAN");
const ref = ran[0];
let ok = ran.length > 0 && !!GOLDEN;
for (const r of results) {
  if (r.status !== "RAN") {
    console.log(`${r.status.padEnd(7)} ${r.engine}${r.error ? `  ${r.error}` : ""}`);
    if (r.status === "ERROR") ok = false;
    continue;
  }
  const same = r.replay === GOLDEN && r.sweepHash === ref.sweepHash && r.sweepLength === ref.sweepLength;
  if (!same) ok = false;
  console.log(`${same ? "MATCH  " : "DIFFER "} ${r.engine}  replay=${r.replay} sweep=${r.sweepHash}/${r.sweepLength}`);
}
console.log(`golden replay: ${GOLDEN}`);
console.log(ok ? `\nall ${ran.length} engines bit-identical` : "\nDETERMINISM FAILURE");
process.exit(ok ? 0 : 1);
