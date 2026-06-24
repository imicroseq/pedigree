# Changelog

## v2.0.0 - Pipeline redesign

### Background

Prior to v2.0.0, pedigree used a SONG-driven cache model. UPDATECACHE fetched every analysis from SONG and stored SONG's current lineage state in Redis, keyed by `fasta_header_name`. UPDATEANALYSIS then streamed the lineage file and compared each row against the cached SONG state, patching SONG only when the file's lineage differed from what was cached.

This design had a critical flaw: the cache was write-once. Once an analysis was stored in Redis, a guard prevented it from being updated on subsequent UPDATECACHE runs. If SONG's lineage data was cleared or corrected after the cache was filled - which happened to 151 UHTC-ON analyses in dev - the cache still showed the old value. UPDATEANALYSIS would compare the lineage file's value against the stale cache entry, see no difference, and skip the PATCH. SONG would remain un-updated indefinitely.

A second problem was performance: UPDATECACHE had to paginate through all SONG analyses (potentially hundreds of thousands of records across all studies) before any patching could begin, making the cache fill slow and tightly coupled to SONG availability.

### What changed

The pipeline direction was inverted: the cache now stores lineage file state, not SONG state.

**UPDATECACHE** no longer touches SONG. It streams the lineage file directly into Redis - one entry per row, storing the five lineage fields (`lineage`, `pangolinVersion`, `pangolinDataVersion`, `scorpioCall`, `scorpioVersion`) keyed by lowercased `fasta_header_name`. Cache freshness is determined by a file fingerprint: the GCS `md5Hash` for bucket files, or an `mtime+size` composite for local files. If the fingerprint matches the stored fill marker, the fill is skipped entirely. If the file has changed - or no marker exists - the cache is rebuilt from scratch.

**UPDATEANALYSIS** no longer reads the lineage file. It scans SONG page-by-page across all studies, looks up each analysis's `fasta_header_name` in Redis, and PATCHes SONG only when the cached lineage differs from what SONG currently holds. Patches are issued concurrently (configurable via `SONG_PATCH_CONCURRENCY`).

The `CACHE_MAX_AGE_MINUTES` environment variable was removed. Time-based freshness was replaced by content-based freshness via file fingerprint.

### Why it's better

**Correctness:** The write-once cache bug is gone. The cache always reflects the current lineage file. UPDATEANALYSIS always compares SONG's current state against the source of truth (the file, via cache), rather than against a potentially stale snapshot of what SONG used to contain.

**Speed:** UPDATECACHE is now bounded by file size and Redis write throughput, not SONG API pagination. Streaming a file to Redis is significantly faster than paginating hundreds of thousands of SONG analyses.

**Separation of concerns:** Each phase has a single data source. UPDATECACHE reads the file. UPDATEANALYSIS reads SONG. Neither phase depends on the other's data source being available during its own run.

**Resilience:** If SONG is temporarily unavailable, UPDATECACHE can still run and keep the cache current. If the lineage file hasn't changed, UPDATECACHE skips the fill entirely, regardless of SONG state.

### Migration note for existing deployments

The key structure and stored fields are incompatible with the old format. Flush Redis before the first run under the new design:

```bash
redis-cli -h <host> -p <port> -a <password> FLUSHDB
```

Run UPDATECACHE before UPDATEANALYSIS after flushing.

---

### Also in v2.0.0

- Replaced the viralAI-specific ETL with a generic `fileSource` abstraction: supports both TSV and CSV, and tolerates column name variants across Pangolin lineage file formats (`fasta_header_name`, `fasta_header`, `fasta header name`)
- Added progress logging during cache fill: logs every 10k rows written with elapsed time, so long fills give continuous feedback instead of appearing frozen
- Removed per-analysis "No change needed" debug logging during UPDATEANALYSIS: silent skip is the correct behaviour; the run summary already reports totals
