import { z } from 'zod';

export interface ParsedBatchDebugSections {
    taggedText: string;
    tableBatchInputs: string;
}

export interface NormalizedBatchTableCell {
    row_index: number;
    column_index: number;
    row_span: number;
    column_span: number;
    content: string;
    is_header: boolean;
}

export interface NormalizedBatchTable {
    row_count: number;
    column_count: number;
    cells: NormalizedBatchTableCell[];
}

export interface NormalizedBatchTableGroup {
    batchLabel: string;
    tables: NormalizedBatchTable[];
}

type StructuredBatchInput = {
    batchLabel?: unknown;
    tableContext?: unknown;
    context?: unknown;
};

const TABLE_BATCH_MARKER = '[TABLE_BATCH_INPUTS]';
const BBOX_ARRAY_PATTERN = /\[(?:\s*-?\d+(?:\.\d+)?\s*,){3,}\s*-?\d+(?:\.\d+)?\s*\]\s*/g;
const TABLE_CONTEXT_MARKER = '--- TABLE CONTEXT ---';
const FINAL_CONTEXT_MARKER = '--- FINAL CONTEXT ---';
const nonNegativeIntSchema = z.number().int().nonnegative();
const positiveIntSchema = z.number().int().positive();
const normalizedBatchTableCellSchema = z.object({
    row_index: nonNegativeIntSchema,
    column_index: nonNegativeIntSchema,
    row_span: positiveIntSchema,
    column_span: positiveIntSchema,
    content: z.string(),
    is_header: z.boolean(),
});
const normalizedBatchTableSchema = z.object({
    row_count: nonNegativeIntSchema,
    column_count: nonNegativeIntSchema,
    cells: z.array(normalizedBatchTableCellSchema),
});

export function splitTaggedTextAndBatchInputs(text?: string): ParsedBatchDebugSections {
    const source = typeof text === 'string' ? text : '';
    const markerIndex = source.indexOf(TABLE_BATCH_MARKER);

    if (markerIndex < 0) {
        return {
            taggedText: source,
            tableBatchInputs: '',
        };
    }

    return {
        taggedText: source.slice(0, markerIndex).trim(),
        tableBatchInputs: source.slice(markerIndex).trim(),
    };
}

