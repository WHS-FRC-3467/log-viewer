// Builds dist/: landing site + patched AdvantageScope Lite viewer + logs + assets.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fetchLite, liteVersion } from "./fetch-lite.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const MB = 1024 * 1024;
const warnings = [];
const t0 = Date.now();

const LOG_EXTS = [".wpilog", ".wpilogxz", ".rlog", ".dslog", ".dsevents", ".csv"];

function fail(msg) {
  console.error(`\nBUILD FAILED: ${msg}`);
  process.exit(1);
}
function walk(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out.sort();
}
function injectBefore(file, anchor, insertion, what) {
  let html = fs.readFileSync(file, "utf8");
  const i = html.indexOf(anchor);
  if (i < 0) fail(`Could not find anchor ${JSON.stringify(anchor)} in ${path.relative(root, file)} (${what}). The Lite markup probably changed; update scripts/build.mjs.`);
  html = html.slice(0, i) + insertion + html.slice(i);
  fs.writeFileSync(file, html);
}
function gitDate(rel) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", rel], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

const liteRoot = await fetchLite();
const version = liteVersion();
const staticDir = path.join(liteRoot, "static");

console.log("[build] cleaning dist/");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// ---- Landing site ----
const siteConfig = JSON.parse(fs.readFileSync(path.join(root, "site.config.json"), "utf8"));
for (const [i, s] of (siteConfig.logSources ?? []).entries()) {
  if (s.url ? typeof s.url !== "string" : !/^[\w.-]+\/[\w.-]+$/.test(s.repo ?? "")) fail(`site.config.json logSources[${i}] needs "repo": "owner/name" or "url"`);
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
for (const f of ["index.html", "app.js", "style.css"]) {
  let t = fs.readFileSync(path.join(root, "site", f), "utf8");
  if (f === "index.html") t = t.replaceAll("{{TITLE}}", esc(siteConfig.title ?? "Log Viewer")).replaceAll("{{TEAM}}", esc(siteConfig.teamNumber ?? ""));
  fs.writeFileSync(path.join(dist, f), t);
}
fs.writeFileSync(path.join(dist, "site.config.json"), JSON.stringify(siteConfig));
fs.writeFileSync(path.join(dist, ".nojekyll"), "");
fs.copyFileSync(path.join(liteRoot, "LICENSE"), path.join(dist, "LICENSE-AdvantageScope.txt"));
fs.copyFileSync(path.join(liteRoot, "ThirdPartyLicenses.txt"), path.join(dist, "ThirdPartyLicenses.txt"));
for (const f of ["log-index.js", "viewer-shim.js"]) fs.copyFileSync(path.join(root, "site", f), path.join(dist, f));

// ---- Viewer ----
const viewer = path.join(dist, "viewer");
console.log(`[build] copying Lite ${version} static site`);
fs.cpSync(staticDir, viewer, { recursive: true, filter: (src) => path.relative(staticDir, src).split(path.sep)[0] !== "bundledAssets" });

injectBefore(
  path.join(viewer, "index.html"),
  '<script type="module" src="bundles/main.js"></script>',
  '<script src="../log-index.js"></script>\n    <script src="../viewer-shim.js"></script>\n    ',
  "viewer shim"
);
// hub.html has a strict CSP (script-src 'self'), so the hub shim must be an external file.
fs.writeFileSync(
  path.join(viewer, "www", "hub-shim.js"),
  "// Lets drag-and-drop work in Lite: dropped File objects are registered with the parent shim and given virtual paths.\n" +
    "window.electron = { getFilePath: (f) => parent.__lsRegisterFile(f) };\n"
);
injectBefore(
  path.join(viewer, "www", "hub.html"),
  '<script type="module" src="../bundles/hub.js"></script>',
  '<script src="hub-shim.js"></script>\n    ',
  "hub drag-and-drop shim"
);

// ---- Assets ----
const assetsOut = path.join(viewer, "assets");
// site.config.json "excludeBundledAssets": bundled asset folders to leave out (saves Pages space).
const excluded = new Set(siteConfig.excludeBundledAssets ?? []);
fs.cpSync(path.join(staticDir, "bundledAssets"), assetsOut, {
  recursive: true,
  filter: (src) => !excluded.has(path.relative(path.join(staticDir, "bundledAssets"), src).split(path.sep)[0]),
});
const userAssets = path.join(root, "assets");
if (fs.existsSync(userAssets)) {
  for (const e of fs.readdirSync(userAssets, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    fs.rmSync(path.join(assetsOut, e.name), { recursive: true, force: true });
    fs.cpSync(path.join(userAssets, e.name), path.join(assetsOut, e.name), { recursive: true });
  }
}
const assetIndex = {};
for (const rel of walk(assetsOut)) {
  const name = path.posix.basename(rel);
  if (name.startsWith(".") || /^readme(\..*)?$/i.test(name) || rel === "index.json") continue;
  let contents = null;
  if (name === "config.json") {
    try {
      contents = JSON.parse(fs.readFileSync(path.join(assetsOut, rel), "utf8"));
    } catch {
      warnings.push(`assets/${rel}: invalid JSON, indexed as null`);
    }
  }
  assetIndex[rel] = contents;
}
fs.writeFileSync(path.join(assetsOut, "index.json"), JSON.stringify(assetIndex));

// ---- Logs ----
const logsSrc = path.join(root, "logs");
const logsOut = path.join(dist, "logs");
fs.mkdirSync(logsOut, { recursive: true });
const logs = [];
for (const rel of walk(logsSrc)) {
  const base = path.posix.basename(rel);
  if (base.startsWith(".") || /^readme/i.test(base)) continue;
  const isGz = rel.toLowerCase().endsWith(".gz");
  const logical = isGz ? rel.slice(0, -3) : rel;
  const ext = path.posix.extname(logical).toLowerCase();
  if (!LOG_EXTS.includes(ext)) continue;
  const src = path.join(logsSrc, rel);
  const raw = fs.readFileSync(src);
  let stored, encoding, size, file;
  if (isGz) {
    stored = raw;
    encoding = "gzip";
    size = raw.length >= 4 ? raw.readUInt32LE(raw.length - 4) : raw.length; // ISIZE trailer (mod 2^32)
    file = rel;
  } else if (ext === ".wpilogxz") {
    stored = raw;
    encoding = null;
    size = raw.length;
    file = logical;
  } else {
    stored = zlib.gzipSync(raw, { level: 9 });
    encoding = "gzip";
    size = raw.length;
    file = logical + ".gz";
  }
  const dest = path.join(logsOut, ...file.split("/"));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, stored);
  if (stored.length > 95 * MB) warnings.push(`logs/${file} is ${(stored.length / MB).toFixed(1)} MB (> 95 MB; GitHub's limit is 100 MB per file)`);
  const date = gitDate(path.posix.join("logs", rel)) ?? fs.statSync(src).mtime.toISOString();
  logs.push({ path: logical, file, encoding, size, compressedSize: stored.length, date });
}
fs.writeFileSync(path.join(logsOut, "index.json"), JSON.stringify({ generatedAt: new Date().toISOString(), logs }, null, 1));

// ---- Summary ----
let total = 0;
for (const f of walk(dist)) {
  const s = fs.statSync(path.join(dist, f)).size;
  total += s;
  if (s > 95 * MB && !f.startsWith("logs/")) warnings.push(`${f} is ${(s / MB).toFixed(1)} MB (> 95 MB)`);
}
if (total > 900 * MB) warnings.push(`dist is ${(total / MB).toFixed(0)} MB (> 900 MB; GitHub Pages limit is 1 GB)`);
const logBytes = logs.reduce((a, l) => a + l.compressedSize, 0);
const rawBytes = logs.reduce((a, l) => a + l.size, 0);
console.log("\n[build] done");
console.log(`  Lite version : ${version}`);
console.log(`  Log sources  : ${(siteConfig.logSources ?? []).map((s) => s.repo ?? s.url).join(", ") || "none"} (read at runtime)`);
console.log(`  Logs         : ${logs.length} bundled (${(rawBytes / MB).toFixed(2)} MB raw -> ${(logBytes / MB).toFixed(2)} MB stored)`);
console.log(`  Assets       : ${Object.keys(assetIndex).length} files, ${new Set(Object.keys(assetIndex).map((k) => k.split("/")[0])).size} folders`);
console.log(`  dist total   : ${(total / MB).toFixed(1)} MB`);
console.log(`  Build time   : ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const w of warnings) console.warn(`  WARNING: ${w}`);
