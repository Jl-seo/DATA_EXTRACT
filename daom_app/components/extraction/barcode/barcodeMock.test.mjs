import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildMockErpLookup,
    mergeScannedBarcode,
} from './barcodeMock.ts';

test('single 모드에서는 마지막 스캔 1건만 유지한다', () => {
    const first = mergeScannedBarcode([], {
        code: '8801234567890',
        format: 'EAN_13',
        scannedAt: '2026-05-26T00:00:00.000Z',
    }, 'single');

    const second = mergeScannedBarcode(first, {
        code: '8801234567891',
        format: 'EAN_13',
        scannedAt: '2026-05-26T00:01:00.000Z',
    }, 'single');

    assert.equal(second.length, 1);
    assert.equal(second[0].code, '8801234567891');
    assert.equal(second[0].hitCount, 1);
});

test('multi 모드에서는 중복 코드를 누적 카운트한다', () => {
    const first = mergeScannedBarcode([], {
        code: 'A-100',
        format: 'CODE_128',
        scannedAt: '2026-05-26T00:00:00.000Z',
    }, 'multi');

    const duplicated = mergeScannedBarcode(first, {
        code: 'A-100',
        format: 'CODE_128',
        scannedAt: '2026-05-26T00:00:03.000Z',
    }, 'multi');

    assert.equal(duplicated.length, 1);
    assert.equal(duplicated[0].code, 'A-100');
    assert.equal(duplicated[0].hitCount, 2);
    assert.equal(duplicated[0].scannedAt, '2026-05-26T00:00:03.000Z');
});

test('mock 조회 결과는 같은 바코드에 대해 동일하게 생성된다', () => {
    const first = buildMockErpLookup('8801234567890');
    const second = buildMockErpLookup('8801234567890');

    assert.deepEqual(first, second);
    assert.equal(first.barcode, '8801234567890');
    assert.equal(typeof first.quantity, 'number');
});
