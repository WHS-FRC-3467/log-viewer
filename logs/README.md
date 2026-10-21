# Bundled logs (optional)

Team logs normally live in the season storage repos listed in `site.config.json` `logSources` (e.g. WHS-FRC-3467/logs-2026), not here.

Logs committed here are built into the Pages site instead, which counts against its 1 GB limit; useful for a few examples. The build gzips them; paths here (minus `.gz`) are the shareable names, so use a folder that doesn't clash with a source's `folder`, e.g. `logs/examples/`.

Supported types: `.wpilog`, `.wpilogxz`, `.rlog`, `.dslog`, `.dsevents`, `.csv`, plus pre-gzipped variants. `.hoot` and `.revlog` are not supported.
