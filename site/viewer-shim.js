/*
 * viewer-shim.js
 * Replaces the Python lite_server.py endpoints for the static AdvantageScope Lite build:
 *   GET assets                 -> assets/index.json (generated at build time)
 *   GET logs?folder=...        -> JSON list of logs from log-index.js (this site + logSources)
 *   GET logs/<name>?folder=... -> log bytes (gunzipped in the browser), or a locally opened File
 * Also provides deep links (?log=..., ?local=<id>) and shareable-URL updates.
 * Classic script; must run after ../log-index.js and before bundles/main.js.
 */
(function () {
  "use strict";
  var origFetch = window.fetch.bind(window);
  var viewerBase = new URL(".", location.href); // .../viewer/
  var assetsPathA = viewerBase.pathname + "assets";
  var assetsPathB = viewerBase.pathname + "assets/";
  var logsPath = viewerBase.pathname + "logs";
  var logsPrefix = viewerBase.pathname + "logs/";

  // ---------- log index ----------
  function loadIndex() {
    return window.LogIndex.load();
  }

  function normFolder(f) {
    return (f || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  }
  function jsonResponse(obj) {
    return new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  function notFound(msg) {
    return new Response(msg || "Not found", { status: 404 });
  }

  // ---------- local files ----------
  var localFiles = new Map();
  var localCounter = 0;
  function registerFile(file) {
    var id = Date.now().toString(36) + "-" + (++localCounter);
    localFiles.set(id, file);
    forgetRepoLogs();
    return "__local__/" + id + "/" + file.name;
  }
  window.__lsRegisterFile = registerFile;

  // ---------- shareable URL ----------
  var shared = [];
  var lastLogFetch = 0;
  function setLogParams(paths) {
    try {
      var u = new URL(location.href);
      u.searchParams.delete("log");
      u.searchParams.delete("local");
      paths.forEach(function (p) { u.searchParams.append("log", p); });
      history.replaceState(history.state, "", u.toString());
    } catch (e) { /* ignore */ }
  }
  function noteRepoLog(path) {
    var now = Date.now();
    if (now - lastLogFetch > 3000) shared = []; // a new open-session started
    lastLogFetch = now;
    if (shared.indexOf(path) < 0) shared.push(path);
    setLogParams(shared);
  }
  function forgetRepoLogs() {
    shared = [];
    setLogParams([]);
  }

  // ---------- serving logs ----------
  function listLogs(index, folderParam) {
    var folder = normFolder(folderParam);
    var prefix = "";
    if (folder) {
      var p = folder + "/";
      if (index.logs.some(function (l) { return l.path.indexOf(p) === 0; })) prefix = p;
    }
    return index.logs
      .filter(function (l) { return l.path.indexOf(prefix) === 0; })
      .map(function (l) { return { name: l.path.slice(prefix.length), size: l.size }; });
  }

  function serveLog(index, name, folderParam) {
    var folder = normFolder(folderParam);
    var cands = [];
    if (folder) cands.push(folder + "/" + name);
    cands.push(name);
    cands.push(name.replace(/^\/+/, ""));
    var entry = null;
    for (var i = 0; i < cands.length && !entry; i++) entry = index.byPath.get(cands[i]) || null;
    if (!entry) return Promise.resolve(notFound("No such log: " + name));
    return window.LogIndex.fetchLog(entry).then(function (r) {
      if (r.ok) noteRepoLog(entry.path);
      return r;
    });
  }

  window.fetch = function (input, init) {
    try {
      var reqUrl = typeof input === "string" || input instanceof URL ? String(input) : input && input.url;
      var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
      if (reqUrl && method === "GET") {
        var u = new URL(reqUrl, location.href);
        if (u.origin === location.origin) {
          if (u.pathname === assetsPathA || u.pathname === assetsPathB) {
            return origFetch(new URL("assets/index.json", viewerBase), { cache: "no-cache" });
          }
          if (u.pathname === logsPath || u.pathname === logsPrefix.slice(0, -1) + "/") {
            return loadIndex().then(function (idx) {
              return jsonResponse(listLogs(idx, u.searchParams.get("folder")));
            });
          }
          if (u.pathname.indexOf(logsPrefix) === 0) {
            var name = decodeURIComponent(u.pathname.slice(logsPrefix.length));
            var m = /^__local__\/([^/]+)\/(.*)$/.exec(name);
            if (m) {
              var f = localFiles.get(m[1]);
              if (!f) return Promise.resolve(notFound("Local file no longer available"));
              forgetRepoLogs();
              return Promise.resolve(new Response(f, { status: 200, headers: { "Content-Type": "application/octet-stream" } }));
            }
            return loadIndex().then(function (idx) {
              return serveLog(idx, name, u.searchParams.get("folder"));
            });
          }
        }
      }
    } catch (e) {
      console.warn("[viewer-shim] fetch wrapper error", e);
    }
    return origFetch(input, init);
  };

  // ---------- deep links ----------
  function readLocalFromIdb(id) {
    return new Promise(function (resolve) {
      try {
        var open = indexedDB.open("logserver", 1);
        open.onupgradeneeded = function () {
          if (!open.result.objectStoreNames.contains("files")) open.result.createObjectStore("files");
        };
        open.onerror = function () { resolve(null); };
        open.onsuccess = function () {
          var db = open.result;
          var tx = db.transaction("files", "readwrite");
          var store = tx.objectStore("files");
          var get = store.get(id);
          get.onsuccess = function () {
            var rec = get.result || null;
            if (rec) store.delete(id);
            tx.oncomplete = function () { db.close(); resolve(rec); };
          };
          get.onerror = function () { db.close(); resolve(null); };
        };
      } catch (e) { resolve(null); }
    });
  }

  function whenHubReady() {
    return new Promise(function (resolve) {
      var tries = 0;
      (function poll() {
        var frame = document.querySelector("iframe.hub-frame");
        var w = frame && frame.contentWindow;
        var ready = false;
        try {
          ready = !!(w && w.messagePort && typeof w.messagePort.onmessage === "function" && w.assets !== null && w.assets !== undefined);
        } catch (e) { /* not ready */ }
        if (ready || ++tries > 200) return setTimeout(function () { resolve(ready ? w : null); }, 800);
        setTimeout(poll, 100);
      })();
    });
  }

  function openInHub(hub, paths) {
    // Equivalent to the main window sending "open-files" over the MessageChannel.
    hub.messagePort.onmessage({ data: { name: "open-files", data: { files: paths, merge: false } } });
  }

  var params = new URL(location.href).searchParams;
  var wantLogs = params.getAll("log").filter(Boolean);
  var wantLocal = params.get("local");
  if (wantLogs.length || wantLocal) {
    window.addEventListener("load", function () {
      Promise.all([whenHubReady(), wantLocal ? readLocalFromIdb(wantLocal) : null]).then(function (res) {
        var hub = res[0];
        var rec = res[1];
        if (!hub) { console.warn("[viewer-shim] hub never became ready; not opening deep link"); return; }
        if (wantLocal) {
          var file = rec && (rec.file || rec);
          if (!file) { console.warn("[viewer-shim] local file not found in IndexedDB"); return; }
          if (!(file instanceof File)) file = new File([file], (rec && rec.name) || "log.wpilog");
          var vp = registerFile(file);
          openInHub(hub, [vp]);
        } else {
          openInHub(hub, wantLogs);
        }
      });
    });
  }
})();
