import 'server-only';
import { OpenAIService } from '../OpenAIService';
import { LayoutParser } from './LayoutParser';
import { RefinerEngine } from './RefinerEngine';
import { DirectTableMapper } from './DirectTableMapper';
import { ExtractionModel } from '@/scheme/extractionModel';
import crypto from 'crypto';

import { PipelineOcrData, WorkOrder, WorkOrderField, EngineerOutput, PipelineResult } from '@/scheme/pipeline';

// 모듈 레벨 캐시: 서버 프로세스가 살아있는 동안 Designer LLM 호출 결과를 공유
// 기존 인스턴스 레벨 캐시는 요청마다 초기화되어 매번 Designer를 재호출하는 문제가 있었음
const GLOBAL_WORK_ORDER_CACHE: Record<string, WorkOrder> = {};

export class BetaPipeline {
    private openaiClient: OpenAIService;
    private workOrderCache = GLOBAL_WORK_ORDER_CACHE; // 모듈 레벨 캐시 참조 (모든 인스턴스 공유)
    private llmRequestBodies: Array<Record<string, unknown>> = [];

    constructor(openaiClient: OpenAIService) {
        this.openaiClient = openaiClient;
    }

    public async execute(model: ExtractionModel, ocrData: PipelineOcrData, focusPages?: number[]): Promise<PipelineResult> {
        const startTime = Date.now();
        this.llmRequestBodies = [];

        let taggedText = "";
        let refMap = {};

        if (ocrData._is_direct_markdown) {

            taggedText = ocrData.content || "";
        } else {
            const parser = new LayoutParser(ocrData);
            const parsed = parser.parse(focusPages);
            taggedText = parsed.taggedText;
            refMap = parsed.refMap;
        }

        const contentLen = taggedText.length;
        const pageCount = (ocrData.pages || []).length;


        // 2. Designer LLM (스키마 설계)
        const workOrder = await this.runDesigner(model);

        // 3. Engineer LLM (추출 실행)
        const isExcel = ocrData._is_direct_markdown === true;
        const SINGLE_SHOT_CHAR_LIMIT = isExcel ? 300000 : 50000;
        const TEXT_CHUNK_SIZE = isExcel ? 150000 : 25000;

        // 조기 행 수 감지: 대형 테이블(15행 이상)은 바로 병렬 페이징으로 진입
        const expectedRowCount = this.countTableRows(taggedText);
        // beta_features.disable_parallel_paging: true 이면 병렬 페이징 비활성화
        const disableParallelPaging = model.beta_features?.disable_parallel_paging === true;
        const isLargeTable = !isExcel && !disableParallelPaging && expectedRowCount >= 15;



        let engineerOutput: EngineerOutput;

        if (isLargeTable) {
            engineerOutput = await this.runEngineerPaginated(workOrder, taggedText, expectedRowCount, model);

        } else if (contentLen <= SINGLE_SHOT_CHAR_LIMIT) {

            engineerOutput = await this.runEngineer(workOrder, taggedText, model);

            if (engineerOutput._truncated) {
                console.warn("[BetaPipeline] 단일 샷 출력이 잘렸습니다! 청크 기반(Chunked) Engineer로 폴백합니다.");
                engineerOutput = await this.runEngineerChunked(workOrder, taggedText, TEXT_CHUNK_SIZE, model);
            }
        } else {

            engineerOutput = await this.runEngineerChunked(workOrder, taggedText, TEXT_CHUNK_SIZE, model);
        }

        if (!isLargeTable && engineerOutput._truncated) {
            console.warn("[BetaPipeline] 청크 기반 Engineer의 출력도 잘렸습니다! 스키마 분할(테이블 단위)로 폴백합니다.");
            engineerOutput = await this.runEngineerPerTable(workOrder, taggedText, TEXT_CHUNK_SIZE, model);
        }

        // 행 수 부족 감지: finish_reason='stop'이지만 실제로 행이 누락된 경우 대응
        if (!isLargeTable && !disableParallelPaging) {
            const extractedRowCount = this.countExtractedRows(engineerOutput);
            if (expectedRowCount > 0 && extractedRowCount < expectedRowCount * 0.8) {
                console.warn(`[BetaPipeline] 행 수 부족 (OCR: ${expectedRowCount}행, 추출: ${extractedRowCount}행). 병렬 페이징으로 전환합니다.`);
                engineerOutput = await this.runEngineerPaginated(workOrder, taggedText, expectedRowCount, model);
            }
        }

        // 3b. DirectTableMapper (테이블 필드 결정적 매핑)
        // beta_features.use_direct_table_mapper === false 인 경우에만 비활성화
        const shouldRunDirectTableMapper = !isExcel && model.beta_features?.use_direct_table_mapper !== false;
        if (shouldRunDirectTableMapper) {
            try {
                const mapper = new DirectTableMapper(this.openaiClient);
                const mapperOutput = await mapper.extractTables(workOrder, taggedText, model);
                const mergedCount = this.mergeTableFieldsFromMapper(engineerOutput, mapperOutput, model);
                if (mergedCount > 0) {
                    console.log(`[BetaPipeline] DirectTableMapper merged ${mergedCount} table field(s).`);
                }
            } catch (error) {
                console.warn('[BetaPipeline] DirectTableMapper 실행 실패 (LLM 결과 유지):', error);
            }
        }



        // 4. 후처리 (Post Process)
        const tableKeys = (model.fields || [])
            .filter(f => ['table', 'list', 'array'].includes(f.type || ''))
            .map(f => f.key);
        const finalGuide = RefinerEngine.postProcessWithRef(engineerOutput, refMap, tableKeys);

        // 4b. unmapped_critical_info 추출 (other_data에 추가)
        const otherData: Record<string, unknown>[] = [];
        const processedGuide = finalGuide.guide_extracted || {};
        const unmapped = processedGuide.unmapped_critical_info;

        if (unmapped) {
            const unmappedItems = Array.isArray(unmapped) ? unmapped : [unmapped];
            for (const item of unmappedItems) {
                if (item && typeof item === 'object') {
                    if (item.value) {
                        otherData.push({
                            column: "unmapped_critical_info",
                            value: item.value,
                            confidence: item.confidence ?? 0.5,
                            bbox: item.bbox
                        });
                    }
                } else if (item && typeof item === 'string') {
                    otherData.push({ column: "unmapped_critical_info", value: item, confidence: 0.5 });
                }
            }
            delete processedGuide.unmapped_critical_info;
        }

        const totalUsage = engineerOutput._token_usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

        return {
            guide_extracted: processedGuide,
            raw_content: ocrData.content || "",
            raw_tables: ocrData.tables || [],
            token_usage: totalUsage, // 하위 호환성 유지
            _debug_info: {
                token_usage: totalUsage,
                llm_request_bodies: this.llmRequestBodies
            },
            work_order: workOrder,
            other_data: otherData,
            beta_metadata: {
                parsed_content: taggedText,
                ref_map: refMap,
                pipeline_mode: "designer-engineer"
            },
            model_name: model.name || "",
            duration_seconds: (Date.now() - startTime) / 1000
        };
    }

