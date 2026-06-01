import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildCameraConstraintsCandidates } from './cameraConstraints.ts';

test('기본 카메라 제약은 environment 우선 후 user 폴백 순서를 가진다', () => {
    const candidates = buildCameraConstraintsCandidates();
    assert.deepEqual(candidates, [
        { facingMode: 'environment' },
        { facingMode: 'user' },
    ]);
});

test('user 우선 요청 시 user 후 environment 폴백 순서를 가진다', () => {
    const candidates = buildCameraConstraintsCandidates('user');
    assert.deepEqual(candidates, [
        { facingMode: 'user' },
        { facingMode: 'environment' },
    ]);
});
