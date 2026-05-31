import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildApplicableDateContextForTableBatch,
    carryForwardApplicableDateContext,
    buildDocumentContextForTableBatch,
    composeTableBatchContext,
    compactTablePromptCell,
    compactTablePromptSlice,
    extractPageBBoxesFromTableContext,
    summarizeDateFieldCoverage,
    isLikelyValidityDateContextLine,
} from './TableBatchDocumentContext.ts';

test('builds compact document context for table batches from top-of-page text', () => {
    const context = buildDocumentContextForTableBatch({
        chunkContent: [
            'Carrier Rate Sheet',
            'Validity: 2025-12-08 ~ 2025-12-14',
            'Currency: USD',
            'POL POD 20DC 40HC',
            'CNSHA USLAX 5500 5500',
        ].join('\n'),
        paragraphs: [
            {
                content: 'Carrier Rate Sheet',
                boundingRegions: [{ pageNumber: 1, polygon: [0.1, 0.08, 0.8, 0.08, 0.8, 0.1, 0.1, 0.1] }],
            },
            {
                content: 'Validity: 2025-12-08 ~ 2025-12-14',
                boundingRegions: [{ pageNumber: 1, polygon: [0.1, 0.12, 0.8, 0.12, 0.8, 0.14, 0.1, 0.14] }],
            },
            {
                content: 'Currency: USD',
                boundingRegions: [{ pageNumber: 1, polygon: [0.1, 0.16, 0.5, 0.16, 0.5, 0.18, 0.1, 0.18] }],
            },
            {
                content: 'CNSHA USLAX 5500 5500',
                boundingRegions: [{ pageNumber: 1, polygon: [0.1, 0.52, 0.9, 0.52, 0.9, 0.54, 0.1, 0.54] }],
            },
        ],
        pageBBoxes: [{ pageNumber: 1, bbox: [0.08, 0.45, 0.95, 0.9] }],
        maxChars: 1000,
    });

    assert.doesNotMatch(context, /Validity: 2025-12-08 ~ 2025-12-14/);
    assert.match(context, /Currency: USD/);
    assert.doesNotMatch(context, /CNSHA USLAX 5500 5500/);
});

test('falls back to leading structured chunk lines when paragraph context is unavailable', () => {
    const context = buildDocumentContextForTableBatch({
        chunkContent: [
            'POL POD 20 40 40HC',
            'Service Scope: US IPI via LAX/LGB',
            'CNSHA USLAX 5500 5500',
        ].join('\n'),
        paragraphs: [],
        pageBBoxes: [{ pageNumber: 1, bbox: [0.08, 0.45, 0.95, 0.9] }],
        maxChars: 1000,
    });

    assert.match(context, /POL POD 20 40 40HC/);
    assert.match(context, /Service Scope: US IPI via LAX\/LGB/);
});

test('detects validity/date context lines that should not be treated as below-table related text', () => {
    assert.equal(isLikelyValidityDateContextLine('2. Validity : 12/8 ~ 12/14'), true);
    assert.equal(isLikelyValidityDateContextLine('START_DATE 2025-12-08 END_DATE 2025-12-14'), true);
    assert.equal(isLikelyValidityDateContextLine('CNSHA USLAX 5500 5500'), false);
});

test('selects only the nearest validity line above the current table batch', () => {
    const paragraphs = [
        {
            content: 'Validity : 12/1 ~ 12/7',
            boundingRegions: [{ pageNumber: 1, polygon: [0.1, 0.1, 0.5, 0.1, 0.5, 0.12, 0.1, 0.12] }],
        },
        {
            content: 'Salt Lake City. UT',
            boundingRegions: [{ pageNumber: 1, polygon: [0.2, 0.36, 0.6, 0.36, 0.6, 0.38, 0.2, 0.38] }],
        },
        {
            content: 'Validity : 12/8 ~ 12/14',
            boundingRegions: [{ pageNumber: 1, polygon: [0.1, 0.55, 0.5, 0.55, 0.5, 0.57, 0.1, 0.57] }],
        },
    ];

    const firstTableDateContext = buildApplicableDateContextForTableBatch({
        paragraphs,
        pageBBoxes: [{ pageNumber: 1, bbox: [0.08, 0.2, 0.95, 0.5] }],
    });
    const secondTableDateContext = buildApplicableDateContextForTableBatch({
        paragraphs,
        pageBBoxes: [{ pageNumber: 1, bbox: [0.08, 0.62, 0.95, 0.9] }],
    });

    assert.equal(firstTableDateContext?.text, 'Validity : 12/1 ~ 12/7');
    assert.equal(secondTableDateContext?.text, 'Validity : 12/8 ~ 12/14');
});