    private captureLlmRequestBody(requestBody: Record<string, unknown>): void {
        this.llmRequestBodies.push(requestBody);
    }

    private mergeTableFieldsFromMapper(
        engineerOutput: EngineerOutput,
        mapperOutput: Record<string, unknown>,
        model: ExtractionModel
    ): number {
        if (!engineerOutput.guide_extracted || typeof engineerOutput.guide_extracted !== 'object') {
            engineerOutput.guide_extracted = {};
        }
        const guide = engineerOutput.guide_extracted as Record<string, unknown>;
        const tableKeys = new Set(
            (model.fields || [])
                .filter(f => ['table', 'list', 'array'].includes(f.type || ''))
                .map(f => f.key)
        );

        let mergedCount = 0;
        for (const [key, value] of Object.entries(mapperOutput)) {
            if (!tableKeys.has(key)) continue;
            if (!Array.isArray(value) || value.length === 0) continue;

            const mapperRows = value as unknown[];
            const existingRows = Array.isArray(guide[key]) ? (guide[key] as unknown[]) : [];
            if (existingRows.length === 0) {
                guide[key] = mapperRows;
                mergedCount++;
                continue;
            }

            const mapperScore = this.getTableQualityScore(mapperRows, key, model);
            const engineerScore = this.getTableQualityScore(existingRows, key, model);
            const mapperCoverageRatio = mapperRows.length / Math.max(existingRows.length, 1);

            const useMapper =
                mapperScore >= engineerScore * 0.95 &&
                mapperCoverageRatio >= 0.4;

            const selectedRows = useMapper ? mapperRows : existingRows;
            const reconciledRows = useMapper
                ? this.reconcileConsensusColumns(selectedRows, existingRows)
                : selectedRows;

            guide[key] = reconciledRows;
            mergedCount++;

            console.log(
                `[BetaPipeline] table_merge field='${key}' source=${useMapper ? 'mapper' : 'engineer'} ` +
                `mapper_score=${mapperScore.toFixed(3)} engineer_score=${engineerScore.toFixed(3)} ` +
                `mapper_rows=${mapperRows.length} engineer_rows=${existingRows.length}`
            );
        }
        return mergedCount;
    }

    private getCellValueAsText(cell: unknown): string {
        if (cell === null || cell === undefined) return '';
        if (typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean') {
            return String(cell).trim();
        }
        if (typeof cell === 'object' && !Array.isArray(cell)) {
            const value = (cell as Record<string, unknown>).value;
            if (value === null || value === undefined) return '';
            return String(value).trim();
        }
        return '';
    }

    private getTableSubFields(model: ExtractionModel, fieldKey: string): Array<{ key: string; type?: string; is_required?: boolean }> {
        const target = (model.fields || []).find(f => f.key === fieldKey);
        if (!target || !Array.isArray(target.sub_fields)) return [];
        return target.sub_fields.map(sf => ({
            key: sf.key,
            type: sf.type,
            is_required: sf.is_required
        }));
    }

    private isNumericLike(text: string): boolean {
        return /^[-+]?\$?\d[\d,]*(\.\d+)?(%|\/\d+)?$/.test(text);
    }

