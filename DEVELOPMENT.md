# Development Guide

Internal guide for developers working on this codebase — local setup, dependencies, scripts, and known gotchas.

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
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
| `CACHE_MAX_AGE_MINUTES` | `0` | `0` = always recache; set to e.g. `240` to skip if cache is fresh |

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
| `npm run dev` | Full pipeline: fill cache from SONG, then update analyses from lineage file |
| `npm run dev:updateCache` | Cache fill only — fetches all SONG analyses into Redis |
| `npm run dev:updateAnalysis` | Analysis update only — reads lineage file, patches SONG using existing cache |

For production:

```bash
npm run build        # compiles src/ → dist/ (clears dist/ first via prebuild)
npm start            # runs compiled output
```

---

## Lineage file sources

Pedigree supports two lineage file sources, controlled by environment variables:

**Local file (for testing):**
Set `LOCAL_FILE_PATH` to a local `.tsv` file. Bypasses GCS entirely.

**GCS (production):**
Set `GS_BUCKET_NAME` and `GS_FOLDER`. Unset or empty `LOCAL_FILE_PATH`. The script fetches the latest file from the bucket.

The Duotang pipeline produces two file formats:
- `virusseq_metadata.tsv` — tab-separated, full metadata, column `fasta header name`
- `lineage_assignments.csv` — comma-separated, lighter, column `fasta_header`

Both are handled by the header alias map in `src/services/fileSource.ts`.

---

## Cache freshness

By default (`CACHE_MAX_AGE_MINUTES=0`) the cache is always refilled. Set a positive value to skip the refill when a recent fill marker exists in Redis:

```bash
CACHE_MAX_AGE_MINUTES=240   # skip if cache was filled in the last 4 hours
```

When running `npm run dev:updateAnalysis` against a cache that has no fill marker (e.g. a pre-existing cache), the script will check the Redis key count against SONG's published analysis count and stamp the marker automatically if the counts look reasonable.

---

## SONG schema version requirement

SONG enforces `enforceLatest=true`: analyses can only be PATCHed when they are at the latest schema version. Dev analyses submitted under older schema versions will be silently skipped (logged at `debug`).

**To enable patching in dev:** run SONG's migration script to upgrade dev analyses to the latest `consensus_sequence` schema version before testing the PATCH path. Check the SONG repository for the migration script.

In production, all analyses are at the current latest version and this is not an issue.

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

1. **Pedigree** reads a lineage TSV from GCS (or a local file via `LOCAL_FILE_PATH`). For each row, it looks up the corresponding SONG analysis in Redis by `fasta_header_name`, then PATCHes the analysis with the lineage fields.
2. **SONG** persists the updated analysis and emits an event downstream. Indexing is triggered automatically — no manual intervention is required.
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

A non-empty `buckets` array confirms lineage data is indexed. Analyses without a matching TSV row will appear as `__missing__` — a ~40% gap is normal in dev when only a subset of analyses have lineage assignments.

### What to check when data is missing in the portal

1. Confirm pedigree ran without errors and patched the expected analyses.
2. Query the SONG analysis directly to verify the lineage fields were written.
3. Query Arranger (see above) — if the bucket is there, the data reached ES; the issue is in the portal layer.
4. If Arranger shows no data, check the ES index directly or inspect the indexing service logs.

---

## Working documents

The `.dev/` directory is the shared context layer for this project:

- [`.dev/roadmap.md`](.dev/roadmap.md) — planned work and architectural evolution
- [`.dev/tech-debt.md`](.dev/tech-debt.md) — known issues; `standalone: yes` items can be picked up freely
- [`.dev/sessions.md`](.dev/sessions.md) — log of what was done each session and open threads
