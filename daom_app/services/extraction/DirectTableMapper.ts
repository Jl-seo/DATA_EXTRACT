import 'server-only';
import OpenAI from 'openai';
import { OpenAIService } from '../OpenAIService';
import { WorkOrder, WorkOrderField } from '@/scheme/pipeline';
import { ExtractionModel, FieldDefinition } from '@/scheme/extractionModel';

interface ParsedCell {
    // OCR 셀 텍스트(태그 제거 후). 병합 셀 등에서 null 가능.
    value: string | null;
    // tagged text의 셀 원본 참조(^Cxxxx). 후단 trace 용도.
    ref: string | null;
}

interface ParsedTable {
    // 물리 표를 markdown 형태로 직렬화한 원문
    mdTable: string;
    // 표 직전 문맥(상수/섹션 정보 추출용)
    preamble: string;
}

interface TableSchema {
    key: string;
    columns: Record<string, {
        instruction?: string;
        rules?: string[];
        label?: string;
        is_required?: boolean;
        type?: string;
    }>;
}

interface TableMappingResult {
    // 현재 표를 어떤 table field로 보낼지 결정(null이면 skip)
    assigned_schema_key: string | null;
    // OCR 헤더 인덱스 -> 타깃 sub field key 매핑
    column_mapping?: Record<string, string>;
    // 헤더에 없지만 문맥에서 얻은 상수값(예: POL, 유효기간)
    constants?: Record<string, string>;
}

type TableRow = Record<string, { value: string | null; ref: string | null; confidence: number }>;

