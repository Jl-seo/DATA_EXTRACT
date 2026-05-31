import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildTableBatchPromptParts,
    selectTableBatchFields,
} from './TableBatchPrompt.ts';

test('selects table fields and table-adjacent scalar fields for table batches', () => {
    const selected = selectTableBatchFields([
        { key: 'Rate_List', label: 'Rate List', type: 'table', sub_fields: [{ key: 'POL', label: 'POL', type: 'text' }] },
        { key: 'Validity', label: 'Validity', type: 'text' },
        { key: 'Surcharge_Note', label: 'Surcharge Note', type: 'text' },
        { key: 'Carrier_Name', label: 'Carrier Name', type: 'text' },
    ]);

    assert.deepEqual(selected.map((field) => field.key), ['Rate_List', 'Validity', 'Surcharge_Note']);
});

test('builds table batch prompt parts with full global rules and reduced reference data', () => {
    const parts = buildTableBatchPromptParts({
        fields: [
            { key: 'Rate_List', label: 'Rate List', type: 'table', sub_fields: [{ key: 'POL', label: 'POL', type: 'text' }] },
            { key: 'Validity', label: 'Validity', type: 'text' },
            { key: 'Carrier_Name', label: 'Carrier Name', type: 'text' },
        ],
        globalRules: [
            '<core_objective>core</core_objective>',
            '<decision_order>decision</decision_order>',
            '<remark_style_rules>remark</remark_style_rules>',
            '<verification_rules>verify</verification_rules>',
        ].join('\n'),
        referenceData: {
            unique_constraints: [{ target_array: 'Rate_List', unique_keys: ['POL', 'POD', 'PVY', 'Via', 'Validity'] }],
            route_pod_mapping: { USEC: ['USNYC', 'USSAV'] },
            carrier_route_surcharge_hints: { hmm: { north_america: { included: ['BAF'] } } },
            carrier_surcharge_aliases: { BAF: ['B.A.F'] },
            surcharge_catalog: { BAF: { charge_type: 'ocean' } },
            very_large_unused_section: { ignored: true },
        },
    });

    assert.match(parts.fieldDescriptions, /Rate_List/);
    assert.match(parts.fieldDescriptions, /Validity/);
    assert.doesNotMatch(parts.fieldDescriptions, /Carrier_Name/);

    assert.match(parts.globalRules, /core/);
    assert.match(parts.globalRules, /decision/);
    assert.match(parts.globalRules, /verify/);
    assert.match(parts.globalRules, /remark/);

    const reference = JSON.parse(parts.referenceDataJson);
    assert.deepEqual(Object.keys(reference).sort(), [
        'carrier_route_surcharge_hints',
        'carrier_surcharge_aliases',
        'route_pod_mapping',
        'surcharge_catalog',
        'unique_constraints',
    ]);
    assert.equal(reference.very_large_unused_section, undefined);
});

test('filters low-scoring table fields and keeps matching table fields for packing-like headers', () => {
    const parts = buildTableBatchPromptParts({
        fields: [
            {
                key: 'invoice_item',
                label: 'Invoice Item',
                type: 'table',
                sub_fields: [
                    { key: 'po_no', label: 'PO No', type: 'text' },
                    { key: 'item_no', label: 'Item No', type: 'text' },
                    { key: 'description', label: 'Description', type: 'text' },
                    { key: 'qty', label: 'Qty', type: 'text' },
                    { key: 'unit_price', label: 'Unit Price', type: 'text' },
                    { key: 'amount', label: 'Amount', type: 'text' },
                ],
            },
            {
                key: 'packing_item',
                label: 'Packing Item',
                type: 'table',
                sub_fields: [
                    { key: 'carton_no', label: 'Carton No', type: 'text' },
                    { key: 'net_weight', label: 'Net Weight', type: 'text' },
                    { key: 'gross_weight', label: 'Gross Weight', type: 'text' },
                ],
            },
        ],
        chunkContent: 'PACKING LIST\nNET WEIGHT\nGROSS WEIGHT\nCARTON',
        tableContext: JSON.stringify([{
            cells: [
                { row_index: 0, column_index: 0, content: 'Carton No', is_header: true },
                { row_index: 0, column_index: 1, content: 'Net Weight', is_header: true },
                { row_index: 0, column_index: 2, content: 'Gross Weight', is_header: true },
            ],
        }]),
        headerSource: 'direct',
    });

    assert.doesNotMatch(parts.fieldDescriptions, /invoice_item/);
    assert.match(parts.fieldDescriptions, /packing_item/);
});

test('keeps the best matching table field for invoice-like headers', () => {
    const parts = buildTableBatchPromptParts({
        fields: [
            {
                key: 'invoice_item',
                label: 'Invoice Item',
                type: 'table',
                sub_fields: [
                    { key: 'po_no', label: 'PO No', type: 'text' },
                    { key: 'item_no', label: 'Item No', type: 'text' },
                    { key: 'description', label: 'Description', type: 'text' },
                    { key: 'qty', label: 'Qty', type: 'text' },
                    { key: 'unit_price', label: 'Unit Price', type: 'text' },
                    { key: 'amount', label: 'Amount', type: 'text' },
                ],
            },
            {
                key: 'packing_item',
                label: 'Packing Item',
                type: 'table',
                sub_fields: [
                    { key: 'carton_no', label: 'Carton No', type: 'text' },
                    { key: 'net_weight', label: 'Net Weight', type: 'text' },
                    { key: 'gross_weight', label: 'Gross Weight', type: 'text' },
                ],
            },
        ],
        chunkContent: 'COMMERCIAL INVOICE\nInvoice No. 12345',
        tableContext: JSON.stringify([{
            cells: [
                { row_index: 0, column_index: 0, content: 'PO No', is_header: true },
                { row_index: 0, column_index: 1, content: 'Item No', is_header: true },
                { row_index: 0, column_index: 2, content: 'Description', is_header: true },
                { row_index: 0, column_index: 3, content: 'Qty', is_header: true },
                { row_index: 0, column_index: 4, content: 'Unit Price', is_header: true },
                { row_index: 0, column_index: 5, content: 'Amount', is_header: true },
            ],
        }]),
        headerSource: 'direct',
    });

    assert.match(parts.fieldDescriptions, /invoice_item/);
    assert.doesNotMatch(parts.fieldDescriptions, /packing_item/);
});
