// Downloads the pinned AdvantageScope Lite release (.ipk) and extracts its static site.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import * as tar from "tar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(root, ".cache");

export function liteVersion() {
  return JSON.parse(fs.readFileSync(path.join(root, "lite.config.json"), "utf8")).version;
}
export function liteDir(version = liteVersion()) {
  return path.join(cacheDir, "lite", version);
}

function parseAr(buf) {
  if (buf.subarray(0, 8).toString("latin1") !== "!<arch>\n") throw new Error("Not an ar archive");
  const members = {};
  let o = 8;
  while (o + 60 <= buf.length) {
    const name = buf.subarray(o, o + 16).toString("latin1").trim().replace(/\/$/, "");
    const size = parseInt(buf.subarray(o + 48, o + 58).toString("latin1").trim(), 10);
    o += 60;
    members[name] = buf.subarray(o, o + size);
    o += size + (size % 2);
  }
  return members;
}

export async function fetchLite() {
  const version = liteVersion();
  const out = liteDir(version);
  if (fs.existsSync(path.join(out, ".complete"))) {
    console.log(`[fetch-lite] ${version} already extracted`);
    return out;
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  const ipk = path.join(cacheDir, `advantagescope-lite-${version}.ipk`);
  if (!fs.existsSync(ipk)) {
    const url = `https://github.com/Mechanical-Advantage/AdvantageScope/releases/download/${version}/advantagescope-lite-${version}.ipk`;
    console.log(`[fetch-lite] downloading ${url}`);
    let res;
    try {
      res = await fetch(url, { redirect: "follow" });
    } catch (e) {
      if (String(e?.cause?.code).includes("CERT")) console.error("TLS error: behind a TLS-inspecting proxy? Re-run with NODE_OPTIONS=--use-system-ca");
      throw e;
    }
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    const tmp = ipk + ".part";
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
    fs.renameSync(tmp, ipk);
  }
  console.log("[fetch-lite] extracting");
  const members = parseAr(fs.readFileSync(ipk));
  const dataName = Object.keys(members).find((n) => n.startsWith("data.tar"));
  if (!dataName) throw new Error("data.tar.* not found in ipk");
  let data = members[dataName];
  if (dataName.endsWith(".gz")) data = zlib.gunzipSync(data);
  else if (!dataName.endsWith(".tar")) throw new Error(`Unsupported member ${dataName}`);

  const tmpDir = out; // extract in place (renames fail on some Windows setups); ".complete" marks success
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  const tarFile = path.join(cacheDir, "data.tar");
  fs.writeFileSync(tarFile, data);
  // Strip "./usr/local/bin/advantagescope-lite/"
  const prefix = "usr/local/bin/advantagescope-lite/";
  await tar.x({
    file: tarFile,
    cwd: tmpDir,
    filter: (p) => p.replace(/^\.\//, "").startsWith(prefix),
    onReadEntry: (entry) => {
      entry.path = entry.path.replace(/^\.\//, "").slice(prefix.length);
    },
  });
  fs.rmSync(tarFile, { force: true });
  if (!fs.existsSync(path.join(tmpDir, "static", "index.html"))) throw new Error("static/index.html missing after extraction");
  fs.writeFileSync(path.join(out, ".complete"), new Date().toISOString());
  console.log(`[fetch-lite] extracted to ${out}`);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchLite().catch((e) => { console.error(e); process.exit(1); });
}