    private getTableQualityScore(rows: unknown[], fieldKey: string, model: ExtractionModel): number {
        if (!Array.isArray(rows) || rows.length === 0) return 0;
        const subFields = this.getTableSubFields(model, fieldKey);
        if (subFields.length === 0) return Math.min(rows.length / 10, 1);

        let totalRowScore = 0;
        let validRowCount = 0;

        for (const row of rows) {
            if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
            const rowObj = row as Record<string, unknown>;

            let hasAny = false;
            let requiredTotal = 0;
            let requiredFilled = 0;
            let numberTotal = 0;
            let numberValid = 0;

            for (const sf of subFields) {
                const text = this.getCellValueAsText(rowObj[sf.key]);
                if (text) hasAny = true;

                if (sf.is_required) {
                    requiredTotal++;
                    if (text) requiredFilled++;
                }

                if (sf.type === 'number') {
                    numberTotal++;
                    if (!text || this.isNumericLike(text)) numberValid++;
                }
            }

            if (!hasAny) continue;
            validRowCount++;

            const requiredScore = requiredTotal > 0 ? (requiredFilled / requiredTotal) : 1;
            const numberScore = numberTotal > 0 ? (numberValid / numberTotal) : 1;
            totalRowScore += (requiredScore * 0.7) + (numberScore * 0.3);
        }

        if (validRowCount === 0) return 0;
        const avgRowScore = totalRowScore / validRowCount;
        const rowCountBoost = Math.min(validRowCount / 12, 1);
        return (avgRowScore * 0.8) + (rowCountBoost * 0.2);
    }

    private getColumnConsensus(rows: unknown[]): Record<string, { value: string; ratio: number; count: number }> {
        const bucket: Record<string, Map<string, number>> = {};
        let rowCount = 0;

        for (const row of rows) {
            if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
            rowCount++;
            const rowObj = row as Record<string, unknown>;
            for (const [col, cell] of Object.entries(rowObj)) {
                const text = this.getCellValueAsText(cell);
                if (!text) continue;
                if (!bucket[col]) bucket[col] = new Map<string, number>();
                bucket[col].set(text, (bucket[col].get(text) || 0) + 1);
            }
        }

        const consensus: Record<string, { value: string; ratio: number; count: number }> = {};
        for (const [col, map] of Object.entries(bucket)) {
            let bestValue = '';
            let bestCount = 0;
            for (const [value, count] of map.entries()) {
                if (count > bestCount) {
                    bestCount = count;
                    bestValue = value;
                }
            }
            if (!bestValue || bestCount === 0) continue;
            consensus[col] = {
                value: bestValue,
                count: bestCount,
                ratio: rowCount > 0 ? (bestCount / rowCount) : 0
            };
        }
        return consensus;
    }

    private reconcileConsensusColumns(selectedRows: unknown[], engineerRows: unknown[]): unknown[] {
        if (!Array.isArray(selectedRows) || selectedRows.length === 0) return selectedRows;
        if (!Array.isArray(engineerRows) || engineerRows.length === 0) return selectedRows;

        const mapperConsensus = this.getColumnConsensus(selectedRows);
        const engineerConsensus = this.getColumnConsensus(engineerRows);
        const correctedCols: Array<{ col: string; from: string; to: string }> = [];

        for (const [col, mapper] of Object.entries(mapperConsensus)) {
            const eng = engineerConsensus[col];
            if (!eng) continue;
            if (mapper.value === eng.value) continue;
            if (mapper.ratio < 0.95 || eng.ratio < 0.95) continue;
            if (eng.count < 3) continue;
            correctedCols.push({ col, from: mapper.value, to: eng.value });
        }

        if (correctedCols.length === 0) return selectedRows;

        const nextRows = selectedRows.map(row => {
            if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
            const rowObj = row as Record<string, unknown>;
            const copied: Record<string, unknown> = { ...rowObj };

            for (const fix of correctedCols) {
                const cell = copied[fix.col];
                if (!cell || typeof cell !== 'object' || Array.isArray(cell)) continue;
                const cellObj = cell as Record<string, unknown>;
                copied[fix.col] = { ...cellObj, value: fix.to };
            }
            return copied;
        });

        console.log(
            `[BetaPipeline] consensus_reconcile applied: ` +
            correctedCols.map(c => `${c.col}('${c.from}'→'${c.to}')`).join(', ')
        );
        return nextRows;
    }

    private computeCacheKey(model: ExtractionModel): string {
        const fields = model.fields || [];
        // Designer LLM 결과에 영향을 주는 모든 필드 속성을 포함하여 캐시 키 생성
        const fieldsJson = JSON.stringify(fields.map(f => ({
            key: f.key,
            label: f.label,
            description: f.description,
            rules: f.rules,
            type: f.type,
            is_required: f.is_required,
            dictionary_id: f.dictionary_id,
            validation_regex: f.validation_regex,
            sub_fields: (f as any).sub_fields
        })));

        const globalRules = model.global_rules || "";
        const refData = JSON.stringify(model.reference_data || {});
        const dataStructure = model.data_structure || "data";
        const betaFeatures = JSON.stringify(model.beta_features || {});

        const raw = `v3|${model.id}|${fieldsJson}|${globalRules}|${refData}|${dataStructure}|${betaFeatures}`;
        return crypto.createHash('sha256').update(raw).digest('hex');
    }