test('returns no applicable date context when no validity line exists above the table batch', () => {
    const dateContext = buildApplicableDateContextForTableBatch({
        paragraphs: [
            {
                content: 'Currency: USD',
                boundingRegions: [{ pageNumber: 1, polygon: [0.1, 0.1, 0.5, 0.1, 0.5, 0.12, 0.1, 0.12] }],
            },
        ],
        pageBBoxes: [{ pageNumber: 1, bbox: [0.08, 0.2, 0.95, 0.5] }],
    });

    assert.equal(dateContext, null);
});

test('falls back to chunk content validity line when paragraph geometry is unavailable', () => {
    const dateContext = buildApplicableDateContextForTableBatch({
        chunkContent: [
            'Carrier Rate Sheet',
            'Validity : 12/8 ~ 12/14',
            'POL POD 20 40 40HC',
        ].join('\n'),
        paragraphs: [],
        pageBBoxes: [{ pageNumber: 1, bbox: [0.08, 0.2, 0.95, 0.5] }],
    });

    assert.equal(dateContext?.text, 'Validity : 12/8 ~ 12/14');
    assert.equal(dateContext?.source, 'above_table');
});

test('always uses full chunk content when table context exists', () => {
    const context = composeTableBatchContext({
        chunkContent: '--- Page 1 ---\nINVOICE\nLine A\nLine B',
        tableContext: '[{"table_index":0}]',
        batchLabel: '1/3',
        dateContextText: '[p1 0,0,1,1] 2026-05-06',
        documentContext: 'INVOICE HEADER',
    });

    assert.match(context, /--- Page 1 ---/);
    assert.match(context, /INVOICE/);
    assert.match(context, /--- TABLES \(Normalized Coordinates \| batch 1\/3\) ---/);
    assert.doesNotMatch(context, /--- APPLICABLE DATE CONTEXT ---/);
    assert.doesNotMatch(context, /--- DOCUMENT CONTEXT FOR THIS TABLE BATCH ---/);
});

test('falls back to full chunk content when table context is absent', () => {
    const context = composeTableBatchContext({
        chunkContent: '--- Page 1 ---\nINVOICE\nLine A\nLine B',
        tableContext: '',
        batchLabel: '1/3',
        dateContextText: '',
        documentContext: '',
    });

    assert.equal(context, '--- Page 1 ---\nINVOICE\nLine A\nLine B');
});

test('summarizes date field coverage for successful table batch responses', () => {
    const coverage = summarizeDateFieldCoverage({
        fields: [
            { key: 'START_DATE', label: 'Start Date' },
            { key: 'END_DATE', label: 'End Date' },
            { key: 'CURRENCY', label: 'Currency' },
        ],
        rows: [
            { __row_index: 60, START_DATE: '2025-12-08', END_DATE: '2025-12-14', CURRENCY: 'USD' },
            { __row_index: 61, START_DATE: { value: '' }, END_DATE: null, CURRENCY: 'USD' },
            { __row_index: 62, CURRENCY: 'USD' },
        ],
    });

    assert.deepEqual(coverage, [
        {
            fieldKey: 'START_DATE',
            totalRows: 3,
            filledRows: 1,
            missingRows: 2,
            sampleMissingRows: [61, 62],
            sampleFilledValues: ['2025-12-08'],
        },
        {
            fieldKey: 'END_DATE',
            totalRows: 3,
            filledRows: 1,
            missingRows: 2,
            sampleMissingRows: [61, 62],
            sampleFilledValues: ['2025-12-14'],
        },
    ]);
});

