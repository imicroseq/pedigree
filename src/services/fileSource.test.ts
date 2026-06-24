import { suite, test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeHeaderKey, mapAndValidateHeaders } from './fileSource';

suite('normalizeHeaderKey', () => {
	test('lowercases all characters', () => {
		assert.equal(normalizeHeaderKey('LINEAGE'), 'lineage');
	});

	test('strips underscores', () => {
		assert.equal(normalizeHeaderKey('fasta_header_name'), 'fastaheadername');
	});

	test('strips spaces', () => {
		assert.equal(normalizeHeaderKey('fasta header name'), 'fastaheadername');
	});

	test('handles mixed separators and casing', () => {
		assert.equal(normalizeHeaderKey('FASTA_Header Name'), 'fastaheadername');
	});
});

suite('mapAndValidateHeaders', () => {
	test('maps canonical header names unchanged', () => {
		const result = mapAndValidateHeaders(['fasta_header_name', 'lineage']);
		assert.deepEqual(result, ['fasta_header_name', 'lineage']);
	});

	test('resolves the fasta_header alias to fasta_header_name', () => {
		const result = mapAndValidateHeaders(['fasta_header', 'lineage']);
		assert.deepEqual(result, ['fasta_header_name', 'lineage']);
	});

	test('resolves the space-separated "fasta header name" alias to fasta_header_name', () => {
		const result = mapAndValidateHeaders(['fasta header name', 'lineage']);
		assert.deepEqual(result, ['fasta_header_name', 'lineage']);
	});

	test('resolves the lineage_name alias to lineage', () => {
		const result = mapAndValidateHeaders(['fasta_header_name', 'lineage_name']);
		assert.deepEqual(result, ['fasta_header_name', 'lineage']);
	});

	test('passes through unrecognised columns unchanged', () => {
		const result = mapAndValidateHeaders(['fasta_header_name', 'lineage', 'some_extra_col']);
		assert.deepEqual(result, ['fasta_header_name', 'lineage', 'some_extra_col']);
	});

	test('throws when fasta_header_name is missing', () => {
		assert.throws(
			() => mapAndValidateHeaders(['lineage']),
			/Missing required headers/,
		);
	});

	test('throws when lineage is missing', () => {
		assert.throws(
			() => mapAndValidateHeaders(['fasta_header_name']),
			/Missing required headers/,
		);
	});

	test('throws when both required headers are missing', () => {
		assert.throws(
			() => mapAndValidateHeaders(['pangolin_version']),
			/Missing required headers/,
		);
	});

	test('throws when two headers resolve to the same canonical name', () => {
		assert.throws(
			() => mapAndValidateHeaders(['fasta_header_name', 'fasta_header', 'lineage']),
			/Duplicate header/,
		);
	});
});
