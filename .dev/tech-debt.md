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

### Logging: cache-fill progress logged per 100-record batch
`cache/index.ts` logs a percentage progress line for every page of 100 analyses within each study. For large studies (ABPL-AB has ~99k records) this is ~990 log lines per study. Reduce to per-study summary only, or log at `debug`.
standalone: yes

~~### Logging: `isValidData` logs `!source?.lineage` instead of the value~~ — fixed 2026-06-19

### Logging: retry events logged at error instead of warn
`song.ts` `onRetry` callback logs at `error`. Retries are an expected transient-failure behaviour, not an error state; they should be `warn`.
standalone: yes

### Logging: unstructured format
Winston is configured with a plain-text printf format. Per global conventions, structured logging (key-value pairs) is first-class, both for machine queryability and for OWASP A09 compliance. All event-significant log lines (patch success/failure, cache miss, validation failure, script start/end) should emit structured objects, not interpolated strings.
standalone: yes

### Sequence diagram references ViralAI
`doc/sequenceDiagram.md` still labels the external source "ViralAI" in all three flow variants. Should be updated to a generic label ("lineage source" or "GCS bucket") to match the new ETL-agnostic architecture.
standalone: yes

### Async-executor anti-pattern in `cache/index.ts`
`getAndCacheAnalysisByStudy` and `saveCacheAnalysis` still use `new Promise(async (resolve, reject) => {...})`. `startLoadCachePipeline` was fixed to a plain `async function` but these two were not in scope. Both can be rewritten as plain async functions without behaviour change.
standalone: yes

### No tests
`package.json` test script is a placeholder (`echo "Error: no test specified" && exit 1`). No unit or integration tests exist. The header validation logic in `fileSource.ts` (`mapAndValidateHeaders`, `buildExpectedHeaderMap`) and the data-validity check in `services/index.ts` (`isValidData`) are the highest-value targets for initial coverage.
standalone: yes
