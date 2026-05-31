import 'server-only';

import { PipelineOcrData, PipelineOcrPage, PipelineOcrTable, PipelineOcrParagraph } from '@/scheme/pipeline';

export interface RefMapItem {
    text: string;
    bbox?: number[] | null;
    page_number?: number;
    file_id?: string;
    type?: string;
}

export class LayoutParser {
    public ocrList: PipelineOcrData[];
    public fileIds: string[];

    public fullContent: string;
    public globalPages: PipelineOcrPage[];
    public pageOffsetMap: Record<number, { fileId: string, localPageNumber: number }>;
    public contentOffsets: Array<{ start: number, end: number, fileId: string }>;

    public allTables: PipelineOcrTable[];
    public allParagraphs: PipelineOcrParagraph[];

    public refMap: Record<string, RefMapItem>;
    // Uint8Array는 bytearray와 유사하게 동작
    public claimedMask: Uint8Array;

    // 삽입 정보: { offset, priority, tagDisp }
    public insertions: Array<{ offset: number, priority: number, tagDisp: string }>;

    public counters: { C: number, W: number, P: number };
    public tableReplacements: Array<{ start: number, end: number, markdown: string }>;

    constructor(inputs: PipelineOcrData | PipelineOcrData[], fileIds?: string[]) {
        if (!inputs) throw new Error("Input must be valid OCR result or array of results");

        this.ocrList = Array.isArray(inputs) ? inputs : [inputs];

        if (fileIds) {
            if (fileIds.length !== this.ocrList.length) {
                throw new Error(`fileIds count (${fileIds.length}) must match inputs (${this.ocrList.length})`);
            }
            this.fileIds = fileIds;
        } else {
            this.fileIds = this.ocrList.map((_, i) => `file_${i}`);
        }

        this.fullContent = "";
        this.globalPages = [];
        this.pageOffsetMap = {};
        this.contentOffsets = [];
        this.allTables = [];
        this.allParagraphs = [];

        let currentGlobalPage = 1;
        let currentCharOffset = 0;

        for (let idx = 0; idx < this.ocrList.length; idx++) {
            const ocrData = this.ocrList[idx];
            const fid = this.fileIds[idx];

            const fileContent = ocrData.content || "";
            if (idx > 0) {
                const separator = `\n=== File: ${fid} ===\n`;
                this.fullContent += separator;
                currentCharOffset += separator.length;
            }

            const fileStart = currentCharOffset;
            this.fullContent += fileContent;
            const fileEnd = currentCharOffset + fileContent.length;
            this.contentOffsets.push({ start: fileStart, end: fileEnd, fileId: fid });
            currentCharOffset = fileEnd;

            const localPages = ocrData.pages || [];
            for (const p of localPages) {
                this.pageOffsetMap[currentGlobalPage] = {
                    fileId: fid,
                    localPageNumber: p.pageNumber || p.page_number || 0
                };
                const pCopy = {
                    ...p,
                    global_page_number: currentGlobalPage,
                    file_id: fid,
                    file_content_offset: fileStart
                } as PipelineOcrPage;
                this.globalPages.push(pCopy);
                currentGlobalPage++;
            }

            for (const t of (ocrData.tables || [])) {
                this.allTables.push({ ...t, file_id: fid, file_content_offset: fileStart });
            }

            for (const p of (ocrData.paragraphs || [])) {
                this.allParagraphs.push({ ...p, file_id: fid, file_content_offset: fileStart });
            }
        }

        this.refMap = {};
        this.claimedMask = new Uint8Array(this.fullContent.length);
        this.insertions = [];
        this.counters = { C: 1, W: 1, P: 1 };
        this.tableReplacements = [];
    }

    public parse(_focusPages?: number[]): { taggedText: string, refMap: Record<string, RefMapItem> } {
        try {
            this._passTables();
            this._passEntities();
            this._passParagraphs();

            const taggedText = this._reconstructText();
            return { taggedText, refMap: this.refMap };
        } catch (e) {
            console.warn("[LayoutParser] 파싱(Parse) 실패, 원본 콘텐츠를 반환합니다: ", e);
            return { taggedText: this.fullContent || "", refMap: {} };
        }
    }

    private _markClaimed(offset: number, length: number) {
        let end = offset + length;
        end = Math.min(end, this.fullContent.length);
        for (let i = offset; i < end; i++) {
            this.claimedMask[i] = 1;
        }
    }

