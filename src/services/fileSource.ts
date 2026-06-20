import { createReadStream } from 'fs';
import os from 'os';
import path from 'path';
import { parse } from 'csv';
import { Writable } from 'stream';
import { GetFilesResponse, Storage } from '@google-cloud/storage';

import { config } from '@/config';
import { getNewestFile, getFileName } from '@/utils/utils';
import logger from '@/utils/logger';

// Creates a client
const storage = new Storage();

export type TsvColumns = {
	breadth_of_coverage_value: string; // unused
	consensus_sequence_software_name: string; // unused
	consensus_sequence_software_version: string; // unused
	depth_of_coverage_value: string; // unused
	fasta_header_name: string;
	lineage: string;
	pangolin_data_version: string;
	pangolin_version: string;
	reference_genome_accession: string; // unused
	scorpio_call: string;
	scorpio_version: string;
	study_id: string;
};

const headerAliases: Record<keyof TsvColumns, string[]> = {
	breadth_of_coverage_value: [],
	consensus_sequence_software_name: [],
	consensus_sequence_software_version: [],
	depth_of_coverage_value: [],
	fasta_header_name: ['fasta_header', 'fasta header name'],
	lineage: ['lineage_name'],
	pangolin_data_version: ['lineage_analysis_software_data_version'],
	pangolin_version: ['lineage_analysis_software_version'],
	reference_genome_accession: [],
	scorpio_call: [],
	scorpio_version: [],
	study_id: [],
};

const expectedHeaders = Object.keys(headerAliases) as Array<keyof TsvColumns>;
const expectedHeaderMap = buildExpectedHeaderMap();

export const getLatestLineageFile = (): Promise<string> => {
	return new Promise<string>((resolve, reject) => {
		listFiles(config.gs.bucket, config.gs.folder)
			.then((files: GetFilesResponse) => getNewestFile(files[0]))
			.then(getFileName)
			.then((resp) => resolve(resp))
			.catch((err) => reject(new Error(`Storage error:${err}`)));
	});
};

export const streamFileDownload = (fileName: string, handleData: Writable): Promise<string> => {
	return new Promise<string>((resolve, reject) => {
		logger.info(`Downloading file:${fileName}`);
		streamTsv(storage.bucket(config.gs.bucket).file(fileName).createReadStream(), handleData)
			.on('finish', () => {
				logger.info(`gs://${config.gs.bucket}/${fileName} download completed`);
				resolve(`gs://${config.gs.bucket}/${fileName} download completed`);
			})
			.on('error', () => {
				logger.error(`gs://${config.gs.bucket}/${fileName} download failed`);
				reject(new Error(`gs://${config.gs.bucket}/${fileName} download failed`));
			});
	});
};

export const streamLocalFile = (filePath: string, handleData: Writable): Promise<string> => {
	return new Promise<string>((resolve, reject) => {
		const resolvedFilePath = resolveLocalFilePath(filePath);
		logger.info(`Loading local file:${resolvedFilePath}`);
		streamTsv(createReadStream(resolvedFilePath), handleData)
			.on('finish', () => {
				logger.info(`Local file ${resolvedFilePath} load completed`);
				resolve(`Local file ${resolvedFilePath} load completed`);
			})
			.on('error', (err) => {
				logger.error(`Local file ${resolvedFilePath} load failed: ${err}`);
				reject(new Error(`Local file ${resolvedFilePath} load failed: ${err}`));
			});
	});
};

const streamTsv = (sourceStream: NodeJS.ReadableStream, handleData: Writable) =>
	sourceStream
		.pipe(
			parse({
				columns: (headers: string[]) => mapAndValidateHeaders(headers),
				delimiter: '\t',
				trim: true,
			}),
		)
		.pipe(handleData);

function mapAndValidateHeaders(headers: string[]): string[] {
	const missingHeaders = new Set(expectedHeaders);
	const seenHeaders = new Set<string>();

	const mappedHeaders = headers.map((header) => {
		const normalizedHeader = normalizeHeaderKey(header);
		const mappedHeader = expectedHeaderMap.get(normalizedHeader);

		if (!mappedHeader) {
			return header;
		}

		if (seenHeaders.has(mappedHeader)) {
			throw new Error(`Duplicate TSV header detected after normalization: ${header}`);
		}

		seenHeaders.add(mappedHeader);
		missingHeaders.delete(mappedHeader);
		return mappedHeader;
	});

	if (missingHeaders.size > 0) {
		throw new Error(`Missing required TSV headers: ${Array.from(missingHeaders).join(', ')}`);
	}

	return mappedHeaders;
}

function normalizeHeaderKey(value: string): string {
	return value.replace(/[\s_]+/g, '').toLowerCase();
}

function buildExpectedHeaderMap(): Map<string, keyof TsvColumns> {
	const headerMap = new Map<string, keyof TsvColumns>();

	for (const canonicalHeader of expectedHeaders) {
		registerHeaderAlias(headerMap, canonicalHeader, canonicalHeader);

		for (const alias of headerAliases[canonicalHeader]) {
			registerHeaderAlias(headerMap, canonicalHeader, alias);
		}
	}

	return headerMap;
}

function registerHeaderAlias(
	headerMap: Map<string, keyof TsvColumns>,
	canonicalHeader: keyof TsvColumns,
	alias: string,
): void {
	headerMap.set(normalizeHeaderKey(alias), canonicalHeader);
}

function resolveLocalFilePath(filePath: string): string {
	if (filePath === '~') {
		return os.homedir();
	}

	if (filePath.startsWith(`~${path.sep}`)) {
		return path.join(os.homedir(), filePath.slice(2));
	}

	return filePath;
}

const listFiles = async function (bucketName: string, folderName: string): Promise<GetFilesResponse> {
	const options = {
		autoPaginate: false,
		delimiter: '/',
		prefix: folderName || '',
	};

	// Lists files in the bucket
	logger.debug(`List files on bucket ${bucketName} folder:${folderName}`);
	return storage.bucket(bucketName).getFiles(options);
};
