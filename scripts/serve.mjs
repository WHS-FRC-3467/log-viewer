// Tiny static server for dist/ (mimics GitHub Pages: .gz is served as-is, without Content-Encoding).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.PORT || 8080);
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".wasm": "application/wasm",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".gz": "application/gzip", ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".wpilog": "application/octet-stream", ".wpilogxz": "application/octet-stream",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".mp4": "video/mp4", ".webp": "image/webp",
};

http.createServer((req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const rel = decodeURIComponent(url.pathname);
    let file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) { res.writeHead(403).end("Forbidden"); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!rel.endsWith("/")) { res.writeHead(301, { Location: rel + "/" + url.search }).end(); return; }
      file = path.join(file, "index.html");
    }
    if (!fs.existsSync(file)) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found"); console.log(404, req.url); return; }
    const stat = fs.statSync(file);
    res.writeHead(200, {
      "Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-cache",
    });
    if (req.method === "HEAD") res.end(); else fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
}).listen(port, () => console.log(`Serving dist/ at http://localhost:${port}/`));
