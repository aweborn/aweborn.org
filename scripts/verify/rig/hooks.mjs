// Sandbox rig: run the sync-service and the tests where the native packages
// (tsx's esbuild, better-sqlite3) can't be installed. Use with:
//   node --no-warnings --experimental-transform-types --import ./scripts/verify/rig/hooks.mjs <file.ts>
// - "./x.js" resolves to "./x.ts" when only the .ts exists (what tsx does)
// - "better-sqlite3" resolves to a node:sqlite stand-in
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const shim = new URL("./sqlite-shim.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "better-sqlite3") return { url: shim, shortCircuit: true };
    if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL?.startsWith("file:")) {
      const ts = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
      if (!existsSync(fileURLToPath(new URL(specifier, context.parentURL))) && existsSync(fileURLToPath(ts))) return nextResolve(ts.href, context);
    }
    return nextResolve(specifier, context);
  },
});
