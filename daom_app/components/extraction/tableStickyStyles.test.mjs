import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getStickyTableClasses } from './tableStickyStyles.ts';

test('body sticky cells keep an opaque surface on the cell itself', () => {
    const classes = getStickyTableClasses({
        section: 'body',
        column: 'first-data',
        isSelected: false,
    });

    assert.match(classes.cellClassName, /sticky left-16/);
    assert.match(classes.cellClassName, /bg-background/);
    assert.doesNotMatch(classes.cellClassName, /group-hover\/row:bg-primary\/5/);
    assert.match(classes.innerClassName, /group-hover\/row:bg-primary\/5/);
});

test('selected sticky body cells apply highlight on the inner layer', () => {
    const classes = getStickyTableClasses({
        section: 'body',
        column: 'first-data',
        isSelected: true,
    });

    assert.doesNotMatch(classes.cellClassName, /bg-primary\/15/);
    assert.match(classes.innerClassName, /bg-primary\/15/);
    assert.match(classes.innerClassName, /ring-1/);
});

test('sticky header cells use muted background without row hover classes', () => {
    const classes = getStickyTableClasses({
        section: 'header',
        column: 'actions',
        isSelected: false,
    });

    assert.match(classes.cellClassName, /sticky left-0 top-0/);
    assert.match(classes.cellClassName, /bg-muted/);
    assert.equal(classes.innerClassName, '');
});
