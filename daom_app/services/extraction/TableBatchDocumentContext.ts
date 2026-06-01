export type TableBatchPageBBox = {
    pageNumber: number;
    bbox: number[];
};

type ParsedContextLine = {
    text: string;
    pageNumber?: number;
    bbox?: number[];
    sourceRank: number;
};

export type ApplicableDateContext = {
    text: string;
    pageNumber: number;
    y: number;
    bbox: number[];
    source?: 'above_table' | 'inside_table' | 'below_table' | 'previous_table';
};

export type DateFieldCoverageField = {
    key: string;
    label?: string | null;
    type?: string | null;
};

export type DateFieldCoverageSummary = {
    fieldKey: string;
    totalRows: number;
    filledRows: number;
    missingRows: number;
    sampleMissingRows: number[];
    sampleFilledValues: string[];
};

type BuildTableBatchDocumentContextParams = {
    chunkContent: string;
    paragraphs: unknown[];
    pageBBoxes: TableBatchPageBBox[];
    maxChars?: number;
    maxLines?: number;
};

type BuildApplicableDateContextParams = {
    paragraphs: unknown[];
    pageBBoxes: TableBatchPageBBox[];
    tableContext?: string;
    chunkContent?: string;
};

type CarryForwardApplicableDateContextParams = {
    current: ApplicableDateContext | null;
    previous: ApplicableDateContext | null;
    pageBBoxes: TableBatchPageBBox[];
};

const TABLE_PROMPT_CELL_ALWAYS_OMIT_KEYS = new Set([
    'bbox',
    'cell_index',
    'slice_count',
]);

const TABLE_PROMPT_SLICE_ALWAYS_OMIT_KEYS = new Set([
    'page_start',
    'page_end',
    'row_count',
    'row_bucket_index_start',
    'row_bucket_index_end',
    'slice_count',
]);

export function compactTablePromptCell(cell: Record<string, unknown>): Record<string, unknown> {
    const compacted: Record<string, unknown> = {};

    Object.entries(cell).forEach(([key, value]) => {
        if (TABLE_PROMPT_CELL_ALWAYS_OMIT_KEYS.has(key)) return;
        if (key === 'row_span' && value === 1) return;
        if (key === 'column_span' && value === 1) return;
        compacted[key] = value;
    });

    return compacted;
}

export function compactTablePromptSlice(slice: Record<string, unknown>): Record<string, unknown> {
    const compacted: Record<string, unknown> = {};

    Object.entries(slice).forEach(([key, value]) => {
        if (TABLE_PROMPT_SLICE_ALWAYS_OMIT_KEYS.has(key)) return;
        compacted[key] = value;
    });

    return compacted;
}

export function extractPageBBoxesFromTableContext(tableContext?: string): TableBatchPageBBox[] {
    if (!tableContext || !tableContext.trim()) return [];

    try {
        const parsed = JSON.parse(tableContext);
        const slices = Array.isArray(parsed) ? parsed : [];
        const pageBoxMap = new Map<number, number[]>();

        slices.forEach((slice) => {
            const sliceObj = asRecord(slice);
            const slicePageNumber = pickNumber(sliceObj, ['page_number', 'pageNumber', 'page_start']);
            const cells = asArray(sliceObj?.cells);

            cells.forEach((cell) => {
                const cellObj = asRecord(cell);
                if (!cellObj) return;

                const pageNumber = pickNumber(cellObj, ['page_number', 'pageNumber']) ?? slicePageNumber;
                const bbox = pickNumberArray(cellObj, ['bbox']);
                if (!pageNumber || !bbox || bbox.length < 4) return;

                const existing = pageBoxMap.get(pageNumber);
                pageBoxMap.set(pageNumber, existing ? mergeBBoxes([existing, bbox]) || existing : bbox);
            });
        });

        return Array.from(pageBoxMap.entries())
            .sort(([left], [right]) => left - right)
            .map(([pageNumber, bbox]) => ({ pageNumber, bbox }));
    } catch {
        return [];
    }
}

const DEFAULT_MAX_CHARS = 3500;
const DEFAULT_MAX_LINES = 28;

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function pickString(record: Record<string, unknown> | null, keys: string[]): string | undefined {
    if (!record) return undefined;
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
}

function pickNumber(record: Record<string, unknown> | null, keys: string[]): number | undefined {
    if (!record) return undefined;
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
    }
    return undefined;
}