export function stripCoordinateArraysForDisplay(text?: string): string {
    const source = typeof text === 'string' ? text : '';
    return source
        .replace(BBOX_ARRAY_PATTERN, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function extractTableContextsForDisplay(text?: string): string {
    const source = typeof text === 'string' ? text : '';
    if (!source.includes(TABLE_CONTEXT_MARKER)) {
        return stripCoordinateArraysForDisplay(source);
    }

    const chunks = source.split(/\n(?=### batch=)/);
    const rendered = chunks
        .map((chunk) => {
            const trimmedChunk = chunk.trim();
            if (!trimmedChunk) {
                return '';
            }

            const tableContextIndex = trimmedChunk.indexOf(TABLE_CONTEXT_MARKER);
            if (tableContextIndex < 0) {
                return '';
            }

            const finalContextIndex = trimmedChunk.indexOf(FINAL_CONTEXT_MARKER);
            const tableContext = trimmedChunk
                .slice(
                    tableContextIndex + TABLE_CONTEXT_MARKER.length,
                    finalContextIndex >= 0 ? finalContextIndex : undefined
                )
                .trim();

            const batchHeaderMatch = trimmedChunk.match(/^### batch=.*$/m);
            if (!tableContext) {
                return '';
            }

            return [
                batchHeaderMatch?.[0] ?? '### batch',
                stripCoordinateArraysForDisplay(tableContext),
            ].join('\n');
        })
        .filter(Boolean)
        .join('\n\n');

    return rendered.trim();
}

export function extractFinalContextsForDisplay(text?: string): string {
    const source = typeof text === 'string' ? text : '';
    if (!source.includes(FINAL_CONTEXT_MARKER)) {
        return stripCoordinateArraysForDisplay(source);
    }

    const chunks = source.split(/\n(?=### batch=)/);
    const rendered = chunks
        .map((chunk) => {
            const trimmedChunk = chunk.trim();
            if (!trimmedChunk) {
                return '';
            }

            const finalContextIndex = trimmedChunk.indexOf(FINAL_CONTEXT_MARKER);
            if (finalContextIndex < 0) {
                return '';
            }

            const finalContext = trimmedChunk
                .slice(finalContextIndex + FINAL_CONTEXT_MARKER.length)
                .trim();

            const batchHeaderMatch = trimmedChunk.match(/^### batch=.*$/m);
            if (!finalContext) {
                return '';
            }

            return [
                batchHeaderMatch?.[0] ?? '### batch',
                stripCoordinateArraysForDisplay(finalContext),
            ].join('\n');
        })
        .filter(Boolean)
        .join('\n\n');

    return rendered.trim();
}

function isStructuredBatchInput(value: unknown): value is StructuredBatchInput {
    return !!value && typeof value === 'object';
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
}

function toInt(value: unknown, fallback: number): number {
    const numeric = toNumber(value);
    if (numeric === null) return fallback;
    return Math.trunc(numeric);
}

function toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y';
    }
    if (typeof value === 'number') {
        return value === 1;
    }
    return false;
}

function toDisplayString(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
}

function normalizeBatchCell(cell: unknown): NormalizedBatchTableCell | null {
    const cellObj = asRecord(cell);
    if (!cellObj) return null;

    const rowIndex = toInt(cellObj.row_index ?? cellObj.rowIndex, -1);
    const columnIndex = toInt(cellObj.column_index ?? cellObj.columnIndex, -1);
    if (rowIndex < 0 || columnIndex < 0) return null;

    const parsedCell = normalizedBatchTableCellSchema.safeParse({
        row_index: rowIndex,
        column_index: columnIndex,
        row_span: Math.max(1, toInt(cellObj.row_span ?? cellObj.rowSpan, 1)),
        column_span: Math.max(1, toInt(cellObj.column_span ?? cellObj.columnSpan, 1)),
        content: toDisplayString(cellObj.content ?? cellObj.text),
        is_header: toBoolean(cellObj.is_header ?? cellObj.isHeader),
    });

    if (!parsedCell.success) return null;
    return parsedCell.data;
}

function normalizeBatchTable(table: unknown): NormalizedBatchTable | null {
    const tableObj = asRecord(table);
    if (!tableObj) return null;

    const rawCells = Array.isArray(tableObj.cells) ? tableObj.cells : [];
    const normalizedCells = rawCells
        .map((cell) => normalizeBatchCell(cell))
        .filter((cell): cell is NormalizedBatchTableCell => cell !== null)
        .sort((a, b) => {
            if (a.row_index !== b.row_index) return a.row_index - b.row_index;
            return a.column_index - b.column_index;
        });

    if (normalizedCells.length === 0) return null;

    const derivedRowCount = normalizedCells.reduce(
        (max, cell) => Math.max(max, cell.row_index + cell.row_span),
        0
    );
    const derivedColumnCount = normalizedCells.reduce(
        (max, cell) => Math.max(max, cell.column_index + cell.column_span),
        0
    );

    const parsedTable = normalizedBatchTableSchema.safeParse({
        row_count: Math.max(
            toInt(tableObj.row_count ?? tableObj.rowCount, 0),
            derivedRowCount
        ),
        column_count: Math.max(
            toInt(tableObj.column_count ?? tableObj.columnCount, 0),
            derivedColumnCount
        ),
        cells: normalizedCells,
    });

    if (!parsedTable.success) return null;
    return parsedTable.data;
}

function parseNormalizedTables(tableContext: string): NormalizedBatchTable[] {
    try {
        const parsed = JSON.parse(tableContext);
        const rawTables = Array.isArray(parsed) ? parsed : [parsed];

        return rawTables
            .map((table) => normalizeBatchTable(table))
            .filter((table): table is NormalizedBatchTable => table !== null);
    } catch {
        return [];
    }
}

export function extractNormalizedTablesFromStructuredInputs(inputs?: unknown[]): NormalizedBatchTableGroup[] {
    if (!Array.isArray(inputs) || inputs.length === 0) {
        return [];
    }

    return inputs
        .map((input, index) => {
            if (!isStructuredBatchInput(input)) {
                return null;
            }

            const batchLabel = typeof input.batchLabel === 'string' && input.batchLabel.trim().length > 0
                ? input.batchLabel
                : `${index + 1}`;
            const tableContext = typeof input.tableContext === 'string'
                ? input.tableContext.trim()
                : '';
            if (!tableContext) {
                return null;
            }

            const tables = parseNormalizedTables(tableContext);
            if (tables.length === 0) {
                return null;
            }

            return {
                batchLabel,
                tables,
            };
        })
        .filter((item): item is NormalizedBatchTableGroup => item !== null);
}

export function extractTableContextsFromStructuredInputs(inputs?: unknown[]): string {
    if (!Array.isArray(inputs) || inputs.length === 0) {
        return '';
    }

    return inputs
        .map((input, index) => {
            if (!isStructuredBatchInput(input)) {
                return '';
            }

            const batchLabel = typeof input.batchLabel === 'string' && input.batchLabel.trim().length > 0
                ? input.batchLabel
                : `${index + 1}`;
            const tableContext = typeof input.tableContext === 'string'
                ? input.tableContext.trim()
                : '';

            if (!tableContext) {
                return '';
            }

            return [
                `### batch=${batchLabel}`,
                stripCoordinateArraysForDisplay(tableContext),
            ].join('\n');
        })
        .filter((item) => item.length > 0)
        .join('\n\n')
        .trim();
}

export function extractFinalContextsFromStructuredInputs(inputs?: unknown[]): string {
    if (!Array.isArray(inputs) || inputs.length === 0) {
        return '';
    }

    return inputs
        .map((input, index) => {
            if (!isStructuredBatchInput(input)) {
                return '';
            }

            const batchLabel = typeof input.batchLabel === 'string' && input.batchLabel.trim().length > 0
                ? input.batchLabel
                : `${index + 1}`;
            const context = typeof input.context === 'string'
                ? input.context.trim()
                : '';

            if (!context) {
                return '';
            }

            return [
                `### batch=${batchLabel}`,
                stripCoordinateArraysForDisplay(context),
            ].join('\n');
        })
        .filter((item) => item.length > 0)
        .join('\n\n')
        .trim();
}
