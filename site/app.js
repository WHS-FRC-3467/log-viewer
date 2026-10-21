(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var logs = [];
  var folder = ""; // current folder, "" = root

  function fmtSize(n) {
    if (n < 1024) return n + " B";
    var u = ["KB", "MB", "GB"], i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return n.toFixed(n < 10 ? 2 : 1) + " " + u[i];
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg; t.classList.add("show");
    setTimeout(function () { t.classList.remove("show"); }, 1800);
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function viewerUrl(path) { return "viewer/?log=" + encodeURIComponent(path).replace(/%2F/g, "/"); }
  function absViewerUrl(path) { return new URL(viewerUrl(path), location.href).href; }

  function setFolder(f, push) {
    folder = f;
    if (push !== false) {
      var u = new URL(location.href);
      if (f) u.searchParams.set("dir", f); else u.searchParams.delete("dir");
      history.replaceState(null, "", u.toString());
    }
    render();
  }

  function renderCrumbs(searching) {
    var c = $("crumbs");
    c.textContent = "";
    if (searching) { c.appendChild(el("span", "muted", "Search results across all folders")); return; }
    var parts = folder ? folder.split("/") : [];
    var root = el("a", null, "All logs");
    root.href = "#"; root.onclick = function (e) { e.preventDefault(); setFolder(""); };
    c.appendChild(root);
    var acc = "";
    parts.forEach(function (p, i) {
      acc += (i ? "/" : "") + p;
      c.appendChild(el("span", "sep", "/"));
      var target = acc;
      if (i === parts.length - 1) c.appendChild(el("span", null, p));
      else {
        var a = el("a", null, p); a.href = "#";
        a.onclick = function (e) { e.preventDefault(); setFolder(target); };
        c.appendChild(a);
      }
    });
  }

  function render() {
    var q = $("search").value.trim().toLowerCase();
    var sort = $("sort").value;
    var list = $("list");
    list.textContent = "";
    renderCrumbs(!!q);

    var items = [], folders = new Map();
    if (q) {
      items = logs.filter(function (l) { return l.path.toLowerCase().indexOf(q) >= 0; });
    } else {
      var prefix = folder ? folder + "/" : "";
      logs.forEach(function (l) {
        if (l.path.indexOf(prefix) !== 0) return;
        var rest = l.path.slice(prefix.length), slash = rest.indexOf("/");
        if (slash < 0) items.push(l);
        else {
          var name = rest.slice(0, slash), f = folders.get(name) || { name: name, count: 0, date: "" };
          f.count++; if (l.date > f.date) f.date = l.date;
          folders.set(name, f);
        }
      });
    }
    var cmp = {
      "date-desc": function (a, b) { return (b.date || "").localeCompare(a.date || ""); },
      "date-asc": function (a, b) { return (a.date || "").localeCompare(b.date || ""); },
      "name-asc": function (a, b) { return a.path.localeCompare(b.path, undefined, { numeric: true }); },
      "name-desc": function (a, b) { return b.path.localeCompare(a.path, undefined, { numeric: true }); },
    }[sort];
    items.sort(cmp);
    var fl = Array.from(folders.values());
    fl.sort(sort.indexOf("date") === 0
      ? function (a, b) { return sort === "date-desc" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date); }
      : function (a, b) { var r = a.name.localeCompare(b.name, undefined, { numeric: true }); return sort === "name-desc" ? -r : r; });

    fl.forEach(function (f) {
      var row = el("div", "row folder");
      var main = el("div", "main");
      var nm = el("div", "name");
      var a = el("a", null, "📁 " + f.name);
      var target = (folder ? folder + "/" : "") + f.name;
      a.href = "?dir=" + encodeURIComponent(target);
      a.onclick = function (e) { e.preventDefault(); setFolder(target); };
      nm.appendChild(a); main.appendChild(nm);
      main.appendChild(el("div", "meta", f.count + (f.count === 1 ? " log" : " logs")));
      row.appendChild(main); list.appendChild(row);
    });
    items.forEach(function (l) {
      var row = el("div", "row");
      var main = el("div", "main");
      var nm = el("div", "name");
      var a = el("a", null, q ? l.path : l.path.split("/").pop());
      a.href = viewerUrl(l.path);
      nm.appendChild(a); main.appendChild(nm);
      main.appendChild(el("div", "meta", [fmtDate(l.date), fmtSize(l.size) + (l.encoding ? " (" + fmtSize(l.compressedSize) + " stored)" : "")].filter(Boolean).join(" · ")));
      var acts = el("div", "acts");
      var open = el("a", "btn primary", "Open"); open.href = viewerUrl(l.path);
      var copy = el("button", null, "Copy link"); copy.type = "button";
      copy.onclick = function () {
        var url = absViewerUrl(l.path);
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
          function () { toast("Link copied"); },
          function () { window.prompt("Copy this link", url); });
      };
      var dl = el("a", "btn", "Download"); dl.href = l.url; dl.setAttribute("download", decodeURIComponent(l.url.split("/").pop()));
      acts.append(open, copy, dl);
      row.append(main, acts); list.appendChild(row);
    });
    var empty = $("empty");
    empty.hidden = fl.length + items.length > 0;
    empty.textContent = q ? "No logs match your search." : logs.length ? "This folder is empty." : "No logs have been added yet.";
  }

  // ---- local file -> IndexedDB -> viewer ----
  function openLocal(file) {
    if (!file) return;
    if (/\.(hoot|revlog)$/i.test(file.name)) { alert("Phoenix .hoot and REV .revlog files are not supported. Convert them first."); return; }
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var req = indexedDB.open("logserver", 1);
    req.onupgradeneeded = function () { if (!req.result.objectStoreNames.contains("files")) req.result.createObjectStore("files"); };
    req.onerror = function () { alert("Could not store the file in this browser (private mode?)."); };
    req.onsuccess = function () {
      var db = req.result, tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put({ file: file, name: file.name }, id);
      tx.oncomplete = function () { db.close(); location.href = "viewer/?local=" + encodeURIComponent(id); };
      tx.onerror = function () { alert("Could not store the file in this browser."); };
    };
  }
  var drop = $("drop");
  ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (e) { openLocal(e.dataTransfer.files[0]); });
  $("picker").addEventListener("change", function (e) { openLocal(e.target.files[0]); });

  $("search").addEventListener("input", render);
  $("sort").addEventListener("change", render);

  LogIndex.load().then(function (j) {
    logs = j.logs;
    if (j.errors.length) { $("warn").hidden = false; $("warn").textContent = "Some log storage could not be reached, so the list may be incomplete: " + j.errors.join("; "); }
    var d = new URL(location.href).searchParams.get("dir");
    if (d) folder = d.replace(/^\/+|\/+$/g, "");
    render();
  }).catch(function () {
    $("empty").hidden = false; $("empty").textContent = "Could not load the log index.";
  });
})();
