import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildTableBatchExecutionGroups } from './TableBatchExecution.ts';

test('groups consecutive legacy batches into parallel execution groups', () => {
    const groups = buildTableBatchExecutionGroups([
        { batchIndex: 0, shouldUseEnhancedContext: false },
        { batchIndex: 1, shouldUseEnhancedContext: false },
        { batchIndex: 2, shouldUseEnhancedContext: true },
        { batchIndex: 3, shouldUseEnhancedContext: false },
        { batchIndex: 4, shouldUseEnhancedContext: true },
        { batchIndex: 5, shouldUseEnhancedContext: true },
        { batchIndex: 6, shouldUseEnhancedContext: false },
    ]);

    assert.deepEqual(groups, [
        { mode: 'parallel', batchIndexes: [0, 1] },
        { mode: 'sequential', batchIndexes: [2] },
        { mode: 'parallel', batchIndexes: [3] },
        { mode: 'sequential', batchIndexes: [4] },
        { mode: 'sequential', batchIndexes: [5] },
        { mode: 'parallel', batchIndexes: [6] },
    ]);
});

test('returns one parallel group when all batches are legacy', () => {
    const groups = buildTableBatchExecutionGroups([
        { batchIndex: 0, shouldUseEnhancedContext: false },
        { batchIndex: 1, shouldUseEnhancedContext: false },
        { batchIndex: 2, shouldUseEnhancedContext: false },
    ]);

    assert.deepEqual(groups, [
        { mode: 'parallel', batchIndexes: [0, 1, 2] },
    ]);
});