    private async runDesigner(model: ExtractionModel): Promise<WorkOrder> {
        const cacheKey = this.computeCacheKey(model);
        if (this.workOrderCache[cacheKey]) {

            return this.workOrderCache[cacheKey];
        }



        const systemPrompt = RefinerEngine.constructDesignerPrompt(model);
        const userPrompt = "Generate the work order JSON. Output ONLY valid JSON, nothing else.";

        const messages = [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userPrompt }
        ];

        let workOrder: WorkOrder;
        try {
            const dynamicMaxTokens = (model.fields.length > 10 || model.fields.some(f => f.type === 'table')) ? 16384 : 4096;
            this.captureLlmRequestBody({
                extraction_mode: 'beta',
                stage: 'designer',
                json_mode: true,
                max_tokens: dynamicMaxTokens,
                messages,
            });
            const rawResultStr = await this.openaiClient.getCompletion(messages, undefined, true, dynamicMaxTokens);
            const rawResult = JSON.parse(rawResultStr.choices[0].message.content || "{}");

            if (rawResult.work_order && typeof rawResult.work_order === 'object') {
                workOrder = rawResult;
            } else if (typeof rawResult === 'object' && !rawResult.error) {
                workOrder = { work_order: rawResult };
            } else {
                console.warn("[BetaPipeline] Designer LLM이 에러 또는 빈 값을 반환했습니다. 폴백(Fallback)을 사용합니다.");
                workOrder = this.buildFallbackWorkOrder(model);
            }
        } catch (error) {
            console.error("[BetaPipeline] Designer LLM 호출 실패, 폴백(Fallback)을 사용합니다.", error);
            workOrder = this.buildFallbackWorkOrder(model);
        }

        const woInner = workOrder.work_order || {};
        const hasFields = (woInner.common_fields && woInner.common_fields.length > 0) ||
            (woInner.table_fields && woInner.table_fields.length > 0);

        if (!hasFields) {
            console.warn(`[BetaPipeline] Designer 출력에 필드 정의가 누락되었습니다. 폴백(Fallback)을 사용합니다.`);
            workOrder = this.buildFallbackWorkOrder(model);
        }

