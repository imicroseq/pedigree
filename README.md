# Pedigree

Synchronizes Pangolin lineage data from a lineage file (URL, local, or GCS) into the VirusSeq SONG repository.

## How it works

Pedigree runs in two phases:

1. **UPDATECACHE** - streams the lineage file into Redis, keyed by `fasta_header_name`. Skips the fill if the file fingerprint matches the stored marker (content-based freshness, not time-based).
2. **UPDATEANALYSIS** - scans all SONG studies page-by-page, compares each analysis against the Redis cache, and PATCHes SONG only where the lineage differs.

Running without a profile executes both phases in sequence.

## Getting started

Requires Node.js v24 or higher.

```bash
npm ci
cp .env.schema .env   # populate all fields
npm run dev           # full pipeline (recommended)
```

For development details, local Redis setup, and troubleshooting: see [DEVELOPMENT.md](./DEVELOPMENT.md).

## Environment variables

| Variable | Type | Description |
|---|---|---|
| `ANALYSIS_TYPE_NAME` | String | Default `consensus_sequence`. SONG analysis type to target. |
| `API_RETRIES` | Number | Default `3`. Retries when SONG requests fail. |
| `API_TIMEOUT` | Number | Default `10000`. Response timeout for SONG requests (milliseconds). |
| `EGO_CLIENT_ID` | String | Ego client ID. |
| `EGO_CLIENT_SECRET` | String | Ego client secret. |
| `EGO_URL` | String | Ego API URL (include the `/api` path segment). |
| `ENABLE_DEBUG` | Boolean | Default `false`. Enables verbose debug logging. |
| `GS_BUCKET_NAME` | String | GCS bucket name (production). |
| `GS_FOLDER` | String | GCS folder path within the bucket (production). |
| `JWT_KEY` | String | Public key for JWT verification. Optional if `JWT_KEY_URL` is set. |
| `JWT_KEY_URL` | String | URL to fetch the public key. Optional if `JWT_KEY` is set. |
| `LINEAGE_FILE_SOURCE` | String | Optional. URL (`https://...`) or local path to the lineage file. When set, bypasses GCS entirely. |
| `NODE_ENV` | String | Optional. Runtime environment identifier. |
| `NOTIFICATIONS_SLACK_URL` | String | Webhook URL for Slack run notifications. |
| `REDIS_HOST` | String | Default `localhost`. Comma-separated hosts enable cluster mode (e.g. `host1:6379,host2:6379`). |
| `REDIS_PASSWORD` | String | Redis password. |
| `REDIS_PORT` | Number | Default `6379`. Used when a host entry omits a port. |
| `SONG_ENDPOINT` | String | SONG API base URL. |
| `SONG_PATCH_CONCURRENCY` | Number | Default `5`. Concurrent PATCH requests during UPDATEANALYSIS. |
| `TIMEZONE` | String | Default `America/Toronto`. Timezone for log timestamps (zoneId format). |

## Profiles

| Profile | Script | Description |
|---|---|---|
| _(none)_ | `npm run dev` | Full pipeline: UPDATECACHE then UPDATEANALYSIS (recommended) |
| `UPDATECACHE` | `npm run dev:updateCache` | Fill Redis from the lineage file only |
| `UPDATEANALYSIS` | `npm run dev:updateAnalysis` | Scan SONG and patch analyses using existing cache |

## Lineage file formats

Pedigree accepts both Pangolin lineage file formats produced by the Duotang pipeline:

| File | Format | Key column |
|---|---|---|
| `virusseq_metadata.tsv` | Tab-separated | `fasta header name` |
| `lineage_assignments.csv` | Comma-separated | `fasta_header` |

Header matching is case- and separator-tolerant, so `fasta_header_name`, `fasta_header`, and `fasta header name` are all treated as equivalent.
