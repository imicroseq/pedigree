# Pedigree Roadmap

## Active

### Replace viralAI ETL with generic fileSource
Decouple lineage data ingestion from the ViralAI-specific TSV format. The new `fileSource.ts` introduces:
- ETL-agnostic naming (`getLatestLineageFile` vs `getLatestViralAIFile`)
- Robust header validation and alias mapping (tolerates alternate column names from different ETL producers)
- `streamLocalFile` for local-file bypass during testing (`LOCAL_FILE_PATH` env var)

**Status**: Complete — confirmed working in dev as of 2026-06-19. Awaiting production run to close fully.

### Cache redesign: file-state model with fingerprint freshness
Rewrote the two-phase pipeline to fix a root cause bug where stale cache caused analyses to be silently skipped.

- **UPDATECACHE**: streams the lineage file directly into Redis (file fields per row, keyed by `fasta_header_name`). Freshness is determined by file fingerprint (GCS `md5Hash`; local `mtime:size`), not time elapsed.
- **UPDATEANALYSIS**: scans SONG page-by-page across all studies; looks up each analysis in Redis; PATCHes only when lineage differs.
- Removed `CACHE_MAX_AGE_MINUTES` env var and time-based freshness logic entirely.
- **Important**: existing Redis deployments using the old cache format (SONG-state keys) must run `FLUSHDB` before the first run under this design. See `DEVELOPMENT.md`.

**Status**: Implementation complete and TypeScript-verified 2026-06-23. Awaiting first production run.

## Backlog

### SONG-driven cache invalidation (superseded)
Previously tracked as a potential enhancement; now moot. Cache freshness is driven by the lineage file fingerprint — if the file hasn't changed, the cache is reused regardless of SONG state changes. This is the correct behaviour: pedigree is the authoritative source of lineage data, not SONG.

- Update `doc/sequenceDiagram.md`: still references "ViralAI" in the flow labels; should be renamed to "lineage source" or similar to match the new generic framing.
