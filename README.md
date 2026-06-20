# Pedigree (Sequence Lineage updating script)

The purpose of this script is to syncronize data from a Cloud Object Storage (as a .tsv format) to VirusSeq data repository.

## Getting started

This script has been tested using NodeJS v^16.

### Local configuration

1. `npm ci`
2. Copy [.env.schema](./.env.schema) file to a new file named `.env`. Populate all fields. See description of env variables in the **Environment variables** section.
3. `npm run dev` or `npm run dev:[profile]` See description of profiles in the **Profiles** section

### Environment variables

| VARIABLE                | TYPE    | DESCRIPTION                                                                                    |
| ----------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| LOCAL_FILE_PATH         | String  | Optional. When set, skips the Google bucket download and reads this TSV file instead.          |
| GS_BUCKET_NAME          | String  | Google Storage bucket name                                                                     |
| GS_FOLDER               | String  | Google Storage folder path                                                                     |
| EGO_CLIENT_ID           | String  | Ego Client ID                                                                                  |
| EGO_CLIENT_SECRET       | String  | Ego Client Secret                                                                              |
| EGO_URL                 | String  | Ego URL API                                                                                    |
| JWT_KEY                 | String  | Public key. This variable is optional if JWT_KEY_URL is set                                    |
| JWT_KEY_URL             | String  | URL to fetch the public key. This variable is optional if JWT_KEY is set                       |
| REDIS_HOST              | String  | Default `localhost`. Comma-separated hosts enable cluster mode (e.g. `host1:6379,host2:6379`). |
| REDIS_PORT              | Number  | Default `6379`. Used when a host entry omits a port.                                           |
| REDIS_PASSWORD          | String  | Redis password                                                                                 |
| SONG_ENDPOINT           | String  | Song endpoint                                                                                  |
| ANALYSIS_TYPE_VERSION   | Number  | Default `1`. Process only the Analysis within this schema version.                             |
| API_RETRIES             | Number  | Default `3`. Retries when SONG requests fail.                                                  |
| API_TIMEOUT             | Number  | Default `10000`. (Milliseconds) Response timeout for SONG requests.                            |
| ENABLE_DEBUG            | Boolean | Default `true`. Produces more detailed logging.                                                |
| NODE_ENV                | String  | Optional. Defines the environment. <!-- TODO: describe impact -->                              |
| NOTIFICATIONS_SLACK_URL | String  | Webhook URL for notifications to a channel                                                     |
| TIMEZONE                | String  | Default `America/Toronto`. Use a zoneId format {area}/{city} to handle daylight savings.       |

### Example .env (Redis / Valkey cluster)

```
REDIS_HOST=valkey-1:6379,valkey-2:6379,valkey-3:6379
REDIS_PORT=6379
REDIS_PASSWORD=your-password
```

### Profiles

| Profile        | DESCRIPTION                                                                                |
| -------------- | ------------------------------------------------------------------------------------------ |
| updateCache    | This profile will only update Pedigree cache DB                                            |
| updateAnalysis | Synchronize VirusSeq data using the already existing Pedigree cache DB                     |
|                | Not specifying a profile will do `updateCache` and then do `updateAnalaysis` (Recommended) |

### TSV headers

Pedigree validates the TSV header row before it starts processing records. All expected columns must be present.

Header matching is tolerant of spaces and underscores, so names like these are treated as equivalent:

- `specimen_collector_sample_ID` or `specimen collector sample ID`
