import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveStrictTableColumnKeys } from './tableSchema.ts';

test('uses model table sub_fields when they are defined', () => {
    const keys = resolveStrictTableColumnKeys(
        [{ key: 'po_no' }, { key: 'item_no' }],
        [{ key: 'legacy_col' }]
    );

    assert.deepEqual(keys, ['po_no', 'item_no']);
});

test('falls back to value sub_fields when model sub_fields are missing', () => {
    const keys = resolveStrictTableColumnKeys(
        undefined,
        [{ key: 'po_no' }, { key: 'item_no' }]
    );

    assert.deepEqual(keys, ['po_no', 'item_no']);
});

test('does not infer table columns from extracted row keys when no schema exists', () => {
    const keys = resolveStrictTableColumnKeys(undefined, undefined);

    assert.deepEqual(keys, []);
});