// markdown 한 줄을 셀 배열로 파싱한다.
// 주의: 이스케이프된 \| 는 셀 구분자로 처리하지 않는다.
function parseMarkdownRow(line: string): string[] {
    const trimmed = line.trim();
    const body = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
    const withoutTail = body.endsWith('|') ? body.slice(0, -1) : body;

    const cells: string[] = [];
    let current = '';
    let escaped = false;

    for (const ch of withoutTail) {
        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (ch === '|') {
            cells.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    cells.push(current.trim());
    return cells;
}

// work_order.columns와 모델 sub_fields 메타를 결합해
// 매퍼 평가/검증에 필요한 컬럼 스키마를 만든다.
function toTableSchema(field: WorkOrderField, modelField?: FieldDefinition): TableSchema {
    const rawColumns = field.columns && typeof field.columns === 'object' ? field.columns : {};
    const columns: Record<string, {
        instruction?: string;
        rules?: string[];
        label?: string;
        is_required?: boolean;
        type?: string;
    }> = {};

    const modelSubFieldMap = new Map<string, FieldDefinition>();
    for (const sf of modelField?.sub_fields || []) {
        modelSubFieldMap.set(sf.key, sf);
    }

    for (const [key, value] of Object.entries(rawColumns)) {
        const modelSub = modelSubFieldMap.get(key);
        const mergedRules: string[] = [];

        if (value && typeof value === 'object') {
            const valueObj = value as { instruction?: string; rules?: unknown };
            if (Array.isArray(valueObj.rules)) {
                for (const r of valueObj.rules) {
                    if (typeof r === 'string' && r.trim()) mergedRules.push(r.trim());
                }
            }
            if (typeof modelSub?.rules === 'string' && modelSub.rules.trim()) {
                mergedRules.push(modelSub.rules.trim());
            }
            columns[key] = {
                instruction: valueObj.instruction || modelSub?.description || undefined,
                rules: mergedRules,
                label: modelSub?.label,
                is_required: modelSub?.is_required || false,
                type: modelSub?.type || 'text',
            };
        } else {
            if (typeof modelSub?.rules === 'string' && modelSub.rules.trim()) {
                mergedRules.push(modelSub.rules.trim());
            }
            columns[key] = {
                instruction: modelSub?.description || undefined,
                rules: mergedRules,
                label: modelSub?.label,
                is_required: modelSub?.is_required || false,
                type: modelSub?.type || 'text',
            };
        }
    }
    return { key: field.key, columns };
}

export class DirectTableMapper {
    private openaiClient: OpenAIService;

    constructor(openaiClient: OpenAIService) {
        this.openaiClient = openaiClient;
    }

    private isMappingDebugEnabled(): boolean {
        return process.env.DAOM_TABLE_MAPPING_DEBUG === '1';
    }

    // taggedText에서 물리적 표 블록을 추출하고, 표 직전 문맥(preamble)을 함께 수집한다.
    // 이후 표 할당/상수 추론 단계에서 preamble을 활용한다.
    private extractMarkdownTablesWithContext(taggedText: string, preambleLinesCount: number = 50): ParsedTable[] {
        const lines = taggedText.split('\n');
        const tables: ParsedTable[] = [];
        let currentTable: string[] = [];
        let inTable = false;
        const recentTextLines: string[] = [];

        for (const line of lines) {
            const stripped = line.trim();
            if (stripped.startsWith('|')) {
                inTable = true;
                currentTable.push(line);
                continue;
            }

            if (inTable) {
                tables.push({
                    mdTable: currentTable.join('\n'),
                    preamble: recentTextLines.join('\n')
                });
                currentTable = [];
                inTable = false;
            }

            if (!stripped) continue;
            const cleanText = stripped.replace(/\^C[0-9A-Fa-f]+/g, '').trim();
            if (!cleanText) continue;
            recentTextLines.push(stripped);
            if (recentTextLines.length > preambleLinesCount) {
                recentTextLines.shift();
            }
        }

        if (currentTable.length > 0) {
            tables.push({
                mdTable: currentTable.join('\n'),
                preamble: recentTextLines.join('\n')
            });
        }
        return tables;
    }

    private isMarkdownSeparatorLine(line: string): boolean {
        const cells = parseMarkdownRow(line);
        if (cells.length === 0) return false;
        return cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()));
    }

    // markdown 표를 헤더/데이터 행으로 분리하고, 헤더 없는 연속 페이지 표는 이전 헤더를 재사용한다.
    private parseMarkdownTable(
        mdTable: string,
        headerFallbackByColCount: Map<number, string[]>
    ): { headers: string[]; rows: ParsedCell[][]; usedFallbackHeader: boolean } {
        const lines = mdTable.split('\n').map(line => line.trim()).filter(Boolean);
        if (lines.length < 1) return { headers: [], rows: [], usedFallbackHeader: false };

        const firstRowCells = parseMarkdownRow(lines[0]);
        const hasExplicitHeader = lines.length > 1 && this.isMarkdownSeparatorLine(lines[1]);
        const colCount = firstRowCells.length;

        let headers: string[] = [];
        let dataLines: string[] = [];
        let usedFallbackHeader = false;

        if (hasExplicitHeader) {
            headers = firstRowCells.map((header, idx) => {
                const clean = header.replace(/\^C[0-9A-Fa-f]+/g, '').trim();
                return clean || `Empty_Col_${idx + 1}`;
            });
            dataLines = lines.slice(2);
            if (headers.length > 0) {
                headerFallbackByColCount.set(colCount, headers);
            }
        } else {
            const fallbackHeaders = headerFallbackByColCount.get(colCount);
            if (fallbackHeaders && fallbackHeaders.length === colCount) {
                headers = fallbackHeaders;
                dataLines = lines; // 첫 줄부터 데이터로 처리
                usedFallbackHeader = true;
            } else {
                // fallback 불가 시 기존 동작 유지(첫 줄을 헤더로 간주)
                headers = firstRowCells.map((header, idx) => {
                    const clean = header.replace(/\^C[0-9A-Fa-f]+/g, '').trim();
                    return clean || `Empty_Col_${idx + 1}`;
                });
                dataLines = lines.slice(1);
            }
        }

        const rows: ParsedCell[][] = dataLines.map(line => {
            const cells = parseMarkdownRow(line);
            return cells.map(cell => {
                const refMatch = cell.match(/\^(C[0-9A-Fa-f]+)/);
                const ref = refMatch ? refMatch[1] : null;
                const text = cell.replace(/\^C[0-9A-Fa-f]+/g, '').trim();
                return { value: text || null, ref };
            });
        });

        return { headers, rows, usedFallbackHeader };
    }

    // 페이지 경계로 잘린 동일 표를 병합한다.
    // preamble이 거의 비어 있고 컬럼 수가 동일한 경우만 병합 대상으로 본다.
    private mergePageBreakTables(tables: ParsedTable[]): ParsedTable[] {
        if (tables.length === 0) return [];
        const merged: ParsedTable[] = [tables[0]];

        for (let i = 1; i < tables.length; i++) {
            const prev = merged[merged.length - 1];
            const curr = tables[i];
            const cleanPreamble = curr.preamble.replace(/[\d/\-\sPAGEpage]/g, '');
            const isEmptyPreamble = cleanPreamble.length < 5;

            const prevLines = prev.mdTable.trim().split('\n');
            const currLines = curr.mdTable.trim().split('\n');
            const prevFirst = prevLines[0] || '';
            const currFirst = currLines[0] || '';
            const prevCols = parseMarkdownRow(prevFirst).length;
            const currCols = parseMarkdownRow(currFirst).length;

            const headersMatch = this.areHeaderRowsEquivalent(prevFirst, currFirst);
            if (!isEmptyPreamble || prevCols !== currCols || prevCols <= 2) {
                merged.push(curr);
                continue;
            }

            let appendData: string[] = currLines;
            if (currLines.length > 2 && currLines[1].includes('---')) {
                appendData = headersMatch ? currLines.slice(2) : [currLines[0], ...currLines.slice(2)];
            }
            prev.mdTable = `${prev.mdTable}\n${appendData.join('\n')}`;
        }
        return merged;
    }

    // 헤더 태그/공백 차이를 제거하고 같은 헤더인지 판단한다.
    private areHeaderRowsEquivalent(rowA: string, rowB: string): boolean {
        const cellsA = parseMarkdownRow(rowA).map(cell => this.normalizeHeaderCell(cell));
        const cellsB = parseMarkdownRow(rowB).map(cell => this.normalizeHeaderCell(cell));
        if (cellsA.length === 0 || cellsA.length !== cellsB.length) return false;
        for (let i = 0; i < cellsA.length; i++) {
            if (cellsA[i] !== cellsB[i]) return false;
        }
        return true;
    }

    // 중복 헤더명(Destination, Amount 등)을 LLM이 구분할 수 있도록
    // "Header#colIndex" 형태로 보조 라벨을 만든다.
    private buildIndexedHeaderLabels(headers: string[]): string[] {
        return headers.map((header, idx) => {
            const clean = header.replace(/\^C[0-9A-Fa-f]+/g, '').trim() || `Empty_Col_${idx + 1}`;
            return `${clean}#${idx}`;
        });
    }

    // 단일 표를 어떤 table_field에 할당할지, 컬럼 인덱스 매핑을 어떻게 할지 LLM으로 평가한다.
    // 실제 row 조립은 아래 extractTables에서 결정적으로 수행한다.
    private async evaluateAndMapTable(
        tableSchema: TableSchema[],
        headers: string[],
        preamble: string,
        rowSample: string,
        globalPreamble: string
    ): Promise<TableMappingResult> {
        const indexedHeaders = this.buildIndexedHeaderLabels(headers);
        // 이 단계는 "판정(assignment/mapping)" 전용이며,
        // 실제 row 생성/보정/검증은 extractTables에서 deterministic 하게 처리한다.
        const systemPrompt = `You are an Expert Table Extractor running a Hybrid Independent Table Pipeline (ITP).
Your job is to evaluate a single physical table from a document and determine which Target Schema Field it belongs to, then map its columns.

TARGET SCHEMA FIELDS:
${JSON.stringify(tableSchema, null, 2)}

GLOBAL DOCUMENT CONTEXT (For Global Constants):
${globalPreamble}

CURRENT TABLE TO EVALUATE:
- Preceding Text (Local Preamble): ${preamble.slice(-400) || 'None'}
- OCR Headers (by index, disambiguated):
${indexedHeaders.map((h, i) => `  [${i}] ${h}`).join('\n')}
- Sample Row Data: ${rowSample}

CRITICAL RULES FOR EVALUATION (FALSE POSITIVE PREVENTION):
1. STRUCTURAL COMPATIBILITY: The OCR Headers MUST logically support the REQUIRED sub-columns of the Target Schema Field.
   - Example 1: If Schema requires "POL" and "POD", and OCR Headers are "Destination", "20'", "40'", it IS compatible (POL/Validity might be in Preamble).
   - Example 2: If Schema is "Rate_List" (requires POL, POD, Rates) but OCR Headers are "Surcharge Name", "Currency", "Amount", it is INCOMPATIBLE.
2. REJECT NOISE: If the table is obviously an email signature, a layout grid, or generic text without data, you MUST reject it by omitting the mapping.
3. SINGLE ASSIGNMENT: Evaluate and assign the table to at MOST ONE target schema key. If it doesn't fit any, return an empty mapping.

CRITICAL RULES FOR EXTRACTION:
1. "column_mapping": Map OCR Header indices (e.g. "0", "1") to the exact sub-column keys of the CHOSEN schema field.
2. "constants": If a sub-column key is NOT found in the headers, BUT its value is clearly stated in the Local Preamble OR Global Context, extract it here.

OUTPUT FORMAT (JSON ONLY):
{
  "assigned_schema_key": "target_schema_key_or_null",
  "column_mapping": {
    "0": "sub_column_key_a",
    "2": "sub_column_key_b"
  },
  "constants": {
    "missing_sub_column_key_c": "value extracted from preamble"
  }
}
If the table does NOT belong to any schema, output:
{
  "assigned_schema_key": null
}`;

        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Evaluate and map this table.' }
        ];

        try {
            const res = await this.openaiClient.getCompletion(messages, undefined, true, 2048, 0.0, 42);
            const content = res.choices[0].message.content || '{}';
            const parsed = JSON.parse(content) as TableMappingResult;
            return parsed;
        } catch (error) {
            // 표 하나 실패가 전체 추출 실패로 번지지 않게 안전하게 null 매핑으로 처리
            console.warn('[DirectTableMapper] evaluateAndMapTable failed:', error);
            return { assigned_schema_key: null };
        }
    }

    // 숫자형 컬럼 검증용 휴리스틱
    private isNumericLike(value: string): boolean {
        return /^[-+]?\$?\d[\d,]*(\.\d+)?(%|\/\d+)?$/.test(value.trim());
    }

    private normalizeHeaderCell(cell: string): string {
        return cell
            .replace(/\^C[0-9A-Fa-f]+/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9가-힣]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private buildHeaderSignature(headers: string[]): string {
        return headers.map(h => this.normalizeHeaderCell(h)).join('|');
    }

    // 헤더/설명 행이 데이터로 섞였는지 판별하기 위한 간단한 노이즈 감지
    private isLikelyHeaderNoise(values: string[]): boolean {
        const joined = values.join(' ').toLowerCase();
        const noiseTokens = ['trade', 'direction', 'dry', 'reefer', 'validity', 'service name', 'vvd', 'pol', 'pod'];
        const hitCount = noiseTokens.reduce((acc, token) => acc + (joined.includes(token) ? 1 : 0), 0);
        return hitCount >= 3;
    }

    // row 단위 최소 품질 검증:
    // - 필수 컬럼 충족
    // - 숫자형 컬럼 형식
    // - 명백한 헤더 노이즈 배제
    private validateRowAgainstSchema(row: TableRow, schema: TableSchema): boolean {
        const values = Object.keys(schema.columns).map(col => row[col]?.value).filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
        if (values.length === 0) return false;
        if (this.isLikelyHeaderNoise(values)) return false;

        let requiredFail = 0;
        let numericFail = 0;
        for (const [colKey, colSchema] of Object.entries(schema.columns)) {
            const raw = row[colKey]?.value;
            const text = typeof raw === 'string' ? raw.trim() : '';

            if (colSchema.is_required && !text) {
                requiredFail++;
                continue;
            }

            if (text && colSchema.type === 'number' && !this.isNumericLike(text)) {
                // 숫자 컬럼인데 명백히 숫자 형태가 아니면 실패
                numericFail++;
            }
        }

        if (requiredFail > 0) return false;
        if (numericFail >= 2) return false;
        return true;
    }

    // 메인 파이프라인:
    // 1) 표 추출/병합
    // 2) 표-스키마 할당 + 컬럼 인덱스 매핑
    // 3) 인덱스 기반 row 조립 + forward-fill
    // 4) 스키마 검증 후 커밋
    public async extractTables(workOrder: WorkOrder, taggedText: string, model?: ExtractionModel): Promise<Record<string, TableRow[]>> {
        const woInner = workOrder.work_order || {};
        const rawTableFields = Array.isArray(woInner.table_fields) ? woInner.table_fields : [];
        const modelTableFieldMap = new Map<string, FieldDefinition>();
        for (const f of model?.fields || []) {
            if (['table', 'list', 'array'].includes(f.type || '')) {
                modelTableFieldMap.set(f.key, f as FieldDefinition);
            }
        }

        const tableSchema: TableSchema[] = rawTableFields
            .filter(field => !!field?.key)
            .map(field => toTableSchema(field, modelTableFieldMap.get(field.key)));
        if (tableSchema.length === 0) return {};

        const rawTables = this.extractMarkdownTablesWithContext(taggedText);
        const mergedTables = this.mergePageBreakTables(rawTables);
        if (mergedTables.length === 0) return {};

        const globalPreamble = taggedText.slice(0, 1000).replace(/\^C[0-9A-Fa-f]+/g, '').trim();
        const resultsBySchema: Record<string, TableRow[]> = {};
        for (const schema of tableSchema) resultsBySchema[schema.key] = [];
        const mappingCacheByHeaderSig = new Map<string, { schemaKey: string; columnMapping: Record<number, string> }>();
        const headerFallbackByColCount = new Map<number, string[]>();

        for (let tableIndex = 0; tableIndex < mergedTables.length; tableIndex++) {
            const table = mergedTables[tableIndex];
            const { headers, rows, usedFallbackHeader } = this.parseMarkdownTable(table.mdTable, headerFallbackByColCount);
            if (headers.length === 0 || rows.length === 0) continue;

            const rowSample = rows[0].map(c => c.value || '').join(' | ');
            const headerSig = this.buildHeaderSignature(headers);
            const mapping = await this.evaluateAndMapTable(tableSchema, headers, table.preamble, rowSample, globalPreamble);

            let assignedSchemaKey = mapping.assigned_schema_key;
            const rawColumnMapping = mapping.column_mapping || {};
            let mappingSource = 'llm';

            // 동일 headerSig는 첫 유효 매핑을 기준으로 고정하여 일관성을 유지한다.
            const cached = mappingCacheByHeaderSig.get(headerSig);
            if (cached) {
                // schema 판정이 흔들려도 동일 headerSig에서는 기준 schema를 우선 사용
                assignedSchemaKey = cached.schemaKey;
                if (!mapping.assigned_schema_key || mapping.assigned_schema_key !== cached.schemaKey) {
                    mappingSource = 'cache-schema';
                }
            }

            if (!assignedSchemaKey) continue;

            const targetSchema = tableSchema.find(s => s.key === assignedSchemaKey);
            if (!targetSchema) continue;

            const llmValidColumnMapping: Record<number, string> = {};
            // LLM 응답을 그대로 신뢰하지 않고 인덱스 범위/스키마 키 존재를 재검증한다.
            for (const [idxStr, targetKey] of Object.entries(rawColumnMapping)) {
                const idx = Number(idxStr);
                if (!Number.isInteger(idx) || idx < 0 || idx >= headers.length) continue;
                if (!Object.prototype.hasOwnProperty.call(targetSchema.columns, targetKey)) continue;
                llmValidColumnMapping[idx] = targetKey;
            }

            // 기준 매핑 우선: cached를 기본으로 쓰고, LLM에서 새로 찾은 컬럼만 보강한다.
            const validColumnMapping: Record<number, string> = cached && cached.schemaKey === assignedSchemaKey
                ? { ...cached.columnMapping }
                : {};

            if (Object.keys(validColumnMapping).length > 0) {
                mappingSource = mappingSource === 'llm' ? 'cache' : `${mappingSource}+cache`;
            }

            for (const [idxStr, targetKey] of Object.entries(llmValidColumnMapping)) {
                const idx = Number(idxStr);
                if (Object.prototype.hasOwnProperty.call(validColumnMapping, idx)) continue;
                validColumnMapping[idx] = targetKey;
            }

            if (Object.keys(llmValidColumnMapping).length > 0 && Object.keys(validColumnMapping).length > 0) {
                if (mappingSource === 'llm') {
                    mappingSource = 'llm';
                } else if (!mappingSource.includes('llm')) {
                    mappingSource = `${mappingSource}+llm-extend`;
                }
            }

            if (Object.keys(validColumnMapping).length > 0) {
                mappingCacheByHeaderSig.set(headerSig, {
                    schemaKey: assignedSchemaKey,
                    columnMapping: validColumnMapping
                });
            }

            const validConstants: Record<string, string> = {};
            // constants도 동일하게 스키마 키 화이트리스트로 제한
            for (const [targetKey, constantValue] of Object.entries(mapping.constants || {})) {
                if (!Object.prototype.hasOwnProperty.call(targetSchema.columns, targetKey)) continue;
                if (!constantValue) continue;
                validConstants[targetKey] = constantValue;
            }

            if (this.isMappingDebugEnabled()) {
                const indexedHeaders = headers.map((h, idx) => `[${idx}] ${h.replace(/\^C[0-9A-Fa-f]+/g, '').trim()}`);
                console.log(
                    `[DirectTableMapper][MapDebug] table#${tableIndex} ` +
                    `headerSig="${headerSig}" usedFallback=${usedFallbackHeader} assigned="${assignedSchemaKey}" ` +
                    `source=${mappingSource} rawMapping=${JSON.stringify(rawColumnMapping)} ` +
                    `llmValidMapping=${JSON.stringify(llmValidColumnMapping)} validMapping=${JSON.stringify(validColumnMapping)} ` +
                    `constants=${JSON.stringify(validConstants)} headers=${JSON.stringify(indexedHeaders)}`
                );
            }

            // 같은 물리 표 내부에서만 forward-fill 상태를 유지한다.
            const previousByColumnIndex: Record<number, string | null> = {};
            for (const rowCells of rows) {
                const rowObj: TableRow = {};
                let hasPhysicalData = false;

                // constants는 preamble/global context에서 얻은 표 단위 공통값
                for (const [k, v] of Object.entries(validConstants)) {
                    rowObj[k] = { value: v, ref: null, confidence: 1.0 };
                }

                for (const [idxStr, targetKey] of Object.entries(validColumnMapping)) {
                    const idx = Number(idxStr);
                    if (!Number.isInteger(idx) || idx < 0 || idx >= rowCells.length) {
                        continue;
                    }
                    const cell = rowCells[idx];
                    let value = cell.value;
                    let ref = cell.ref;

                    // 병합 셀 표현(빈 셀) 보정: 직전 값으로 carry-forward
                    if (!value && Object.prototype.hasOwnProperty.call(previousByColumnIndex, idx)) {
                        value = previousByColumnIndex[idx];
                        ref = null;
                    } else {
                        // 비어있지 않은 실제 셀을 다음 row carry-forward 기준으로 저장
                        previousByColumnIndex[idx] = value;
                    }

                    rowObj[targetKey] = { value, ref, confidence: value ? 1.0 : 0.0 };
                    if (cell.value) hasPhysicalData = true;
                }

                // 스키마 컬럼 순서를 고정해 후단 UI/저장 포맷 드리프트를 줄인다.
                const orderedRow: TableRow = {};
                for (const schemaColKey of Object.keys(targetSchema.columns)) {
                    orderedRow[schemaColKey] = rowObj[schemaColKey] || { value: null, ref: null, confidence: 0.0 };
                }
                for (const [k, v] of Object.entries(rowObj)) {
                    if (!Object.prototype.hasOwnProperty.call(orderedRow, k)) {
                        orderedRow[k] = v;
                    }
                }

                // 실제 데이터가 있고 검증을 통과한 행만 결과에 반영
                if (hasPhysicalData && this.validateRowAgainstSchema(orderedRow, targetSchema)) {
                    resultsBySchema[targetSchema.key].push(orderedRow);
                }
            }
        }

        const filtered: Record<string, TableRow[]> = {};
        // 빈 배열 필드는 결과에서 제거해 후단 merge 시 잡음을 줄인다.
        for (const [k, v] of Object.entries(resultsBySchema)) {
            if (v.length > 0) filtered[k] = v;
        }
        return filtered;
    }
}