    private _isRegionClaimed(offset: number, length: number): boolean {
        const end = Math.min(offset + length, this.claimedMask.length);
        for (let i = offset; i < end; i++) {
            if (this.claimedMask[i]) return true;
        }
        return false;
    }

    private _getClaimingRef(offset: number): string | null {
        // 이 오프셋을 점유하고 있는 기존 태그 ID를 반환
        for (const [id, ref] of Object.entries(this.refMap)) {
            if (ref.type === 'C' || ref.type === 'W' || ref.type === 'P') {
                // Approximate check: refMap에는 offset 정보가 없으므로 insertions에서 직접 찾아야 함
                // 하지만 LayoutParser는 insertions에 테이블 셀을 넣지 않음.
                // 대신, 테이블 셀은 _markClaimed로 영역만 표시함.
                // 중첩 테이블 처리를 위해 이 로직을 개선 필요.
            }
        }
        return null; // Fallback
    }

    private _flattenTable(table: PipelineOcrTable): string {
        const grid: Record<string, string> = {};
        let maxRow = -1;
        let maxCol = -1;
        const cells = table.cells || [];
        for (const cell of cells) {
            const r = cell.rowIndex ?? cell.row_index ?? 0;
            const c = cell.columnIndex ?? cell.column_index ?? 0;
            const rs = cell.rowSpan ?? cell.row_span ?? 1;
            const cs = cell.columnSpan ?? cell.column_span ?? 1;
            const content = (cell.content || "").replace(/\n/g, " ").trim();
            maxRow = Math.max(maxRow, r + rs - 1);
            maxCol = Math.max(maxCol, c + cs - 1);
            for (let i = r; i < r + rs; i++) {
                for (let j = c; j < c + cs; j++) {
                    grid[`${i},${j}`] = content;
                }
            }
        }
        if (maxRow < 0) return "";
        const lines = [];
        for (let i = 0; i <= maxRow; i++) {
            const row = [];
            for (let j = 0; j <= maxCol; j++) {
                row.push(grid[`${i},${j}`] || "");
            }
            lines.push(`[${row.join(" | ")}]`);
        }
        return lines.join("\n");
    }

    private _getHexId(prefix: 'C' | 'W' | 'P'): string {
        const val = this.counters[prefix];
        this.counters[prefix]++;
        return `${prefix}${val.toString(16).toUpperCase()}`;
    }

    private _escapeMarkdownCell(text: string): string {
        return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
    }

