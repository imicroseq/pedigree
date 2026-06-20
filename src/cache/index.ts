import logger from '@/utils/logger';
import { config } from '@/config';
import { Analysis, getAllStudies, getAnalysisByStudyPaginated } from '@/services/song';

import { connectRedis, existsKey, saveHash, getHash, getKeyCount, keyFormat } from './redisConfig';

const CACHE_FILL_MARKER_KEY = 'pedigree:cache:fill';

export type CacheData = {
  analysisId: string;
  lineageAnalysisSoftwareDataVersion: string;
  lineageAnalysisSoftwareName: string;
  lineageAnalysisSoftwareVersion: string;
  lineageName: string;
  scorpioCall: string;
  scorpioVersion: string;
  studyId: string;
};

export async function startLoadCachePipeline(): Promise<void> {
  await connectRedis();
  if (await isCacheFresh()) {
    logger.info('Cache is fresh — skipping refill. Set CACHE_MAX_AGE_MINUTES=0 to force.');
    return;
  }
  const studies = await getAllStudies();
  for (const [index, study] of studies.entries()) {
    logger.info(`Fetching ${index + 1}/${studies.length} studyId: ${study}`);
    await getAndCacheAnalysisByStudy(study);
  }
  await markCacheFilled();
}

export async function adoptCacheIfNeeded(): Promise<void> {
  if (!config.cache.maxAgeMinutes) return;

  await connectRedis();
  const marker = await getHash(CACHE_FILL_MARKER_KEY);
  if (marker?.updatedAt) return;

  const keyCount = await getKeyCount();
  if (keyCount === 0) {
    logger.info('Cache is empty — skipping adoption');
    return;
  }

  const studies = await getAllStudies();
  let songTotal = 0;
  for (const study of studies) {
    const resp = await getAnalysisByStudyPaginated(study, 1, 0);
    songTotal += resp.totalAnalyses;
  }

  logger.info(`Cache adoption: Redis has ${keyCount} keys, SONG has ${songTotal} published analyses`);

  if (keyCount < songTotal) {
    logger.warn(
      `Redis key count (${keyCount}) is less than SONG total (${songTotal}) — cache may be incomplete (analyses without fasta_header_name are excluded by design)`,
    );
  }

  await markCacheFilled();
  logger.info('Cache freshness marker stamped');
}

async function isCacheFresh(): Promise<boolean> {
  const maxAge = config.cache.maxAgeMinutes;
  if (!maxAge) return false;

  const marker = await getHash(CACHE_FILL_MARKER_KEY);
  if (!marker?.updatedAt) return false;

  const ageMinutes = (Date.now() - Number(marker.updatedAt)) / 1000 / 60;
  logger.debug(`Cache age: ${Math.round(ageMinutes)} min (max: ${maxAge} min)`);
  return ageMinutes < maxAge;
}

async function markCacheFilled(): Promise<void> {
  await saveHash(CACHE_FILL_MARKER_KEY, { updatedAt: Date.now() });
  logger.debug(`Cache fill marker written`);
}

function getAndCacheAnalysisByStudy(studyId: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const limit: number = 100;
    let offset: number = 0;
    let total: number = limit;

    while (offset < total) {
      let resp = await getAnalysisByStudyPaginated(studyId, limit, offset);
      offset += resp.currentTotalAnalyses;
      total = resp.totalAnalyses;

      if (total > 0) {
        try {
          await saveCacheAnalysis(resp.analyses);
          logger.info(
            `getAndCacheAnalysisByStudy - Cashing progress study ${studyId}: ${
              Math.round((offset / total) * 100 * 100) / 100
            }%`,
          );
        } catch (error) {
          logger.error(`Caching error on saveCacheAnalysis: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    logger.info(`Finished caching ${studyId} total of ${total} records`);
    resolve(studyId);
  });
}

function saveCacheAnalysis(analysisList: Array<Analysis>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    connectRedis()
      .then(async () => {
        logger.debug(`saveCacheAnalysis - caching ${analysisList?.length} analysis`);

        for (const analysis of analysisList) {
          const fastaHeaderName = analysis.sample_collection?.fasta_header_name;
          if (!fastaHeaderName) continue;

          const key = cacheKey(fastaHeaderName);
          if (await existsKey(key)) continue;

          const hsetData: CacheData = {
            analysisId: analysis.analysisId || '',
            lineageAnalysisSoftwareDataVersion:
              analysis.lineage_analysis?.lineage_analysis_software_data_version || '',
            lineageAnalysisSoftwareName:
              analysis.lineage_analysis?.lineage_analysis_software_name || '',
            lineageAnalysisSoftwareVersion:
              analysis.lineage_analysis?.lineage_analysis_software_version || '',
            lineageName: analysis.lineage_analysis?.lineage_name || '',
            scorpioCall: analysis.lineage_analysis?.scorpio_call || '',
            scorpioVersion: analysis.lineage_analysis?.scorpio_version || '',
            studyId: analysis.studyId || '',
          };

          await saveHash(key, hsetData);
        }
        resolve();
      })
      .catch((error) => reject(error));
  });
}

export const getCacheByKey = (key: keyFormat): Promise<CacheData> => {
  return new Promise((resolve, reject) => {
    connectRedis()
      .then(async () => {
        let cachedData = await getHash(key);
        if (Object.keys(cachedData).length == 0) {
          reject(`key:${key} not found in cache.`);
        }
        resolve(toCacheData(cachedData));
      })
      .catch((error) => reject(error));
  });
};

function toCacheData(data: any): CacheData {
  return {
    analysisId: data['analysisId'],
    lineageAnalysisSoftwareDataVersion: data['lineageAnalysisSoftwareDataVersion'],
    lineageAnalysisSoftwareName: data['lineageAnalysisSoftwareName'],
    lineageAnalysisSoftwareVersion: data['lineageAnalysisSoftwareVersion'],
    lineageName: data['lineageName'],
    scorpioCall: data['scorpioCall'],
    scorpioVersion: data['scorpioVersion'],
    studyId: data['studyId'],
  };
}

export function cacheKey(fastaHeaderName: string): keyFormat {
  return fastaHeaderName.toLowerCase();
}
