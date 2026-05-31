export type HeaderSource = 'direct' | 'carried' | 'none';

const MAX_CONTINUATION_LEADING_COLUMN_DEFICIT = 2;

export function getContinuationLeadingColumnOffset(params: {
    previousColumnCount: number | null;
    currentColumnCount: number;
    currentHasDirectHeader: boolean;
}): number {
    if (params.previousColumnCount === null) return 0;
    if (params.currentHasDirectHeader) return 0;

    const deficit = params.previousColumnCount - params.currentColumnCount;
    if (deficit <= 0) return 0;
    if (deficit > MAX_CONTINUATION_LEADING_COLUMN_DEFICIT) return 0;
    return deficit;
}

export function shouldGroupAsContinuationTable(params: {
    previousTablePage: number | null;
    previousHasDirectHeader: boolean;
    previousColumnCount: number | null;
    currentTablePage: number;
    currentHasDirectHeader: boolean;
    currentColumnCount: number;
    currentHeaderMatchesPrevious?: boolean;
}): boolean {
    if (params.previousTablePage === null || params.previousColumnCount === null) return false;
    if (!params.previousHasDirectHeader) return false;
    if (params.currentTablePage !== params.previousTablePage + 1) return false;
    if (!params.currentHasDirectHeader) {
        if (params.currentColumnCount === params.previousColumnCount) return true;
        return getContinuationLeadingColumnOffset({
            previousColumnCount: params.previousColumnCount,
            currentColumnCount: params.currentColumnCount,
            currentHasDirectHeader: params.currentHasDirectHeader,
        }) > 0;
    }
    if (params.currentColumnCount !== params.previousColumnCount) return false;
    return params.currentHeaderMatchesPrevious === true;
}

export function shouldCarryForwardHeader(params: {
    currentTablePage: number;
    currentTableIndex: number;
    currentHasDirectHeader: boolean;
    columnCount: number;
    previousHeaderTablePage: number | null;
    previousHeaderTableIndex: number | null;
    previousHeaderColumnCount: number | null;
}): boolean {
    if (params.currentHasDirectHeader) return false;
    if (params.previousHeaderTablePage === null || params.previousHeaderTableIndex === null || params.previousHeaderColumnCount === null) {
        return false;
    }
    if (params.columnCount !== params.previousHeaderColumnCount) return false;
    if (params.currentTablePage <= params.previousHeaderTablePage) return false;
    return params.currentTableIndex === params.previousHeaderTableIndex + 1;
}

export function shouldUseEnhancedTableContext(params: {
    headerSource: HeaderSource;
    pages: number[];
    hasDocumentContext?: boolean;
    hasDateContext?: boolean;
}): boolean {
    if (params.pages.length > 1) return true;
    if (params.headerSource !== 'carried') return false;
    return params.hasDocumentContext === true || params.hasDateContext === true;
}
