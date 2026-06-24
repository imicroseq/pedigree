# Development Guide

Internal guide for developers working on this codebase — local setup, dependencies, scripts, and known gotchas.

---

## Prerequisites

- [Node.js](https://nodejs.org/) v24 or higher
- `kubectl` access to the iMicroSeq cluster (for Redis port-forward)
- Access to dev EGO and SONG endpoints (credentials in `.env`)

---

## Local setup

Copy `.env.schema` to `.env` and fill in the values:

```bash
cp .env.schema .env
```

Key variables for local development:

| Variable | Dev value | Notes |
|---|---|---|
| `SONG_ENDPOINT` | `https://song-clinical.dev.virusseq-dataportal.ca` | Use prod URL only when confident |
| `EGO_URL` | `https://ego.dev.virusseq-dataportal.ca/api` | The `/api` path segment is required |
| `EGO_CLIENT_ID` / `EGO_CLIENT_SECRET` | see team vault | |
| `REDIS_HOST` | `localhost` | No `http://` prefix |
| `REDIS_PORT` | `60318` | Must match your port-forward |
| `LOCAL_FILE_PATH` | `~/Downloads/virusseq_metadata.tsv` | Bypasses GCS; use for local testing |
| `SONG_PATCH_CONCURRENCY` | `5` | Concurrent PATCH requests during UPDATEANALYSIS |

Install dependencies:

```bash
npm install
```

---

## Redis port-forward

Pedigree requires a Redis connection. In local development this is a port-forward to the cluster Redis:

```bash
kubectl port-forward -n <namespace> svc/<redis-service> <REDIS_PORT>:6379
```

The port-forward must be active before running any script. If you see `AggregateError` on startup, the port-forward is not running or is on the wrong port.

---

## Running locally

Always use the `dev:*` scripts during development — they run via `ts-node` against the source directly. The `start` / `start:*` scripts run compiled output from `dist/` and will be stale unless you have run `npm run build` first.

| Script | What it does |
|---|---|
| `npm run dev` | Full pipeline: fill cache from lineage file, then scan SONG and patch analyses |
| `npm run dev:updateCache` | Cache fill only — streams the lineage file into Redis |
| `npm run dev:updateAnalysis` | Analysis update only — scans SONG and patches using the existing cache |

For production:

```bash
npm run build        # compiles src/ → dist/ (clears dist/ first via prebuild)
npm start            # runs compiled output
```

---

## Architecture: two-phase pipeline

Pedigree runs in two phases, either separately (via profiles) or together (default).

### Phase 1: UPDATECACHE — file to Redis

1. Validates the lineage file (checks required columns are present).
2. Computes a fingerprint for the file: `md5Hash` from GCS metadata, or `<mtimeMs>:<size>` for local files.
3. Compares the fingerprint against the fill marker stored in Redis. If they match, the cache is current and the fill is skipped.
4. If stale or absent, streams every row of the lineage file into Redis. Each row is keyed by `fasta_header_name` (lowercased) and stores the five lineage fields: `lineage`, `pangolinVersion`, `pangolinDataVersion`, `scorpioCall`, `scorpioVersion`.
5. Writes a fill marker (`pedigree:cache:fill`) with the file name, fingerprint, and fill timestamp.

### Phase 2: UPDATEANALYSIS — SONG scan to PATCH

1. Checks for a fill marker; logs a warning if none is found (cache was never filled or was cleared).
2. Resolves the latest SONG schema version for the configured analysis type (fails fast if SONG is unreachable).
3. Iterates all studies returned by SONG, paginating through analyses (100 per page).
4. For each analysis, looks up `sample_collection.fasta_header_name` in Redis.
   - If not found in cache: skip (this analysis has no lineage assignment in the file).
   - If `lineage_analysis.lineage_name` already matches the cached value: skip (no change needed).
   - Otherwise: PATCH SONG with the five lineage fields.
5. Patches are issued in concurrent batches (`SONG_PATCH_CONCURRENCY`, default 5).

### Cache key format

Cache entries are stored under the lowercased `fasta_header_name` (e.g. `hcov-19/canada/sk-rrpl-720239/2024`). The fill marker is stored under `pedigree:cache:fill`.

### Upgrading from an older Redis cache

The cache schema changed in v2.0.0. Prior versions stored SONG state (analysisId, studyId, lineageName) under a different key structure. If Redis contains old-format entries, **flush the cache before the first run** under the new design:

```bash
# via redis-cli through a port-forward:
redis-cli -h localhost -p <REDIS_PORT> FLUSHDB
```

After flushing, run UPDATECACHE before UPDATEANALYSIS.

---

## Lineage file sources

Pedigree supports two lineage file sources, controlled by environment variables:

**Local file (for testing):**
Set `LOCAL_FILE_PATH` to a local `.tsv` or `.csv` file. Bypasses GCS entirely. Fingerprint is computed from the file's `mtime` and `size` — no MD5 calculation needed.

**GCS (production):**
Set `GS_BUCKET_NAME` and `GS_FOLDER`. Unset or empty `LOCAL_FILE_PATH`. The script fetches the latest file from the bucket. Fingerprint is taken from GCS object metadata (`md5Hash`), with a fallback to `updated:size` if `md5Hash` is absent.

The Duotang pipeline produces two Pangolin lineage file formats:
- `virusseq_metadata.tsv` — tab-separated, full metadata, column `fasta header name`
- `lineage_assignments.csv` — comma-separated, lighter, column `fasta_header`

Both are handled by the header alias map in `src/services/fileSource.ts`.

---

## SONG schema version requirement

SONG enforces `enforceLatest=true`: analyses can only be PATCHed when they are at the latest schema version. Dev analyses submitted under older schema versions will be silently skipped (logged at `debug`).

**To enable patching in dev:** run SONG's migration script to upgrade dev analyses to the latest `consensus_sequence` schema version before testing the PATCH path. Check the SONG repository for the migration script.

In production, all analyses are at the current latest version and this is not an issue.

---

## Versioning

The `version` field in `package.json` is always `0.0.0-dev` on `main`. When preparing a release, the developer updates it to the real version (e.g. `2.0.0`) on the `release` branch - Jenkins reads that value and uses it for Docker image tags and git tags. Do not change the version field on `main`; version intent is tracked in `CHANGELOG.md` instead.

---

## Maintenance scripts

```bash
npm run clear:dist          # remove compiled output
npm run clear:nodeModules   # remove all node_modules
npm run reset               # clear both and reinstall
```

---

## Platform data pipeline

Pedigree sits at the beginning of a multi-stage pipeline. When it runs successfully, data flows as follows:

1. **Pedigree** reads a lineage file from GCS (or `LOCAL_FILE_PATH`), fills Redis, then scans SONG and PATCHes analyses whose lineage fields are missing or outdated.
2. **SONG** persists the updated analysis and emits an event downstream. Indexing is triggered automatically - no manual intervention is required.
3. **Elasticsearch** receives the upserted document in the `clinical_centric` index.
4. **Arranger** serves the indexed data to the portal via GraphQL.

### Verifying data in Arranger

Arranger uses double-underscore notation for nested ES fields. To check whether lineage data is present after a run:

```graphql
query {
  clinical {
    aggregations {
      analysis__lineage_analysis__lineage_name {
        buckets { key doc_count }
      }
    }
  }
}
```

A non-empty `buckets` array confirms lineage data is indexed. Analyses without a matching TSV row will appear as `__missing__` - a ~40% gap is normal in dev when only a subset of analyses have lineage assignments.

### What to check when data is missing in the portal

1. Confirm pedigree ran without errors and patched the expected analyses.
2. Query the SONG analysis directly to verify the lineage fields were written.
3. Query Arranger (see above) - if the bucket is there, the data reached ES; the issue is in the portal layer.
4. If Arranger shows no data, check the ES index directly or inspect the indexing service logs.

---

## Working documents

The `.dev/` directory is the shared context layer for this project:

- [`.dev/roadmap.md`](.dev/roadmap.md) - planned work and architectural evolution
- [`.dev/tech-debt.md`](.dev/tech-debt.md) - known issues; `standalone: yes` items can be picked up freely
- [`.dev/sessions.md`](.dev/sessions.md) - log of what was done each session and open threads
