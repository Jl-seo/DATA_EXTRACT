import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canEditExtractionModel } from '../../lib/extractionPermission.ts';

test('global admin can edit any model', () => {
    const result = canEditExtractionModel(
        {
            isGlobalAdmin: true,
            roles: [],
        },
        'model-a'
    );

    assert.equal(result, true);
});

test('model admin can edit only the matching model', () => {
    const summary = {
        isGlobalAdmin: false,
        roles: [
            { modelId: 'model-a', modelName: 'A', role: 'Admin' },
            { modelId: 'model-b', modelName: 'B', role: 'User' },
        ],
    };

    assert.equal(canEditExtractionModel(summary, 'model-a'), true);
    assert.equal(canEditExtractionModel(summary, 'model-b'), false);
    assert.equal(canEditExtractionModel(summary, 'model-c'), false);
});

test('wildcard admin role grants edit access', () => {
    const result = canEditExtractionModel(
        {
            isGlobalAdmin: false,
            roles: [{ modelId: '*', modelName: '모든 모델', role: 'Admin' }],
        },
        'sub-model'
    );

    assert.equal(result, true);
});

test('missing target model id never grants edit access', () => {
    const result = canEditExtractionModel(
        {
            isGlobalAdmin: true,
            roles: [{ modelId: '*', modelName: '모든 모델', role: 'Admin' }],
        },
        undefined
    );

    assert.equal(result, false);
});