function pickNumberArray(record: Record<string, unknown> | null, keys: string[]): number[] | undefined {
    if (!record) return undefined;
    for (const key of keys) {
        const value = record[key];
        if (!Array.isArray(value)) continue;
        const numbers = value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
        if (numbers.length === value.length && numbers.length >= 4) return numbers;
    }
    return undefined;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function polygonToBBox(values: number[] | undefined): number[] | undefined {
    if (!values || values.length < 4) return undefined;
    if (values.length === 4) return values;

    const xs: number[] = [];
    const ys: number[] = [];
    for (let index = 0; index + 1 < values.length; index += 2) {
        xs.push(values[index]);
        ys.push(values[index + 1]);
    }
    if (xs.length === 0 || ys.length === 0) return undefined;
    return [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys),
    ];
}

function normalizeForDedupe(value: string): string {
    return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeToken(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isLikelyTableRowText(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed) return false;
    const upperTokens = trimmed.match(/[A-Z]{2,}/g) || [];
    const numberTokens = trimmed.match(/\d[\d,.]*/g) || [];
    return upperTokens.length >= 2 && numberTokens.length >= 2 && trimmed.length < 180;
}

function isLikelyStructuredHeaderLine(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed || !isLikelyTableRowText(trimmed)) return false;
    const numberTokens = trimmed.match(/\d[\d,.]*/g) || [];
    return numberTokens.every((token) => token.replace(/[^\d]/g, '').length <= 2);
}

function isDateCoverageField(field: DateFieldCoverageField): boolean {
    const key = normalizeToken(field.key);
    const label = normalizeToken(field.label || '');
    const type = normalizeToken(field.type || '');
    const combined = `${key} ${label}`;

    return (
        type === 'date' ||
        combined.includes('startdate') ||
        combined.includes('enddate') ||
        combined.includes('validity') ||
        combined.includes('validfrom') ||
        combined.includes('validto')
    );
}

function unwrapCellValue(value: unknown): unknown {
    const record = asRecord(value);
    if (record && Object.prototype.hasOwnProperty.call(record, 'value')) {
        return record.value;
    }
    return value;
}

function isMissingCellValue(value: unknown): boolean {
    const unwrapped = unwrapCellValue(value);
    if (unwrapped === null || unwrapped === undefined) return true;
    if (typeof unwrapped === 'string') return unwrapped.trim() === '';
    return false;
}

function getRowSourceIndex(row: Record<string, unknown>, fallbackIndex: number): number {
    return (
        pickNumber(row, ['__row_index', 'row_index', '__row', 'row']) ??
        fallbackIndex
    );
}

export function summarizeDateFieldCoverage(params: {
    fields: DateFieldCoverageField[];
    rows: unknown[];
}): DateFieldCoverageSummary[] {
    const dateFields = params.fields.filter((field) => isDateCoverageField(field));
    if (dateFields.length === 0 || params.rows.length === 0) return [];

    return dateFields.map((field) => {
        const fieldKeyNorm = normalizeToken(field.key);
        const fieldLabelNorm = field.label ? normalizeToken(field.label) : '';
        let filledRows = 0;
        let missingRows = 0;
        const sampleMissingRows: number[] = [];
        const sampleFilledValues: string[] = [];

        params.rows.forEach((row, index) => {
            const rowRecord = asRecord(row);
            if (!rowRecord) return;

            const rowMap = new Map<string, unknown>();
            Object.entries(rowRecord).forEach(([key, value]) => {
                rowMap.set(normalizeToken(key), value);
            });

            const rawValue =
                rowRecord[field.key] ??
                rowMap.get(fieldKeyNorm) ??
                (fieldLabelNorm ? rowMap.get(fieldLabelNorm) : undefined);

            if (isMissingCellValue(rawValue)) {
                missingRows += 1;
                if (sampleMissingRows.length < 8) {
                    sampleMissingRows.push(getRowSourceIndex(rowRecord, index));
                }
                return;
            }

            filledRows += 1;
            const unwrapped = unwrapCellValue(rawValue);
            const textValue = String(unwrapped);
            if (!sampleFilledValues.includes(textValue) && sampleFilledValues.length < 4) {
                sampleFilledValues.push(textValue);
            }
        });

        return {
            fieldKey: field.key,
            totalRows: filledRows + missingRows,
            filledRows,
            missingRows,
            sampleMissingRows,
            sampleFilledValues,
        };
    });
}

