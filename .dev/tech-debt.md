# Tech Debt

## Active / Blocking

_(none — previous blockers resolved)_

---

## Low Priority

~~### `dist/` must be rebuilt before `npm start`~~ — resolved 2026-06-19 via `prebuild` lifecycle hook

~~### Version filter in `isValidData` is redundant~~ — removed 2026-06-19

~~### Logging: error wrapping produces redundant prefixes~~ — fixed 2026-06-19

### Logging: every successful PATCH logged at info level
`song.ts` logs each successful PATCH at `info` with a running counter. For large runs (hundreds of thousands of analyses) this floods the log. Downgrade to `debug`; keep a single `info` summary at the end (already present in `index.ts` SUMMARY block).
standalone: yes

~~### Logging: cache-fill progress logged per 100-record batch~~ — resolved 2026-06-23; cache now filled by streaming the lineage file directly, no per-study pagination

~~### Logging: `isValidData` logs `!source?.lineage` instead of the value~~ — fixed 2026-06-19

### Logging: retry events logged at error instead of warn
`song.ts` `onRetry` callback logs at `error`. Retries are an expected transient-failure behaviour, not an error state; they should be `warn`.
standalone: yes

### Logging: unstructured format
Winston is configured with a plain-text printf format. Per global conventions, structured logging (key-value pairs) is first-class, both for machine queryability and for OWASP A09 compliance. All event-significant log lines (patch success/failure, cache miss, validation failure, cache fill progress, script start/end) should emit structured objects, not interpolated strings. Scope: all log call sites across `cache/index.ts`, `services/index.ts`, `services/song.ts`, `services/fileSource.ts`, and `index.ts`.
standalone: yes

### Sequence diagram references ViralAI
`doc/sequenceDiagram.md` still labels the external source "ViralAI" in all three flow variants. Should be updated to a generic label ("lineage source" or "GCS bucket") to match the new ETL-agnostic architecture.
standalone: yes

~~### Async-executor anti-pattern in `cache/index.ts`~~ — resolved 2026-06-23; `getAndCacheAnalysisByStudy` and `saveCacheAnalysis` removed in cache redesign

### Redis writes are sequential during cache fill
`makeRedisCacheWritable` in `cache/index.ts` issues one `saveHash` call per row and awaits it before processing the next row (stream backpressure). For large files (~650k rows in production) this serialises all Redis writes. Pipelining via `multi()`/`exec()` in batches would significantly reduce fill time.
standalone: yes

~~### No tests~~ — resolved 2026-06-23; 24 BDD tests added covering `normalizeHeaderKey`, `mapAndValidateHeaders`, `cacheKey`, `isMarkerFresh`, `shouldPatch`
