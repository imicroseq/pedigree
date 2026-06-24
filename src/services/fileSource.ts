import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import { parse } from 'csv';
import { Writable } from 'stream';
import axios from 'axios';
import { GetFilesResponse, Storage } from '@google-cloud/storage';

import { config } from '@/config';
import { getNewestFile, getFileName } from '@/utils/utils';
import logger from '@/utils/logger';

// Creates a client
const storage = new Storage();

export type TsvColumns = {
	fasta_header_name: string;
	lineage: string;
	// present in the full metadata TSV; absent in the lighter lineage_assignments.csv
	breadth_of_coverage_value?: string;
	consensus_sequence_software_name?: string;
	consensus_sequence_software_version?: string;
	depth_of_coverage_value?: string;
	pangolin_data_version?: string;
	pangolin_version?: string;
	reference_genome_accession?: string;
	scorpio_call?: string;
	scorpio_version?: string;
	study_id?: string;
};

const requiredHeaders = ['fasta_header_name', 'lineage'] as const;
type RequiredHeader = (typeof requiredHeaders)[number];

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

export type LineageFileInfo = {
	fileName: string;
	/** md5Hash for GCS; "<mtimeMs>:<size>" for local files; ETag or Last-Modified for URLs. */
	fingerprint: string;
};

export function isUrl(value: string): boolean {
	return value.startsWith('http://') || value.startsWith('https://');
}

export async function getLineageFileInfo(): Promise<LineageFileInfo> {
	const fileSource = config.gs.fileSource;
	if (isUrl(fileSource)) {
		return getUrlFileInfo(fileSource);
	}
	if (fileSource) {
		const resolved = resolveLocalFilePath(fileSource);
		const { mtimeMs, size } = await stat(resolved);
		return { fileName: path.basename(resolved), fingerprint: `${mtimeMs}:${size}` };
	}
	const fileName = await getLatestLineageFile();
	const [metadata] = await storage.bucket(config.gs.bucket).file(fileName).getMetadata();
	const md5Hash = (metadata as Record<string, unknown>).md5Hash as string | undefined;
	const fingerprint =
		md5Hash ??
		`${(metadata as Record<string, unknown>).updated}:${(metadata as Record<string, unknown>).size}`;
	return { fileName: path.basename(fileName), fingerprint };
}

async function getUrlFileInfo(url: string): Promise<LineageFileInfo> {
	const response = await axios.head(url, { timeout: 10_000 });
	const etag = response.headers['etag'] as string | undefined;
	const lastModified = response.headers['last-modified'] as string | undefined;
	const fingerprint = etag ?? lastModified ?? `url:${url}`;
	const fileName = path.basename(new URL(url).pathname) || 'lineage-file';
	return { fileName, fingerprint };
}

/**
 * Stream the lineage file (URL, local, or GCS) into a Writable. Used by the cache-fill step.
 * Resolves file location internally so the cache module does not need to know the source type.
 */
export async function streamFileToCacheWriter(writer: Writable): Promise<void> {
	const fileSource = config.gs.fileSource;
	if (isUrl(fileSource)) {
		await streamUrlFile(fileSource, writer);
		return;
	}
	if (fileSource) {
		await streamLocalFile(fileSource, writer);
		return;
	}
	const fileName = await getLatestLineageFile();
	await streamFileDownload(fileName, writer);
}

export const validateLineageFile = async (): Promise<void> => {
	const fileSource = config.gs.fileSource;

	let sourceStream: NodeJS.ReadableStream;
	let delimiter: string;

	if (isUrl(fileSource)) {
		logger.info(`Preflight: validating headers in ${fileSource}`);
		const response = await axios.get(fileSource, { responseType: 'stream', timeout: 10_000 });
		sourceStream = response.data;
		delimiter = delimiterFor(new URL(fileSource).pathname);
	} else if (fileSource) {
		const resolved = resolveLocalFilePath(fileSource);
		logger.info(`Preflight: validating headers in ${resolved}`);
		sourceStream = createReadStream(resolved);
		delimiter = delimiterFor(resolved);
	} else {
		const fileName = await getLatestLineageFile();
		logger.info(`Preflight: validating headers in gs://${config.gs.bucket}/${fileName}`);
		sourceStream = storage.bucket(config.gs.bucket).file(fileName).createReadStream();
		delimiter = delimiterFor(fileName);
	}

	return new Promise<void>((resolve, reject) => {
		sourceStream
			.pipe(parse({ columns: mapAndValidateHeaders, delimiter, to: 1, trim: true }))
			.on('data', () => {}) // drain the single validation record; we only care about headers
			.on('end', () => { logger.info('Preflight: headers valid'); resolve(); })
			.on('error', reject);
	});
};

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
		streamDelimited(storage.bucket(config.gs.bucket).file(fileName).createReadStream(), handleData, delimiterFor(fileName))
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
		streamDelimited(createReadStream(resolvedFilePath), handleData, delimiterFor(resolvedFilePath))
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

export const streamUrlFile = async (url: string, handleData: Writable): Promise<string> => {
	logger.info(`Downloading URL: ${url}`);
	const response = await axios.get(url, { responseType: 'stream', timeout: 60_000 });
	return new Promise<string>((resolve, reject) => {
		streamDelimited(response.data, handleData, delimiterFor(new URL(url).pathname))
			.on('finish', () => {
				logger.info(`URL ${url} download completed`);
				resolve(`URL ${url} download completed`);
			})
			.on('error', (err) => {
				logger.error(`URL ${url} download failed: ${err}`);
				reject(new Error(`URL ${url} download failed: ${err}`));
			});
	});
};

const delimiterFor = (filePath: string): string => (filePath.toLowerCase().endsWith('.csv') ? ',' : '\t');

const streamDelimited = (sourceStream: NodeJS.ReadableStream, handleData: Writable, delimiter: string) =>
	sourceStream
		.pipe(
			parse({
				columns: (headers: string[]) => mapAndValidateHeaders(headers),
				delimiter,
				trim: true,
			}),
		)
		.pipe(handleData);

export function mapAndValidateHeaders(headers: string[]): string[] {
	const missingRequired = new Set<RequiredHeader>(requiredHeaders);
	const seenHeaders = new Set<string>();

	const mappedHeaders = headers.map((header) => {
		const normalizedHeader = normalizeHeaderKey(header);
		const mappedHeader = expectedHeaderMap.get(normalizedHeader);

		if (!mappedHeader) {
			return header;
		}

		if (seenHeaders.has(mappedHeader)) {
			throw new Error(`Duplicate header detected after normalization: ${header}`);
		}

		seenHeaders.add(mappedHeader);
		if (requiredHeaders.includes(mappedHeader as RequiredHeader)) {
			missingRequired.delete(mappedHeader as RequiredHeader);
		}
		return mappedHeader;
	});

	if (missingRequired.size > 0) {
		throw new Error(`Missing required headers: ${Array.from(missingRequired).join(', ')}`);
	}

	return mappedHeaders;
}

export function normalizeHeaderKey(value: string): string {
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
