import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    getContinuationLeadingColumnOffset,
    shouldGroupAsContinuationTable,
    shouldCarryForwardHeader,
    shouldUseEnhancedTableContext,
} from './CuTableStrategy.ts';

test('carries header only for consecutive next-page continuation tables', () => {
    assert.equal(shouldCarryForwardHeader({
        currentTablePage: 2,
        currentTableIndex: 1,
        currentHasDirectHeader: false,
        columnCount: 6,
        previousHeaderTablePage: 1,
        previousHeaderTableIndex: 0,
        previousHeaderColumnCount: 6,
    }), true);
});

test('does not carry header for same-page table without direct header', () => {
    assert.equal(shouldCarryForwardHeader({
        currentTablePage: 1,
        currentTableIndex: 1,
        currentHasDirectHeader: false,
        columnCount: 6,
        previousHeaderTablePage: 1,
        previousHeaderTableIndex: 0,
        previousHeaderColumnCount: 6,
    }), false);
});

test('does not carry header when column count differs', () => {
    assert.equal(shouldCarryForwardHeader({
        currentTablePage: 2,
        currentTableIndex: 1,
        currentHasDirectHeader: false,
        columnCount: 5,
        previousHeaderTablePage: 1,
        previousHeaderTableIndex: 0,
        previousHeaderColumnCount: 6,
    }), false);
});

test('uses enhanced context only for continuation-like batches', () => {
    assert.equal(shouldUseEnhancedTableContext({
        headerSource: 'carried',
        pages: [1, 2],
    }), true);

    assert.equal(shouldUseEnhancedTableContext({
        headerSource: 'direct',
        pages: [1, 2],
    }), true);

    assert.equal(shouldUseEnhancedTableContext({
        headerSource: 'direct',
        pages: [1],
    }), false);

    assert.equal(shouldUseEnhancedTableContext({
        headerSource: 'carried',
        pages: [1],
        hasDocumentContext: false,
        hasDateContext: false,
    }), false);

    assert.equal(shouldUseEnhancedTableContext({
        headerSource: 'carried',
        pages: [1],
        hasDocumentContext: true,
        hasDateContext: false,
    }), true);
});

test('groups next-page table without direct header as continuation', () => {
    assert.equal(shouldGroupAsContinuationTable({
        previousTablePage: 1,
        previousHasDirectHeader: true,
        previousColumnCount: 8,
        currentTablePage: 2,
        currentHasDirectHeader: false,
        currentColumnCount: 8,
    }), true);
});

test('groups next-page table without direct header when one leading column is missing', () => {
    assert.equal(shouldGroupAsContinuationTable({
        previousTablePage: 1,
        previousHasDirectHeader: true,
        previousColumnCount: 8,
        currentTablePage: 2,
        currentHasDirectHeader: false,
        currentColumnCount: 7,
    }), true);
});

test('does not group continuation when current table has direct header', () => {
    assert.equal(shouldGroupAsContinuationTable({
        previousTablePage: 1,
        previousHasDirectHeader: true,
        previousColumnCount: 8,
        currentTablePage: 2,
        currentHasDirectHeader: true,
        currentColumnCount: 8,
    }), false);
});

test('groups continuation when current repeated header matches previous header', () => {
    assert.equal(shouldGroupAsContinuationTable({
        previousTablePage: 1,
        previousHasDirectHeader: true,
        previousColumnCount: 8,
        currentTablePage: 2,
        currentHasDirectHeader: true,
        currentColumnCount: 8,
        currentHeaderMatchesPrevious: true,
    }), true);
});

test('does not group continuation when column deficit is too large', () => {
    assert.equal(shouldGroupAsContinuationTable({
        previousTablePage: 1,
        previousHasDirectHeader: true,
        previousColumnCount: 8,
        currentTablePage: 2,
        currentHasDirectHeader: false,
        currentColumnCount: 5,
    }), false);
});

test('returns leading column offset only for headerless continuation deficit', () => {
    assert.equal(getContinuationLeadingColumnOffset({
        previousColumnCount: 8,
        currentColumnCount: 7,
        currentHasDirectHeader: false,
    }), 1);

    assert.equal(getContinuationLeadingColumnOffset({
        previousColumnCount: 8,
        currentColumnCount: 8,
        currentHasDirectHeader: false,
    }), 0);

    assert.equal(getContinuationLeadingColumnOffset({
        previousColumnCount: 8,
        currentColumnCount: 7,
        currentHasDirectHeader: true,
    }), 0);
});
