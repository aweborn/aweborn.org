const M = new URL("./mocks/", import.meta.url).href;
const map = { persistence: "persistence.mjs", creations: "creations.mjs", safety: "safety.mjs", research: "research.mjs", "making-of": "making-of.mjs" };
export async function resolve(spec, ctx, next) {
  const m = spec.match(/^\.\/([a-z-]+)\.(js|ts)$/);
  if (m && map[m[1]] && ctx.parentURL?.includes("/sync-service/src/")) return { url: M + map[m[1]], shortCircuit: true };
  if (process.env.TRACE && ctx.parentURL?.includes("sync-service")) console.error("resolve", spec, "from", ctx.parentURL);
  return next(spec, ctx);
}
