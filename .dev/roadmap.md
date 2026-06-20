# Pedigree Roadmap

## Active

### Replace viralAI ETL with generic fileSource
Decouple lineage data ingestion from the ViralAI-specific TSV format. The new `fileSource.ts` introduces:
- ETL-agnostic naming (`getLatestLineageFile` vs `getLatestViralAIFile`)
- Robust header validation and alias mapping (tolerates alternate column names from different ETL producers)
- `streamLocalFile` for local-file bypass during testing (`LOCAL_FILE_PATH` env var)

**Status**: Complete — confirmed working in dev as of 2026-06-19. Awaiting production run to close fully.

## Backlog

### SONG-driven cache invalidation (low priority)
Currently `updateCache` skips a refill only when `CACHE_MAX_AGE_MINUTES` is set and the marker key is fresh — a manual dev mechanism. A smarter alternative would detect that SONG's data has changed (e.g. new analyses published, or a total-count mismatch per study) and trigger a selective or full refill automatically. Requires either a SONG event stream, a webhook, or a periodic count-diff query. Deferred until the fileSource ETL replacement is confirmed stable in prod.

- Update `doc/sequenceDiagram.md`: still references "ViralAI" in the flow labels; should be renamed to "lineage source" or similar to match the new generic framing.
- `cache/index.ts` still uses 2-space indentation; rest of codebase uses tabs. Formatting-only PR candidate.
