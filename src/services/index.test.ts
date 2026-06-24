import { suite, test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldPatch } from './index';
import { Analysis } from '@/services/song';
import { CacheData } from '@/cache';

const cached: CacheData = {
	lineage: 'XBB.1.5',
	pangolinVersion: '4.3',
	pangolinDataVersion: '2024-01-01',
	scorpioCall: 'XBB.1.5-like',
	scorpioVersion: '0.3.19',
};

const baseAnalysis: Analysis = {
	analysisId: 'test-analysis-id',
	studyId: 'TEST-STUDY',
};

suite('shouldPatch', () => {
	test('returns false when lineage already matches the cache', () => {
		const analysis: Analysis = {
			...baseAnalysis,
			lineage_analysis: {
				lineage_name: 'XBB.1.5',
				lineage_analysis_software_name: 'pangolin',
				lineage_analysis_software_version: '4.3',
				lineage_analysis_software_data_version: '2024-01-01',
				scorpio_call: 'XBB.1.5-like',
				scorpio_version: '0.3.19',
			},
		};
		assert.equal(shouldPatch(analysis, cached), false);
	});

	test('returns true when the stored lineage differs from the cache', () => {
		const analysis: Analysis = {
			...baseAnalysis,
			lineage_analysis: {
				lineage_name: 'BA.2',
				lineage_analysis_software_name: 'pangolin',
				lineage_analysis_software_version: '4.0',
				lineage_analysis_software_data_version: '2023-01-01',
				scorpio_call: 'BA.2-like',
				scorpio_version: '0.3.17',
			},
		};
		assert.equal(shouldPatch(analysis, cached), true);
	});

	test('returns true when the analysis has no lineage_analysis at all', () => {
		assert.equal(shouldPatch(baseAnalysis, cached), true);
	});

	test('returns true when lineage_analysis is present but lineage_name is absent', () => {
		const analysis = {
			...baseAnalysis,
			lineage_analysis: {} as Analysis['lineage_analysis'],
		};
		assert.equal(shouldPatch(analysis!, cached), true);
	});
});
