/*
 * log-index.js
 * Loads the combined log list, shared by the landing page and the viewer.
 * Sources, in order (on a duplicate path the first one wins):
 *   1. logs/index.json on this site (logs committed to this repo, if any)
 *   2. each entry of site.config.json "logSources", e.g.
 *        { "repo": "WHS-FRC-3467/logs-2026", "branch": "main", "folder": "2026" }
 *      read from raw.githubusercontent.com at runtime, or { "url": "https://host/dir/", "folder": ... }
 *      for any other static host. Each source has an index.json; its "file" entries are relative to it.
 * Every log gets an absolute "url"; "path" is prefixed with the source's "folder".
 * Classic script; exposes window.LogIndex.
 */
(function () {
  "use strict";
  var scriptUrl = document.currentScript ? document.currentScript.src : location.href;
  var siteRoot = new URL(".", scriptUrl);

  function getJson(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(url + ": " + r.status);
      return r.json();
    });
  }
  function sourceBase(s) {
    if (s.url) return new URL(s.url.replace(/\/*$/, "/"), siteRoot).href;
    return "https://raw.githubusercontent.com/" + s.repo + "/" + encodeURIComponent(s.branch || "main") + "/";
  }
  function readSource(base, folder) {
    folder = (folder || "").replace(/^\/+|\/+$/g, "");
    return getJson(base + "index.json").then(function (j) {
      return (j.logs || []).map(function (l) {
        return {
          path: folder ? folder + "/" + l.path : l.path,
          url: new URL(l.file.split("/").map(encodeURIComponent).join("/"), base).href,
          encoding: l.encoding,
          size: l.size,
          compressedSize: l.compressedSize,
          date: l.date,
        };
      });
    });
  }

  var promise = null;
  function load() {
    if (promise) return promise;
    promise = getJson(new URL("site.config.json", siteRoot))
      .catch(function () { return {}; })
      .then(function (cfg) {
        var sources = [{ name: "this site", base: new URL("logs/", siteRoot).href, folder: "", optional: true }];
        (cfg.logSources || []).forEach(function (s) {
          sources.push({ name: s.repo || s.url, base: sourceBase(s), folder: s.folder });
        });
        return Promise.all(sources.map(function (s) {
          return readSource(s.base, s.folder).then(
            function (logs) { return { logs: logs }; },
            function (e) { return { logs: [], error: s.optional ? null : s.name + " (" + e.message + ")" }; }
          );
        }));
      })
      .then(function (results) {
        var byPath = new Map(), errors = [];
        results.forEach(function (r) {
          if (r.error) errors.push(r.error);
          r.logs.forEach(function (l) {
            if (byPath.has(l.path)) console.warn("[log-index] duplicate log path, keeping the first: " + l.path);
            else byPath.set(l.path, l);
          });
        });
        errors.forEach(function (e) { console.warn("[log-index] could not load " + e); });
        return { logs: Array.from(byPath.values()), byPath: byPath, errors: errors };
      });
    return promise;
  }

  // Fetches a log's bytes, gunzipping when the data is gzip (checked by magic number, so a host that
  // already decoded Content-Encoding still works).
  function fetchLog(entry) {
    return fetch(entry.url).then(function (r) {
      if (!r.ok) return r;
      return r.arrayBuffer().then(function (buf) {
        var b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
        var body = buf;
        if (b[0] === 0x1f && b[1] === 0x8b) {
          if (typeof DecompressionStream === "undefined") return new Response("This browser lacks DecompressionStream", { status: 500 });
          body = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
        }
        return new Response(body, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
      });
    });
  }

  window.LogIndex = { load: load, fetchLog: fetchLog };
})();
