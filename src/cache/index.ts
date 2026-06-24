import { Writable } from 'stream';

import logger from '@/utils/logger';
import {
	getLineageFileInfo,
	LineageFileInfo,
	streamFileToCacheWriter,
	TsvColumns,
} from '@/services/fileSource';

import { connectRedis, saveHash, getHash, keyFormat } from './redisConfig';

const CACHE_FILL_MARKER_KEY = 'pedigree:cache:fill';

export type CacheData = {
	lineage: string;
	pangolinVersion: string;
	pangolinDataVersion: string;
	scorpioCall: string;
	scorpioVersion: string;
};

export type CacheFillMarker = {
	filledAt: string;
	fileName: string;
	fingerprint: string;
};

export async function startLoadCachePipeline(): Promise<void> {
	await connectRedis();

	const fileInfo = await getLineageFileInfo();

	if (await isCacheFresh(fileInfo)) {
		logger.info(`Cache is current for ${fileInfo.fileName} — skipping refill.`);
		return;
	}

	logger.info(`Filling cache from ${fileInfo.fileName} (fingerprint: ${fileInfo.fingerprint})`);
	const writer = makeRedisCacheWritable();
	await streamFileToCacheWriter(writer);
	await markCacheFilled(fileInfo);
	logger.info(`Cache filled from ${fileInfo.fileName}`);
}

export const getCacheByKey = (key: keyFormat): Promise<CacheData> => {
	return new Promise((resolve, reject) => {
		connectRedis()
			.then(async () => {
				const cached = await getHash(key);
				if (Object.keys(cached).length === 0) {
					reject(`key:${key} not found in cache.`);
					return;
				}
				resolve(toCacheData(cached));
			})
			.catch((error) => reject(error));
	});
};

export function cacheKey(fastaHeaderName: string): keyFormat {
	return fastaHeaderName.toLowerCase();
}

export async function getCacheFillMarker(): Promise<CacheFillMarker | null> {
	await connectRedis();
	const data = await getHash(CACHE_FILL_MARKER_KEY);
	if (Object.keys(data).length === 0) return null;
	return {
		filledAt: data['filledAt'],
		fileName: data['fileName'],
		fingerprint: data['fingerprint'],
	};
}

function makeRedisCacheWritable(): Writable {
	let count = 0;
	const startTime = Date.now();
	return new Writable({
		objectMode: true,
		write(row: TsvColumns, _encoding, callback) {
			count++;
			if (count % 10000 === 0) {
				const elapsed = Math.round((Date.now() - startTime) / 1000);
				logger.info(`Cache fill progress: ${count} rows written (${elapsed}s elapsed)`);
			}
			const key = cacheKey(row.fasta_header_name);
			const entry: CacheData = {
				lineage: row.lineage,
				pangolinVersion: row.pangolin_version ?? '',
				pangolinDataVersion: row.pangolin_data_version ?? '',
				scorpioCall: row.scorpio_call ?? '',
				scorpioVersion: row.scorpio_version ?? '',
			};
			saveHash(key, entry).then(() => callback()).catch(callback);
		},
	});
}

export function isMarkerFresh(marker: CacheFillMarker | null, fileInfo: LineageFileInfo): boolean {
	if (!marker) return false;
	return marker.fileName === fileInfo.fileName && marker.fingerprint === fileInfo.fingerprint;
}

async function isCacheFresh(fileInfo: LineageFileInfo): Promise<boolean> {
	return isMarkerFresh(await getCacheFillMarker(), fileInfo);
}

async function markCacheFilled(fileInfo: LineageFileInfo): Promise<void> {
	const marker: CacheFillMarker = {
		filledAt: new Date().toISOString(),
		fileName: fileInfo.fileName,
		fingerprint: fileInfo.fingerprint,
	};
	await saveHash(CACHE_FILL_MARKER_KEY, marker);
}

function toCacheData(data: Record<string, string>): CacheData {
	return {
		lineage: data['lineage'],
		pangolinVersion: data['pangolinVersion'],
		pangolinDataVersion: data['pangolinDataVersion'],
		scorpioCall: data['scorpioCall'],
		scorpioVersion: data['scorpioVersion'],
	};
}