    private _normalizeHeaderText(text: string): string {
        return text
            .replace(/\^C[0-9A-Fa-f]+/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private _buildMergedHeaderCells(
        grid: Record<string, { content: string, tag_id: string | null }>,
        headerRows: number[],
        maxCol: number
    ): string[] {
        const headers: string[] = [];

        for (let c = 0; c <= maxCol; c++) {
            const parts: string[] = [];
            const seen = new Set<string>();

            for (const r of headerRows) {
                const key = `${r},${c}`;
                const cellInfo = grid[key];
                if (!cellInfo) continue;

                const normalized = this._normalizeHeaderText(cellInfo.content);
                if (!normalized) continue;
                const dupKey = normalized.toLowerCase();
                if (seen.has(dupKey)) continue;

                seen.add(dupKey);
                parts.push(normalized);
            }

            headers.push(parts.length > 0 ? parts.join('_') : `Column_${c + 1}`);
        }

        return headers;
    }

    private _toMarkdownRow(cells: string[]): string {
        const cellsStr = cells.map(cell => ` ${this._escapeMarkdownCell(cell)} `);
        return "|" + cellsStr.join("|") + "|";
    }

    private _findGlobalPage(fileId: string, localPage: number): number {
        for (const p of this.globalPages) {
            if (p.file_id === fileId && (p.pageNumber === localPage || p.page_number === localPage)) {
                return p.global_page_number;
            }
        }
        return 1;
    }

    private _normalizeBbox(polygon: any, globalPage: number, fileId: string): number[] | undefined {
        if (!polygon || (Array.isArray(polygon) && polygon.length < 4)) return undefined;
        let coords: number[] = [];

        // {x, y}[] 또는 [{x, y}, ...] 형식 처리
        if (Array.isArray(polygon) && typeof polygon[0] === 'object' && polygon[0] !== null) {
            coords = (polygon as any[]).map(p => [p.x, p.y]).flat();
        } else if (Array.isArray(polygon)) {
            coords = polygon;
        } else {
            return undefined;
        }

        const page = this.globalPages.find(p => p.global_page_number === globalPage && p.file_id === fileId);
        const width = page?.width || 8.27;   // A4 가로 (인치)
        const height = page?.height || 11.69; // A4 세로 (인치)

        // 모든 좌표를 0-100 퍼센트로 정규화 및 소수점 4자리 고정
        return coords.map((val, i) => {
            const denom = (i % 2 === 0) ? width : height;
            const normalized = (val / denom) * 100;
            return isNaN(normalized) ? 0 : Number(normalized.toFixed(4));
        });
    }

    private _registerTag(text: string, bbox: any, globalPage: number, fileId: string, typeCode: 'C' | 'W' | 'P', offset: number, length: number, priority: number = 10) {
        const tagId = this._getHexId(typeCode);
        const tagDisp = `^${tagId}`;

        const normalizedBbox = this._normalizeBbox(bbox, globalPage, fileId);

        this.refMap[tagId] = {
            text: text,
            bbox: normalizedBbox,
            page_number: globalPage,
            file_id: fileId,
            type: typeCode
        };

        const insertPos = offset + length;
        this.insertions.push({ offset: insertPos, priority, tagDisp });
        this._markClaimed(offset, length);
        return tagDisp;
    }

    private _passTables() {
        const fileCursors: Record<string, number> = {};
        for (const fid of this.fileIds) fileCursors[fid] = 0;
        // 헤더 없는 연속 페이지 표를 위해 최근 헤더를 컬럼 수 기준으로 기억한다.
        const lastHeaderByColCount = new Map<number, string>();

        for (const table of this.allTables) {
            const fid = table.file_id;
            const offsetShift = table.file_content_offset;

            // 중첩 테이블 감지: 테이블의 시작점 근처가 이미 점유되어 있다면 중첩 테이블로 간주하고 평탄화하여 삽입
            const firstCell = table.cells?.[0];
            const firstSpan = firstCell?.spans?.[0];
            if (firstSpan) {
                const globalBase = offsetShift + firstSpan.offset;
                if (this._isRegionClaimed(globalBase, 1)) {
                    const flattened = this._flattenTable(table);
                    // 중첩 테이블은 별도 Markdown으로 뽑지 않고 텍스트로만 남김 (부모 셀 텍스트에 포함되도록 유도)
                    // _markClaimed를 하지 않으므로 Paragraph 파싱 등에서 이 텍스트가 추출될 것임.
                    // 또는 부모 셀의 content가 이미 이 텍스트를 포함하고 있을 확률이 높음.
                    continue; 
                }
            }

            let maxRow = -1;
            let maxCol = -1;
            const headerRowSet = new Set<number>(); // columnHeader로 식별된 헤더 행 집합
            let tableSpanStart: number | null = null;
            let tableSpanEnd: number | null = null;
            const grid: Record<string, { content: string, tag_id: string | null }> = {};

            const cells = table.cells || [];
            for (const cell of cells) {
                const content = (cell.content || "").trim();
                const rowIdx = cell.rowIndex ?? cell.row_index ?? 0;
                const colIdx = cell.columnIndex ?? cell.column_index ?? 0;
                const rowSpan = cell.rowSpan ?? cell.row_span ?? 1;
                const colSpan = cell.columnSpan ?? cell.column_span ?? 1;

                maxRow = Math.max(maxRow, rowIdx + rowSpan - 1);
                maxCol = Math.max(maxCol, colIdx + colSpan - 1);
                
                // 헤더 여부 확인 (kind: "columnHeader")
                const cellKind = (cell as { kind?: string }).kind;
                if (cellKind === "columnHeader") {
                    for (let r = rowIdx; r < rowIdx + rowSpan; r++) {
                        headerRowSet.add(r);
                    }
                }

                const regions = cell.boundingRegions || cell.bounding_regions || [];
                const spans = cell.spans || [];

                let bbox = null;
                let globalPage = this._findGlobalPage(fid, 1);

                if (regions.length > 0) {
                    bbox = regions[0].polygon;
                    const localPage = regions[0].pageNumber || regions[0].page_number || 1;
                    globalPage = this._findGlobalPage(fid, localPage);
                }

                let localOffset = -1;
                let localLength = 0;

                if (spans.length === 0) {
                    const currentCursor = fileCursors[fid] || 0;
                    const searchStart = offsetShift + currentCursor;
                    const searchEnd = this.contentOffsets.find(co => co.fileId === fid)?.end ?? this.fullContent.length;
                    
                    // 현재 파일 범위 내에서만 검색하도록 제한
                    const searchArea = this.fullContent.substring(searchStart, searchEnd);
                    const localFoundPos = content ? searchArea.indexOf(content) : -1;
                    const foundPos = localFoundPos !== -1 ? searchStart + localFoundPos : -1;

                    if (foundPos === -1 && !content) {
                        // 텍스트는 없으나 DocIntel에서 감지된 빈 셀 -> 가상 태그 생성 (컬럼 밀림 방지)
                        const tagId = this._getHexId('C');
                        const tagDisp = `^${tagId}`;
                        const normalizedBbox = this._normalizeBbox(bbox, globalPage, fid);
                        this.refMap[tagId] = { text: "", bbox: normalizedBbox, page_number: globalPage, file_id: fid, type: 'C' };

                        for (let r = rowIdx; r < rowIdx + rowSpan; r++) {
                            for (let c = colIdx; c < colIdx + colSpan; c++) {
                                const key = `${r},${c}`;
                                if (!grid[key]) grid[key] = { content: "", tag_id: tagDisp };
                            }
                        }
                        continue;
                    } else if (foundPos === -1) {
                        // 텍스트가 있으나 본문 검색 실패 -> 가상 태그 생성 (컬럼 밀림 방지)
                        const tagId = this._getHexId('C');
                        const tagDisp = `^${tagId}`;
                        const normalizedBbox = this._normalizeBbox(bbox, globalPage, fid);
                        this.refMap[tagId] = { text: content, bbox: normalizedBbox, page_number: globalPage, file_id: fid, type: 'C' };

                        for (let r = rowIdx; r < rowIdx + rowSpan; r++) {
                            for (let c = colIdx; c < colIdx + colSpan; c++) {
                                const key = `${r},${c}`;
                                if (!grid[key]) grid[key] = { content: content, tag_id: tagDisp };
                            }
                        }
                        continue;
                    }

                    localOffset = foundPos - offsetShift;
                    localLength = content.length;
                    fileCursors[fid] = localOffset + localLength;
                } else {
                    const primarySpan = spans[0];
                    localOffset = primarySpan.offset;
                    localLength = primarySpan.length;
                }

                const globalOffset = offsetShift + localOffset;

                if (tableSpanStart === null || globalOffset < tableSpanStart) {
                    tableSpanStart = globalOffset;
                }
                const cellEnd = globalOffset + localLength;
                if (tableSpanEnd === null || cellEnd > tableSpanEnd) {
                    tableSpanEnd = cellEnd;
                }

                const tagId = this._getHexId('C');
                const tagDisp = `^${tagId}`;

                const normalizedBbox = this._normalizeBbox(bbox, globalPage, fid);

                this.refMap[tagId] = {
                    text: content,
                    bbox: normalizedBbox,
                    page_number: globalPage,
                    file_id: fid,
                    type: 'C'
                };

                this._markClaimed(globalOffset, localLength);

                for (let r = rowIdx; r < rowIdx + rowSpan; r++) {
                    for (let c = colIdx; c < colIdx + colSpan; c++) {
                        const key = `${r},${c}`;
                        if (!grid[key]) {
                            grid[key] = { content: content, tag_id: tagDisp };
                        }
                    }
                }
            }

            if (maxRow < 0 || maxCol < 0) continue;

            const mdRows: string[] = [];
            for (let r = 0; r <= maxRow; r++) {
                const cellsStr = [];
                for (let c = 0; c <= maxCol; c++) {
                    const cellInfo = grid[`${r},${c}`] || { content: "", tag_id: null };
                    const cellText = this._escapeMarkdownCell(cellInfo.content);
                    const tag = cellInfo.tag_id;

                    if (tag && cellText) {
                        cellsStr.push(` ${tag} ${cellText} `);
                    } else if (tag) {
                        cellsStr.push(` ${tag} `);
                    } else {
                        cellsStr.push(` ${cellText} `);
                    }
                }
                mdRows.push("|" + cellsStr.join("|") + "|");
            }

            if (headerRowSet.size > 0) {
                // 다중 헤더를 컬럼 기준으로 병합하여 단일 헤더 행으로 만든다.
                const sortedHeaderRows = Array.from(headerRowSet).sort((a, b) => a - b);
                const mergedHeaderCells = this._buildMergedHeaderCells(grid, sortedHeaderRows, maxCol);
                const headerRow = this._toMarkdownRow(mergedHeaderCells);
                const headerEndRow = sortedHeaderRows[sortedHeaderRows.length - 1];
                const dataRows = mdRows.slice(headerEndRow + 1);
                const sep = "|" + Array(maxCol + 1).fill("---").join("|") + "|";
                mdRows.length = 0;
                mdRows.push(headerRow, sep, ...dataRows);
                lastHeaderByColCount.set(maxCol + 1, headerRow);
            } else {
                // 표 자체에 헤더가 없는 경우: 동일 컬럼 수의 직전 헤더를 재삽입
                const fallbackHeader = lastHeaderByColCount.get(maxCol + 1);
                if (fallbackHeader) {
                    const sep = "|" + Array(maxCol + 1).fill("---").join("|") + "|";
                    mdRows.unshift(sep);
                    mdRows.unshift(fallbackHeader);
                }
            }

            const markdownTable = "\n" + mdRows.join("\n") + "\n";

            if (tableSpanStart !== null && tableSpanEnd !== null) {
                this.tableReplacements.push({ start: tableSpanStart, end: tableSpanEnd, markdown: markdownTable });
            } else {
                const insertAt = offsetShift;
                this.tableReplacements.push({ start: insertAt, end: insertAt, markdown: markdownTable });
            }
        }
    }

    private _passEntities() {
        const pageCursors: Record<number, number> = {};

        for (const page of this.globalPages) {
            const globalPageNum = page.global_page_number;
            const fid = page.file_id;
            const offsetShift = page.file_content_offset;

            const words = page.words || [];
            if (!(globalPageNum in pageCursors)) {
                pageCursors[globalPageNum] = 0;
            }

            for (const word of words) {
                const content = word.content || "";
                if (!content || !this._isEntity(content)) continue;

                const span = word.span;
                let localOffset = span?.offset ?? -1;
                let length = span?.length ?? 0;

                if (localOffset === -1) {
                    const searchStart = offsetShift + pageCursors[globalPageNum];
                    const foundPos = this.fullContent.indexOf(content, searchStart);
                    if (foundPos === -1) continue;

                    localOffset = foundPos - offsetShift;
                    length = content.length;
                    pageCursors[globalPageNum] = localOffset + length;
                }

                const globalOffset = offsetShift + localOffset;

                if (this._isRegionClaimed(globalOffset, length)) {
                    pageCursors[globalPageNum] = Math.max(pageCursors[globalPageNum], localOffset + length);
                    continue;
                }

                this._registerTag(
                    content,
                    word.boundingBox || word.polygon,
                    globalPageNum,
                    fid,
                    "W",
                    globalOffset,
                    length,
                    1
                );
            }
        }
    }

    private _passParagraphs() {
        for (const para of this.allParagraphs) {
            const content = (para.content || "").trim();
            if (!content) continue;

            const fid = para.file_id;
            const offsetShift = para.file_content_offset;
            const spans = para.spans || [];

            let localOffset = -1;
            let localLength = 0;

            if (spans.length === 0) {
                const foundPos = this.fullContent.indexOf(content, offsetShift);
                if (foundPos === -1) continue;
                localOffset = foundPos - offsetShift;
                localLength = content.length;
            } else {
                const primarySpan = spans[0];
                localOffset = primarySpan.offset;
                localLength = primarySpan.length;
            }

            const globalOffset = offsetShift + localOffset;
            let currentGapStart = -1;
            const paraEnd = globalOffset + localLength;

            for (let i = globalOffset; i < Math.min(paraEnd, this.fullContent.length); i++) {
                const isClaimed = this.claimedMask[i] === 1;

                if (!isClaimed) {
                    if (currentGapStart === -1) currentGapStart = i;
                } else {
                    if (currentGapStart !== -1) {
                        this._registerGap(currentGapStart, i, para, fid);
                        currentGapStart = -1;
                    }
                }
            }

            if (currentGapStart !== -1) {
                this._registerGap(currentGapStart, paraEnd, para, fid);
            }
        }

        if (this.allParagraphs.length === 0) {
            this._passContentGaps();
        }
    }

    private _passContentGaps() {
        const contentLen = this.fullContent.length;
        if (contentLen === 0) return;

        const lines = this.fullContent.split("\n");
        let currentOffset = 0;

        for (const line of lines) {
            const lineLen = line.length;
            if (lineLen < 2 || !line.trim()) {
                currentOffset += lineLen + 1;
                continue;
            }

            const lineStart = currentOffset;
            const lineEnd = currentOffset + lineLen;
            let gapStart = -1;

            for (let i = lineStart; i < Math.min(lineEnd, contentLen); i++) {
                if (this.claimedMask[i] === 0) {
                    if (gapStart === -1) gapStart = i;
                } else {
                    if (gapStart !== -1) {
                        this._registerContentGap(gapStart, i);
                        gapStart = -1;
                    }
                }
            }

            if (gapStart !== -1) {
                this._registerContentGap(gapStart, lineEnd);
            }

            currentOffset += lineLen + 1;
        }
    }

    private _registerContentGap(start: number, end: number) {
        const length = end - start;
        if (length < 3) return;

        const textSegment = this.fullContent.substring(start, end).trim();
        if (!textSegment || textSegment.length < 2) return;

        let fileId = this.fileIds.length > 0 ? this.fileIds[0] : "file_0";
        let globalPage = 1;

        for (const { start: fStart, end: fEnd, fileId: fid } of this.contentOffsets) {
            if (fStart <= start && start < fEnd) {
                fileId = fid;
                globalPage = this._findGlobalPage(fid, 1);
                break;
            }
        }

        this._registerTag(textSegment, null, globalPage, fileId, "P", start, length, 2);
    }

    private _registerGap(start: number, end: number, parentPara: PipelineOcrParagraph, fileId: string) {
        const length = end - start;
        if (length < 3) return;

        const textSegment = this.fullContent.substring(start, end).trim();
        if (!textSegment || textSegment.length < 2) return;

        const regions = parentPara.boundingRegions || parentPara.bounding_regions || [];
        let bbox = null;
        let globalPage = this._findGlobalPage(fileId, 1);

        if (regions.length > 0) {
            bbox = regions[0].polygon;
            const localPage = regions[0].pageNumber || regions[0].page_number || 1;
            globalPage = this._findGlobalPage(fileId, localPage);
        }

        this._registerTag(textSegment, bbox, globalPage, fileId, "P", start, length, 2);
    }

    private _reconstructText(): string {
        const tableRepls = [...this.tableReplacements].sort((a, b) => a.start - b.start);
        const tableZones = tableRepls.map(r => ({ start: r.start, end: r.end }));

        const inTableZone = (pos: number) => {
            return tableZones.some(z => z.start <= pos && pos <= z.end);
        };

        const filteredInsertions = this.insertions.filter(ins => !inTableZone(ins.offset));
        filteredInsertions.sort((a, b) => a.offset - b.offset || a.priority - b.priority);

        type TableEvent = { type: 'table', pos: number, data: { start: number, end: number, markdown: string } };
        type TagEvent = { type: 'tag', pos: number, data: { offset: number, priority: number, tagDisp: string } };
        const events: Array<TableEvent | TagEvent> = [];

        for (const repl of tableRepls) {
            events.push({ pos: repl.start, type: 'table', data: repl });
        }
        for (const ins of filteredInsertions) {
            events.push({ pos: ins.offset, type: 'tag', data: ins });
        }

        events.sort((a, b) => a.pos - b.pos || (a.type === 'table' ? 0 : 1));

        const chunks: string[] = [];
        let lastPos = 0;

        for (const event of events) {
            if (event.type === 'table') {
                const { start, end, markdown } = event.data;
                if (start < lastPos) continue;

                chunks.push(this.fullContent.substring(lastPos, start));
                chunks.push(markdown);
                lastPos = end;
            } else {
                const { offset, tagDisp } = event.data;
                if (offset < lastPos) continue;

                chunks.push(this.fullContent.substring(lastPos, offset));
                chunks.push(` ${tagDisp}`);
                lastPos = offset;
            }
        }

        chunks.push(this.fullContent.substring(lastPos));
        return chunks.join("");
    }

    private _isEntity(text: string): boolean {
        if (/\d/.test(text)) return true;
        if (text === text.toUpperCase() && text.length > 2) return true;
        if (/[€£₩$]/.test(text)) return true;
        if (text.length >= 2 && /[가-힣]+/.test(text)) return true;
        return false;
    }
}
