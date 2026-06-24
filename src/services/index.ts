import logger from '@/utils/logger';
import { config } from '@/config';
import { getCacheByKey, CacheData, cacheKey, getCacheFillMarker } from '@/cache';
import {
	Analysis,
	getAllStudies,
	getAnalysisByStudyPaginated,
	getLatestAnalysisTypeVersion,
	patchAnalysis,
} from '@/services/song';

const lineageSoftwareName = 'pangolin';
const PAGE_SIZE = 100;

let latestAnalysisTypeVersion: number | null = null;

async function resolveLatestAnalysisTypeVersion(): Promise<number> {
	if (latestAnalysisTypeVersion === null) {
		latestAnalysisTypeVersion = await getLatestAnalysisTypeVersion(config.analysis.typeName);
		logger.info(`Latest SONG schema version for '${config.analysis.typeName}': ${latestAnalysisTypeVersion}`);
	}
	return latestAnalysisTypeVersion;
}

export function shouldPatch(analysis: Analysis, cached: CacheData): boolean {
	return analysis.lineage_analysis?.lineage_name !== cached.lineage;
}

async function processAnalysis(analysis: Analysis): Promise<void> {
	const fastaHeaderName = analysis.sample_collection?.fasta_header_name;
	if (!fastaHeaderName) return;

	let cached: CacheData;
	try {
		cached = await getCacheByKey(cacheKey(fastaHeaderName));
	} catch {
		return; // fasta_header_name not in the lineage file — skip
	}

	if (!shouldPatch(analysis, cached)) {
		return;
	}

	const version = await resolveLatestAnalysisTypeVersion();
	await patchAnalysis(analysis.studyId, analysis.analysisId, {
		analysisType: { name: config.analysis.typeName, version },
		lineage_analysis: {
			lineage_name: cached.lineage,
			lineage_analysis_software_name: lineageSoftwareName,
			lineage_analysis_software_version: cached.pangolinVersion,
			lineage_analysis_software_data_version: cached.pangolinDataVersion,
			scorpio_call: cached.scorpioCall,
			scorpio_version: cached.scorpioVersion,
		},
	});
}

export async function startUpdateAnalysisPipeline(): Promise<void> {
	const marker = await getCacheFillMarker();
	if (!marker) {
		logger.warn('No cache fill marker found — UPDATECACHE has not been run. All analyses will be skipped.');
	} else {
		logger.info(`Using cache filled from ${marker.fileName} at ${marker.filledAt}`);
	}

	await resolveLatestAnalysisTypeVersion(); // fail fast before scanning studies

	const studies = await getAllStudies();
	const concurrency = config.song.patchConcurrency;

	for (const [i, study] of studies.entries()) {
		logger.info(`Processing study ${i + 1}/${studies.length}: ${study}`);
		let offset = 0;
		let total = 0;
		do {
			const resp = await getAnalysisByStudyPaginated(study, PAGE_SIZE, offset);
			total = resp.totalAnalyses;
			offset += resp.currentTotalAnalyses;

			for (let j = 0; j < resp.analyses.length; j += concurrency) {
				const chunk = resp.analyses.slice(j, j + concurrency);
				await Promise.all(
					chunk.map((analysis) =>
						processAnalysis(analysis).catch((err) =>
							logger.error(
								`Error processing ${analysis.analysisId}: ${err instanceof Error ? err.message : String(err)}`,
							),
						),
					),
				);
			}
		} while (offset < total);
	}
}
