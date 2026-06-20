import { Writable } from 'stream';

import logger from '@/utils/logger';
import { config } from '@/config';
import { getCacheByKey, CacheData, cacheKey } from '@/cache';
import { Analysis, getLatestAnalysisTypeVersion, patchAnalysis } from '@/services/song';

import { getLatestLineageFile, streamFileDownload, streamLocalFile, TsvColumns } from './fileSource';

const lineageSoftwareName = 'pangolin';

let latestAnalysisTypeVersion: number | null = null;

async function resolveLatestAnalysisTypeVersion(): Promise<number> {
	if (latestAnalysisTypeVersion === null) {
		latestAnalysisTypeVersion = await getLatestAnalysisTypeVersion(config.analysis.typeName);
		logger.info(`Latest SONG schema version for '${config.analysis.typeName}': ${latestAnalysisTypeVersion}`);
	}
	return latestAnalysisTypeVersion;
}

export const startUpdateAnalysisPipeline = function (): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const localFilePath = config.gs.localFilePath;

		if (localFilePath) {
			streamLocalFile(localFilePath, handleData)
				.then(() => resolve())
				.catch(reject);
			return;
		}

		getLatestLineageFile()
			.then((fileName: string) => streamFileDownload(fileName, handleData))
			.then(() => resolve())
			.catch(reject);
	});
};

export const handleData = new Writable({
	objectMode: true,
	write(source: TsvColumns, _encoding, callback) {
		getCacheByKey(cacheKey(source.fasta_header_name))
			.then(async (cache: CacheData) => {
				if (isValidData(source, cache)) {
					const payload: Partial<Analysis> = {
						analysisType: {
							name: config.analysis.typeName,
							version: await resolveLatestAnalysisTypeVersion(),
						},
						lineage_analysis: {
							lineage_analysis_software_data_version: source.pangolin_data_version,
							lineage_analysis_software_name: lineageSoftwareName,
							lineage_analysis_software_version: source.pangolin_version,
							lineage_name: source.lineage,
							scorpio_call: source.scorpio_call,
							scorpio_version: source.scorpio_version,
						},
					};
					await patchAnalysis(cache.studyId, cache.analysisId, payload);
				}

				callback();
			})
			.catch((err) => {
				logger.error(`An error occurred with ${source.fasta_header_name}: ${err instanceof Error ? err.message : String(err)}`);
				callback();
			});
	},
});

function isValidData(source: TsvColumns, cache: CacheData): boolean {
	if (cache.lineageName == source.lineage) {
		logger.debug(`No changes for analysisId:${cache.analysisId} on lineage prop. skipping..`);
		return false;
	} else if (!cache?.analysisId || !source?.lineage) {
		logger.error(`Invalid Cache or Source data. AnalysisId:${cache?.analysisId} lineage:${source?.lineage}`);
		return false;
	}

	return true;
}