test('selects validity context from table footer cells when no above-table paragraph exists', () => {
    const tableContext = JSON.stringify([
        {
            page_number: 1,
            cells: [
                { row_index: 0, column_index: 0, content: 'POL', page_number: 1, bbox: [0.1, 0.2, 0.2, 0.22] },
                { row_index: 1, column_index: 0, content: 'JED', page_number: 1, bbox: [0.1, 0.24, 0.2, 0.26] },
                { row_index: 6, column_index: 1, content: 'VALIDITY', page_number: 1, bbox: [0.4, 0.82, 0.5, 0.84] },
                { row_index: 6, column_index: 2, content: '03/12 - 03/31', page_number: 1, bbox: [0.55, 0.82, 0.7, 0.84] },
            ],
        },
    ]);

    const dateContext = buildApplicableDateContextForTableBatch({
        paragraphs: [],
        pageBBoxes: [{ pageNumber: 1, bbox: [0.08, 0.18, 0.95, 0.88] }],
        tableContext,
    });

    assert.equal(dateContext?.text, 'VALIDITY 03/12 - 03/31');
    assert.equal(dateContext?.source, 'inside_table');
});

test('carries previous table date context to a later continuation page', () => {
    const carried = carryForwardApplicableDateContext({
        current: null,
        previous: {
            text: 'Validity : 12/1 ~ 12/7',
            pageNumber: 1,
            y: 0.08,
            bbox: [0.1, 0.08, 0.5, 0.1],
            source: 'above_table',
        },
        pageBBoxes: [{ pageNumber: 2, bbox: [0.08, 0.2, 0.95, 0.8] }],
    });

    assert.equal(carried?.text, 'Validity : 12/1 ~ 12/7');
    assert.equal(carried?.source, 'previous_table');
});

test('removes prompt-only table metadata while preserving extraction keys', () => {
    const cell = compactTablePromptCell({
        table_index: 2,
        row_index: 10,
        column_index: 3,
        row_span: 1,
        column_span: 1,
        content: 'Toronto, ON',
        page_number: 4,
        cell_index: 99,
        bbox: [0.1, 0.2, 0.3, 0.4],
        slice_count: 5,
        carried_header: true,
    });

    assert.deepEqual(cell, {
        table_index: 2,
        row_index: 10,
        column_index: 3,
        content: 'Toronto, ON',
        page_number: 4,
        carried_header: true,
    });

    const slice = compactTablePromptSlice({
        table_index: 2,
        page_number: 4,
        page_start: 4,
        page_end: 4,
        row_count: 100,
        column_count: 6,
        row_range_start: 10,
        row_range_end: 20,
        row_bucket_index_start: 0,
        row_bucket_index_end: 10,
        slice_index: 3,
        slice_count: 8,
        cells: [cell],
    });

    assert.deepEqual(slice, {
        table_index: 2,
        page_number: 4,
        column_count: 6,
        row_range_start: 10,
        row_range_end: 20,
        slice_index: 3,
        cells: [cell],
    });
});

test('extracts merged page bounding boxes from compact table batch payload', () => {
    const tableContext = JSON.stringify([
        {
            table_index: 0,
            page_number: 1,
            row_range_start: 0,
            row_range_end: 5,
            cells: [
                { row_index: -1, column_index: 0, content: 'POL', page_number: 1, bbox: [0.1, 0.08, 0.2, 0.1], carried_header: true },
                { row_index: 0, column_index: 0, content: 'BUSAN', page_number: 1, bbox: [0.1, 0.2, 0.25, 0.22] },
                { row_index: 0, column_index: 1, content: 'USD 100', page_number: 1, bbox: [0.3, 0.2, 0.45, 0.22] },
                { row_index: 1, column_index: 0, content: 'INCHEON', page_number: 2, bbox: [0.1, 0.18, 0.25, 0.2] },
                { row_index: 1, column_index: 1, content: 'USD 120', page_number: 2, bbox: [0.3, 0.18, 0.45, 0.2] },
            ],
        },
    ]);

    assert.deepEqual(extractPageBBoxesFromTableContext(tableContext), [
        { pageNumber: 1, bbox: [0.1, 0.08, 0.45, 0.22] },
        { pageNumber: 2, bbox: [0.1, 0.18, 0.45, 0.2] },
    ]);
});