export function isLikelyValidityDateContextLine(content: string): boolean {
    const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!normalized) return false;

    const hasDateLikeValue =
        /\d{1,4}\s*[./-]\s*\d{1,2}/.test(normalized) ||
        /\d{1,2}\s*[./-]\s*\d{1,2}/.test(normalized);
    if (!hasDateLikeValue) return false;

    return (
        normalized.includes('validity') ||
        normalized.includes('valid from') ||
        normalized.includes('valid to') ||
        normalized.includes('effective') ||
        normalized.includes('start_date') ||
        normalized.includes('start date') ||
        normalized.includes('end_date') ||
        normalized.includes('end date') ||
        normalized.includes('유효') ||
        normalized.includes('시작일') ||
        normalized.includes('종료일') ||
        normalized.includes('적용기간')
    );
}

function getParagraphContextLine(paragraph: unknown): ParsedContextLine | null {
    const paragraphObj = asRecord(paragraph);
    const text = pickString(paragraphObj, ['content', 'text']);
    if (!text || isLikelyTableRowText(text)) return null;

    const regions = asArray(paragraphObj?.boundingRegions ?? paragraphObj?.bounding_regions);
    const firstRegion = asRecord(regions[0]);
    const pageNumber =
        pickNumber(firstRegion, ['pageNumber', 'page_number']) ??
        pickNumber(paragraphObj, ['pageNumber', 'page_number']);
    const bbox =
        polygonToBBox(pickNumberArray(firstRegion, ['polygon', 'boundingPolygon', 'bbox', 'boundingBox'])) ??
        polygonToBBox(pickNumberArray(paragraphObj, ['polygon', 'boundingPolygon', 'bbox', 'boundingBox']));

    return { text, pageNumber, bbox, sourceRank: 0 };
}

function isAboveScopedTable(line: ParsedContextLine, pageBBoxes: TableBatchPageBBox[]): boolean {
    if (line.pageNumber === undefined || !line.bbox || line.bbox.length < 4) return false;
    return pageBBoxes.some((pageBBox) => {
        if (pageBBox.pageNumber !== line.pageNumber || pageBBox.bbox.length < 4) return false;
        const paragraphBottom = line.bbox?.[3] ?? Number.POSITIVE_INFINITY;
        const tableTop = pageBBox.bbox[1];
        return paragraphBottom <= tableTop + 0.02;
    });
}

function buildLeadingChunkLines(
    chunkContent: string,
    maxLines: number,
    options?: { includeStructuredHeaders?: boolean; includeValidityLines?: boolean }
): ParsedContextLine[] {
    return chunkContent
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) =>
            line.length > 0 &&
            !line.startsWith('--- Page ') &&
            (options?.includeValidityLines ? true : !isLikelyValidityDateContextLine(line)) &&
            (
                !isLikelyTableRowText(line) ||
                (options?.includeStructuredHeaders === true && isLikelyStructuredHeaderLine(line))
            )
        )
        .slice(0, maxLines)
        .map((text) => ({ text, sourceRank: 1 }));
}

function buildChunkContentDateContext(
    chunkContent: string | undefined,
    pageBBoxes: TableBatchPageBBox[],
): ApplicableDateContext | null {
    if (!chunkContent) return null;

    const earliestPageBBox = getEarliestPageBBox(pageBBoxes);
    if (!earliestPageBBox) return null;

    const line = buildLeadingChunkLines(chunkContent, 12, {
        includeValidityLines: true,
    }).find((candidate) => isLikelyValidityDateContextLine(candidate.text));

    if (!line) return null;

    const tableTop = earliestPageBBox.bbox[1];
    const syntheticTop = Math.max(0, tableTop - 0.04);
    const syntheticBottom = Math.max(0, tableTop - 0.02);

    return {
        text: line.text,
        pageNumber: earliestPageBBox.pageNumber,
        y: syntheticTop,
        bbox: [
            earliestPageBBox.bbox[0],
            syntheticTop,
            earliestPageBBox.bbox[2],
            syntheticBottom,
        ],
        source: 'above_table',
    };
}

function mergeBBoxes(boxes: number[][]): number[] | undefined {
    const validBoxes = boxes.filter((box) => box.length >= 4);
    if (validBoxes.length === 0) return undefined;

    return validBoxes.reduce(
        (acc, box) => [
            Math.min(acc[0], box[0]),
            Math.min(acc[1], box[1]),
            Math.max(acc[2], box[2]),
            Math.max(acc[3], box[3]),
        ],
        [...validBoxes[0]]
    );
}

