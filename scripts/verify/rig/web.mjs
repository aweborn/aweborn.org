// Sandbox rig: serve the frontend without Vite's native bundler (which can't be installed
// in a sandbox that holds only another platform's node_modules). Not a build tool: it
// transpiles each src/ and shared/ file on request with the TypeScript compiler and points
// bare imports at the dependency bundles Vite already made (node_modules/.vite/deps, left
// by any earlier `npm run dev`). Good enough to open the app in headless Chrome and look.
//   node scripts/verify/rig/web.mjs [port]      (default 5173; reads .env for VITE_*)
import http from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(join(ROOT, "package.json"));
const ts = require("typescript");
const PORT = Number(process.argv[2] ?? 5173);
const DEPS = join(ROOT, "node_modules/.vite/deps");
const optimized = JSON.parse(readFileSync(join(DEPS, "_metadata.json"), "utf8")).optimized;

const env = { MODE: "development", DEV: true, PROD: false, SSR: false, BASE_URL: "/" };
for (const line of existsSync(join(ROOT, ".env")) ? readFileSync(join(ROOT, ".env"), "utf8").split("\n") : []) {
  const m = /^(VITE_[A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
for (const [k, v] of Object.entries(process.env)) if (k.startsWith("VITE_")) env[k] = v;

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".glb": "model/gltf-binary", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".woff2": "font/woff2", ".wasm": "application/wasm",
};
const CODE = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

function findFile(abs) {
  if (existsSync(abs) && statSync(abs).isFile()) return abs;
  for (const e of [".ts", ".tsx", ".js"]) if (existsSync(abs + e)) return abs + e;
  for (const e of [".ts", ".tsx"]) if (existsSync(join(abs, "index" + e))) return join(abs, "index" + e);
  // "./x.js" written for the server's compiler, where only x.ts exists
  if (abs.endsWith(".js") && existsSync(abs.slice(0, -3) + ".ts")) return abs.slice(0, -3) + ".ts";
  return null;
}

function rewrite(spec, importer) {
  if (spec.startsWith("@aweborn/shared/") || spec.startsWith(".") || spec.startsWith("/")) {
    const [raw, query] = spec.split("?");
    const abs = raw.startsWith("@aweborn/shared/") ? join(ROOT, "shared", raw.slice("@aweborn/shared/".length))
      : raw.startsWith("/") ? join(ROOT, raw) : resolve(dirname(importer), raw);
    // One URL per file (its real path and extension), or the browser loads a module twice
    const file = findFile(abs) ?? abs;
    const path = "/" + file.slice(ROOT.length + 1).split("\\").join("/");
    if (query) return `${path}?${query}`;
    return CODE.includes(extname(file)) ? path : `${path}?import`;
  }
  const dep = optimized[spec];
  if (!dep) {
    console.error(`[rig] no pre-bundled dependency for "${spec}" in ${importer} (run the real Vite once on a machine that can)`);
    return spec;
  }
  return "/node_modules/.vite/deps/" + dep.file;
}

/**
 * Point every import at something the browser can fetch. Parsed (not a text search), so
 * the word "import" inside a string is left alone. Dependencies Vite bundled from CommonJS
 * (react…) only have a default export, so named imports are unpacked from it, as Vite does.
 */
function rewriteImports(code, file) {
  const sf = ts.createSourceFile(file + ".js", code, ts.ScriptTarget.ES2022, false, ts.ScriptKind.JS);
  const edits = [];
  let n = 0;
  const specEdit = (lit) => edits.push([lit.getStart(sf) + 1, lit.getEnd() - 1, rewrite(lit.text, file)]);
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const dep = optimized[node.moduleSpecifier.text];
      const c = node.importClause;
      if (dep?.needsInterop && c) {
        const v = `__cjs${n++}`;
        const lines = [`import ${v} from ${JSON.stringify(rewrite(node.moduleSpecifier.text, file))};`];
        if (c.name) lines.push(`const ${c.name.text} = ${v} && ${v}.__esModule ? ${v}.default : ${v};`);
        if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) lines.push(`const ${c.namedBindings.name.text} = ${v};`);
        if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
          for (const el of c.namedBindings.elements) lines.push(`const ${el.name.text} = ${v}[${JSON.stringify((el.propertyName ?? el.name).text)}];`);
        }
        edits.push([node.getStart(sf), node.getEnd(), lines.join(" ")]);
      } else specEdit(node.moduleSpecifier);
      return;
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) return specEdit(node.moduleSpecifier);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) specEdit(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  edits.sort((x, y) => y[0] - x[0]);
  for (const [start, end, text] of edits) code = code.slice(0, start) + text + code.slice(end);
  return code;
}

const cache = new Map();
function compile(file) {
  const mtime = statSync(file).mtimeMs;
  const hit = cache.get(file);
  if (hit && hit.mtime === mtime) return hit.code;
  let code = readFileSync(file, "utf8");
  if (/\.tsx?$/.test(file)) {
    code = ts.transpileModule(code, {
      fileName: file,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, isolatedModules: true, verbatimModuleSyntax: true, sourceMap: false },
    }).outputText;
  }
  code = rewriteImports(code, file).replace(/\bimport\.meta\.env\b/g, `(${JSON.stringify(env)})`);
  cache.set(file, { mtime, code });
  return code;
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const path = decodeURIComponent(url.pathname);
  const send = (status, type, body) => { res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(body); };
  try {
    if (path.startsWith("/src/") || path.startsWith("/shared/")) {
      const file = findFile(join(ROOT, path));
      if (!file) return send(404, "text/plain", "not found: " + path);
      const ext = extname(file);
      if (CODE.includes(ext)) return send(200, "text/javascript", compile(file));
      if (url.searchParams.has("inline") || url.searchParams.has("raw")) return send(200, "text/javascript", `export default ${JSON.stringify(readFileSync(file, "utf8"))}`);
      if (url.searchParams.has("import")) {
        if (ext === ".css") return send(200, "text/javascript", `const s=document.createElement("style");s.dataset.rig=${JSON.stringify(path)};s.textContent=${JSON.stringify(readFileSync(file, "utf8"))};document.head.appendChild(s);export default s.textContent`);
        if (ext === ".json") return send(200, "text/javascript", `export default ${readFileSync(file, "utf8")}`);
        return send(200, "text/javascript", `export default ${JSON.stringify(path)}`);
      }
      return send(200, MIME[ext] ?? "application/octet-stream", readFileSync(file));
    }
    if (path.startsWith("/node_modules/")) {
      const file = join(ROOT, path);
      if (!existsSync(file)) return send(404, "text/plain", "not found");
      return send(200, MIME[extname(file)] ?? "application/octet-stream", readFileSync(file));
    }
    const pub = join(ROOT, "public", path);
    if (path !== "/" && existsSync(pub) && statSync(pub).isFile()) return send(200, MIME[extname(pub)] ?? "application/octet-stream", readFileSync(pub));
    // Everything else is the app (client-side routes like /w/<id>)
    return send(200, "text/html", readFileSync(join(ROOT, "index.html"), "utf8"));
  } catch (err) {
    console.error(`[rig] ${path}: ${err.message}`);
    send(500, "text/plain", String(err.message));
  }
}).listen(PORT, () => console.log(`[rig] frontend on http://localhost:${PORT} (sync at ${env.VITE_SYNC_URL ?? "?"})`));
