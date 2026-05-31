import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    extractFinalContextsForDisplay,
    extractFinalContextsFromStructuredInputs,
    extractNormalizedTablesFromStructuredInputs,
    extractTableContextsFromStructuredInputs,
    extractTableContextsForDisplay,
    splitTaggedTextAndBatchInputs,
    stripCoordinateArraysForDisplay,
} from './parseTableBatchDebug.ts';

test('splits tagged text and table batch inputs when marker exists', () => {
    assert.deepEqual(
        splitTaggedTextAndBatchInputs('tagged text\n[TABLE_BATCH_INPUTS]\nbatch json'),
        {
            taggedText: 'tagged text',
            tableBatchInputs: '[TABLE_BATCH_INPUTS]\nbatch json',
        }
    );
});

test('returns only batch inputs when marker is at start', () => {
    assert.deepEqual(
        splitTaggedTextAndBatchInputs('[TABLE_BATCH_INPUTS]\nbatch json'),
        {
            taggedText: '',
            tableBatchInputs: '[TABLE_BATCH_INPUTS]\nbatch json',
        }
    );
});

test('returns tagged text only when marker does not exist', () => {
    assert.deepEqual(
        splitTaggedTextAndBatchInputs('tagged text only'),
        {
            taggedText: 'tagged text only',
            tableBatchInputs: '',
        }
    );
});

test('strips coordinate arrays from batch debug display text', () => {
    assert.equal(
        stripCoordinateArraysForDisplay(
            'DYB06131ASR2200\n[4.4077,3.5286,4.4534,3.6217] 1\n[4.9597,3.5208,5.3457,3.6335] $619.00'
        ),
        'DYB06131ASR2200\n1\n$619.00'
    );
});

test('keeps non-coordinate markers intact', () => {
    assert.equal(
        stripCoordinateArraysForDisplay('[TABLE_BATCH_INPUTS]\nvalue'),
        '[TABLE_BATCH_INPUTS]\nvalue'
    );
});

test('extracts only table contexts per batch for display', () => {
    assert.equal(
        extractTableContextsForDisplay(
            '[TABLE_BATCH_INPUTS]\n' +
            '### batch=1/2\n' +
            'table_global_index=0\n' +
            '--- TABLE CONTEXT ---\n' +
            '[1,2,3,4] value\n' +
            '--- FINAL CONTEXT ---\n' +
            'Alpha\n' +
            '### batch=2/2\n' +
            'table_global_index=1\n' +
            '--- TABLE CONTEXT ---\n' +
            '[5,6,7,8] value\n' +
            '--- FINAL CONTEXT ---\n' +
            'Beta'
        ),
        '### batch=1/2\nvalue\n\n### batch=2/2\nvalue'
    );
});

test('extracts table contexts from structured batch inputs', () => {
    assert.equal(
        extractTableContextsFromStructuredInputs([
            {
                batchLabel: '1/2',
                tableContext: '[1,2,3,4] value',
            },
            {
                batchLabel: '2/2',
                tableContext: '[5,6,7,8] value',
            },
        ]),
        '### batch=1/2\nvalue\n\n### batch=2/2\nvalue'
    );
});

test('extracts only final contexts per batch for display', () => {
    assert.equal(
        extractFinalContextsForDisplay(
            '[TABLE_BATCH_INPUTS]\n' +
            '### batch=1/2\n' +
            'table_global_index=0\n' +
            '--- TABLE CONTEXT ---\n' +
            '[1,2,3,4] table\n' +
            '--- FINAL CONTEXT ---\n' +
            '[9,8,7,6] final\n' +
            '### batch=2/2\n' +
            'table_global_index=1\n' +
            '--- TABLE CONTEXT ---\n' +
            '[5,6,7,8] table\n' +
            '--- FINAL CONTEXT ---\n' +
            '[4,3,2,1] final'
        ),
        '### batch=1/2\nfinal\n\n### batch=2/2\nfinal'
    );
});

test('extracts final contexts from structured batch inputs', () => {
    assert.equal(
        extractFinalContextsFromStructuredInputs([
            {
                batchLabel: '1/2',
                context: '[1,2,3,4] final',
            },
            {
                batchLabel: '2/2',
                context: '[5,6,7,8] final',
            },
        ]),
        '### batch=1/2\nfinal\n\n### batch=2/2\nfinal'
    );
});

test('extracts normalized table batches from structured batch inputs', () => {
    const normalized = extractNormalizedTablesFromStructuredInputs([
        {
            batchLabel: '1/2',
            tableContext: JSON.stringify([
                {
                    row_count: 2,
                    column_count: 2,
                    cells: [
                        { row_index: 0, column_index: 0, content: 'A', is_header: true },
                        { row_index: 0, column_index: 1, content: 'B', is_header: true },
                        { row_index: 1, column_index: 0, content: '1' },
                        { row_index: 1, column_index: 1, content: '2' },
                    ],
                },
            ]),
        },
    ]);

    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].batchLabel, '1/2');
    assert.equal(normalized[0].tables.length, 1);
    assert.equal(normalized[0].tables[0].row_count, 2);
    assert.equal(normalized[0].tables[0].column_count, 2);
    assert.equal(normalized[0].tables[0].cells[0].is_header, true);
    assert.equal(normalized[0].tables[0].cells[0].content, 'A');
});

test('normalizes camelCase table context fields', () => {
    const normalized = extractNormalizedTablesFromStructuredInputs([
        {
            batchLabel: '2/2',
            tableContext: JSON.stringify([
                {
                    rowCount: 1,
                    columnCount: 1,
                    cells: [
                        { rowIndex: 0, columnIndex: 0, content: 123, isHeader: true },
                    ],
                },
            ]),
        },
    ]);

    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].tables[0].row_count, 1);
    assert.equal(normalized[0].tables[0].column_count, 1);
    assert.equal(normalized[0].tables[0].cells[0].content, '123');
    assert.equal(normalized[0].tables[0].cells[0].is_header, true);
});