function buildInsideTableDateContext(tableContext?: string): ApplicableDateContext | null {
    if (!tableContext || !tableContext.trim()) return null;

    try {
        const parsed = JSON.parse(tableContext);
        const slices = Array.isArray(parsed) ? parsed : [];
        const rowGroups = new Map<string, {
            pageNumber: number;
            rowIndex: number;
            cells: Array<{ columnIndex: number; content: string; bbox?: number[] }>;
        }>();

        slices.forEach((slice) => {
            const sliceObj = asRecord(slice);
            const cells = asArray(sliceObj?.cells);
            cells.forEach((cell) => {
                const cellObj = asRecord(cell);
                if (!cellObj) return;

                const content = pickString(cellObj, ['content', 'text']);
                if (!content) return;

                const pageNumber =
                    pickNumber(cellObj, ['page_number', 'pageNumber']) ??
                    pickNumber(sliceObj, ['page_number', 'pageNumber', 'page_start']) ??
                    1;
                const rowIndex = pickNumber(cellObj, ['row_index', 'rowIndex']) ?? 0;
                const columnIndex = pickNumber(cellObj, ['column_index', 'columnIndex']) ?? 0;
                const bbox = pickNumberArray(cellObj, ['bbox']);
                const key = `${pageNumber}:${rowIndex}`;
                const existing = rowGroups.get(key);
                const nextCell = { columnIndex, content, bbox };

                if (existing) {
                    existing.cells.push(nextCell);
                    return;
                }

                rowGroups.set(key, {
                    pageNumber,
                    rowIndex,
                    cells: [nextCell],
                });
            });
        });

        const candidates: ApplicableDateContext[] = [];
        for (const rowGroup of rowGroups.values()) {
            const orderedCells = rowGroup.cells.sort((left, right) => left.columnIndex - right.columnIndex);
            const rowText = orderedCells
                .map((cell) => cell.content.trim())
                .filter(Boolean)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();

            if (!isLikelyValidityDateContextLine(rowText)) continue;

            const bbox = mergeBBoxes(orderedCells.map((cell) => cell.bbox).filter((box): box is number[] => Array.isArray(box)));
            candidates.push({
                text: rowText,
                pageNumber: rowGroup.pageNumber,
                y: bbox?.[1] ?? rowGroup.rowIndex,
                bbox: bbox || [0, rowGroup.rowIndex, 0, rowGroup.rowIndex],
                source: 'inside_table',
            });
        }

        if (candidates.length === 0) return null;
        candidates.sort((left, right) => {
            if (left.pageNumber !== right.pageNumber) return left.pageNumber - right.pageNumber;
            return left.y - right.y;
        });

        return candidates[0];
    } catch {
        return null;
    }
}

function getEarliestPageBBox(pageBBoxes: TableBatchPageBBox[]): TableBatchPageBBox | null {
    const validBBoxes = pageBBoxes.filter((pageBBox) => pageBBox.bbox.length >= 4);
    if (validBBoxes.length === 0) return null;

    return [...validBBoxes].sort((left, right) => {
        if (left.pageNumber !== right.pageNumber) return left.pageNumber - right.pageNumber;
        return left.bbox[1] - right.bbox[1];
    })[0];
}

export function carryForwardApplicableDateContext(params: CarryForwardApplicableDateContextParams): ApplicableDateContext | null {
    if (params.current) return params.current;
    if (!params.previous) return null;

    const earliestPageBBox = getEarliestPageBBox(params.pageBBoxes);
    if (!earliestPageBBox) return null;

    if (params.previous.pageNumber > earliestPageBBox.pageNumber) return null;

    if (params.previous.pageNumber === earliestPageBBox.pageNumber) {
        const previousBottom = params.previous.bbox.length >= 4 ? params.previous.bbox[3] : params.previous.y;
        const tableTop = earliestPageBBox.bbox[1];
        if (previousBottom > tableTop + 0.02) return null;
    }

    return {
        ...params.previous,
        source: 'previous_table',
    };
}