        this.workOrderCache[cacheKey] = workOrder;
        return workOrder;
    }

    private buildFallbackWorkOrder(model: ExtractionModel): WorkOrder {
        const TABLE_FIELD_TYPES = ['list', 'table', 'array'];

        const commonFields: WorkOrderField[] = [];
        const tableFields: WorkOrderField[] = [];

        for (const f of (model.fields || [])) {
            const entry: WorkOrderField = {
                key: f.key,
                instruction: `Extract '${f.label}' from the document.`,
                expected_format: f.type,
                rules: []
            };

            if (f.description) entry.instruction += ` Description: ${f.description}`;
            if (f.rules) {
                entry.rules = entry.rules || [];
                entry.rules.push(f.rules);
            }
            if (f.is_required) {
                entry.instruction += " [REQUIRED]";
                entry.rules = entry.rules || [];
                entry.rules.push("This field is MANDATORY. If not found, explicitly state why.");
            }
            // [주의] dictionary_id는 LLM 프롬프트에 노출하지 않음.
            // 딕셔너리 정규화는 추출 완료 후 performDictionaryNormalization 단계에서 후처리로만 수행됨.
            // 프롬프트에 노출 시 LLM이 스스로 변환을 시도하여 딕셔너리 해제 후에도 적용되는 버그가 발생함.
            if (f.validation_regex) {
                entry.instruction += ` [Regex: ${f.validation_regex}]`;
            }

            if (TABLE_FIELD_TYPES.includes(f.type || '')) {
                // sub_fields 정보를 columns에 매핑하여 Engineer LLM이 컬럼 구조를 인지하도록 함
                const cols: Record<string, any> = {};
                if (f.sub_fields && f.sub_fields.length > 0) {
                    f.sub_fields.forEach(sub => {
                        let subInst = `Extract '${sub.label}'${sub.description ? ` — ${sub.description}` : ''}`;
                        const subRules = sub.rules ? [sub.rules] : [];

                        if (sub.is_required) {
                            subInst += " [REQUIRED]";
                            subRules.push("This column is MANDATORY. If not found, explicitly state why.");
                        }

                        cols[sub.key] = {
                            instruction: subInst,
                            rules: subRules,
                            expected_format: sub.type || 'text'
                        };
                    });
                }
                entry.columns = cols;
                entry.rules = entry.rules || [];
                tableFields.push(entry);

            } else {
                commonFields.push(entry);
            }
        }

        return {
            work_order: {
                document_type: model.description || model.name,
                extraction_mode: tableFields.length > 0 ? "table" : "data",
                common_fields: commonFields,
                table_fields: tableFields,
                integrity_rules: [
                    "Copy values exactly as written. No conversion/calculation/translation.",
                    "Missing values must be null.",
                    "Extract in original language. Do NOT translate unless field rule says so."
                ]
            }
        };
    }

    private async runEngineer(workOrder: WorkOrder, taggedText: string, model: ExtractionModel): Promise<EngineerOutput> {
        const systemPrompt = RefinerEngine.constructEngineerPrompt(workOrder, model.reference_data, model.global_rules || undefined, model.fields);

        const userPrompt = `DOCUMENT DATA (Tagged Layout Format):\n${taggedText}\n\nExtract all fields according to the work order and document rules. Return valid JSON.`;


        const messages = [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userPrompt }
        ];

        try {
            // max_tokens를 16,384로 상향 조정 (대형 테이블 응답 잘림 방지)
            this.captureLlmRequestBody({
                extraction_mode: 'beta',
                stage: 'engineer_single',
                json_mode: true,
                max_tokens: 16384,
                messages,
            });
            const res = await this.openaiClient.getCompletion(messages, undefined, true, 16384);
            const content = res.choices[0].message.content || "{}";
            const isTruncated = res.choices[0].finish_reason === 'length';

            try {
                const parsed = JSON.parse(content);
                parsed._token_usage = res.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
                parsed._truncated = isTruncated;
                return parsed;
            } catch (parseError) {
                console.error(`[BetaPipeline] Engineer JSON Parse Failed. Finish Reason: ${res.choices[0].finish_reason}`);
                throw parseError;
            }
        } catch (error) {
            console.error("[BetaPipeline] 단일 샷(Single-shot) Engineer 실패:", error);
            return { guide_extracted: {}, _truncated: true, error: String(error) };
        }
    }

    private chunkWithHeaders(taggedText: string, chunkSize: number): string[] {
        if (taggedText.length <= chunkSize) return [taggedText];

        const chunks: string[] = [];
        let curPos = 0;

        while (curPos < taggedText.length) {
            const nextPos = curPos + chunkSize;

            if (nextPos >= taggedText.length) {
                chunks.push(taggedText.substring(curPos));
                break;
            }

            let splitPos = taggedText.lastIndexOf('\n', nextPos);
            if (splitPos <= curPos) {
                splitPos = nextPos;
            }

            chunks.push(taggedText.substring(curPos, splitPos));
            curPos = splitPos;
        }

        return chunks;
    }

    private async runEngineerChunked(workOrder: WorkOrder, taggedText: string, chunkSize: number, model: ExtractionModel): Promise<EngineerOutput> {
        const chunks = this.chunkWithHeaders(taggedText, chunkSize);


        if (chunks.length === 0) return { guide_extracted: {} };

        const systemPrompt = RefinerEngine.constructEngineerPrompt(workOrder, model.reference_data, model.global_rules || undefined, model.fields);

        const results = await Promise.all(chunks.map(async (chunkText, idx) => {
            const userPrompt = `DOCUMENT DATA (Tagged Layout Format — Chunk ${idx + 1}/${chunks.length}):\n${chunkText}\n\nExtract all fields from this section. Return valid JSON.`;

            const messages = [
                { role: 'system' as const, content: systemPrompt },
                { role: 'user' as const, content: userPrompt }
            ];

            try {
                // max_tokens: 16384 적용
                this.captureLlmRequestBody({
                    extraction_mode: 'beta',
                    stage: 'engineer_chunked',
                    chunk_index: idx,
                    chunk_total: chunks.length,
                    json_mode: true,
                    max_tokens: 16384,
                    messages,
                });
                const res = await this.openaiClient.getCompletion(messages, undefined, true, 16384);
                const content = res.choices[0].message.content || "{}";
                const isTruncated = res.choices[0].finish_reason === 'length';

                try {
                    const parsed = JSON.parse(content);
                    parsed._token_usage = res.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
                    parsed._truncated = isTruncated;
                    return parsed;
                } catch (parseError) {
                    console.error(`[BetaPipeline] Engineer Chunk ${idx} JSON Parse Failed. Finish Reason: ${res.choices[0].finish_reason}`);
                    throw parseError;
                }
            } catch (err) {
                console.error(`[BetaPipeline] Engineer 청크 ${idx} 실패:`, err);
                return { guide_extracted: {}, error: String(err) };
            }
        }));

        const mergedGuide: Record<string, unknown> = {};
        const seenRows: Record<string, Set<string>> = {};
        const totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        let anyTruncated = false;

        for (const res of results) {
            if (res._truncated) anyTruncated = true;

            if (res._token_usage) {
                totalUsage.prompt_tokens += res._token_usage.prompt_tokens || 0;
                totalUsage.completion_tokens += res._token_usage.completion_tokens || 0;
                totalUsage.total_tokens += res._token_usage.total_tokens || 0;
            }

            const guide = res.guide_extracted || {};
            for (const [key, val] of Object.entries(guide)) {
                if (Array.isArray(val)) {
                    if (!Array.isArray(mergedGuide[key])) {
                        mergedGuide[key] = [];
                        seenRows[key] = new Set();
                    }

                    // unique_constraints 설정 확인
                    const uniqueKeys = this.getUniqueKeysForField(key, model);

                    for (const row of val) {
                        if (row && typeof row === 'object') {
                            const rowKey = this.getRowSemanticKey(row, uniqueKeys);
                            if (!seenRows[key].has(rowKey)) {
                                seenRows[key].add(rowKey);
                                (mergedGuide[key] as unknown[]).push(row);
                            }
                        }
                    }
                } else {
                    if (!(key in mergedGuide)) {
                        mergedGuide[key] = val;
                    } else if (val && typeof val === 'object' && (val as Record<string, unknown>).value !== null && (val as Record<string, unknown>).value !== undefined) {
                        const existing = mergedGuide[key];
                        if (existing && typeof existing === 'object' && ((existing as Record<string, unknown>).value === null || (existing as Record<string, unknown>).value === undefined)) {
                            mergedGuide[key] = val; // 실제 값으로 null 덮어쓰기
                        }
                    }
                }
            }
        }

        return {
            guide_extracted: mergedGuide,
            _token_usage: totalUsage,
            _truncated: anyTruncated
        };
    }

    private async runEngineerPerTable(workOrder: WorkOrder, taggedText: string, chunkSize: number, model: ExtractionModel): Promise<EngineerOutput> {
        const woInner = workOrder.work_order || {};
        const tableFields = woInner.table_fields || [];
        const commonFields = woInner.common_fields || [];

        console.warn(`[BetaPipeline] 스키마 분할(테이블 단위)로 폴백합니다. ${tableFields.length}개의 테이블이 발견되었습니다.`);

        if (tableFields.length === 0) {
            return await this.runEngineerChunked(workOrder, taggedText, chunkSize, model);
        }

        const subOrders: WorkOrder[] = [];

        if (commonFields.length > 0) {
            subOrders.push({
                work_order: {
                    ...woInner,
                    table_fields: [],
                    extraction_mode: "data"
                }
            });
        }

        for (const tField of tableFields) {
            subOrders.push({
                work_order: {
                    ...woInner,
                    common_fields: [],
                    table_fields: [tField],
                    extraction_mode: "table"
                }
            });
        }

        const results = await Promise.all(subOrders.map(async subWo => {

            return await this.runEngineerChunked(subWo, taggedText, chunkSize, model);
        }));

        const mergedGuide: Record<string, unknown> = {};
        const totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        let anyTruncated = false;

        for (const res of results) {
            if (res._truncated) anyTruncated = true;
            if (res._token_usage) {
                totalUsage.prompt_tokens += res._token_usage.prompt_tokens || 0;
                totalUsage.completion_tokens += res._token_usage.completion_tokens || 0;
                totalUsage.total_tokens += res._token_usage.total_tokens || 0;
            }

            const guide = res.guide_extracted || {};
            for (const [key, val] of Object.entries(guide)) {
                mergedGuide[key] = val;
            }
        }

        return {
            guide_extracted: mergedGuide,
            _token_usage: totalUsage,
            _truncated: anyTruncated
        };
    }

    /** OCR 태그드 텍스트에서 테이블 데이터 행 수를 카운트 (헤더·구분자 제외) */
    private countTableRows(taggedText: string): number {
        const lines = taggedText.split('\n');
        let inTable = false;
        let headerPassed = false;
        let dataRows = 0;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('|')) {
                if (inTable) { inTable = false; headerPassed = false; }
                continue;
            }
            inTable = true;
            if (trimmed.includes('---')) { headerPassed = true; continue; }
            if (!headerPassed) continue;
            dataRows++;
        }
        return dataRows;
    }

    /** 추출된 결과에서 가장 긴 배열 필드의 행 수를 반환 */
    private countExtractedRows(output: EngineerOutput): number {
        const guide = output.guide_extracted || {};
        let maxRows = 0;
        for (const val of Object.values(guide)) {
            if (Array.isArray(val) && val.length > maxRows) maxRows = val.length;
        }
        return maxRows;
    }

    /**
     * 행 단위 페이징 추출
     * GPT가 finish_reason='stop'으로 스스로 멈출 때 사용.
     * 테이블을 12행씩 나누어 개별 호출 후 병합합니다.
     */
    private async runEngineerPaginated(
        workOrder: WorkOrder,
        taggedText: string,
        totalTableRows: number,
        model: ExtractionModel
    ): Promise<EngineerOutput> {
        const PAGINATION_SIZE = 8; // 안정성을 위해 10 -> 8로 하향 조정
        const mergedGuide: Record<string, any> = {}; // 배열 + 스칼라 모두 수용
        const seenHashes: Record<string, Set<string>> = {};
        const totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };


        // STEP 0: common_fields(스칼라)가 있으면 전체 문서를 대상으로 먼저 단일 샷 추출
        const woInner = workOrder.work_order || workOrder;
        const commonFields = woInner.common_fields || [];
        if (commonFields.length > 0) {
            const commonOnlyWorkOrder = {
                work_order: {
                    ...woInner,
                    table_fields: [], // 테이블 필드 제외
                }
            };
            const systemPrompt = RefinerEngine.constructEngineerPrompt(commonOnlyWorkOrder, model.reference_data, model.global_rules || undefined, model.fields);
            const userPrompt = `DOCUMENT DATA (Tagged Layout Format):\n${taggedText}\n\nExtract ONLY the common (scalar) fields listed in the work order. Ignore table fields. Return valid JSON.`;
            try {
                const commonMessages = [{ role: 'system' as const, content: systemPrompt }, { role: 'user' as const, content: userPrompt }];
                this.captureLlmRequestBody({
                    extraction_mode: 'beta',
                    stage: 'engineer_paginated_common',
                    json_mode: true,
                    max_tokens: 4096,
                    messages: commonMessages,
                });
                const res = await this.openaiClient.getCompletion(
                    commonMessages,
                    undefined, true, 4096
                );
                if (res.usage) {
                    totalUsage.prompt_tokens += res.usage.prompt_tokens || 0;
                    totalUsage.completion_tokens += res.usage.completion_tokens || 0;
                    totalUsage.total_tokens += res.usage.total_tokens || 0;
                }
                const parsed = JSON.parse(res.choices[0].message.content || '{}');
                const guide = parsed.guide_extracted || {};
                for (const [key, val] of Object.entries(guide)) {
                    if (!Array.isArray(val) && val !== null && val !== undefined) {
                        mergedGuide[key] = val;
                    }
                }
            } catch (err) {

                console.warn('[BetaPipeline] 공통 필드 사전 추출 실패 (계속 진행):', err);
            }
        }

        // 테이블 헤더와 데이터 행 분리
        const allLines = taggedText.split('\n');
        const tableHeaderLines: string[] = [];
        const dataLines: string[] = [];
        let inTable2 = false;
        let headerPassed2 = false;
        let headerCollected = false;

        for (const line of allLines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('|')) {
                if (!headerCollected) tableHeaderLines.push(line);
                inTable2 = false;
                headerPassed2 = false;
                continue;
            }
            inTable2 = true;
            if (trimmed.includes('---')) {
                tableHeaderLines.push(line);
                headerPassed2 = true;
                continue;
            }
            if (!headerPassed2) {
                tableHeaderLines.push(line);
                headerCollected = true;
                continue;
            }
            dataLines.push(line);
        }

        const tableHeader = tableHeaderLines.join('\n');
        const totalDataLines = dataLines.length;

        // 모든 페이지를 동시에 병렬 호출 (직렬 → 병렬 전환)

        const pageResults: (EngineerOutput | null)[] = new Array(Math.ceil(totalDataLines / PAGINATION_SIZE)).fill(null);
        const CONCURRENCY_LIMIT = 6; // 10 -> 6으로 상향 (TPM 100k 환경 대응)
        let chunkIdx = 0;
        for (let i = 0; i < totalDataLines; i += PAGINATION_SIZE * CONCURRENCY_LIMIT) {

            const batchPromises: Promise<void>[] = [];

            for (let j = 0; j < CONCURRENCY_LIMIT; j++) {
                const startIdx = i + (j * PAGINATION_SIZE);
                if (startIdx >= totalDataLines) break;

                const endIdx = Math.min(startIdx + PAGINATION_SIZE, totalDataLines);
                const pageRows = dataLines.slice(startIdx, endIdx);
                const capturedStart = startIdx;
                const capturedEnd = endIdx;
                const currentChunkIdx = chunkIdx++;

                batchPromises.push((async () => {
                    try {
                        const result = await this.runEngineerPageRange(
                            workOrder,
                            tableHeader,
                            pageRows,
                            startIdx,
                            endIdx,
                            totalDataLines,
                            model,
                            totalUsage
                        );
                        pageResults[currentChunkIdx] = result;
                    } catch (err: unknown) {
                        console.error(`[BetaPipeline] 페이징 에러 (rows ${startIdx + 1}-${endIdx}):`, err);
                    }
                })());
            }

            await Promise.all(batchPromises);
        }


        // 정해진 인덱스 순서대로 병합하여 행 순서 보장
        for (const parsed of pageResults) {
            if (!parsed) continue;
            const guide = parsed.guide_extracted || {};

            for (const [key, val] of Object.entries(guide)) {
                if (Array.isArray(val)) {
                    // 테이블 필드: 중복 제거 후 병합
                    if (!Array.isArray(mergedGuide[key])) {
                        mergedGuide[key] = [];
                        seenHashes[key] = new Set();
                    }
                    if (!seenHashes[key]) {
                        seenHashes[key] = new Set();
                    }
                    // unique_constraints 설정 확인
                    const uniqueKeys = this.getUniqueKeysForField(key, model);

                    for (const row of val) {
                        const rowKey = this.getRowSemanticKey(row, uniqueKeys);
                        if (!seenHashes[key].has(rowKey)) {
                            mergedGuide[key].push(row);
                            seenHashes[key].add(rowKey);
                        }
                    }
                } else if (val !== null && val !== undefined && !mergedGuide[key]) {
                    // 공통 필드(스칼라): 아직 수집되지 않은 경우 첫 번째 값 저장
                    mergedGuide[key] = val;
                }
            }
        }


        totalUsage.total_tokens = totalUsage.prompt_tokens + totalUsage.completion_tokens;

        return { guide_extracted: mergedGuide, _token_usage: totalUsage };
    }

    /** 특정 범위의 행을 추출 (응답 잘림 시 재귀적으로 분할 재시도) */
    private async runEngineerPageRange(
        workOrder: WorkOrder,
        tableHeader: string,
        pageRows: string[],
        startIdx: number,
        endIdx: number,
        totalDataLines: number,
        model: ExtractionModel,
        totalUsage: any
    ): Promise<EngineerOutput | null> {
        const pageText = `${tableHeader}\n${pageRows.join('\n')}`;
        const systemPrompt = RefinerEngine.constructEngineerPrompt(workOrder, model.reference_data, model.global_rules || undefined, model.fields);
        const userPrompt = `DOCUMENT DATA (table rows ${startIdx + 1}-${endIdx} of ${totalDataLines}):\n${pageText}\n\nExtract ALL table rows from this section. Return valid JSON.`;

        const messages = [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userPrompt }
        ];

        this.captureLlmRequestBody({
            extraction_mode: 'beta',
            stage: 'engineer_paginated_rows',
            row_range: `${startIdx + 1}-${endIdx}`,
            row_total: totalDataLines,
            json_mode: true,
            max_tokens: 16384,
            messages,
        });
        const res = await this.openaiClient.getCompletion(messages, undefined, true, 16384);
        const rawContent = res.choices[0].message.content || '{}';

        if (res.usage) {
            totalUsage.prompt_tokens += res.usage.prompt_tokens || 0;
            totalUsage.completion_tokens += res.usage.completion_tokens || 0;
            totalUsage.total_tokens += res.usage.total_tokens || 0;
        }

        if (res.choices[0].finish_reason === 'length') {
            console.warn(`[BetaPipeline] 페이지 rows ${startIdx + 1}-${endIdx}: 응답 잘림. 분할 재시도합니다.`);
            if (pageRows.length <= 2) {
                console.error(`[BetaPipeline] 더 이상 분할할 수 없습니다 (rows ${startIdx + 1}-${endIdx}). 최대한 파싱 시도합니다.`);
                const fixedJson = this.tryFixJson(res.choices[0].message.content || '{}');
                try {
                    return JSON.parse(fixedJson);
                } catch {
                    return { guide_extracted: {} };
                }
            }

            const mid = Math.floor(pageRows.length / 2);
            const firstHalfRows = pageRows.slice(0, mid);
            const secondHalfRows = pageRows.slice(mid);

            const [r1, r2] = await Promise.all([
                this.runEngineerPageRange(workOrder, tableHeader, firstHalfRows, startIdx, startIdx + mid, totalDataLines, model, totalUsage),
                this.runEngineerPageRange(workOrder, tableHeader, secondHalfRows, startIdx + mid, endIdx, totalDataLines, model, totalUsage)
            ]);

            return this.mergeEngineerOutputs(r1, r2);
        }

        try {
            return JSON.parse(rawContent);
        } catch (e) {
            const fixed = this.tryFixJson(rawContent);
            try { return JSON.parse(fixed); } catch { return { guide_extracted: {} }; }
        }
    }

    /**
     * 필드 키에 해당하는 유니크 제약 조건 컬럼 리스트를 반환합니다.
     */
    private getUniqueKeysForField(fieldKey: string, model: ExtractionModel): string[] | null {
        try {
            const refData = model.reference_data as any;
            if (refData?.unique_constraints && Array.isArray(refData.unique_constraints)) {
                const constraint = refData.unique_constraints.find((c: any) => c.target_array === fieldKey);
                if (constraint && Array.isArray(constraint.unique_keys)) {
                    return constraint.unique_keys;
                }
            }
        } catch (e) {
            console.warn(`[BetaPipeline] unique_constraints 파싱 실패:`, e);
        }
        return null;
    }

    /**
     * 특정 컬럼(uniqueKeys)을 기준으로 행의 의미적 해시 키를 생성합니다.
     */
    private getRowSemanticKey(row: any, uniqueKeys: string[] | null): string {
        if (!row || typeof row !== 'object') return JSON.stringify(row);

        const semanticData: Record<string, any> = {};
        
        if (uniqueKeys && uniqueKeys.length > 0) {
            uniqueKeys.forEach(key => {
                const cell = row[key];
                if (cell && typeof cell === 'object' && 'value' in (cell as any)) {
                    semanticData[key] = (cell as any).value;
                } else {
                    semanticData[key] = cell;
                }
            });
        } else {
            Object.keys(row).sort().forEach(key => {
                if (key.startsWith('__')) return;
                const cell = row[key];
                if (cell && typeof cell === 'object' && 'value' in (cell as any)) {
                    semanticData[key] = (cell as any).value;
                } else {
                    semanticData[key] = cell;
                }
            });
        }
        return JSON.stringify(semanticData);
    }

    private tryFixJson(json: string): string {
        try {
            JSON.parse(json);
            return json;
        } catch {
            let fixed = json.trim();
            if (!fixed.endsWith('}')) {
                // 대략적인 JSON 닫기 시도 (배열 내부인 경우 고려)
                if (fixed.includes('[') && !fixed.includes(']')) fixed += ']}';
                else fixed += '}';
            }
            return fixed;
        }
    }

    private mergeEngineerOutputs(r1: EngineerOutput | null, r2: EngineerOutput | null): EngineerOutput {
        const merged: Record<string, any> = {};
        const g1: Record<string, any> = r1?.guide_extracted || {};
        const g2: Record<string, any> = r2?.guide_extracted || {};

        const keys = new Set([...Object.keys(g1), ...Object.keys(g2)]);
        for (const key of keys) {
            const v1 = g1[key];
            const v2 = g2[key];
            if (Array.isArray(v1) || Array.isArray(v2)) {
                merged[key] = [...(Array.isArray(v1) ? v1 : []), ...(Array.isArray(v2) ? v2 : [])];
            } else {
                merged[key] = v1 ?? v2;
            }
        }
        return { guide_extracted: merged };
    }
}
