// Transpiles supabase/functions/pgc-mailchimp/render.ts into assets/js/newsletter-render.js:
// the copy the portal composer imports to draw its canvas with the very same
// code the sending service runs, so the preview and the sent email cannot
// drift apart. Plain TypeScript → ES2022 module, nothing bundled, no imports
// and nothing Node-specific in the output; the file is committed.
// tests/newsletter-render.test.mjs fails while the committed file differs from
// a fresh transpile, so rerun this after every edit of render.ts.
// Usage: node tools/build-newsletter-render.mjs   (TYPESCRIPT_MODULE=… to point at a typescript install)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SRC = path.join(ROOT, "supabase", "functions", "pgc-mailchimp", "render.ts");
export const OUT = path.join(ROOT, "assets", "js", "newsletter-render.js");
export const HEADER = "// GENERATED from supabase/functions/pgc-mailchimp/render.ts by tools/build-newsletter-render.mjs — do not edit; edit the .ts and rerun the build.\n";

/** The TypeScript compiler: $TYPESCRIPT_MODULE, then the package name, then the usual global installs. Null when none loads. */
export function loadTypeScript() {
  const require = createRequire(import.meta.url);
  for (const m of [process.env.TYPESCRIPT_MODULE, "typescript", "/opt/node22/lib/node_modules/typescript", "/usr/lib/node_modules/typescript", "/usr/local/lib/node_modules/typescript"].filter(Boolean)) {
    try { return require(m); } catch (e) { /* next */ }
  }
  return null;
}
/** render.ts as an ES2022 module, without the header comment. */
export function transpile(ts, source = fs.readFileSync(SRC, "utf8")) {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName: "render.ts" }).outputText;
}
/** The full file the build writes. */
export function build(ts) { return HEADER + transpile(ts); }
/** The committed file's code with the header comment removed; null when the file is missing. */
export function committed() {
  let s;
  try { s = fs.readFileSync(OUT, "utf8"); } catch (e) { return null; }
  return s.replace(/^\/\/ GENERATED[^\n]*\n/, "");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ts = loadTypeScript();
  if (!ts) { console.error("TypeScript is not installed (npm i -g typescript, or set TYPESCRIPT_MODULE)."); process.exit(2); }
  const out = build(ts);
  const same = fs.existsSync(OUT) && fs.readFileSync(OUT, "utf8") === out;
  if (!same) fs.writeFileSync(OUT, out);
  console.log(`${path.relative(ROOT, OUT)} ${same ? "is up to date" : "written"} (${out.length} bytes, typescript ${ts.version})`);
}
