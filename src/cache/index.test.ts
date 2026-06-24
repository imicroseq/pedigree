import { suite, test } from 'node:test';
import assert from 'node:assert/strict';

import { cacheKey, isMarkerFresh, CacheFillMarker } from './index';
import { LineageFileInfo } from '@/services/fileSource';

suite('cacheKey', () => {
	test('lowercases a mixed-case fasta header name', () => {
		assert.equal(cacheKey('hCoV-19/Canada/SK-RRPL-720201/2024'), 'hcov-19/canada/sk-rrpl-720201/2024');
	});

	test('preserves already-lowercase input', () => {
		assert.equal(cacheKey('hcov-19/canada/on-uhtc-12345/2023'), 'hcov-19/canada/on-uhtc-12345/2023');
	});

	test('lowercases all-uppercase input', () => {
		assert.equal(cacheKey('HCOV-19/CANADA/AB-ABPHL-99999/2024'), 'hcov-19/canada/ab-abphl-99999/2024');
	});
});

suite('isMarkerFresh', () => {
	const fileInfo: LineageFileInfo = {
		fileName: 'lineage_assignments.csv',
		fingerprint: 'abc123',
	};

	const matchingMarker: CacheFillMarker = {
		filledAt: '2026-06-23T00:00:00.000Z',
		fileName: 'lineage_assignments.csv',
		fingerprint: 'abc123',
	};

	test('returns false when marker is null', () => {
		assert.equal(isMarkerFresh(null, fileInfo), false);
	});

	test('returns false when the file name differs', () => {
		const marker: CacheFillMarker = { ...matchingMarker, fileName: 'virusseq_metadata.tsv' };
		assert.equal(isMarkerFresh(marker, fileInfo), false);
	});

	test('returns false when the fingerprint differs', () => {
		const marker: CacheFillMarker = { ...matchingMarker, fingerprint: 'stale-fingerprint' };
		assert.equal(isMarkerFresh(marker, fileInfo), false);
	});

	test('returns true when both file name and fingerprint match', () => {
		assert.equal(isMarkerFresh(matchingMarker, fileInfo), true);
	});
});