export function buildApplicableDateContextForTableBatch(params: BuildApplicableDateContextParams): ApplicableDateContext | null {
    const candidates: Array<ApplicableDateContext & { distance: number }> = [];

    for (const paragraph of params.paragraphs) {
        const line = getParagraphContextLine(paragraph);
        if (!line || !isLikelyValidityDateContextLine(line.text)) continue;
        if (line.pageNumber === undefined || !line.bbox || line.bbox.length < 4) continue;

        for (const pageBBox of params.pageBBoxes) {
            if (pageBBox.pageNumber !== line.pageNumber || pageBBox.bbox.length < 4) continue;

            const lineBottom = line.bbox[3];
            const tableTop = pageBBox.bbox[1];
            if (lineBottom > tableTop + 0.02) continue;

            candidates.push({
                text: line.text,
                pageNumber: line.pageNumber,
                y: line.bbox[1],
                bbox: line.bbox,
                source: 'above_table',
                distance: Math.max(0, tableTop - lineBottom),
            });
        }
    }

    if (candidates.length === 0) {
        const insideTable = buildInsideTableDateContext(params.tableContext);
        if (insideTable) return insideTable;
        return buildChunkContentDateContext(params.chunkContent, params.pageBBoxes);
    }

    candidates.sort((left, right) => {
        if (left.distance !== right.distance) return left.distance - right.distance;
        if (left.pageNumber !== right.pageNumber) return left.pageNumber - right.pageNumber;
        return right.y - left.y;
    });

    const best = candidates[0];
    return {
        text: best.text,
        pageNumber: best.pageNumber,
        y: best.y,
        bbox: best.bbox,
        source: best.source,
    };
}

export function buildDocumentContextForTableBatch(params: BuildTableBatchDocumentContextParams): string {
    const maxChars = params.maxChars ?? DEFAULT_MAX_CHARS;
    const maxLines = params.maxLines ?? DEFAULT_MAX_LINES;
    if (maxChars <= 0 || maxLines <= 0) return '';

    const paragraphLines = params.paragraphs
        .map((paragraph) => getParagraphContextLine(paragraph))
        .filter((line): line is ParsedContextLine => line !== null)
        .filter((line) => !isLikelyValidityDateContextLine(line.text))
        .filter((line) => isAboveScopedTable(line, params.pageBBoxes))
        .sort((left, right) => {
            if ((left.pageNumber ?? 0) !== (right.pageNumber ?? 0)) {
                return (left.pageNumber ?? 0) - (right.pageNumber ?? 0);
            }
            const leftY = left.bbox?.[1] ?? Number.POSITIVE_INFINITY;
            const rightY = right.bbox?.[1] ?? Number.POSITIVE_INFINITY;
            if (leftY !== rightY) return leftY - rightY;
            const leftX = left.bbox?.[0] ?? Number.POSITIVE_INFINITY;
            const rightX = right.bbox?.[0] ?? Number.POSITIVE_INFINITY;
            return leftX - rightX;
        });

    const leadingChunkLines = buildLeadingChunkLines(params.chunkContent, Math.max(4, Math.floor(maxLines / 2)));
    const fallbackStructuredChunkLines = buildLeadingChunkLines(
        params.chunkContent,
        Math.max(4, Math.floor(maxLines / 2)),
        { includeStructuredHeaders: true }
    );
    const selected: ParsedContextLine[] = [];
    const seen = new Set<string>();

    for (const line of [...paragraphLines, ...leadingChunkLines]) {
        const key = normalizeForDedupe(line.text);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        selected.push(line);
        if (selected.length >= maxLines) break;
    }

    if (selected.length < Math.min(2, maxLines)) {
        for (const line of fallbackStructuredChunkLines) {
            const key = normalizeForDedupe(line.text);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            selected.push(line);
            if (selected.length >= maxLines) break;
        }
    }

    const outputLines: string[] = [];
    for (const line of selected) {
        const prefix = line.pageNumber !== undefined && line.bbox
            ? `[p${line.pageNumber} ${line.bbox.join(',')}] `
            : '';
        const nextLine = `${prefix}${line.text}`;
        const nextValue = [...outputLines, nextLine].join('\n');
        if (nextValue.length > maxChars) break;
        outputLines.push(nextLine);
    }

    return outputLines.join('\n');
}

export function composeTableBatchContext(params: {
    chunkContent: string;
    tableContext: string;
    batchLabel: string;
    dateContextText?: string;
    documentContext?: string;
}): string {
    if (params.tableContext.trim()) {
        return `${params.chunkContent}\n\n--- TABLES (Normalized Coordinates | batch ${params.batchLabel}) ---\n${params.tableContext}`;
    }

    return params.chunkContent;
}
