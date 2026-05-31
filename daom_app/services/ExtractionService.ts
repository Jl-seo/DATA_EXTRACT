import 'server-only';
import { DocIntelligenceService, AnalyzeResult } from './DocIntelligenceService';
import { OpenAIService } from './OpenAIService';
import { ExtractionModel } from '@/scheme/extractionModel';
import { LLMSettings } from '@/scheme/llmSettings';
import pLimit from 'p-limit';
import { BetaPipeline } from './extraction/BetaPipeline';
import { VisionPipeline } from './extraction/VisionPipeline';
import { RefinerEngine } from './extraction/RefinerEngine';
import { ExcelDeterministicMapper } from './extraction/ExcelDeterministicMapper';
import { ContentUnderstandingService } from './ContentUnderstandingService';

export interface ExtractedField {
    value: any;
    confidence: number;
    bbox?: number[];
    page_number?: number;
    _table_page_bboxes?: Record<number, number[]>; // 멀티 페이지 하이라이트용
    rules?: string | null;
    type: 'text' | 'number' | 'date' | 'table';
    is_required?: boolean | null;
    dictionary_id?: string | null;
    validation_regex?: string | null;
    category?: string;
    original_value?: string;
    sub_fields?: any[] | null;
}

export interface ExtractionResult {
    guide_extracted: Record<string, any>;
    other_data?: any[];
    raw_content?: string;
    raw_tables?: any[];
    beta_metadata?: Record<string, any>;
    comparisons?: any[];
    mode?: 'extraction' | 'comparison';
    comparison_count?: number;
    di_page_count?: number;
    token_usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    _chunked?: boolean;
    _debug_info?: any;
    llm_model?: string;
}

interface Chunk {
    index: number;
    page_numbers: number[];
    content: string;
    paragraphs: any[];
    tables: any[];
    token_estimate: number;
}

type OcrEngine = 'di' | 'cu' | 'vision';

interface MissingFieldHealingTarget {
    key: string;
    label: string;
    instruction: string;
    rules: string[];
}

interface MissingTableCellHealingTarget {
    task_id: string;
    parent_key: string;
    parent_label: string;
    sub_key: string;
    sub_label: string;
    row_index: number;
    row_number: number | null;
    row_context: Record<string, string | number | boolean>;
    rules: string[];
}

interface HealingTargetBundle {
    fields: MissingFieldHealingTarget[];
    tableCells: MissingTableCellHealingTarget[];
}

interface MultiFileSourceInput {
    filename: string;
    fileSource: string | Buffer | (() => Promise<string | Buffer>);
}

interface MultiFileOcrSummary {
    filename: string;
    engine: OcrEngine;
    raw_content: string;
    page_count: number;
}

interface MultiFileExtractResult {
    result: ExtractionResult;
    source_ocr: MultiFileOcrSummary[];
    extraction_path: OcrEngine;
}

export class ExtractionService {
    private static globalLimit = pLimit(2); // 글로벌 동시 추출 문서 수를 2로 조정
    private readonly healingPassEnabled = true;
    private readonly proactiveChunkingEnabled = false; // 임시: 선제 청크 비활성화
    private readonly chunkFallbackEnabled = false; // 임시: full 실패 시 chunk 폴백 비활성화
    private docIntel: DocIntelligenceService;
    private openai: OpenAIService;

    constructor(docIntel: DocIntelligenceService, openai: OpenAIService) {
        this.docIntel = docIntel;
        this.openai = openai;
    }

    private isGpt5FamilyModel(modelName?: string): boolean {
        if (!modelName) return false;
        const normalized = modelName.toLowerCase();
        return normalized.includes('gpt-5');
    }

    private estimatePromptTokens(text: string): number {
        if (!text) return 0;
        const asciiChars = text.match(/[\x00-\x7F]/g)?.length || 0;
        const nonAsciiChars = Math.max(0, text.length - asciiChars);
        return Math.ceil((asciiChars / 4) + (nonAsciiChars * 1.15));
    }

    private buildErrorOcrPreview(content: string, maxLength: number = 50000): string {
        if (!content) return '';
        if (content.length <= maxLength) return content;
        return `${content.slice(0, maxLength)}\n...[truncated ${content.length - maxLength} chars]`;
    }

    private isLikelyPromptTooLarge(prompt: string): boolean {
        // Azure 모델별 입력 한도(예: 272k)보다 충분한 안전 여유를 두고 사전 차단
        const estimatedTokens = this.estimatePromptTokens(prompt);
        return estimatedTokens >= 220000;
    }

    private isInputTokenLimitError(error: unknown): boolean {
        const errorObj = this.asRecord(error);
        const nestedError = this.asRecord(errorObj?.error);
        const message = [
            error instanceof Error ? error.message : '',
            this.pickString(errorObj, ['message']) || '',
            this.pickString(nestedError, ['message']) || '',
        ].join(' ').toLowerCase();
        const code = [
            this.pickString(errorObj, ['code']) || '',
            this.pickString(nestedError, ['code']) || '',
        ].join(' ').toLowerCase();

        return (
            message.includes('input tokens exceed') ||
            message.includes('messages resulted in') ||
            message.includes('maximum context length') ||
            message.includes('context length') ||
            message.includes('token limit') ||
            code.includes('context_length_exceeded')
        );
    }

    private isChunkFallbackTarget(error: unknown): boolean {
        if (this.isInputTokenLimitError(error)) return true;
        if (!(error instanceof Error)) return false;

        const message = error.message || '';
        return (
            message.includes('[PROMPT_TOO_LARGE]') ||
            message.includes('Empty response from LLM') ||
            message.includes('Unexpected end of JSON input') ||
            message.includes('Unterminated string in JSON')
        );
    }

    private getProactiveChunkReason(
        engine: OcrEngine,
        contentLength: number,
        pageCount: number,
        model: ExtractionModel,
        llmModel: string
    ): string | null {
        if (!this.proactiveChunkingEnabled) return null;

        if (contentLength > 100000) return 'content_length_threshold';
        if (pageCount > 20) return 'page_count_threshold';

        const hasTableFields = model.fields.some((f) => f.type === 'table');
        const isGpt5 = this.isGpt5FamilyModel(llmModel);

        // GPT-5 + CU 조합에서는 내부 추론 토큰 소모로 full 응답 공백이 발생할 수 있어
        // 보수적으로 선제 chunking을 적용한다.
        if (isGpt5 && engine === 'cu') {
            if (hasTableFields && contentLength > 25000) {
                return 'cu_gpt5_table_safety_threshold';
            }
            if (contentLength > 45000) {
                return 'cu_gpt5_content_safety_threshold';
            }
        }

        return null;
    }

    private hasAnyMeaningfulExtractionValue(value: unknown): boolean {
        if (value === null || value === undefined) return false;
        if (typeof value === 'string') return value.trim().length > 0;
        if (typeof value === 'number' || typeof value === 'boolean') return true;
        if (Array.isArray(value)) {
            if (value.length === 0) return false;
            return value.some((item) => this.hasAnyMeaningfulExtractionValue(item));
        }
        if (typeof value === 'object') {
            const record = this.asRecord(value);
            if (!record) return false;
            if (Object.prototype.hasOwnProperty.call(record, 'value')) {
                return this.hasAnyMeaningfulExtractionValue(record.value);
            }
            return Object.values(record).some((child) => this.hasAnyMeaningfulExtractionValue(child));
        }
        return false;
    }

    private hasMeaningfulGuideData(guide: Record<string, unknown> | undefined): boolean {
        if (!guide) return false;
        const entries = Object.entries(guide);
        if (entries.length === 0) return false;
        return entries.some(([, field]) => this.hasAnyMeaningfulExtractionValue(field));
    }

    private countMeaningfulGuideFields(guide: Record<string, unknown> | undefined): number {
        if (!guide) return 0;
        return Object.values(guide).filter((field) => this.hasAnyMeaningfulExtractionValue(field)).length;
    }

    private buildLlmResponseMeta(
        mode: 'full' | 'chunk' | 'excel_chunk',
        response: unknown,
        content: string | null | undefined,
        extra: Record<string, unknown> = {}
    ): Record<string, unknown> {
        const responseRecord = this.asRecord(response);
        const choices = this.asArray(responseRecord?.choices);
        const firstChoice = this.asRecord(choices[0]);
        const message = this.asRecord(firstChoice?.message);
        const usage = this.asRecord(responseRecord?.usage);
        const rawPreview = typeof content === 'string' ? content.slice(0, 500) : '';

        return {
            mode,
            finish_reason: this.pickString(firstChoice, ['finish_reason']) || 'unknown',
            refusal: this.pickString(message, ['refusal']) || 'none',
            content_len: typeof content === 'string' ? content.length : 0,
            content_preview: rawPreview,
            prompt_tokens: this.pickNumber(usage, ['prompt_tokens']) || 0,
            completion_tokens: this.pickNumber(usage, ['completion_tokens']) || 0,
            total_tokens: this.pickNumber(usage, ['total_tokens']) || 0,
            ...extra,
        };
    }

    private buildLlmResponseBody(
        mode: 'full' | 'chunk' | 'excel_chunk',
        response: unknown,
        content: string | null | undefined,
        extra: Record<string, unknown> = {}
    ): Record<string, unknown> {
        const responseRecord = this.asRecord(response);
        const choices = this.asArray(responseRecord?.choices);
        const firstChoice = this.asRecord(choices[0]);
        const message = this.asRecord(firstChoice?.message);
        const usage = this.asRecord(responseRecord?.usage);

        return {
            mode,
            finish_reason: this.pickString(firstChoice, ['finish_reason']) || 'unknown',
            refusal: this.pickString(message, ['refusal']) || 'none',
            content: typeof content === 'string' ? content : '',
            usage: {
                prompt_tokens: this.pickNumber(usage, ['prompt_tokens']) || 0,
                completion_tokens: this.pickNumber(usage, ['completion_tokens']) || 0,
                total_tokens: this.pickNumber(usage, ['total_tokens']) || 0,
            },
            ...extra,
        };
    }

    private getLatestLlmResponseMeta(result: ExtractionResult): Record<string, unknown> | null {
        const debugInfo = this.asRecord(result._debug_info);
        const metas = this.asArray(debugInfo?.llm_response_meta);
        if (metas.length === 0) return null;
        const latest = this.asRecord(metas[metas.length - 1]);
        return latest || null;
    }

    private diagnoseEmptyExtraction(
        rawResult: ExtractionResult,
        normalizedResult: ExtractionResult
    ): {
        reason: string;
        raw_guide_keys: number;
        raw_meaningful_fields: number;
        normalized_guide_keys: number;
        normalized_meaningful_fields: number;
        total_chunks?: number;
        successful_chunks?: number;
    } {
        const rawGuide = this.asRecord(rawResult.guide_extracted) || {};
        const normalizedGuide = this.asRecord(normalizedResult.guide_extracted) || {};

        const rawGuideKeys = Object.keys(rawGuide).length;
        const normalizedGuideKeys = Object.keys(normalizedGuide).length;
        const rawMeaningfulFields = this.countMeaningfulGuideFields(rawGuide);
        const normalizedMeaningfulFields = this.countMeaningfulGuideFields(normalizedGuide);

        const normalizedDebug = this.asRecord(normalizedResult._debug_info);
        const debugChunking = this.asRecord(normalizedDebug?._debug_chunking);
        const totalChunks = this.pickNumber(debugChunking, ['total_chunks']);
        const successfulChunks = this.pickNumber(debugChunking, ['successful_chunks']);

        let reason = 'unknown_empty_result';
        if (rawMeaningfulFields > 0 && normalizedMeaningfulFields === 0) {
            reason = 'post_processing_filtered_all';
        } else if (
            typeof totalChunks === 'number' &&
            totalChunks > 0 &&
            typeof successfulChunks === 'number' &&
            successfulChunks === 0
        ) {
            reason = 'all_chunks_empty_or_failed';
        } else if (rawGuideKeys === 0) {
            reason = 'raw_guide_missing';
        } else if (rawMeaningfulFields === 0) {
            reason = 'raw_guide_all_empty';
        } else if (normalizedGuideKeys === 0) {
            reason = 'normalized_guide_missing';
        }

        return {
            reason,
            raw_guide_keys: rawGuideKeys,
            raw_meaningful_fields: rawMeaningfulFields,
            normalized_guide_keys: normalizedGuideKeys,
            normalized_meaningful_fields: normalizedMeaningfulFields,
            total_chunks: totalChunks,
            successful_chunks: successfulChunks,
        };
    }

    private normalizeExcelToken(value: unknown): string {
        if (value === null || value === undefined) return '';
        return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    private isEmptyExcelCell(value: unknown): boolean {
        if (value === null || value === undefined) return true;
        if (typeof value === 'string') return value.trim() === '';
        return false;
    }

    private asRecord(value: unknown): Record<string, unknown> | null {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
        return value as Record<string, unknown>;
    }

    private asArray(value: unknown): unknown[] {
        return Array.isArray(value) ? value : [];
    }

    private pickString(source: Record<string, unknown> | null, keys: string[]): string | undefined {
        if (!source) return undefined;
        for (const key of keys) {
            const value = source[key];
            if (typeof value === 'string' && value.trim()) {
                return value;
            }
        }
        return undefined;
    }

    private pickNumber(source: Record<string, unknown> | null, keys: string[]): number | undefined {
        if (!source) return undefined;
        for (const key of keys) {
            const value = source[key];
            if (typeof value === 'number' && Number.isFinite(value)) {
                return value;
            }
        }
        return undefined;
    }

    private pickNumberArray(source: Record<string, unknown> | null, keys: string[]): number[] | undefined {
        if (!source) return undefined;
        for (const key of keys) {
            const value = source[key];
            if (!Array.isArray(value)) continue;
            const numbers = value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
            if (numbers.length >= 4) return numbers;
        }
        return undefined;
    }

    private bboxToPolygon(bbox: number[]): number[] | undefined {
        if (bbox.length < 4) return undefined;
        const [x1, y1, x2, y2] = bbox;
        return [x1, y1, x2, y1, x2, y2, x1, y2];
    }

    private parseNumbersFromText(value: string): number[] {
        const matches = value.match(/-?\d+(?:\.\d+)?/g);
        if (!matches) return [];
        return matches
            .map((token) => Number(token))
            .filter((num) => Number.isFinite(num));
    }

    private parseCuSourceGeometry(source: string | undefined): { pageNumber?: number; polygon?: number[] } {
        if (!source || !source.trim()) return {};

        const dMatch = source.match(/[dD]\(([^)]*)\)/);
        const fromD = dMatch ? this.parseNumbersFromText(dMatch[1]) : [];

        if (fromD.length >= 9) {
            const pageNumber = Math.max(1, Math.floor(fromD[0]));
            const polygon = fromD.slice(1, 9);
            if (polygon.length === 8) {
                return { pageNumber, polygon };
            }
        }

        const allNumbers = this.parseNumbersFromText(source);
        if (allNumbers.length >= 8) {
            return { polygon: allNumbers.slice(0, 8) };
        }
        if (allNumbers.length >= 4) {
            const bbox = allNumbers.slice(0, 4);
            return { polygon: this.bboxToPolygon(bbox) };
        }

        return {};
    }

    private resolveOcrEngine(model: ExtractionModel): OcrEngine {
        const betaFeatures = model.beta_features;
        if (!betaFeatures || typeof betaFeatures !== 'object') return 'di';

        const rawEngine = (betaFeatures as Record<string, unknown>).ocr_engine;
        if (typeof rawEngine !== 'string') return 'di';

        const normalized = rawEngine.trim().toLowerCase();
        if (normalized === 'vision' || normalized === 'multimodal') return 'vision';
        return normalized === 'cu' || normalized === 'content_understanding' ? 'cu' : 'di';
    }

    private resolveCuAnalyzerId(model: ExtractionModel): string | undefined {
        const betaFeatures = model.beta_features;
        if (!betaFeatures || typeof betaFeatures !== 'object') return undefined;

        const raw = (betaFeatures as Record<string, unknown>).cu_analyzer_id;
        if (typeof raw !== 'string') return undefined;
        const trimmed = raw.trim();
        return trimmed || undefined;
    }

    private resolveCuApiVersion(model: ExtractionModel): string | undefined {
        const betaFeatures = model.beta_features;
        if (!betaFeatures || typeof betaFeatures !== 'object') return undefined;

        const raw = (betaFeatures as Record<string, unknown>).cu_api_version;
        if (typeof raw !== 'string') return undefined;
        const trimmed = raw.trim();
        return trimmed || undefined;
    }

    private buildAnalyzeResultFromCuPayload(payload: unknown): AnalyzeResult {
        const payloadObj = this.asRecord(payload);
        const resultObj = this.asRecord(payloadObj?.result);
        const sourceObj = resultObj ?? payloadObj;

        const nestedItemKeys = ['pages', 'contents', 'items', 'elements', 'lines', 'paragraphs', 'words'] as const;
        const flattenContentItems = (node: unknown, depth: number = 0): unknown[] => {
            const nodeObj = this.asRecord(node);
            if (!nodeObj) return [];
            if (depth >= 6) return [node];

            const childNodes = nestedItemKeys.flatMap((key) => this.asArray(nodeObj[key]));
            if (childNodes.length === 0) return [node];

            const flattened = childNodes.flatMap((child) => flattenContentItems(child, depth + 1));
            return flattened.length > 0 ? flattened : [node];
        };

        const isLikelyPageObject = (item: unknown): boolean => {
            const itemObj = this.asRecord(item);
            if (!itemObj) return false;
            if (this.pickNumber(itemObj, ['pageNumber', 'page_number', 'width', 'height']) !== undefined) return true;
            if (this.pickString(itemObj, ['unit']) !== undefined) return true;
            return ['words', 'lines', 'paragraphs'].some((key) => this.asArray(itemObj[key]).length > 0);
        };

        const contents = this.asArray(sourceObj?.contents);
        const contentPageItems = contents.flatMap((item) => flattenContentItems(item));

        const rawParagraphs = this.asArray(sourceObj?.paragraphs);
        const lines = this.asArray(sourceObj?.lines);

        const markdownCandidates: string[] = [];
        const sourceMarkdown = this.pickString(sourceObj, ['markdown']);
        if (sourceMarkdown) {
            markdownCandidates.push(sourceMarkdown);
        }
        for (const item of contents) {
            const itemObj = this.asRecord(item);
            const markdown = this.pickString(itemObj, ['markdown']);
            if (markdown) {
                markdownCandidates.push(markdown);
            }
        }
        const uniqueMarkdownCandidates = Array.from(
            new Set(markdownCandidates.map((candidate) => candidate.trim()).filter((candidate) => candidate.length > 0))
        );
        const markdownContent = uniqueMarkdownCandidates.join('\n\n');

        const contentCandidates: string[] = [];
        const directContent = this.pickString(sourceObj, ['content', 'text']);
        if (directContent) contentCandidates.push(directContent);

        for (const item of contentPageItems) {
            const itemObj = this.asRecord(item);
            const directText = this.pickString(itemObj, ['content', 'text']);
            if (directText) {
                contentCandidates.push(directText);
                continue;
            }

            const words = this.asArray(itemObj?.words);
            if (words.length > 0) {
                const wordsText = words
                    .map((word) => {
                        const wordObj = this.asRecord(word);
                        return this.pickString(wordObj, ['content', 'text']) || '';
                    })
                    .filter((text) => text.trim().length > 0)
                    .join(' ');
                if (wordsText) {
                    contentCandidates.push(wordsText);
                }
            }
        }

        for (const line of lines) {
            const lineObj = this.asRecord(line);
            const text = this.pickString(lineObj, ['content', 'text']);
            if (text) contentCandidates.push(text);
        }

        let content = markdownContent || (contentCandidates.length > 0
            ? contentCandidates.join('\n')
            : '');

        const detectPageNumber = (item: unknown): number | undefined => {
            const itemObj = this.asRecord(item);
            const directPage = this.pickNumber(itemObj, ['pageNumber', 'page_number']);
            if (directPage && directPage > 0) return directPage;

            const regions = this.asArray(itemObj?.boundingRegions);
            const firstRegion = this.asRecord(regions[0]);
            const regionPage = this.pickNumber(firstRegion, ['pageNumber', 'page_number']);
            if (regionPage && regionPage > 0) return regionPage;

            const sourceText =
                this.pickString(firstRegion, ['source']) ||
                this.pickString(itemObj, ['source']);
            const parsed = this.parseCuSourceGeometry(sourceText);
            return parsed.pageNumber;
        };

        const rawPages = this.asArray(sourceObj?.pages);
        const contentPages = contents
            .flatMap((item) => {
                const itemObj = this.asRecord(item);
                return this.asArray(itemObj?.pages);
            })
            .filter((pageCandidate) => isLikelyPageObject(pageCandidate));
        const pageCandidates = rawPages.length > 0 ? rawPages : contentPages;
        const detectedPages = [
            ...pageCandidates.map((page) => detectPageNumber(page)),
            ...rawParagraphs.map((paragraph) => detectPageNumber(paragraph)),
            ...lines.map((line) => detectPageNumber(line)),
            ...contentPageItems.map((contentItem) => detectPageNumber(contentItem)),
        ].filter((page): page is number => typeof page === 'number' && Number.isFinite(page) && page > 0);
        const detectedMaxPage = detectedPages.length > 0 ? Math.max(...detectedPages) : 1;

        const pages = pageCandidates.length > 0
            ? pageCandidates.map((page, idx) => {
                const pageObj = this.asRecord(page);
                const pageNumber = detectPageNumber(pageObj) ?? idx + 1;
                const width = this.pickNumber(pageObj, ['width']) ?? 1000;
                const height = this.pickNumber(pageObj, ['height']) ?? 1000;
                return {
                    ...(pageObj || {}),
                    pageNumber,
                    width,
                    height,
                };
            })
            : Array.from({ length: detectedMaxPage }, (_, idx) => ({
                pageNumber: idx + 1,
                width: 1000,
                height: 1000,
            }));

        const bboxDebug = {
            from_region_polygon: 0,
            from_item_polygon: 0,
            from_source_geometry: 0,
            from_bbox: 0,
            from_fallback: 0,
            source_string_detected: 0,
            paragraphs_from_lines: 0,
            paragraphs_from_content_pages: 0,
        };

        const mapTextItemToParagraph = (
            item: unknown,
            kind: 'paragraph' | 'line' | 'content_page'
        ) => {
            const itemObj = this.asRecord(item);
            let text = this.pickString(itemObj, ['content', 'text', 'markdown', 'value']) || '';
            if (!text) {
                const words = this.asArray(itemObj?.words);
                if (words.length > 0) {
                    text = words
                        .map((word) => {
                            const wordObj = this.asRecord(word);
                            return this.pickString(wordObj, ['content', 'text']) || '';
                        })
                        .filter((token) => token.trim().length > 0)
                        .join(' ');
                }
            }

            const regions = this.asArray(itemObj?.boundingRegions);
            const firstRegion = this.asRecord(regions[0]);

            const itemSource = this.pickString(itemObj, ['source']);
            const regionSource = this.pickString(firstRegion, ['source']);
            const sourceFromItem = this.parseCuSourceGeometry(itemSource);
            const sourceFromRegion = this.parseCuSourceGeometry(regionSource);
            if (itemSource || regionSource) {
                bboxDebug.source_string_detected += 1;
            }

            const pageNumber =
                this.pickNumber(firstRegion, ['pageNumber', 'page_number']) ??
                this.pickNumber(itemObj, ['pageNumber', 'page_number']) ??
                sourceFromRegion.pageNumber ??
                sourceFromItem.pageNumber ??
                1;

            let polygon = this.pickNumberArray(firstRegion, ['polygon']);
            if (polygon) {
                bboxDebug.from_region_polygon += 1;
            }

            if (!polygon) {
                polygon = this.pickNumberArray(itemObj, ['polygon', 'boundingPolygon']);
                if (polygon) {
                    bboxDebug.from_item_polygon += 1;
                }
            }

            if (!polygon) {
                polygon = sourceFromRegion.polygon || sourceFromItem.polygon;
                if (polygon) {
                    bboxDebug.from_source_geometry += 1;
                }
            }

            if (!polygon) {
                const bbox = this.pickNumberArray(itemObj, ['bbox', 'boundingBox']);
                if (bbox) {
                    polygon = this.bboxToPolygon(bbox);
                    bboxDebug.from_bbox += 1;
                }
            }

            if (!polygon) {
                bboxDebug.from_fallback += 1;
            }

            if (kind === 'line') {
                bboxDebug.paragraphs_from_lines += 1;
            } else if (kind === 'content_page') {
                bboxDebug.paragraphs_from_content_pages += 1;
            }

            return {
                ...(itemObj || {}),
                content: text,
                boundingRegions: [{
                    pageNumber,
                    ...(polygon ? { polygon } : {}),
                }],
            };
        };

        let paragraphs = rawParagraphs.length > 0
            ? rawParagraphs.map((paragraph) => mapTextItemToParagraph(paragraph, 'paragraph'))
            : (lines.length > 0
                ? lines.map((line) => mapTextItemToParagraph(line, 'line'))
                : (contentPageItems.length > 0
                    ? contentPageItems.map((contentItem) => mapTextItemToParagraph(contentItem, 'content_page'))
                    : [{
                        content,
                        boundingRegions: [{
                            pageNumber: 1,
                        }],
                    }]));
        paragraphs = paragraphs.filter((paragraph) => {
            const paragraphObj = this.asRecord(paragraph);
            const paragraphText = this.pickString(paragraphObj, ['content', 'text']) || '';
            return paragraphText.trim().length > 0;
        });
        if (paragraphs.length === 0) {
            paragraphs = [{
                content: content || '[CU] content 없음',
                boundingRegions: [{ pageNumber: 1 }],
            }];
        }
        if (!content.trim()) {
            content = paragraphs
                .map((paragraph) => {
                    const paragraphObj = this.asRecord(paragraph);
                    return this.pickString(paragraphObj, ['content', 'text']) || '';
                })
                .filter((text) => text.trim().length > 0)
                .join('\n');
            if (!content.trim()) {
                content = '[CU] content 없음';
            }
        }

        const pageWordsMap = new Map<number, Array<{ content: string; polygon: number[] }>>();
        const pushWord = (pageNumber: number, contentText: string, polygon: number[] | undefined) => {
            const text = contentText.trim();
            if (!text || !polygon || polygon.length < 8) return;
            if (!pageWordsMap.has(pageNumber)) {
                pageWordsMap.set(pageNumber, []);
            }
            pageWordsMap.get(pageNumber)!.push({
                content: text,
                polygon,
            });
        };

        const extractTextPolygonPage = (item: unknown): { pageNumber: number; contentText: string; polygon?: number[] } => {
            const itemObj = this.asRecord(item);
            const regions = this.asArray(itemObj?.boundingRegions);
            const firstRegion = this.asRecord(regions[0]);

            const itemSource = this.pickString(itemObj, ['source']);
            const regionSource = this.pickString(firstRegion, ['source']);
            const sourceFromItem = this.parseCuSourceGeometry(itemSource);
            const sourceFromRegion = this.parseCuSourceGeometry(regionSource);

            const pageNumber =
                this.pickNumber(firstRegion, ['pageNumber', 'page_number']) ??
                this.pickNumber(itemObj, ['pageNumber', 'page_number']) ??
                sourceFromRegion.pageNumber ??
                sourceFromItem.pageNumber ??
                1;

            let polygon =
                this.pickNumberArray(firstRegion, ['polygon']) ??
                this.pickNumberArray(itemObj, ['polygon', 'boundingPolygon']) ??
                sourceFromRegion.polygon ??
                sourceFromItem.polygon;

            if (!polygon) {
                const bbox = this.pickNumberArray(itemObj, ['bbox', 'boundingBox']);
                if (bbox) {
                    polygon = this.bboxToPolygon(bbox);
                }
            }

            const contentText = this.pickString(itemObj, ['content', 'text']) || '';
            return {
                pageNumber: Number.isFinite(pageNumber) ? pageNumber : 1,
                contentText,
                polygon,
            };
        };

        for (const item of paragraphs) {
            const extracted = extractTextPolygonPage(item);
            if (extracted.contentText) {
                const tokens = extracted.contentText.split(/\s+/).filter(Boolean);
                if (tokens.length > 0) {
                    tokens.forEach((token) => pushWord(extracted.pageNumber, token, extracted.polygon));
                } else {
                    pushWord(extracted.pageNumber, extracted.contentText, extracted.polygon);
                }
            }
        }
        for (const item of lines) {
            const extracted = extractTextPolygonPage(item);
            if (extracted.contentText) {
                extracted.contentText.split(/\s+/).filter(Boolean).forEach((token) => {
                    pushWord(extracted.pageNumber, token, extracted.polygon);
                });
            }
        }
        for (const item of contentPageItems) {
            const itemObj = this.asRecord(item);
            const nestedWords = this.asArray(itemObj?.words);
            if (nestedWords.length > 0) {
                for (const nestedWord of nestedWords) {
                    const extracted = extractTextPolygonPage(nestedWord);
                    pushWord(extracted.pageNumber, extracted.contentText, extracted.polygon);
                }
                continue;
            }

            const extracted = extractTextPolygonPage(item);
            pushWord(extracted.pageNumber, extracted.contentText, extracted.polygon);
        }

        const pagesWithWords = pages.map((page) => {
            const pageObj = this.asRecord(page) || {};
            const pageNumber = this.pickNumber(pageObj, ['pageNumber', 'page_number']) || 1;
            const existingWordsRaw = this.asArray(pageObj.words);
            const existingWords = existingWordsRaw
                .map((word) => this.asRecord(word))
                .filter((word): word is Record<string, unknown> => !!word)
                .map((word) => {
                    const contentText = this.pickString(word, ['content', 'text']) || '';
                    const polygon =
                        this.pickNumberArray(word, ['polygon', 'boundingPolygon']) ||
                        this.parseCuSourceGeometry(this.pickString(word, ['source'])).polygon;
                    return {
                        content: contentText,
                        ...(polygon ? { polygon } : {}),
                    };
                });

            const generatedWords = pageWordsMap.get(pageNumber) || [];

            return {
                ...pageObj,
                pageNumber,
                words: [...existingWords, ...generatedWords],
            };
        });

        const firstParagraph = this.asRecord(paragraphs[0]);
        const firstRegion = this.asRecord(this.asArray(firstParagraph?.boundingRegions)[0]);
        const samplePolygon = this.pickNumberArray(firstRegion, ['polygon']) || [];
        const sampleParagraphSource = this.pickString(this.asRecord(rawParagraphs[0]), ['source']) || null;
        const sampleLineSource = this.pickString(this.asRecord(lines[0]), ['source']) || null;
        const sampleContentSource = this.pickString(this.asRecord(contentPageItems[0]), ['source']) || null;
        const contentItemsWithSource = contentPageItems.reduce<number>((count, item) => {
            const itemObj = this.asRecord(item);
            const hasSource = !!this.pickString(itemObj, ['source']);
            return hasSource ? count + 1 : count;
        }, 0);
        const cuBboxDebugPayload = {
            normalizer_version: 'cu-table-v1',
            raw_pages: rawPages.length,
            content_pages: contentPages.length,
            raw_paragraphs: rawParagraphs.length,
            raw_lines: lines.length,
            raw_content_pages: contentPageItems.length,
            content_items_with_source: contentItemsWithSource,
            pages: pagesWithWords.length,
            paragraphs: paragraphs.length,
            generated_words: Array.from(pageWordsMap.values()).reduce((sum, words) => sum + words.length, 0),
            markdown_candidates: uniqueMarkdownCandidates.length,
            content_mode: markdownContent ? 'markdown' : 'plain',
            ...bboxDebug,
            sample_page_number: this.pickNumber(firstRegion, ['pageNumber', 'page_number']) ?? null,
            sample_polygon: samplePolygon.slice(0, 8),
            sample_paragraph_source: sampleParagraphSource,
            sample_line_source: sampleLineSource,
            sample_content_source: sampleContentSource,
        };
        console.info('[CU bbox] 변환 요약', cuBboxDebugPayload);
        console.info('[CU bbox] 변환 요약 JSON', JSON.stringify(cuBboxDebugPayload));

        const tables = this.asArray(sourceObj?.tables);

        return {
            content,
            pages: pagesWithWords,
            paragraphs,
            tables,
            keyValuePairs: [],
            documents: [],
            styles: [],
        };
    }

    private async analyzeDocumentForExtraction(
        fileSource: string | Buffer,
        model: ExtractionModel
    ): Promise<{ engine: OcrEngine; analyzeResult: AnalyzeResult }> {
        const requestedEngine = this.resolveOcrEngine(model);
        const isUrlSource = typeof fileSource === 'string' && fileSource.startsWith('http');

        if (requestedEngine === 'cu') {
            if (!isUrlSource) {
                console.warn(
                    `[Extraction] OCR engine requested=cu, used=di (reason=fileSource is not URL, sourceType=${Buffer.isBuffer(fileSource) ? 'buffer' : 'base64'})`
                );
            } else {
                const cuService = new ContentUnderstandingService(this.docIntel.envConfig);
                const cuAnalyzerId = this.resolveCuAnalyzerId(model);
                const cuApiVersion = this.resolveCuApiVersion(model);
                const startCU = Date.now();
                const cuResult = await cuService.analyzeFromUrl(fileSource, cuAnalyzerId, {
                    apiVersion: cuApiVersion,
                });
                const ocrData = this.buildAnalyzeResultFromCuPayload(cuResult.poll_response);
                const cuElapsed = Date.now() - startCU;
                console.log(
                    `[CU API] 완료 (${cuElapsed}ms) | analyzer: ${cuResult.analyzer_id} | pages: ${ocrData.pages?.length || 0} | content: ${ocrData.content.length} chars`
                );
                console.log(`[Extraction] OCR engine requested=cu, used=cu`);
                return { engine: 'cu', analyzeResult: ocrData };
            }
        }

        if (requestedEngine !== 'cu') {
            console.log(`[Extraction] OCR engine requested=di, used=di`);
        }

        const azureModelId = model.azure_model_id || 'prebuilt-layout';
        console.log(`[DocIntel API] 호출 시작 | model: ${azureModelId} | source: ${typeof fileSource === 'string' && fileSource.startsWith('http') ? fileSource.substring(0, 80) + '...' : 'Buffer/Base64'}`);
        const startDI = Date.now();

        const analyzeResult = await this.docIntel.analyzeDocument(
            fileSource,
            azureModelId
        );

        const diElapsed = Date.now() - startDI;
        const contentLength = analyzeResult.content.length;
        const pageCount = analyzeResult.pages?.length || 0;
        const wordCount = analyzeResult.pages?.reduce((sum: number, p: any) => sum + (p.words?.length || 0), 0) || 0;
        console.log(`[DocIntel API] 완료 (${diElapsed}ms) | pages: ${pageCount} | words: ${wordCount} | content: ${contentLength} chars`);

        return { engine: 'di', analyzeResult };
    }

    private shiftPageNumberDeep<T>(value: T, offset: number): T {
        if (offset === 0) return value;
        if (Array.isArray(value)) {
            return value.map((item) => this.shiftPageNumberDeep(item, offset)) as T;
        }

        const record = this.asRecord(value);
        if (!record) return value;

        const shifted: Record<string, unknown> = {};
        for (const [key, childValue] of Object.entries(record)) {
            if ((key === 'pageNumber' || key === 'page_number') && typeof childValue === 'number' && Number.isFinite(childValue)) {
                shifted[key] = childValue + offset;
                continue;
            }
            shifted[key] = this.shiftPageNumberDeep(childValue, offset);
        }
        return shifted as T;
    }

    private mergeAnalyzeResultsForMultiFile(
        items: Array<{ filename: string; engine: OcrEngine; analyzeResult: AnalyzeResult }>
    ): { engine: OcrEngine; analyzeResult: AnalyzeResult } {
        if (items.length === 0) {
            return {
                engine: 'di',
                analyzeResult: {
                    content: '',
                    pages: [],
                    paragraphs: [],
                    tables: [],
                    keyValuePairs: [],
                    documents: [],
                    styles: [],
                },
            };
        }

        const mergedPages: unknown[] = [];
        const mergedParagraphs: unknown[] = [];
        const mergedTables: unknown[] = [];
        const mergedKeyValuePairs: unknown[] = [];
        const mergedDocuments: unknown[] = [];
        const mergedStyles: unknown[] = [];
        const mergedContentSegments: string[] = [];

        let pageOffset = 0;
        let mergedEngine: OcrEngine = items[0].engine;

        for (const item of items) {
            if (item.engine !== mergedEngine) {
                mergedEngine = 'di';
            }

            const pages = Array.isArray(item.analyzeResult.pages) ? item.analyzeResult.pages : [];
            const paragraphs = Array.isArray(item.analyzeResult.paragraphs) ? item.analyzeResult.paragraphs : [];
            const tables = Array.isArray(item.analyzeResult.tables) ? item.analyzeResult.tables : [];
            const keyValuePairs = Array.isArray(item.analyzeResult.keyValuePairs) ? item.analyzeResult.keyValuePairs : [];
            const documents = Array.isArray(item.analyzeResult.documents) ? item.analyzeResult.documents : [];
            const styles = Array.isArray(item.analyzeResult.styles) ? item.analyzeResult.styles : [];

            const sourcePageCount = pages.length > 0 ? pages.length : 1;
            const startPageNumber = pageOffset + 1;

            const shiftedPages = pages.length > 0
                ? this.shiftPageNumberDeep(pages, pageOffset)
                : [{ pageNumber: startPageNumber, words: [] }];
            const shiftedParagraphs = this.shiftPageNumberDeep(paragraphs, pageOffset);
            const shiftedTables = this.shiftPageNumberDeep(tables, pageOffset);
            const shiftedKeyValuePairs = this.shiftPageNumberDeep(keyValuePairs, pageOffset);
            const shiftedDocuments = this.shiftPageNumberDeep(documents, pageOffset);
            const shiftedStyles = this.shiftPageNumberDeep(styles, pageOffset);

            const sourceMarkerParagraph = {
                content: `[SOURCE_FILE] ${item.filename}`,
                boundingRegions: [{ pageNumber: startPageNumber }],
            };

            mergedPages.push(...shiftedPages);
            mergedParagraphs.push(sourceMarkerParagraph, ...(Array.isArray(shiftedParagraphs) ? shiftedParagraphs : []));
            mergedTables.push(...(Array.isArray(shiftedTables) ? shiftedTables : []));
            mergedKeyValuePairs.push(...(Array.isArray(shiftedKeyValuePairs) ? shiftedKeyValuePairs : []));
            mergedDocuments.push(...(Array.isArray(shiftedDocuments) ? shiftedDocuments : []));
            mergedStyles.push(...(Array.isArray(shiftedStyles) ? shiftedStyles : []));

            mergedContentSegments.push(
                `--- SOURCE FILE: ${item.filename} ---\n${item.analyzeResult.content || ''}`
            );

            pageOffset += sourcePageCount;
        }

        return {
            engine: mergedEngine,
            analyzeResult: {
                content: mergedContentSegments.join('\n\n'),
                pages: mergedPages,
                paragraphs: mergedParagraphs,
                tables: mergedTables,
                keyValuePairs: mergedKeyValuePairs,
                documents: mergedDocuments,
                styles: mergedStyles,
            },
        };
    }

    private async resolveSourceToBuffer(fileSource: string | Buffer): Promise<Buffer> {
        if (Buffer.isBuffer(fileSource)) {
            return fileSource;
        }

        if (typeof fileSource === 'string' && fileSource.startsWith('http')) {
            const response = await fetch(fileSource);
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        }

        return Buffer.from(fileSource as string, 'base64');
    }

    async extractMergedSinglePass(
        sources: MultiFileSourceInput[],
        model: ExtractionModel
    ): Promise<MultiFileExtractResult> {
        if (!Array.isArray(sources) || sources.length === 0) {
            throw new Error('No sources provided for merged extraction');
        }

        const betaFeatures = model.beta_features || {};
        const configuredOcrEngine = this.resolveOcrEngine(model);
        const useVisionMode =
            configuredOcrEngine === 'vision' ||
            (betaFeatures as any).vision_extraction === true ||
            (betaFeatures as any).use_vision_extraction === true;

        const llmDeployment = await this.openai.getResolvedDeployment();

        if (useVisionMode) {
            if (sources.length > 1) {
                throw new Error('[VISION_MULTI_FILE_NOT_SUPPORTED] Vision(멀티모달) 엔진은 다중문서 통합추출(merged)에서 아직 지원하지 않습니다. separate 전략을 사용해주세요.');
            }

            const source = sources[0];
            const resolvedSource = typeof source.fileSource === 'function'
                ? await source.fileSource()
                : source.fileSource;
            const buffer = await this.resolveSourceToBuffer(resolvedSource);

            const vision = new VisionPipeline(this.openai);
            const visionResult = await vision.execute(model, buffer, source.filename);
            const sourceOcr: MultiFileOcrSummary[] = [{
                filename: source.filename,
                engine: 'vision',
                raw_content: visionResult.raw_content || '',
                page_count: 1,
            }];

            let finalResult: ExtractionResult = visionResult as unknown as ExtractionResult;
            if (finalResult && finalResult.guide_extracted) {
                finalResult.guide_extracted = this.validateAndFormat(
                    { guide_extracted: finalResult.guide_extracted },
                    model,
                    []
                );
            }
            finalResult = await this.executeHealingPass(
                finalResult,
                model,
                { content: finalResult.raw_content || '', pages: [] } as AnalyzeResult
            );
            const normalizedResult = await this.performDictionaryNormalization(finalResult, model);

            normalizedResult._debug_info = {
                ...(normalizedResult._debug_info || {}),
                extraction_path: 'vision',
                llm_model: (normalizedResult._debug_info as { llm_model?: string } | undefined)?.llm_model || llmDeployment,
                multi_file_single_pass: true,
                source_count: 1,
                source_ocr: sourceOcr,
            };
            normalizedResult.di_page_count = 1;
            normalizedResult.token_usage =
                normalizedResult.token_usage ||
                finalResult.token_usage ||
                (finalResult as { _debug_info?: { token_usage?: ExtractionResult['token_usage'] } })._debug_info?.token_usage;

            if (model.model_type !== 'comparison' && !this.hasMeaningfulGuideData(normalizedResult.guide_extracted as Record<string, unknown> | undefined)) {
                const emptyDiagnostics = this.diagnoseEmptyExtraction(finalResult, normalizedResult);
                const contentLength = typeof finalResult.raw_content === 'string' ? finalResult.raw_content.length : 0;
                console.warn(
                    `[EMPTY_EXTRACTION_REASON] engine=vision pages=1 content_len=${contentLength} reason=${emptyDiagnostics.reason} details=${JSON.stringify(emptyDiagnostics)}`
                );
                throw new Error(
                    `[EMPTY_EXTRACTION_RESULT] engine=vision pages=1 content_len=${contentLength} reason=${emptyDiagnostics.reason}`
                );
            }

            return {
                result: {
                    ...normalizedResult,
                    di_page_count: 1,
                    token_usage: normalizedResult.token_usage ||
                        finalResult.token_usage ||
                        (finalResult as { _debug_info?: { token_usage?: ExtractionResult['token_usage'] } })._debug_info?.token_usage,
                    llm_model: (normalizedResult._debug_info as { llm_model?: string } | undefined)?.llm_model || llmDeployment,
                },
                source_ocr: sourceOcr,
                extraction_path: 'vision',
            };
        }

        const sourceResults: Array<{ filename: string; engine: OcrEngine; analyzeResult: AnalyzeResult }> = [];
        const sourceOcr: MultiFileOcrSummary[] = [];

        for (const source of sources) {
            const resolvedSource = typeof source.fileSource === 'function'
                ? await source.fileSource()
                : source.fileSource;
            const { engine, analyzeResult } = await this.analyzeDocumentForExtraction(resolvedSource, model);
            sourceResults.push({
                filename: source.filename,
                engine,
                analyzeResult,
            });
            sourceOcr.push({
                filename: source.filename,
                engine,
                raw_content: analyzeResult.content || '',
                page_count: analyzeResult.pages?.length || 0,
            });
        }

        const { engine: extractionPath, analyzeResult: mergedAnalyzeResult } = this.mergeAnalyzeResultsForMultiFile(sourceResults);

        const rawResult = await this.extractFull(mergedAnalyzeResult, model, extractionPath);
        const healedResult = await this.executeHealingPass(rawResult, model, mergedAnalyzeResult);
        const normalizedResult = await this.performDictionaryNormalization(healedResult, model);

        normalizedResult._debug_info = {
            ...(normalizedResult._debug_info || {}),
            extraction_path: extractionPath,
            llm_model: (normalizedResult._debug_info as { llm_model?: string } | undefined)?.llm_model || llmDeployment,
            multi_file_single_pass: true,
            source_count: sources.length,
            source_ocr: sourceOcr,
        };
        normalizedResult.di_page_count = mergedAnalyzeResult.pages?.length || 0;
        normalizedResult.token_usage =
            normalizedResult.token_usage ||
            healedResult.token_usage ||
            (healedResult as { _debug_info?: { token_usage?: ExtractionResult['token_usage'] } })._debug_info?.token_usage;

        if (model.model_type !== 'comparison' && !this.hasMeaningfulGuideData(normalizedResult.guide_extracted as Record<string, unknown> | undefined)) {
            const emptyDiagnostics = this.diagnoseEmptyExtraction(healedResult, normalizedResult);
            const contentLength = mergedAnalyzeResult.content.length;
            const pageCount = mergedAnalyzeResult.pages?.length || 0;
            console.warn(
                `[EMPTY_EXTRACTION_REASON] engine=${extractionPath} pages=${pageCount} content_len=${contentLength} reason=${emptyDiagnostics.reason} details=${JSON.stringify(emptyDiagnostics)}`
            );
            const latestLlmMeta =
                this.getLatestLlmResponseMeta(normalizedResult) ||
                this.getLatestLlmResponseMeta(healedResult);
            if (latestLlmMeta) {
                console.warn(
                    `[EMPTY_EXTRACTION_LLM] engine=${extractionPath} pages=${pageCount} content_len=${contentLength} llm_meta=${JSON.stringify(latestLlmMeta)}`
                );
            }
            const emptyError = new Error(
                `[EMPTY_EXTRACTION_RESULT] engine=${extractionPath} pages=${pageCount} content_len=${contentLength} reason=${emptyDiagnostics.reason}`
            ) as Error & Record<string, unknown>;
            emptyError.extraction_path = extractionPath;
            emptyError.page_count = pageCount;
            emptyError.ocr_text_length = mergedAnalyzeResult.content.length;
            emptyError.ocr_text_preview = this.buildErrorOcrPreview(mergedAnalyzeResult.content || '');
            throw emptyError;
        }

        return {
            result: {
                ...normalizedResult,
                di_page_count: mergedAnalyzeResult.pages?.length || 0,
                token_usage: normalizedResult.token_usage ||
                    healedResult.token_usage ||
                    (healedResult as { _debug_info?: { token_usage?: ExtractionResult['token_usage'] } })._debug_info?.token_usage,
                llm_model: (normalizedResult._debug_info as { llm_model?: string } | undefined)?.llm_model || llmDeployment,
            },
            source_ocr: sourceOcr,
            extraction_path: extractionPath,
        };
    }

    async extract(
        fileSource: string | Buffer | (() => Promise<string | Buffer>),
        model: ExtractionModel,
        filename?: string
    ): Promise<ExtractionResult> {
        const activeCount = ExtractionService.globalLimit.activeCount;
        const pendingCount = ExtractionService.globalLimit.pendingCount;
        const startTime = Date.now();

        if (pendingCount > 0) {
            console.log(`[ExtractionService] QUEUE WAIT | 처리대기: ${pendingCount} | 현재작행: ${activeCount} | 파일: ${filename}`);
        }

        return ExtractionService.globalLimit(async () => {
            const queueWaitTime = Date.now() - startTime;
            if (queueWaitTime > 1000) {
                console.log(`[ExtractionService] QUEUE EXIT | 대기 완료 (${queueWaitTime}ms) | 시작: ${filename}`);
            }

            const llmDeployment = await this.openai.getResolvedDeployment();
            const maxAttempts = 3;
            let lastError: any;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                let attemptOcrContent = '';
                let attemptPageCount = 0;
                let attemptExtractionPath: 'excel' | 'vision' | 'di' | 'cu' = 'di';
                try {
                    const currentFileSource = typeof fileSource === 'function'
                        ? await fileSource()
                        : fileSource;
                    const betaFeatures = model.beta_features || {};
                    const configuredOcrEngine = this.resolveOcrEngine(model);
                    const useVision =
                        configuredOcrEngine === 'vision' ||
                        (betaFeatures as any).vision_extraction === true ||
                        (betaFeatures as any).use_vision_extraction === true;
                    const requestedUseBeta = (betaFeatures as any).use_optimized_prompt === true;

                    if (attempt > 1) {
                        console.log(`[ExtractionService] RETRY ATTEMPT ${attempt}/${maxAttempts} | 파일: ${filename}`);
                    }

                    if (requestedUseBeta) {
                        console.log(`[Extraction] Optimized Prompt [Beta] 파이프라인 사용중 (Model: ${model.name})`);
                    } else {
                        console.log(`[Extraction] Standard 파이프라인 사용중 (Model: ${model.name})`);
                    }

                    const isExcel = filename && (
                        filename.toLowerCase().endsWith('.xlsx') ||
                        filename.toLowerCase().endsWith('.xls') ||
                        filename.toLowerCase().endsWith('.csv')
                    );
                    let extractionPath: 'excel' | 'vision' | 'di' | 'cu' = 'di';

                    let finalResult: ExtractionResult;
                    let pageCount = 0; // 스코프 문제 해결을 위해 상단 선언
                    let contentLength = 0;

                    if (isExcel) {
                        extractionPath = 'excel';
                        attemptExtractionPath = extractionPath;
                        const { ExcelParserService } = await import('./ExcelParserService');
                        const excelParser = new ExcelParserService();

                        let buffer: Buffer;
                        if (Buffer.isBuffer(currentFileSource)) {
                            buffer = currentFileSource;
                        } else if (typeof currentFileSource === 'string' && currentFileSource.startsWith('http')) {
                            try {
                                const res = await fetch(currentFileSource);
                                const arrayBuffer = await res.arrayBuffer();
                                buffer = Buffer.from(arrayBuffer);
                            } catch (fetchErr: any) {
                                console.error(`[Extraction] Excel fetch failed for ${currentFileSource}:`, fetchErr);
                                throw new Error(`파일을 가져오는데 실패했습니다. (랜딩존 환경의 경우 SDK Buffer 방식을 사용하십시오): ${fetchErr.message}`);
                            }
                        } else {
                            buffer = Buffer.from(currentFileSource as string, 'base64');
                        }

                        const { getLLMSettings } = await import('@/actions/llmSettings');
                        const settings = await getLLMSettings();

                        const excelResult = await excelParser.parse(buffer);
                        const baseResult = await this.extractFromExcel(excelResult, model, settings);
                        finalResult = await this.executeHealingPass(baseResult, model, { content: excelResult.content, pages: [] } as any);
                        pageCount = 1; // 엑셀 기본값
                        contentLength = typeof excelResult.content === 'string' ? excelResult.content.length : 0;
                        attemptOcrContent = excelResult.content || '';
                        attemptPageCount = pageCount;
                    } else if (useVision) {
                        extractionPath = 'vision';
                        attemptExtractionPath = extractionPath;
                        const vision = new VisionPipeline(this.openai);

                        let buffer: Buffer;
                        if (Buffer.isBuffer(currentFileSource)) {
                            buffer = currentFileSource;
                        } else if (typeof currentFileSource === 'string' && currentFileSource.startsWith('http')) {
                            try {
                                const res = await fetch(currentFileSource);
                                const arrayBuffer = await res.arrayBuffer();
                                buffer = Buffer.from(arrayBuffer);
                            } catch (fetchErr: any) {
                                console.error(`[Extraction] Vision fetch failed for ${currentFileSource}:`, fetchErr);
                                throw new Error(`이미지 파일을 가져오는데 실패했습니다. (랜딩존 환경의 경우 SDK Buffer 방식을 사용하십시오): ${fetchErr.message}`);
                            }
                        } else {
                            buffer = Buffer.from(currentFileSource as string, 'base64');
                        }

                        const filenameOut = filename || "document.jpg";
                        const visionResult = await vision.execute(model, buffer, filenameOut);

                        // Vision 결과에서 페이지 수 및 토큰 사용량 추출
                        pageCount = 1; // Vision은 현재 단일 이미지 기준
                        const tokenUsage = visionResult.token_usage;

                        if (visionResult && visionResult.guide_extracted) {
                            visionResult.guide_extracted = this.validateAndFormat(
                                { guide_extracted: visionResult.guide_extracted },
                                model,
                                []
                            );
                        }
                        // 정규화는 나중에 공통 단계에서 수행
                        finalResult = await this.executeHealingPass(visionResult as any, model, { content: visionResult.raw_content || "", pages: [] } as any);
                        contentLength = typeof visionResult.raw_content === 'string' ? visionResult.raw_content.length : 0;
                        attemptOcrContent = visionResult.raw_content || '';
                        attemptPageCount = pageCount;

                        // 메타데이터 병합
                        finalResult.di_page_count = pageCount;
                        finalResult.token_usage = tokenUsage;
                    } else {
                        // 1. OCR Analysis (DI/CU 선택)
                        const { engine, analyzeResult } = await this.analyzeDocumentForExtraction(currentFileSource, model);
                        extractionPath = engine;
                        attemptExtractionPath = extractionPath;
                        contentLength = analyzeResult.content.length;
                        pageCount = analyzeResult.pages?.length || 0;
                        attemptOcrContent = analyzeResult.content || '';
                        attemptPageCount = pageCount;
                        const useBeta = requestedUseBeta && engine === 'di';
                        if (requestedUseBeta && engine !== 'di') {
                            console.warn('[Extraction] CU 엔진에서는 Optimized Prompt [Beta] 파이프라인을 비활성화합니다.');
                        }

                        if (useBeta) {
                            const beta = new BetaPipeline(this.openai);
                            const betaResult = await beta.execute(model, analyzeResult, []);

                            // BetaPipeline 결과에 스키마 기반 필드 보정 수행
                            if (betaResult && betaResult.guide_extracted) {
                                betaResult.guide_extracted = this.validateAndFormat(
                                    { guide_extracted: betaResult.guide_extracted },
                                    model,
                                    analyzeResult.pages || []
                                );
                            }
                            finalResult = await this.executeHealingPass(betaResult as any, model, analyzeResult);
                        } else {
                            // 2. Decide Strategy (Simple vs Chunked)
                            const proactiveChunkReason = this.getProactiveChunkReason(
                                engine,
                                contentLength,
                                pageCount,
                                model,
                                llmDeployment
                            );
                            const shouldUseChunked = engine !== 'di' && proactiveChunkReason !== null;
                            let rawResult: ExtractionResult;
                            if (shouldUseChunked) {
                                console.log(
                                    `[Extraction] 선제 Chunked 적용 | engine=${engine} | pages=${pageCount} | ` +
                                    `content_len=${contentLength} | reason=${proactiveChunkReason}`
                                );
                                rawResult = await this.extractChunked(analyzeResult, model);
                            } else {
                                try {
                                    rawResult = await this.extractFull(analyzeResult, model, engine);
                                } catch (fullError) {
                                    if (engine !== 'di' && this.chunkFallbackEnabled && this.isChunkFallbackTarget(fullError)) {
                                        const errorMessage = fullError instanceof Error ? fullError.message : String(fullError);
                                        console.warn(
                                            `[Extraction] Full extraction 실패 감지. Chunked로 폴백합니다. ` +
                                            `engine=${engine} | pages=${pageCount} | content_len=${contentLength} | reason=${errorMessage}`
                                        );
                                        rawResult = await this.extractChunked(analyzeResult, model);
                                    } else {
                                        throw fullError;
                                    }
                                }
                            }

                            finalResult = await this.executeHealingPass(rawResult, model, analyzeResult);
                        }

                        // 메타데이터 병합
                        finalResult.di_page_count = pageCount;
                        finalResult.token_usage = finalResult.token_usage || (finalResult as any)._debug_info?.token_usage;
                    }

                    // 3. 공통 최종 단계: 딕셔너리 정규화 수행 (Healing Pass 결과 포함)
                    const normalizedResult = await this.performDictionaryNormalization(finalResult, model);
                    normalizedResult._debug_info = {
                        ...(normalizedResult._debug_info || {}),
                        extraction_path: extractionPath,
                        llm_model: (normalizedResult._debug_info as { llm_model?: string } | undefined)?.llm_model || llmDeployment,
                    };

                    // 리턴 객체에 메타데이터가 포함되어 있는지 최종 보장
                    normalizedResult.di_page_count = pageCount;
                    normalizedResult.token_usage = normalizedResult.token_usage || (finalResult as any).token_usage || (finalResult as any)._debug_info?.token_usage;

                    if (model.model_type !== 'comparison' && !this.hasMeaningfulGuideData(normalizedResult.guide_extracted as Record<string, unknown> | undefined)) {
                        const emptyDiagnostics = this.diagnoseEmptyExtraction(finalResult, normalizedResult);
                        console.warn(
                            `[EMPTY_EXTRACTION_REASON] engine=${extractionPath} pages=${pageCount} content_len=${contentLength} reason=${emptyDiagnostics.reason} details=${JSON.stringify(emptyDiagnostics)}`
                        );
                        const latestLlmMeta =
                            this.getLatestLlmResponseMeta(normalizedResult) ||
                            this.getLatestLlmResponseMeta(finalResult);
                        if (latestLlmMeta) {
                            console.warn(
                                `[EMPTY_EXTRACTION_LLM] engine=${extractionPath} pages=${pageCount} content_len=${contentLength} llm_meta=${JSON.stringify(latestLlmMeta)}`
                            );
                        }
                        const emptyError = new Error(
                            `[EMPTY_EXTRACTION_RESULT] engine=${extractionPath} pages=${pageCount} content_len=${contentLength} reason=${emptyDiagnostics.reason}`
                        ) as Error & Record<string, unknown>;
                        emptyError.extraction_path = extractionPath;
                        emptyError.page_count = pageCount;
                        emptyError.ocr_text_length = attemptOcrContent.length;
                        emptyError.ocr_text_preview = this.buildErrorOcrPreview(attemptOcrContent);
                        throw emptyError;
                    }

                    const totalElapsed = Date.now() - startTime;
                    console.log(`[ExtractionService] JOB FINISHED | 소요시간: ${totalElapsed}ms (대기: ${queueWaitTime}ms) | 파일: ${filename} | pages: ${pageCount}`);

                    return {
                        ...normalizedResult,
                        di_page_count: pageCount,
                        token_usage: normalizedResult.token_usage || (finalResult as any).token_usage || (finalResult as any)._debug_info?.token_usage,
                        llm_model: (normalizedResult._debug_info as { llm_model?: string } | undefined)?.llm_model || llmDeployment,
                    };

                } catch (err: any) {
                    if (err && typeof err === 'object') {
                        const errRecord = err as Record<string, unknown>;
                        if (typeof errRecord.extraction_path !== 'string') {
                            errRecord.extraction_path = attemptExtractionPath;
                        }
                        if (typeof errRecord.page_count !== 'number' && attemptPageCount > 0) {
                            errRecord.page_count = attemptPageCount;
                        }
                        if (attemptOcrContent) {
                            if (typeof errRecord.ocr_text_length !== 'number') {
                                errRecord.ocr_text_length = attemptOcrContent.length;
                            }
                            if (typeof errRecord.ocr_text_preview !== 'string') {
                                errRecord.ocr_text_preview = this.buildErrorOcrPreview(attemptOcrContent);
                            }
                        }
                    }
                    lastError = err;
                    const errorElapsed = Date.now() - startTime;
                    console.warn(`[ExtractionService] ATTEMPT ${attempt} FAILED | 소요시간: ${errorElapsed}ms | 파일: ${filename} | 에러:`, err.message || err);

                    if (attempt < maxAttempts) {
                        const delay = attempt * 2000;
                        console.log(`[ExtractionService] ${delay}ms 후 재시도합니다...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }

            console.error(`[ExtractionService] ALL ${maxAttempts} ATTEMPTS FAILED | 파일: ${filename}`);
            throw lastError;
        });
    }

    async compare(
        baselineUrl: string,
        candidateUrls: string[],
        _model: ExtractionModel
    ): Promise<ExtractionResult> {

        void _model;
        const llmDeployment = await this.openai.getResolvedDeployment();
        const comparison_results = [];

        for (let idx = 0; idx < candidateUrls.length; idx++) {
            const c_url = candidateUrls[idx];

            try {
                const res = await this.openai.compareImages(baselineUrl, c_url);
                comparison_results.push({
                    candidate_index: idx,
                    file_url: c_url,
                    result: res
                });
            } catch (error: any) {
                console.error(`[Extraction] Comparison failed for candidate ${idx + 1}:`, error);
                comparison_results.push({
                    candidate_index: idx,
                    file_url: c_url,
                    error: error.message || String(error),
                    result: { differences: [] }
                });
            }
        }

        return {
            guide_extracted: { comparisons: comparison_results } as any,
            other_data: [],
            raw_content: '',
            comparisons: comparison_results,
            mode: 'comparison',
            comparison_count: candidateUrls.length,
            _debug_info: {
                llm_model: llmDeployment,
            },
            llm_model: llmDeployment,
        };
    }

    // --- Full Extraction Strategy ---
    private async extractFull(
        ocrData: AnalyzeResult,
        model: ExtractionModel,
        engine: OcrEngine
    ): Promise<ExtractionResult> {
        const { getLLMSettings } = await import('@/actions/llmSettings');
        const settings = await getLLMSettings();
        const prompt = this.buildPrompt(ocrData, model, settings.extraction_system);
        const estimatedPromptTokens = this.estimatePromptTokens(prompt);

        if (this.isLikelyPromptTooLarge(prompt)) {
            throw new Error(`[PROMPT_TOO_LARGE] estimated_tokens=${estimatedPromptTokens}`);
        }

        try {
            const messages = [
                { role: 'system' as const, content: settings.extraction_system_role || 'You are a precise document data extractor. Return only valid JSON.' },
                { role: 'user' as const, content: prompt }
            ];
            const startLLM = Date.now();

            const hasTableFields = model.fields.some(f => f.type === 'table');
            const dynamicMaxTokens = hasTableFields ? 16384 : 8192;
            const useStreamForFull = engine !== 'di';
            const llmRequestBody = {
                extraction_mode: 'full',
                json_mode: true,
                max_tokens: dynamicMaxTokens,
                use_stream: useStreamForFull,
                messages,
            };

            const response = await this.openai.getCompletion(
                messages,
                undefined,
                true,
                dynamicMaxTokens,
                0.0,
                42,
                useStreamForFull
            );

            const llmElapsed = Date.now() - startLLM;
            const content = response.choices[0].message.content;
            if (!content) throw new Error('Empty response from LLM');

            const rawJson = JSON.parse(content);
            const validated = this.validateAndFormat(rawJson, model, ocrData.pages || []);

            return {
                guide_extracted: validated,
                other_data: rawJson.other_data || [],
                raw_content: ocrData.content,
                raw_tables: ocrData.tables,
                _chunked: false,
                token_usage: response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                _debug_info: {
                    token_usage: response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                    llm_request_bodies: [llmRequestBody],
                    llm_response_bodies: [
                        this.buildLlmResponseBody('full', response, content, {
                            llm_elapsed_ms: llmElapsed,
                        }),
                    ],
                    llm_response_meta: [
                        this.buildLlmResponseMeta('full', response, content, {
                            llm_elapsed_ms: llmElapsed,
                        }),
                    ],
                }
            };

        } catch (e) {
            console.error('[Extraction] Full extraction failed', e);
            throw e;
        }
    }

    // --- Excel Extraction Strategy ---

    /**
     * Helper to extract data from an Excel chunk (subset of rows)
     */
    private async _extractExcelChunk(
        chunkRows: any[],
        sheetName: string,
        model: ExtractionModel,
        settings: LLMSettings,
        fieldDescriptions: string,
        headerContext: string,
        validColIndices: number[],
        sheetRowsForColumnMapping: any[][]
    ): Promise<ExtractionResult> {
        // Generate JSON context for this page (Excel rows)
        const pageRowIndices = chunkRows
            .map((row: any) => Number((row as any)._originalRowIdx))
            .filter((idx: number) => !Number.isNaN(idx));
        const allowedRowSet = new Set<number>(pageRowIndices);
        const pageRowRange = pageRowIndices.length > 0
            ? `${Math.min(...pageRowIndices)}~${Math.max(...pageRowIndices)}`
            : 'unknown';

        const colLetters = validColIndices.map(c => {
            let label = '';
            let temp = c;
            while (temp >= 0) {
                label = String.fromCharCode((temp % 26) + 65) + label;
                temp = Math.floor(temp / 26) - 1;
            }
            return label;
        });
        const rowsJson: Array<Record<string, unknown>> = [];

        chunkRows.forEach((row) => {
            const originalRowIdx = (row as any)._originalRowIdx;

            // Skip empty rows to match UI
            const isRowEmpty = validColIndices.every(c => row[c] === undefined || row[c] === '' || row[c] === null);
            if (isRowEmpty) return;

            const rowObj: Record<string, unknown> = { __row: originalRowIdx };
            validColIndices.forEach((c, i) => {
                const val = row[c];
                rowObj[colLetters[i]] = (val === undefined || val === null || val === '') ? null : val;
            });
            rowsJson.push(rowObj);
        });
        const pageJsonContext = JSON.stringify(
            {
                sheet: sheetName,
                columns: colLetters,
                rows: rowsJson
            },
            null,
            2
        );

        const deterministicColumnMapByField = new Map<string, Map<string, number>>();
        const deterministicMappingView: Array<{
            table_field: string;
            mappings: Array<{
                sub_field: string;
                column_letter: string;
                header_signature: string;
                score: number;
            }>;
        }> = [];
        for (const field of model.fields) {
            if (field.type !== 'table' || !field.sub_fields || field.sub_fields.length === 0) continue;

            const mapped = ExcelDeterministicMapper.mapSubFieldsToColumns({
                sheetRows: sheetRowsForColumnMapping,
                validColIndices,
                subFields: field.sub_fields.map(sub => ({ key: sub.key, label: sub.label })),
                headerRowLimit: 24
            });

            deterministicColumnMapByField.set(field.key, mapped.subFieldToColumnIndex);
            deterministicMappingView.push({
                table_field: field.key,
                mappings: mapped.mappings.map((m) => ({
                    sub_field: m.subFieldKey,
                    column_letter: m.columnLetter,
                    header_signature: m.headerSignature,
                    score: m.score
                }))
            });
        }
        const deterministicMappingContext = JSON.stringify(deterministicMappingView, null, 2);

        // ⚠️ IMPORTANT: Excel 청크에서는 settings.extraction_system(OCR/PDF용)을 절대 사용하면 안 됨.
        // settings.extraction_system은 table 배열 추출 지시 없는 범용 프롬프트이므로
        // Rate_List 같은 table 타입 필드가 빈값으로 반환되는 원인이 됨.
        // Excel 청크 전용 프롬프트를 항상 사용하고, extraction_system_role만 settings에서 가져옴.
        const excelChunkPrompt = [
            `You are an expert data extractor parsing Excel sheet data.`,
            `The data is provided below as JSON with Row indices (\`__row\`) and Column letters (A, B, C...).`,
            ``,
            `Extract these fields:`,
            fieldDescriptions,
            model.global_rules ? `\nGlobal Rules:\n${model.global_rules}` : '',
            model.reference_data ? `\nReference Data:\n${JSON.stringify(model.reference_data, null, 2)}` : '',
            ``,
            `JSON Page Data:`,
            pageJsonContext,
            ``,
            `Current Page Scope (STRICT):`,
            `- Allowed row indices for this page: [${pageRowIndices.join(', ')}]`,
            `- Allowed row range for this page: ${pageRowRange}`,
            `- You MUST output table rows only for the allowed row indices above.`,
            `- If a candidate row is outside this page scope, ignore it.`,
            ``,
            `JSON Header/Sample Context (structure-only reference):`,
            headerContext,
            ``,
            `Deterministic Column Mapping (STRICT):`,
            deterministicMappingContext,
            `- If a sub-field has mapped column info, extract from that mapped column first.`,
            `- If mapped source cell is empty, return null for that sub-field.`,
            ``,
            `INSTRUCTIONS:`,
            `1. **CRITICAL: You MUST extract ALL relevant rows. Do not summarize or skip.**`,
            `2. Table header structure:`,
            `   - Identify header rows (e.g., Row 9 has "POL", Row 10 has "Code"). Map them correctly to the target fields.`,
            `   - Column letters (A, B, C...) are the primary spatial reference.`,
            `3. Excel Specifics:`,
            `   - Date Serials: Excel stores dates as serial numbers (e.g., 45931 = 2025-10-01). If you see a 5-digit number in a date column, convert it to a date string.`,
            `4. **NO GUESSING / NO IMPUTATION (CRITICAL):**`,
            `   - If a source cell is empty, output null. Never infer from nearby rows/columns/patterns.`,
            `   - Do NOT carry-forward values from previous/next rows unless a field rule explicitly says to do so.`,
            `   - For non-required fields, empty source means null.`,
            `5. **REFERENCE DATA USAGE (CRITICAL):**`,
            `   - Use reference_data only for validation/disambiguation.`,
            `   - Do NOT use reference_data to populate an empty source cell unless a field rule explicitly requires fallback/default filling.`,
            `6. For "table" type fields, return a COMPACT array of objects.`,
            `   - For EACH row, you MUST include a \`__row\` property with the row number from JSON Page Data.`,
            `   - If sub-fields are defined, include every sub-field key in each row object. Use null for missing cells.`,
            `   - Example row: { "__row": 11, "carrier": "...", "pol": "...", "rate_20dc": null }`,
            `   - NEVER generate rows not present in this page's allowed row indices.`,
            `   - Do NOT include metadata like confidence/bbox inside row objects.`,
            `7. Extract actual values only from "JSON Page Data.rows".`,
            `8. "JSON Header/Sample Context" is schema-only helper. Do NOT extract data from it.`,
            `9. Return valid JSON: { "guide_extracted": { "key": ... }, "other_data": [] }`,
        ].join('\n');

        const prompt = excelChunkPrompt;

        // 엑셀 추출은 관리자 Role 프롬프트 커스터마이징의 영향을 받지 않도록 고정 role을 사용한다.
        // (운영 중 role 문구가 "추정/보완"을 유도하면 빈 셀 채움 문제가 재발할 수 있음)
        const excelSystemRole = [
            'You are a strict Excel data extractor.',
            'Return ONLY valid JSON.',
            'Never invent, infer, extrapolate, or impute missing values.',
            'If a source cell is empty, output null.',
            'Never use reference_data to fill blank cells unless a field rule explicitly requires fallback/default filling.',
        ].join(' ');

        const messages = [
            { role: 'system' as const, content: excelSystemRole },
            { role: 'user' as const, content: prompt }
        ];


        // max_tokens를 16,384로 조정 (응답 안정성과 토큰 예산 균형)
        const hasTableFields = model.fields.some(f => f.type === 'table');
        const dynamicMaxTokens = hasTableFields ? 16384 : 8192;
        const llmRequestBody = {
            extraction_mode: 'excel_chunk',
            sheet_name: sheetName,
            json_mode: true,
            max_tokens: dynamicMaxTokens,
            messages,
        };
        const response = await this.openai.getCompletion(messages, undefined, true, dynamicMaxTokens, 0.0, 42, true);
        const content = response.choices[0].message.content;
        if (!content) {
            const finishReason = response.choices[0].finish_reason;
            const refusal = (response.choices[0].message as any)?.refusal;
            console.error(
                `[Extraction] Empty response from LLM (Sheet: ${sheetName}, rows: ${chunkRows.length}, max_tokens: ${dynamicMaxTokens}, finish_reason: ${finishReason || 'unknown'}, refusal: ${refusal || 'none'})`
            );
            throw new Error(
                `[EXCEL_EMPTY_RESPONSE] Sheet=${sheetName}, rows=${chunkRows.length}, max_tokens=${dynamicMaxTokens}, finish_reason=${finishReason || 'unknown'}`
            );
        }
        const finishReason = response.choices[0].finish_reason;
        if (finishReason === 'length') {
            throw new Error(
                `[EXCEL_RESPONSE_TRUNCATED] Sheet=${sheetName}, rows=${chunkRows.length}, max_tokens=${dynamicMaxTokens}`
            );
        }

        // JSON 파싱 실패 시 응답 잘림 여부를 명시적으로 로그 출력
        let rawJson: any;
        try {
            rawJson = JSON.parse(content);
        } catch (parseError) {
            console.error(`[Extraction] JSON 파싱 실패 (Sheet: ${sheetName}). 응답이 max_tokens(${dynamicMaxTokens}) 제한으로 인해 잘렸을 가능성이 있습니다.`);
            const parseMessage = parseError instanceof Error ? parseError.message : String(parseError);
            throw new Error(
                `[EXCEL_JSON_PARSE_ERROR] Sheet=${sheetName}, rows=${chunkRows.length}, max_tokens=${dynamicMaxTokens}, message=${parseMessage}`
            );
        }
        const guide = rawJson.guide_extracted || {};

        const guideMap = new Map<string, any>();
        // 보다 유연한 매핑을 위해 영숫자(a-z0-9)만 남기고 비교
        Object.entries(guide).forEach(([k, v]) => guideMap.set(k.toLowerCase().replace(/[^a-z0-9]/g, ''), v));
        const hydratedGuide: any = {};
        const sourceRowByOriginalIndex = new Map<number, any[]>();
        chunkRows.forEach((sourceRow: any[]) => {
            const originalRowIdx = Number((sourceRow as any)._originalRowIdx);
            if (!Number.isNaN(originalRowIdx)) {
                sourceRowByOriginalIndex.set(originalRowIdx, sourceRow);
            }
        });

        for (const field of model.fields) {
            const fieldKeyLower = field.key.toLowerCase().replace(/[^a-z0-9]/g, '');
            const rawVal = guide[field.key] ?? guideMap.get(fieldKeyLower);

            if (field.type === 'table') {
                const rows = Array.isArray(rawVal) ? rawVal : [];
                const hasDeclaredSubFields = field.sub_fields && field.sub_fields.length > 0;
                const subFieldColumnMap = hasDeclaredSubFields
                    ? (deterministicColumnMapByField.get(field.key) || new Map<string, number>())
                    : new Map<string, number>();
                let sourceBoundCount = 0;
                let outOfPageRowDropCount = 0;

                const hydratedRows = rows.flatMap((row: any, idx) => {
                    const hydratedRow: any = {};
                    const rowMap = new Map<string, any>();
                    Object.entries(row).forEach(([rk, rv]) => rowMap.set(this.normalizeExcelToken(rk), rv));

                    const rowIdxVal = row['__row'] ?? rowMap.get('row') ?? (chunkRows[idx] as any)?._originalRowIdx ?? (idx + 11);
                    const rowIdx = Number(rowIdxVal);
                    if (!Number.isNaN(rowIdx) && allowedRowSet.size > 0 && !allowedRowSet.has(rowIdx)) {
                        outOfPageRowDropCount++;
                        return [];
                    }
                    const sourceRow = sourceRowByOriginalIndex.get(rowIdx) ?? sourceRowByOriginalIndex.get(rowIdx - 1);

                    if (hasDeclaredSubFields) {
                        // sub_fields가 정의된 경우: 모델의 sub_fields 키로 매핑
                        field.sub_fields!.forEach(sub => {
                            const subKeyLower = this.normalizeExcelToken(sub.key);
                            const val = row[sub.key] ?? rowMap.get(subKeyLower);
                            const mappedColIdx = subFieldColumnMap.get(sub.key);
                            const sourceCell = (mappedColIdx !== undefined && sourceRow) ? sourceRow[mappedColIdx] : undefined;
                            let normalizedValue = (val !== undefined ? val : null);

                            if (mappedColIdx !== undefined && sourceRow !== undefined) {
                                if (sub.type === 'date' && typeof val === 'string' && val.trim() !== '') {
                                    normalizedValue = val;
                                } else {
                                    normalizedValue = this.isEmptyExcelCell(sourceCell) ? null : sourceCell;
                                }
                                sourceBoundCount++;
                            }

                            hydratedRow[sub.key] = {
                                value: normalizedValue,
                                confidence: 0.95,
                                bbox: [0, rowIdx * 50, 1000, (rowIdx + 1) * 50],
                                page_number: 1,
                                type: sub.type
                            };
                        });
                    } else {
                        // sub_fields가 없는 경우: LLM이 반환한 row의 모든 키를 그대로 사용
                        // (__row, __metadata 등 내부 메타 키는 제외)
                        const skipKeys = new Set(['__row', '__metadata', 'bbox', 'confidence', 'page_number']);
                        Object.entries(row).forEach(([rk, rv]) => {
                            if (skipKeys.has(rk)) return;
                            hydratedRow[rk] = {
                                value: rv !== undefined ? rv : null,
                                confidence: 0.95,
                                bbox: [0, rowIdx * 50, 1000, (rowIdx + 1) * 50],
                                page_number: 1,
                                type: 'text'
                            };
                        });
                    }
                    return [hydratedRow];
                });

                if (sourceBoundCount > 0) {
                    console.warn(
                        `[Extraction] Excel deterministic column binding applied ` +
                        `(Sheet: ${sheetName}, Field: ${field.key}, BoundCells: ${sourceBoundCount})`
                    );
                }
                if (outOfPageRowDropCount > 0) {
                    console.warn(
                        `[Extraction] Excel out-of-page rows dropped ` +
                        `(Sheet: ${sheetName}, Field: ${field.key}, Dropped: ${outOfPageRowDropCount}, AllowedRange: ${pageRowRange})`
                    );
                }

                hydratedGuide[field.key] = {
                    value: hydratedRows,
                    confidence: 0.95,
                    bbox: [0, 0, 1000, Math.max(hydratedRows.length * 50, 500)],
                    page_number: 1,
                    type: 'table'
                };
            } else {
                const valObj = (rawVal && typeof rawVal === 'object' && 'value' in rawVal) ? rawVal : { value: rawVal };
                hydratedGuide[field.key] = {
                    value: valObj.value !== undefined ? valObj.value : null,
                    confidence: valObj.confidence ?? 0.8,
                    bbox: [0, 0, 1000, 50],
                    page_number: 1,
                    type: field.type
                };
            }
        }

        return {
            guide_extracted: hydratedGuide,
            other_data: rawJson.other_data || [],
            raw_content: pageJsonContext,
            raw_tables: [],
            _chunked: true,
            token_usage: response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            _debug_info: {
                token_usage: response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                raw_json: rawJson,
                llm_request_bodies: [llmRequestBody],
                llm_response_bodies: [
                    this.buildLlmResponseBody('excel_chunk', response, content, {
                        sheet_name: sheetName,
                        row_count: chunkRows.length,
                    }),
                ],
                llm_response_meta: [
                    this.buildLlmResponseMeta('excel_chunk', response, content, {
                        sheet_name: sheetName,
                        row_count: chunkRows.length,
                    }),
                ],
            }
        };
    }

    private isExcelChunkSplitRetryTarget(error: Error): boolean {
        const message = error.message || '';
        return (
            message.includes('[EXCEL_RESPONSE_TRUNCATED]') ||
            message.includes('[EXCEL_JSON_PARSE_ERROR]') ||
            message.includes('[EXCEL_EMPTY_RESPONSE]') ||
            message.includes('Empty response from LLM') ||
            message.includes('Unterminated string in JSON')
        );
    }

    private async extractExcelChunkWithAdaptiveSplit(
        chunkRows: any[],
        sheetName: string,
        model: ExtractionModel,
        settings: LLMSettings,
        fieldDescriptions: string,
        headerContext: string,
        validColIndices: number[],
        sheetRowsForColumnMapping: any[][],
        splitDepth: number = 0
    ): Promise<ExtractionResult[]> {
        try {
            const res = await this._extractExcelChunk(
                chunkRows,
                sheetName,
                model,
                settings,
                fieldDescriptions,
                headerContext,
                validColIndices,
                sheetRowsForColumnMapping
            );
            return [res];
        } catch (error) {
            if (!(error instanceof Error) || !this.isExcelChunkSplitRetryTarget(error)) {
                throw error;
            }

            const chunkSize = chunkRows.length;
            const maxSplitDepth = 6;
            const minChunkSizeForSplit = 20;
            const canSplit = chunkSize > minChunkSizeForSplit && splitDepth < maxSplitDepth;

            if (!canSplit) {
                console.error(
                    `[Extraction] Excel 청크 분할 재시도 한계 도달 (Sheet: ${sheetName}, rows: ${chunkSize}, depth: ${splitDepth}). 원본 에러를 전파합니다.`
                );
                throw error;
            }

            const splitPoint = Math.floor(chunkSize / 2);
            if (splitPoint <= 0 || splitPoint >= chunkSize) {
                throw error;
            }

            console.warn(
                `[Extraction] Excel 청크 반분할 재시도 (Sheet: ${sheetName}, depth: ${splitDepth + 1}, rows: ${chunkSize} -> ${splitPoint} + ${chunkSize - splitPoint})`
            );

            const leftRows = chunkRows.slice(0, splitPoint);
            const rightRows = chunkRows.slice(splitPoint);

            const leftResults = await this.extractExcelChunkWithAdaptiveSplit(
                leftRows,
                sheetName,
                model,
                settings,
                fieldDescriptions,
                headerContext,
                validColIndices,
                sheetRowsForColumnMapping,
                splitDepth + 1
            );
            const rightResults = await this.extractExcelChunkWithAdaptiveSplit(
                rightRows,
                sheetName,
                model,
                settings,
                fieldDescriptions,
                headerContext,
                validColIndices,
                sheetRowsForColumnMapping,
                splitDepth + 1
            );
            return [...leftResults, ...rightResults];
        }
    }

    private async extractFromExcel(
        excelData: any, // ExcelParserResult
        model: ExtractionModel,
        settings: LLMSettings
    ): Promise<ExtractionResult> {
        const fieldDescriptions = model.fields.map(f => {
            let instruction = `- ${f.key} (${f.type}): ${f.label}`;
            const rules: string[] = [];
            if (f.description) instruction += ` Description: ${f.description}`;
            if (f.rules) rules.push(f.rules);
            if (f.is_required) {
                instruction += " [REQUIRED FIELD]";
                rules.push("This field is MANDATORY. If not found, explicitly state why.");
            }
            if (rules.length > 0) instruction += ` Rules: ${rules.join('; ')}`;
            if (f.type === 'table' && f.sub_fields && f.sub_fields.length > 0) {
                instruction += `\n  * Sub-fields for ${f.key}:\n`;
                f.sub_fields.forEach(sub => {
                    let subInst = `    - ${sub.key} (${sub.type}): ${sub.label}`;
                    if (sub.description) subInst += ` Description: ${sub.description}`;
                    const subRules: string[] = [];
                    if (sub.is_required) subRules.push('REQUIRED');
                    if (sub.rules) subRules.push(sub.rules);
                    if (subRules.length > 0) subInst += ` [${subRules.join(', ')}]`;
                    instruction += subInst + '\n';
                });
            }
            return instruction;
        }).join('\n');

        // rawMatrix: header:1(배열 모드)로 파싱된 데이터 → UI 마크다운과 동일한 소스
        // rawData(객체 모드)를 쓰면 __EMPTY_N 키가 LLM에 전달되어 추출 실패 원인이 됨
        const rawMatrixMap: Record<string, any[][]> = excelData.rawMatrix || {};
        const allResults: ExtractionResult[] = [];
        const llmJsonContexts: string[] = [];
        // table 타입 필드가 있는 경우 페이지 크기를 더 작게 잡아 안정성 확보
        // (기존 반분할 청크 재시도는 행 컨텍스트 드리프트를 유발할 수 있어 기본 경로에서 제외)
        const hasTableFields = model.fields.some(f => f.type === 'table');
        const isGpt5Model = this.isGpt5FamilyModel(settings.current_model);
        const PAGE_SIZE = hasTableFields
            ? (isGpt5Model ? 30 : 50)
            : (isGpt5Model ? 120 : 250);

        for (const sheetName of excelData.sheetNames) {
            const allRows: any[][] = rawMatrixMap[sheetName] || [];
            if (allRows.length === 0) continue;

            // UI와 동일하게 유효 컬럼 계산 (최소 1개 값이 있는 컬럼만)
            const maxCols = Math.max(...allRows.map(r => r.length), 0);
            const validColIndices: number[] = [];
            for (let c = 0; c < maxCols; c++) {
                const hasData = allRows.some(r => r[c] !== undefined && r[c] !== null && r[c] !== '');
                if (hasData) validColIndices.push(c);
            }

            if (validColIndices.length === 0) continue;

            // 빈행 정리: 실제 값이 있는 행만 추출 대상으로 사용한다.
            const nonEmptyRows = allRows
                .map((row, originalRowIdx) => {
                    const rowArr = [...row];
                    (rowArr as any)._originalRowIdx = originalRowIdx;
                    return rowArr;
                })
                .filter((row: any[]) => {
                    return !validColIndices.every(c => row[c] === undefined || row[c] === null || row[c] === '');
                });

            if (nonEmptyRows.length === 0) continue;

            // headerContext: 시트 상단을 JSON으로 변환하여 LLM에 컬럼 구조 안내
            const colLettersForContext = validColIndices.map(c => {
                let label = '';
                let temp = c;
                while (temp >= 0) {
                    label = String.fromCharCode((temp % 26) + 65) + label;
                    temp = Math.floor(temp / 26) - 1;
                }
                return label;
            });
            const headerRowsForContext = allRows
                .slice(0, Math.min(allRows.length, 12))
                .map((row, originalRowIdx) => {
                    const rowArr = [...row];
                    (rowArr as any)._originalRowIdx = originalRowIdx;
                    return rowArr;
                });
            const headerRowsJson: Array<Record<string, unknown>> = [];
            headerRowsForContext.forEach((row: any[]) => {
                const rowObj: Record<string, unknown> = { __row: (row as any)._originalRowIdx ?? 0 };
                validColIndices.forEach((c, i) => {
                    const val = row[c];
                    rowObj[colLettersForContext[i]] = (val === undefined || val === null || val === '') ? null : val;
                });
                headerRowsJson.push(rowObj);
            });
            const headerContext = JSON.stringify(
                {
                    sheet: sheetName,
                    columns: colLettersForContext,
                    header_rows: headerRowsJson
                },
                null,
                2
            );
            // 청크 분할과 무관하게 안정적으로 컬럼을 찾기 위해
            // 시트 상단 행(헤더 포함)을 컬럼 매핑 전용 컨텍스트로 고정 사용한다.
            const sheetRowsForColumnMapping = allRows.slice(0, Math.min(allRows.length, 120));

            const totalPages = Math.ceil(nonEmptyRows.length / PAGE_SIZE);
            console.log(
                `[Extraction] Excel 고정 페이징 시작 (Sheet: ${sheetName}, rows: ${nonEmptyRows.length}, page_size: ${PAGE_SIZE}, pages: ${totalPages})`
            );

            for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
                const start = pageIndex * PAGE_SIZE;
                const end = Math.min(start + PAGE_SIZE, nonEmptyRows.length);
                const pageRows = nonEmptyRows.slice(start, end);

                if (pageRows.length === 0) continue;

                const firstRow = (pageRows[0] as any)?._originalRowIdx;
                const lastRow = (pageRows[pageRows.length - 1] as any)?._originalRowIdx;

                console.log(
                    `[Extraction] Excel 페이지 처리 (Sheet: ${sheetName}, page: ${pageIndex + 1}/${totalPages}, rows: ${pageRows.length}, range: ${firstRow}~${lastRow})`
                );

                const pageResult = await this._extractExcelChunk(
                    pageRows,
                    sheetName,
                    model,
                    settings,
                    fieldDescriptions,
                    headerContext,
                    validColIndices,
                    sheetRowsForColumnMapping
                );
                allResults.push(pageResult);

                if (typeof pageResult.raw_content === 'string' && pageResult.raw_content.trim()) {
                    llmJsonContexts.push(
                        [
                            `### Sheet: ${sheetName}`,
                            `### Chunk: ${pageIndex + 1}/${totalPages}`,
                            `### RowRange: ${firstRow}~${lastRow}`,
                            pageResult.raw_content
                        ].join('\n')
                    );
                }
            }
        }

        if (allResults.length === 0) {
            throw new Error('No data found in any sheet');
        }

        const finalResult = this.mergeResults(allResults, model, {
            content: excelData.content,
            pages: [{ pageNumber: 1, width: 1000, height: 1000 * 50 }],
            tables: []
        });

        // OCR 탭의 "LLM 전달 포맷(Tagged Text)"에서
        // 엑셀 경로의 실제 JSON 입력 컨텍스트를 확인할 수 있도록 저장한다.
        if (llmJsonContexts.length > 0) {
            const parsedContent = [
                '[EXCEL_LLM_JSON_CONTEXT]',
                ...llmJsonContexts
            ].join('\n\n');

            finalResult.beta_metadata = {
                ...(finalResult.beta_metadata || {}),
                parsed_content: parsedContent,
                source_format: 'excel_json_page_data',
                chunk_count: llmJsonContexts.length
            };
        }

        return finalResult;
    }

    // --- Chunked Extraction Strategy ---
    private async extractChunked(
        ocrData: AnalyzeResult,
        model: ExtractionModel
    ): Promise<ExtractionResult> {
        const chunks = this.createChunks(ocrData);
        const limit = pLimit(6); // Chunk 병렬 처리량 상향 (TPM 100k 기준)
        const tasks = chunks.map(chunk => limit(() => this.processChunk(chunk, model)));
        const results = await Promise.all(tasks);
        const merged = this.mergeResults(results, model, ocrData);
        const chunkLlmRequestBodies = results.flatMap((result) => {
            const debugInfo = this.asRecord(result?._debug_info);
            const requestBodies = this.asArray(debugInfo?.llm_request_bodies);
            return requestBodies
                .map((item) => this.asRecord(item))
                .filter((item): item is Record<string, unknown> => !!item);
        });
        const chunkLlmResponseMeta = results.flatMap((result) => {
            const debugInfo = this.asRecord(result?._debug_info);
            const responseMeta = this.asArray(debugInfo?.llm_response_meta);
            return responseMeta
                .map((item) => this.asRecord(item))
                .filter((item): item is Record<string, unknown> => !!item);
        });
        const chunkLlmResponseBodies = results.flatMap((result) => {
            const debugInfo = this.asRecord(result?._debug_info);
            const responseBodies = this.asArray(debugInfo?.llm_response_bodies);
            return responseBodies
                .map((item) => this.asRecord(item))
                .filter((item): item is Record<string, unknown> => !!item);
        });

        merged._debug_info = {
            ...merged._debug_info,
            token_usage: merged.token_usage,
            _debug_chunking: {
                total_chunks: chunks.length,
                successful_chunks: results.filter(r => Object.keys(r.guide_extracted || {}).length > 0).length,
            }
        };
        if (chunkLlmRequestBodies.length > 0) {
            merged._debug_info.llm_request_bodies = chunkLlmRequestBodies;
        }
        if (chunkLlmResponseMeta.length > 0) {
            merged._debug_info.llm_response_meta = chunkLlmResponseMeta;
        }
        if (chunkLlmResponseBodies.length > 0) {
            merged._debug_info.llm_response_bodies = chunkLlmResponseBodies;
        }

        return merged;
    }

    private compactTablesForPrompt(
        tables: unknown[],
        maxCellsPerTable: number = 800,
        maxCellContentLength: number = 120
    ): Array<Record<string, unknown>> {
        return tables.map((table, tableIndex) => {
            const tableObj = this.asRecord(table);
            const tableRegions = this.asArray(tableObj?.boundingRegions ?? tableObj?.bounding_regions);
            const firstTableRegion = this.asRecord(tableRegions[0]);
            const tablePage = this.pickNumber(firstTableRegion, ['pageNumber', 'page_number']) || 1;
            const rawCells = this.asArray(tableObj?.cells);
            const selectedCells = rawCells.slice(0, maxCellsPerTable);
            const compactCells = selectedCells
                .map((cell, cellIndex) => {
                    const cellObj = this.asRecord(cell);
                    if (!cellObj) return null;

                    const cellRegions = this.asArray(cellObj.boundingRegions ?? cellObj.bounding_regions);
                    const firstCellRegion = this.asRecord(cellRegions[0]);
                    const pageNumber = this.pickNumber(firstCellRegion, ['pageNumber', 'page_number']) || tablePage;
                    const polygon =
                        this.pickNumberArray(firstCellRegion, ['polygon']) ||
                        this.pickNumberArray(cellObj, ['polygon', 'boundingPolygon']);
                    const bbox = this._ensureBBoxFormat(polygon);

                    const contentRaw = this.pickString(cellObj, ['content', 'text']) || '';
                    const content = contentRaw.length > maxCellContentLength
                        ? `${contentRaw.slice(0, maxCellContentLength)}...`
                        : contentRaw;

                    const compactCell: Record<string, unknown> = {
                        row_index: this.pickNumber(cellObj, ['rowIndex', 'row_index']) || 0,
                        column_index: this.pickNumber(cellObj, ['columnIndex', 'column_index']) || 0,
                        row_span: this.pickNumber(cellObj, ['rowSpan', 'row_span']) || 1,
                        column_span: this.pickNumber(cellObj, ['columnSpan', 'column_span']) || 1,
                        content,
                        page_number: pageNumber,
                    };
                    if (bbox) compactCell.bbox = bbox;
                    if (typeof cellIndex === 'number') compactCell.cell_index = cellIndex;
                    return compactCell;
                })
                .filter((cell): cell is Record<string, unknown> => !!cell);

            const compactTable: Record<string, unknown> = {
                table_index: tableIndex,
                page_number: tablePage,
                row_count: this.pickNumber(tableObj, ['rowCount', 'row_count']) || undefined,
                column_count: this.pickNumber(tableObj, ['columnCount', 'column_count']) || undefined,
                cells: compactCells,
            };
            if (rawCells.length > selectedCells.length) {
                compactTable.truncated_cell_count = rawCells.length - selectedCells.length;
            }
            return compactTable;
        });
    }

    private createChunks(ocrData: AnalyzeResult, maxTokens: number = 4000): Chunk[] {
        const pages = ocrData.pages || [];
        const paragraphs = ocrData.paragraphs || [];
        const tables = ocrData.tables || [];

        const chunks: Chunk[] = [];
        let currentChunk: Partial<Chunk> = {
            page_numbers: [],
            content: '',
            paragraphs: [],
            tables: [],
            token_estimate: 0
        };

        const estimate = (text: string) => this.estimatePromptTokens(text);

        for (const page of pages) {
            const pageNum = page.pageNumber || page.page_number;
            const pageParas = paragraphs.filter((p: any) =>
                p.boundingRegions?.[0]?.pageNumber === pageNum
            );
            const pageTables = tables.filter((t: any) =>
                t.boundingRegions?.[0]?.pageNumber === pageNum
            );

            const pageContent = pageParas
                .map((p: any) => this.formatPromptParagraphLine(p))
                .filter((line: string) => line.length > 0)
                .join('\n');
            const pageTablesForPrompt = this.compactTablesForPrompt(pageTables, 300, 80);
            const pageTableContext = pageTablesForPrompt.length > 0 ? JSON.stringify(pageTablesForPrompt) : '';
            const pageTokens = estimate(pageContent) + estimate(pageTableContext) + 120;

            if ((currentChunk.token_estimate || 0) + pageTokens > maxTokens && currentChunk.page_numbers?.length) {
                chunks.push({
                    index: chunks.length,
                    page_numbers: currentChunk.page_numbers!,
                    content: currentChunk.content!,
                    paragraphs: currentChunk.paragraphs!,
                    tables: currentChunk.tables!,
                    token_estimate: currentChunk.token_estimate!
                });
                currentChunk = {
                    page_numbers: [],
                    content: '',
                    paragraphs: [],
                    tables: [],
                    token_estimate: 0
                };
            }

            currentChunk.page_numbers?.push(pageNum);
            currentChunk.content += `\n--- Page ${pageNum} ---\n${pageContent}`;
            currentChunk.paragraphs?.push(...pageParas);
            currentChunk.tables?.push(...pageTables);
            currentChunk.token_estimate = (currentChunk.token_estimate || 0) + pageTokens;
        }

        if (currentChunk.page_numbers?.length) {
            chunks.push(currentChunk as Chunk);
        }

        return chunks;
    }

    private async processChunk(chunk: Chunk, model: ExtractionModel): Promise<any> {
        const fieldDescriptions = model.fields.map(f => {
            let instruction = `- ${f.key} (${f.type}): ${f.label}`;
            const rules: string[] = [];
            if (f.description) instruction += ` Description: ${f.description}`;
            if (f.rules) rules.push(f.rules);
            if (f.is_required) {
                instruction += " [REQUIRED FIELD]";
                rules.push("This field is MANDATORY. If not found, explicitly state why.");
            }
            // [주의] dictionary_id는 LLM 프롬프트에 노출하지 않음.
            // 딕셔너리 정규화는 추출 완료 후 performDictionaryNormalization 단계에서 후처리로만 수행됨.
            // 프롬프트에 노출 시 LLM이 스스로 변환을 시도하여 딕셔너리 해제 후에도 적용되는 버그가 발생함.
            if (f.validation_regex) instruction += ` [Regex: ${f.validation_regex}]`;
            if (rules.length > 0) instruction += ` Rules: ${rules.join('; ')}`;
            if (f.type === 'table' && f.sub_fields && f.sub_fields.length > 0) {
                instruction += `\n  * Sub-fields for ${f.key}:\n`;
                f.sub_fields.forEach(sub => {
                    let subInst = `    - ${sub.key} (${sub.type}): ${sub.label}`;
                    if (sub.description) subInst += ` Description: ${sub.description}`;
                    const subRules: string[] = [];
                    if (sub.is_required) subRules.push('REQUIRED');
                    if (sub.rules) subRules.push(sub.rules);
                    if (subRules.length > 0) subInst += ` [${subRules.join(', ')}]`;
                    instruction += subInst + '\n';
                });
            }
            return instruction;
        }).join('\n');

        const { getLLMSettings } = await import('@/actions/llmSettings');
        const settings = await getLLMSettings();

        let context = chunk.content;
        if (chunk.tables.length > 0) {
            const maxTableContextChars = 120000;
            let compactTables = this.compactTablesForPrompt(chunk.tables, 800, 120);
            let serializedTables = JSON.stringify(compactTables);

            if (serializedTables.length > maxTableContextChars) {
                compactTables = this.compactTablesForPrompt(chunk.tables, 250, 80);
                serializedTables = JSON.stringify(compactTables);
            }

            while (serializedTables.length > maxTableContextChars && compactTables.length > 1) {
                compactTables = compactTables.slice(0, Math.ceil(compactTables.length / 2));
                serializedTables = JSON.stringify(compactTables);
            }

            if (serializedTables.length > maxTableContextChars) {
                console.warn(
                    `[Extraction] Chunk ${chunk.index} 테이블 컨텍스트가 과도하게 커서 제외합니다. ` +
                    `tables=${chunk.tables.length}, serialized_chars=${serializedTables.length}`
                );
            } else {
                if (compactTables.length < chunk.tables.length) {
                    console.warn(
                        `[Extraction] Chunk ${chunk.index} 테이블 컨텍스트를 축약했습니다. ` +
                        `original_tables=${chunk.tables.length}, included_tables=${compactTables.length}`
                    );
                }
                context += `\n\n--- TABLES (Normalized Coordinates) ---\n${serializedTables}`;
            }
        }

        const basePrompt = (settings.extraction_system || `You are a document data extractor.

Given this document data extracted by Document Intelligence:
{ocr_data}

Extract values for these specific fields:
{field_descriptions}
{global_rules}
{reference_data}

INSTRUCTIONS:
1. Analyze the document structure. If it looks like a table/grid, respect the columns.
2. For specific fields like 'Item' or 'Amount', look for corresponding headers in the table.
3. If a field represents a list of items (e.g. line items in a table), extract it as a JSON Array of objects with relevant keys.
4. Distinguish between 'Item' (product code/name) and 'Description' (details).
5. **Key-Value Tables**: If a table has a structure like [Field Name | Value], map the 'Value' column to the corresponding requested field.
6. **Complex Tables**: Identify headers first. Ensure values are aligned under their respective headers. Do NOT merge neighboring columns (e.g. Description + Width).
7. **CRITICAL**: Extract values EXACTLY as they appear in the text. Do not reformat dates or numbers.
8. **CRITICAL**: You MUST include the 'bbox' (bounding box) for every extracted value. Copy it exactly from source.
8. **CRITICAL**: You MUST include the 'page_number' (1-based index) for every extracted value.

Return a JSON object with TWO parts:
1. "guide_extracted": Object with each field key containing:
   - "value": The extracted value exactly as in text
   - "confidence": Your confidence level from 0.0 to 1.0
   - "bbox": The bounding box [x1, y1, x2, y2] from the source data (REQUIRED)
   - "page_number": The page number (1-based integer) (REQUIRED)

2. "other_data": Array of other data found that wasn't matched to fields.

IMPORTANT:
- Use exact field keys.
- If value is not found, set value to null.
- Return ONLY valid JSON.
{focus_instruction}
`)
            .replace('{pages}', chunk.page_numbers.join(', '))
            .replace('{context}', context)
            .replace('{ocr_data}', context)
            .replace('{fieldDescriptions}', fieldDescriptions)
            .replace('{field_descriptions}', fieldDescriptions)
            .replace('{global_rules}', model.global_rules || '')
            .replace('{reference_data}', model.reference_data ? `Reference Data:\n${JSON.stringify(model.reference_data, null, 2)}` : '')
            .replace('{focus_instruction}', '');

        const prompt = basePrompt;

        try {
            const messages = [
                { role: 'system' as const, content: settings.extraction_system_role || 'You are a precise document data extractor. Return only valid JSON.' },
                { role: 'user' as const, content: prompt }
            ];

            const hasTableFields = model.fields.some(f => f.type === 'table');
            const dynamicMaxTokens = hasTableFields ? 16384 : 8192;
            const llmRequestBody = {
                extraction_mode: 'chunk',
                chunk_index: chunk.index,
                json_mode: true,
                max_tokens: dynamicMaxTokens,
                messages,
            };

            const res = await this.openai.getCompletion(
                messages,
                undefined,
                true,
                dynamicMaxTokens,
                0.0,
                42,
                true
            );
            const text = res.choices[0].message.content;
            const parsed = text ? JSON.parse(text) : {};
            parsed.token_usage = res.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
            parsed._debug_info = {
                ...(parsed._debug_info || {}),
                llm_request_bodies: [llmRequestBody],
                llm_response_bodies: [
                    this.buildLlmResponseBody('chunk', res, text, {
                        chunk_index: chunk.index,
                        page_numbers: chunk.page_numbers,
                    }),
                ],
                llm_response_meta: [
                    this.buildLlmResponseMeta('chunk', res, text, {
                        chunk_index: chunk.index,
                        page_numbers: chunk.page_numbers,
                    }),
                ],
            };
            return parsed;
        } catch (e) {
            console.error(`Chunk ${chunk.index} failed`, e);
            return {};
        }
    }
    
    /**
     * 필드 키에 해당하는 유니크 제약 조건 컬럼 리스트를 반환합니다.
     */
    private getUniqueKeysForField(fieldKey: string, model: ExtractionModel): string[] | null {
        try {
            const refData = this.asRecord(model.reference_data);
            const constraints = this.asArray(refData?.unique_constraints);

            for (const constraintItem of constraints) {
                const constraint = this.asRecord(constraintItem);
                if (!constraint) continue;

                const targetArray = this.pickString(constraint, ['target_array']);
                if (!targetArray || targetArray !== fieldKey) continue;

                const rawUniqueKeys = this.asArray(constraint.unique_keys);
                const uniqueKeys = rawUniqueKeys
                    .filter((item): item is string => typeof item === 'string')
                    .map((item) => item.trim())
                    .filter((item) => item.length > 0);

                if (uniqueKeys.length > 0) {
                    return uniqueKeys;
                }
            }
        } catch (e) {
            console.warn(`[ExtractionService] unique_constraints 파싱 실패:`, e);
        }
        return null;
    }

    /**
     * 특정 컬럼(uniqueKeys)을 기준으로 행의 의미적 해시 키를 생성합니다.
     * uniqueKeys가 없으면 전체 값을 비교합니다.
     */
    private getRowSemanticKey(row: any, uniqueKeys: string[] | null): string {
        if (!row || typeof row !== 'object') return JSON.stringify(row);

        const semanticData: Record<string, any> = {};
        
        if (uniqueKeys && uniqueKeys.length > 0) {
            // 지정된 유니크 키들만 추출하여 비교
            uniqueKeys.forEach(key => {
                const cell = row[key];
                if (cell && typeof cell === 'object' && 'value' in (cell as any)) {
                    semanticData[key] = (cell as any).value;
                } else {
                    semanticData[key] = cell;
                }
            });
        } else {
            // 유니크 키가 지정되지 않은 경우 메타 필드 제외 전체 비교
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

    private mapType(type: any): 'text' | 'number' | 'date' | 'table' {
        if (!type) return 'text';
        if (type === 'string' || type === 'text') return 'text';
        if (type === 'array' || type === 'table' || type === 'object') return 'table';
        if (type === 'number') return 'number';
        if (type === 'date') return 'date';
        return 'text';
    }

    private formatPromptParagraphLine(paragraph: any): string {
        const content = typeof paragraph?.content === 'string' ? paragraph.content.trim() : '';
        if (!content) return '';

        const polygon = paragraph?.boundingRegions?.[0]?.polygon;
        const bbox = this._ensureBBoxFormat(polygon);
        if (!bbox || bbox.length < 4) return content;

        const [x1, y1, x2, y2] = bbox;
        const isFiniteBBox = [x1, y1, x2, y2].every((value) => Number.isFinite(value));
        if (!isFiniteBBox || x2 <= x1 || y2 <= y1) return content;

        return `[${x1},${y1},${x2},${y2}] ${content}`;
    }

    private buildStrictOutputContract(model: ExtractionModel): string {
        const fieldKeys = model.fields.map((field) => field.key);
        return [
            '',
            'OUTPUT CONTRACT (MANDATORY):',
            '- Return ONLY valid JSON.',
            '- Top-level keys must be EXACTLY: "guide_extracted", "other_data".',
            '- Do NOT output any additional top-level keys such as summary/title/vendor/document_note.',
            `- "guide_extracted" must be an object containing these field keys: ${JSON.stringify(fieldKeys)}.`,
            '- If a field is not found, set that field value to null.',
            '- "other_data" must be an array.',
        ].join('\n');
    }

    private mergeResults(results: any[], model: ExtractionModel, ocrData: AnalyzeResult): ExtractionResult {
        const mergedGuide: Record<string, ExtractedField> = {};
        const mergedOther: any[] = [];
        const pages = ocrData.pages || [];

        // 모델 필드 정규화 맵 생성 (메인 필드용)
        const fieldKeyMap = new Map<string, any>();
        model.fields.forEach(f => {
            fieldKeyMap.set(f.key.toLowerCase().replace(/[^a-z0-9]/g, ''), f);
            if (f.label) {
                fieldKeyMap.set(f.label.toLowerCase().replace(/[^a-z0-9]/g, ''), f);
            }
        });

        for (const res of results) {
            const guide = res.guide_extracted || {};
            const other = res.other_data;

            if (other) {
                if (Array.isArray(other)) mergedOther.push(...other);
                else mergedOther.push(other);
            }

            for (const [rawKey, val] of Object.entries(guide)) {
                let itemValue: any;
                let itemConfidence = 0.8;
                let itemBBox: any;
                let itemPage: number | undefined;
                let itemType: 'text' | 'number' | 'date' | 'table' | undefined;

                if (val !== null && typeof val === 'object' && 'value' in (val as any)) {
                    itemValue = (val as any).value;
                    itemConfidence = (val as any).confidence ?? itemConfidence;
                    itemBBox = (val as any).bbox;
                    itemPage = (val as any).page_number;
                    itemType = this.mapType((val as any).type);
                } else {
                    itemValue = val;
                }

                const pageNum = itemPage || 1;
                const rawBBox = this._ensureBBoxFormat(itemBBox);

                // 정규화 매핑 시도
                const rawKeyNorm = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
                const fieldModel = model.fields.find(f => f.key === rawKey) || fieldKeyMap.get(rawKeyNorm);
                const targetKey = fieldModel ? fieldModel.key : rawKey;

                if (itemValue !== null && itemValue !== undefined) {
                    // 실제 값이 있는 경우: bbox 스냅 후 저장
                    const { snappedBBox, finalPage } = this._findAndSnapBBox(String(itemValue), rawBBox, pageNum, pages);
                    const pageInfo = pages.find((p: any) => (p.pageNumber || p.page_number) === finalPage);
                    const normalizedBBox = this._normalizeBBox(snappedBBox || rawBBox, pageInfo?.width || 0, pageInfo?.height || 0);

                    if (!mergedGuide[targetKey] || mergedGuide[targetKey].value === null) {
                        mergedGuide[targetKey] = {
                            value: itemValue,
                            confidence: itemConfidence,
                            bbox: normalizedBBox,
                            page_number: finalPage,
                            type: itemType || fieldModel?.type || 'text',
                            rules: fieldModel?.rules,
                            is_required: fieldModel?.is_required,
                            dictionary_id: fieldModel?.dictionary_id,
                            validation_regex: fieldModel?.validation_regex,
                            sub_fields: (fieldModel?.sub_fields && fieldModel.sub_fields.length > 0) ? (fieldModel.sub_fields as any) : undefined,
                        };
                    } else if (itemType === 'table' && Array.isArray(itemValue)) {
                        // 테이블 필드 중복 제거 병합
                        const existingValue = mergedGuide[targetKey].value;
                        if (Array.isArray(existingValue)) {
                            // unique_constraints 설정 확인
                            const uniqueKeys = this.getUniqueKeysForField(targetKey, model);

                            // 요청 구조가 유효할 때만 dedupe를 수행한다.
                            if (!uniqueKeys || uniqueKeys.length === 0) {
                                existingValue.push(...itemValue);
                                continue;
                            }

                            // 기존 행들의 시맨틱 키 집합 생성
                            const seenKeys = new Set(existingValue.map(row => this.getRowSemanticKey(row, uniqueKeys)));

                            // 겹치지 않는 행만 추가
                            for (const newRow of itemValue) {
                                const rowKey = this.getRowSemanticKey(newRow, uniqueKeys);
                                if (!seenKeys.has(rowKey)) {
                                    existingValue.push(newRow);
                                    seenKeys.add(rowKey);
                                }
                            }
                        }
                    }
                    // text 타입 필드는 합치지 않고 첫 번째 non-null 값을 유지 (사용자 피드백으로 원복)
                } else if (!mergedGuide[targetKey]) {
                    // 값이 null이어도 키는 유지 (이후 청크에서 실제 값이 오면 덮어씀)
                    mergedGuide[targetKey] = {
                        value: null,
                        confidence: 0,
                        bbox: undefined,
                        page_number: pageNum,
                        type: itemType || fieldModel?.type || 'text',
                        rules: fieldModel?.rules,
                        is_required: fieldModel?.is_required,
                        dictionary_id: fieldModel?.dictionary_id,
                        validation_regex: fieldModel?.validation_regex,
                        sub_fields: (fieldModel?.sub_fields && fieldModel.sub_fields.length > 0) ? (fieldModel.sub_fields as any) : undefined,
                    };
                }
            }
        }

        // 토큰 사용량 합산
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        let totalTokens = 0;

        for (const res of results) {
            const usage = res.token_usage || res._token_usage;
            if (usage) {
                totalPromptTokens += usage.prompt_tokens || 0;
                totalCompletionTokens += usage.completion_tokens || 0;
                totalTokens += usage.total_tokens || 0;
            }
        }

        return {
            guide_extracted: mergedGuide,
            other_data: mergedOther,
            raw_content: ocrData.content,
            raw_tables: ocrData.tables,
            token_usage: {
                prompt_tokens: totalPromptTokens,
                completion_tokens: totalCompletionTokens,
                total_tokens: totalTokens
            },
            _chunked: true
        };
    }

    // --- Helpers ---
    private buildPrompt(ocrData: AnalyzeResult, model: ExtractionModel, customPromptTemplate?: string): string {
        const fieldDescriptions = model.fields.map(f => {
            let instruction = `- ${f.key} (${f.type}): ${f.label}`;
            if (f.description) instruction += ` Description: ${f.description}`;
            if (f.rules) instruction += ` Rules: ${f.rules}`;
            if (f.is_required) instruction += " [REQUIRED]";

            // 테이블 타입인 경우 서브필드(컬럼) 정보 추가
            if (f.type === 'table' && f.sub_fields && f.sub_fields.length > 0) {
                const subDescriptions = f.sub_fields.map(sub => {
                    let subDesc = `  * ${sub.key}: ${sub.label}`;
                    if (sub.description) subDesc += ` (Desc: ${sub.description})`;
                    if (sub.rules) subDesc += ` (Rules: ${sub.rules})`;
                    return subDesc;
                }).join('\n');
                instruction += `\n  - TABLE COLUMNS (Must use these keys in JSON objects):\n${subDescriptions}`;
            }
            return instruction;
        }).join('\n');

        const richPages = (ocrData.pages || []).map(page => {
            const pageNum = page.pageNumber || page.page_number;
            const pageParas = (ocrData.paragraphs || []).filter((p: any) => p.boundingRegions?.[0]?.pageNumber === pageNum);
            const paragraphText = pageParas
                .map((p: any) => this.formatPromptParagraphLine(p))
                .filter((line: string) => line.length > 0)
                .join('\n');

            if (paragraphText.trim().length > 0) {
                return `Page ${pageNum}:\n${paragraphText}`;
            }

            const pageWords = Array.isArray((page as any)?.words) ? (page as any).words : [];
            const wordsText = pageWords
                .map((w: any) => {
                    if (!w || typeof w !== 'object') return '';
                    return String(w.content || '').trim();
                })
                .filter((t: string) => t.length > 0)
                .join(' ');

            if (wordsText.length > 0) {
                return `Page ${pageNum}:\n${wordsText}`;
            }

            return `Page ${pageNum}:\n${ocrData.content || ''}`;
        }).join('\n\n');

        const strictOutputContract = this.buildStrictOutputContract(model);

        if (customPromptTemplate) {
            return customPromptTemplate
                .replace('{ocr_data}', richPages)
                .replace('{field_descriptions}', fieldDescriptions)
                .replace('{global_rules}', model.global_rules ? `Global Rules:\n${model.global_rules}` : '')
                .replace('{reference_data}', model.reference_data ? `Reference Data:\n${JSON.stringify(model.reference_data, null, 2)}` : '')
                .concat(strictOutputContract);
        }

        return `Extract data from:
{ocr_data}

{global_rules}
{reference_data}

Fields:
{field_descriptions}
`
            .replace('{ocr_data}', richPages)
            .replace('{field_descriptions}', fieldDescriptions)
            .replace('{global_rules}', model.global_rules ? `GLOBAL RULES:\n${model.global_rules}` : '')
            .replace('{reference_data}', model.reference_data ? `REFERENCE DATA:\n${JSON.stringify(model.reference_data, null, 2)}` : '')
            .concat(strictOutputContract);
    }

    private validateAndFormat(rawJson: any, model: ExtractionModel, pages: any[]): Record<string, ExtractedField> {
        const guide = rawJson.guide_extracted || {};
        const validated: Record<string, ExtractedField> = {};

        // LLM 응답 필드 정규화 맵 생성
        const guideMap = new Map<string, any>();
        Object.entries(guide).forEach(([k, v]) => {
            guideMap.set(k.toLowerCase().replace(/[^a-z0-9]/g, ''), v);
        });

        for (const field of model.fields) {
            const fieldKeyNorm = field.key.toLowerCase().replace(/[^a-z0-9]/g, '');
            const fieldLabelNorm = field.label ? field.label.toLowerCase().replace(/[^a-z0-9]/g, '') : null;

            // 1. 정확한 키 매치, 2. 정규화된 키 매치, 3. 라벨 기반 매치
            const item = guide[field.key] ?? guideMap.get(fieldKeyNorm) ?? (fieldLabelNorm ? guideMap.get(fieldLabelNorm) : undefined);

            if (item !== undefined && item !== null) {
                let itemValue: any;
                let itemConfidence = 0.8;
                let itemBBox: any;
                let itemPage: number | undefined;

                if (typeof item === 'object' && item !== null && 'value' in item) {
                    itemValue = item.value;
                    itemConfidence = item.confidence ?? itemConfidence;
                    itemBBox = item.bbox;
                    itemPage = item.page_number;
                } else {
                    itemValue = item;
                }

                // 테이블 전체 영역(Aggregated BBox) 처리 (RefinerEngine에서 계산되어 넘어온 경우)
                let tablePageBBoxes: Record<number, number[]> | undefined;
                if (Array.isArray(itemValue) && (itemValue as any)._table_bbox) {
                    itemBBox = (itemValue as any)._table_bbox;
                    itemPage = (itemValue as any)._table_page || itemPage;

                    // 멀티 페이지 하이라이트 정보가 있으면 정규화하여 보관
                    const rawPageBBoxes = (itemValue as any)._table_page_bboxes;
                    if (rawPageBBoxes) {
                        tablePageBBoxes = {};
                        for (const [pNumStr, pRawBBox] of Object.entries(rawPageBBoxes)) {
                            const pNum = Number(pNumStr);
                            const pRawArr = pRawBBox as number[];

                            // [BUG FIX] 이중 정규화 방지:
                            // LayoutParser는 bbox를 0-100% 퍼센트 좌표로 이미 정규화하여 refMap에 저장함.
                            // RefinerEngine이 이 값을 _table_page_bboxes에 담아오면 이미 정규화된 상태.
                            // 최대 좌표값이 100 이하면 이미 정규화된 것으로 간주, 그대로 사용.
                            const maxCoordVal = pRawArr.length > 0 ? Math.max(...pRawArr) : 0;
                            if (maxCoordVal <= 100) {
                                tablePageBBoxes[pNum] = pRawArr;
                            } else {
                                // 포인트 또는 인치 단위인 경우 정규화 수행
                                const pInfo = pages.find((p: any) => (p.pageNumber || p.page_number) === pNum);
                                const normalized = this._normalizeBBox(pRawArr, pInfo?.width || 0, pInfo?.height || 0);
                                if (normalized) tablePageBBoxes[pNum] = normalized;
                            }
                        }
                    }
                }

                const rawBBox = this._ensureBBoxFormat(itemBBox);

                const isTable = field.type === 'table' || Array.isArray(itemValue);
                const { snappedBBox, finalPage } = (isTable || !!rawBBox)
                    ? { snappedBBox: rawBBox, finalPage: itemPage || 1 }
                    : this._findAndSnapBBox(String(itemValue), rawBBox, itemPage || 1, pages);

                const pageInfo = pages.find((p: any) => (p.pageNumber || p.page_number) === finalPage);
                const normalizedBBox = this._normalizeBBox(snappedBBox || rawBBox, pageInfo?.width || 0, pageInfo?.height || 0);

                if (field.type === 'table' && Array.isArray(itemValue) && field.sub_fields && field.sub_fields.length > 0) {
                    itemValue = this._hydrateTableRows(itemValue, field.sub_fields, pages);
                }

                validated[field.key] = {
                    value: itemValue,
                    confidence: itemConfidence,
                    bbox: normalizedBBox,
                    page_number: finalPage,
                    _table_page_bboxes: tablePageBBoxes, // 멀티 페이지용 좌표 맵 추가
                    type: field.type,
                    rules: field.rules,
                    is_required: field.is_required,
                    dictionary_id: field.dictionary_id,
                    validation_regex: field.validation_regex,
                    sub_fields: (field.sub_fields && field.sub_fields.length > 0) ? (field.sub_fields as any) : undefined,
                };
            } else {
                validated[field.key] = {
                    value: null,
                    confidence: 0,
                    type: field.type,
                    rules: field.rules,
                    is_required: field.is_required,
                    dictionary_id: field.dictionary_id,
                    validation_regex: field.validation_regex,
                };
            }
        }
        return validated;
    }

    /**
     * Extracts values from raw table rows and maps them to the model's sub_fields schema.
     * This ensures the UI can depend on consistent keys for column rendering.
     */
    private _hydrateTableRows(rows: any[], subFields: any[], pages: any[]): any[] {
        if (!Array.isArray(rows)) return [];

        return rows.map((row) => {
            if (typeof row !== 'object' || row === null) return row;

            const hydratedRow: any = {};
            const rowMap = new Map<string, any>();
            // 유효한 모든 키를 소문자 + 공백/언더바 제거 처리하여 맵핑 (유연한 매칭 지원)
            Object.entries(row).forEach(([rk, rv]) => {
                const normalizedKey = rk.toLowerCase().replace(/[^a-z0-9]/g, '');
                rowMap.set(normalizedKey, rv);
            });

            subFields.forEach(sub => {
                const subKeyNormalized = sub.key.toLowerCase().replace(/[^a-z0-9]/g, '');
                // 1. 정확한 매칭 시도, 2. 정규화된 키로 시도, 3. 라벨로 시도
                const rawVal = row[sub.key] ?? rowMap.get(subKeyNormalized) ?? (sub.label ? rowMap.get(sub.label.toLowerCase().replace(/[^a-z0-9]/g, '')) : undefined);

                if (rawVal && typeof rawVal === 'object' && !Array.isArray(rawVal) && 'value' in rawVal) {
                    // 이미 rich object인 경우 (bbox 등 포함됨)
                    hydratedRow[sub.key] = rawVal;
                } else {
                    // 평문인 경우 rich object로 래핑
                    hydratedRow[sub.key] = {
                        value: rawVal !== undefined ? rawVal : null,
                        confidence: 0.8,
                        bbox: undefined,
                        page_number: 1,
                        type: sub.type || 'text'
                    };
                }
            });

            return hydratedRow;
        });
    }

    private async performDictionaryNormalization(result: ExtractionResult, model: ExtractionModel): Promise<ExtractionResult> {
        try {
            const { getCurrentEnvConfig } = await import('@/lib/env');
            const envConfig = await getCurrentEnvConfig();
            const { default: DictionaryService } = await import('./DictionaryService');
            const dictionaryService = new DictionaryService(envConfig);

            // 1. 모델에서 사용되는 모든 사전 카테고리 수집 (최상위 필드 및 서브필드 포함)
            const categoryIds = new Set<string>();
            model.fields.forEach(f => {
                if (f.dictionary_id) categoryIds.add(f.dictionary_id.toLowerCase());
                if (f.sub_fields) {
                    f.sub_fields.forEach(sub => {
                        if (sub.dictionary_id) categoryIds.add(sub.dictionary_id.toLowerCase());
                    });
                }
            });

            if (categoryIds.size === 0) return result;

            // 2. 필요한 모든 딕셔너리 카테고리를 미리 로드하여 인메모리 캐시 구축
            const categoryLookups = new Map<string, Map<string, string>>();
            await Promise.all(Array.from(categoryIds).map(async (catId) => {
                const lookup = await dictionaryService.getCategoryLookup(catId);
                categoryLookups.set(catId, lookup);
            }));

            const guide = result.guide_extracted;
            if (!guide) return result;

            // 3. 필드별 정규화 수행
            for (const field of model.fields) {
                const extracted = guide[field.key];
                if (!extracted || extracted.value === null || extracted.value === undefined) continue;

                if (field.type === 'table' && Array.isArray(extracted.value)) {
                    // 테이블 형태인 경우 각 행의 서브필드별로 정규화
                    const rows = extracted.value;
                    const subFieldConfigs = field.sub_fields || [];
                    const parentDictId = field.dictionary_id?.toLowerCase();

                    for (const row of rows) {
                        if (typeof row !== 'object' || row === null) continue;

                        // 해당 행 내의 각 컬럼(서브필드) 순회
                        for (const [colKey, cell] of Object.entries(row)) {
                            // cell은 ExtractedField 형태 ({ value, confidence, ... })
                            if (!cell || typeof cell !== 'object' || !('value' in (cell as any))) continue;

                            const cellObj = cell as ExtractedField;
                            if (cellObj.value === null || cellObj.value === undefined) continue;

                            // 이 컬럼에 해당하는 서브필드 정의 찾기
                            const subField = subFieldConfigs.find(s => s.key === colKey);

                            // [BUG FIX] 부모 테이블의 딕셔너리를 무조건 상속받지 않고, 
                            // 서브필드(컬럼)에 명시적으로 설정된 딕셔너리 ID를 우선적으로 사용합니다.
                            const dictId = subField?.dictionary_id?.toLowerCase();

                            if (dictId && categoryLookups.has(dictId)) {
                                const lookup = categoryLookups.get(dictId)!;
                                const originalValue = cellObj.value;

                                if (typeof originalValue === 'string') {
                                    const trimmed = originalValue.trim();
                                    if (!trimmed) continue;

                                    const normalized = lookup.get(trimmed.toLowerCase());
                                    if (normalized && normalized !== originalValue) {
                                        cellObj.original_value = originalValue;
                                        cellObj.value = normalized;
                                    }
                                }
                            }
                        }
                    }
                } else if (field.dictionary_id) {
                    // 일반 필드 형태인 경우
                    const dictId = field.dictionary_id.toLowerCase();
                    const lookup = categoryLookups.get(dictId);

                    if (lookup && typeof extracted.value === 'string') {
                        const originalValue = extracted.value;
                        const trimmed = originalValue.trim();
                        if (trimmed) {
                            const normalized = lookup.get(trimmed.toLowerCase());
                            if (normalized && normalized !== originalValue) {
                                extracted.original_value = originalValue;
                                extracted.value = normalized;
                            }
                        }
                    }
                }
            }
            return result;
        } catch (error) {
            console.error('[Extraction] Dictionary normalization failed', error);
            return result;
        }
    }

    private getExtractedValue(extracted: unknown): unknown {
        const extractedRecord = this.asRecord(extracted);
        if (extractedRecord && Object.prototype.hasOwnProperty.call(extractedRecord, 'value')) {
            return extractedRecord.value;
        }
        return extracted;
    }

    private extractCellValue(cell: unknown): unknown {
        const cellRecord = this.asRecord(cell);
        if (cellRecord && Object.prototype.hasOwnProperty.call(cellRecord, 'value')) {
            return cellRecord.value;
        }
        return cell;
    }

    private isValueMissing(value: unknown): boolean {
        const INVALID_VALUES = new Set(['n/a', 'none', '-', '미기재', '없음', 'null', 'undefined']);
        if (value === null || value === undefined) return true;
        if (Array.isArray(value)) return value.length === 0;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            return normalized === '' || INVALID_VALUES.has(normalized);
        }
        return false;
    }

    private getRowNumber(row: Record<string, unknown>, rowIndex: number): number | null {
        const candidates = [row['__row'], row['row'], row['row_index']];
        for (const candidate of candidates) {
            if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
            if (typeof candidate === 'string') {
                const parsed = Number(candidate);
                if (Number.isFinite(parsed)) return parsed;
            }
        }
        return rowIndex + 1;
    }

    private buildRowContext(
        row: Record<string, unknown>,
        subFields: Array<{ key: string; label?: string | null }>,
        targetSubKey: string,
        rowIndex: number
    ): Record<string, string | number | boolean> {
        const context: Record<string, string | number | boolean> = {};
        const rowNumber = this.getRowNumber(row, rowIndex);
        if (rowNumber !== null) context.__row = rowNumber;

        for (const sub of subFields) {
            if (sub.key === targetSubKey) continue;
            const rawValue = this.extractCellValue(row[sub.key]);
            if (this.isValueMissing(rawValue)) continue;

            if (typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean') {
                context[sub.key] = rawValue;
            } else if (rawValue instanceof Date) {
                context[sub.key] = rawValue.toISOString();
            }

            if (Object.keys(context).length >= 8) break;
        }

        return context;
    }

    private cleanHealedValue(value: unknown): unknown {
        if (typeof value !== 'string') return value;
        return value.replace(/^\[\[(.*)\]\]$/, '$1').replace(/^\[(.*)\]$/, '$1').trim();
    }

    private chunkBySize<T>(items: T[], size: number): T[][] {
        if (size <= 0) return [items];
        const chunks: T[][] = [];
        for (let i = 0; i < items.length; i += size) {
            chunks.push(items.slice(i, i + size));
        }
        return chunks;
    }

    private accumulateUsage(
        accumulator: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
        usage: unknown
    ): boolean {
        const usageRecord = this.asRecord(usage);
        if (!usageRecord) return false;

        const promptTokens = this.pickNumber(usageRecord, ['prompt_tokens']) || 0;
        const completionTokens = this.pickNumber(usageRecord, ['completion_tokens']) || 0;
        const totalTokens = this.pickNumber(usageRecord, ['total_tokens']) || (promptTokens + completionTokens);

        if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) return false;

        accumulator.prompt_tokens += promptTokens;
        accumulator.completion_tokens += completionTokens;
        accumulator.total_tokens += totalTokens;
        return true;
    }

    private identifyHealingTargets(result: ExtractionResult, model: ExtractionModel): HealingTargetBundle {
        const fields: MissingFieldHealingTarget[] = [];
        const tableCells: MissingTableCellHealingTarget[] = [];
        const guide = result.guide_extracted || {};
        const MAX_TABLE_CELL_TARGETS = 80;

        for (const field of model.fields) {
            const extracted = guide[field.key];
            const extractedValue = this.getExtractedValue(extracted);

            if (field.is_required && this.isValueMissing(extractedValue)) {
                fields.push({
                    key: field.key,
                    label: field.label || field.key,
                    instruction: `Extract '${field.label || field.key}' based on: ${field.description || ''}`,
                    rules: field.rules ? [field.rules] : []
                });
            }

            if (field.type !== 'table' || !field.sub_fields || field.sub_fields.length === 0) continue;
            if (!Array.isArray(extractedValue) || extractedValue.length === 0) continue;

            for (let rowIndex = 0; rowIndex < extractedValue.length; rowIndex++) {
                if (tableCells.length >= MAX_TABLE_CELL_TARGETS) break;

                const row = this.asRecord(extractedValue[rowIndex]);
                if (!row) continue;

                for (const sub of field.sub_fields) {
                    if (!sub.is_required) continue;
                    const cellValue = this.extractCellValue(row[sub.key]);
                    if (!this.isValueMissing(cellValue)) continue;

                    tableCells.push({
                        task_id: `${field.key}__${sub.key}__r${rowIndex}`,
                        parent_key: field.key,
                        parent_label: field.label || field.key,
                        sub_key: sub.key,
                        sub_label: sub.label || sub.key,
                        row_index: rowIndex,
                        row_number: this.getRowNumber(row, rowIndex),
                        row_context: this.buildRowContext(row, field.sub_fields, sub.key, rowIndex),
                        rules: sub.rules ? [sub.rules] : []
                    });
                }
            }

            if (tableCells.length >= MAX_TABLE_CELL_TARGETS) {
                console.warn(`[ExtractionService] Healing cell target limit reached (${MAX_TABLE_CELL_TARGETS}). Remaining missing cells will be skipped.`);
                break;
            }
        }

        return { fields, tableCells };
    }

    private buildTableCellHealingPrompt(
        targets: MissingTableCellHealingTarget[],
        ocrData: AnalyzeResult,
        model: ExtractionModel
    ): string {
        const targetPayload = targets.map((target) => ({
            task_id: target.task_id,
            table_key: target.parent_key,
            table_label: target.parent_label,
            row_index: target.row_index,
            row_number: target.row_number,
            column_key: target.sub_key,
            column_label: target.sub_label,
            row_context: target.row_context,
            rules: target.rules
        }));

        return [
            'You are a high-precision document extraction auditor.',
            'Your job is to recover ONLY the missing required table cells listed in TARGET_CELLS.',
            '',
            'HARD RULES:',
            '1. Handle each task_id independently.',
            '2. Never copy one recovered value across multiple rows unless each row has direct evidence.',
            '3. If the value for a task_id is not clearly present, return null.',
            '4. Return ONLY valid JSON.',
            '',
            `TARGET_CELLS:\n${JSON.stringify(targetPayload, null, 2)}`,
            model.global_rules ? `\nGLOBAL RULES:\n${model.global_rules}` : '',
            model.reference_data ? `\nREFERENCE DATA (validation only):\n${JSON.stringify(model.reference_data, null, 2)}` : '',
            '',
            `DOCUMENT TEXT FOR REVIEW:\n${ocrData.content}`,
            '',
            'OUTPUT JSON FORMAT:',
            '{',
            '  "healed_cells": {',
            '    "<task_id>": {',
            '      "value": null,',
            '      "ref": null,',
            '      "is_uncertain": false',
            '    }',
            '  }',
            '}',
            '',
            'Do not output keys that are not in TARGET_CELLS.'
        ].join('\n');
    }

    /**
     * Executes a secondary precision pass to recover missing mandatory values.
     * - Top-level required field: 기존 방식 유지
     * - Table required sub-field: 행/셀 단위로만 정밀 힐링 (전파 금지)
     */
    private async executeHealingPass(
        result: ExtractionResult,
        model: ExtractionModel,
        ocrData: AnalyzeResult
    ): Promise<ExtractionResult> {
        if (!this.healingPassEnabled) {
            console.log('[ExtractionService] Healing Pass disabled by code configuration.');
            return result;
        }

        const targets = this.identifyHealingTargets(result, model);
        if (targets.fields.length === 0 && targets.tableCells.length === 0) return result;

        console.log(
            `[ExtractionService] Starting Healing Pass | fields=${targets.fields.length}, table_cells=${targets.tableCells.length}`
        );

        const usageAccumulator = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        let hasUsage = false;

        // 1) Top-level required fields healing
        if (targets.fields.length > 0) {
            try {
                const healingPrompt = RefinerEngine.constructHealingPrompt(
                    {},
                    targets.fields,
                    ocrData.content,
                    model.reference_data,
                    model.global_rules || undefined
                );
                if (this.isLikelyPromptTooLarge(healingPrompt)) {
                    console.warn('[ExtractionService] Skipping top-level healing due to prompt size risk.');
                } else {
                    const healingSystemRole = [
                        'You are a strict data extraction auditor.',
                        'Return ONLY valid JSON.',
                        'Do not invent values.',
                        'If evidence is not present in source text, return null.',
                    ].join(' ');

                    const response = await this.openai.getCompletion(
                        [
                            { role: 'system' as const, content: healingSystemRole },
                            { role: 'user' as const, content: healingPrompt }
                        ],
                        undefined,
                        true,
                        4096,
                        0.0,
                        42,
                        true
                    );
                    hasUsage = this.accumulateUsage(usageAccumulator, response.usage) || hasUsage;

                    const content = response.choices[0].message.content;
                    if (content) {
                        const healedJson = JSON.parse(content);
                        const healedGuide = this.asRecord(this.asRecord(healedJson)?.guide_extracted) || {};

                        for (const target of targets.fields) {
                            const healedValue = this.asRecord(healedGuide[target.key]);
                            if (!healedValue) continue;

                            const fieldSchema = model.fields.find((f) => f.key === target.key);
                            if (!fieldSchema) continue;

                            const cleanedValue = this.cleanHealedValue(healedValue.value);
                            const isUncertain = healedValue.is_uncertain === true;
                            if (this.isValueMissing(cleanedValue) && !isUncertain) continue;

                            const validatedField = this.validateAndFormat(
                                { guide_extracted: { [target.key]: { ...healedValue, value: cleanedValue } } },
                                { ...model, fields: [fieldSchema] },
                                ocrData.pages || []
                            );

                            if (validatedField[target.key]) {
                                result.guide_extracted[target.key] = validatedField[target.key];
                                console.log(`[ExtractionService] Field healed: ${target.key}`);
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn('[ExtractionService] Top-level healing failed:', err);
            }
        }

        // 2) Table required cell healing (row/cell targeted)
        if (targets.tableCells.length > 0) {
            const CELL_BATCH_SIZE = 30;
            const batches = this.chunkBySize(targets.tableCells, CELL_BATCH_SIZE);
            const fieldMap = new Map(model.fields.map((field) => [field.key, field]));
            let healedCellCount = 0;

            for (const batch of batches) {
                try {
                    const batchPrompt = this.buildTableCellHealingPrompt(batch, ocrData, model);
                    if (this.isLikelyPromptTooLarge(batchPrompt)) {
                        console.warn(
                            `[ExtractionService] Skipping healing batch due to prompt size risk. batch_size=${batch.length}`
                        );
                        continue;
                    }

                    const response = await this.openai.getCompletion(
                        [
                            {
                                role: 'system' as const,
                                content: 'You are a strict table cell recovery auditor. Return ONLY valid JSON.'
                            },
                            { role: 'user' as const, content: batchPrompt }
                        ],
                        undefined,
                        true,
                        4096,
                        0.0,
                        42,
                        true
                    );
                    hasUsage = this.accumulateUsage(usageAccumulator, response.usage) || hasUsage;

                    const content = response.choices[0].message.content;
                    if (!content) continue;

                    const parsed = JSON.parse(content);
                    const healedCells = this.asRecord(this.asRecord(parsed)?.healed_cells);
                    if (!healedCells) continue;

                    const taskMap = new Map(batch.map((task) => [task.task_id, task]));

                    for (const [taskId, rawHealedCell] of Object.entries(healedCells)) {
                        const task = taskMap.get(taskId);
                        if (!task) continue;

                        const healedCell = this.asRecord(rawHealedCell);
                        if (!healedCell) continue;

                        const cleanedValue = this.cleanHealedValue(healedCell.value);
                        const isUncertain = healedCell.is_uncertain === true;
                        if (this.isValueMissing(cleanedValue) && !isUncertain) continue;

                        const parentField = this.asRecord(result.guide_extracted[task.parent_key]);
                        if (!parentField || !Array.isArray(parentField.value)) continue;
                        if (task.row_index < 0 || task.row_index >= parentField.value.length) continue;

                        const row = this.asRecord(parentField.value[task.row_index]);
                        if (!row) continue;

                        const currentValue = this.extractCellValue(row[task.sub_key]);
                        if (!this.isValueMissing(currentValue)) continue;

                        const existingCell = this.asRecord(row[task.sub_key]) || {};
                        const parentSchema = fieldMap.get(task.parent_key);
                        const subSchema = parentSchema?.sub_fields?.find((sub) => sub.key === task.sub_key);
                        const healedRef = this.pickString(healedCell, ['ref']);
                        const healedPage = this.pickNumber(healedCell, ['page_number']);
                        const healedBBox = this._ensureBBoxFormat(healedCell.bbox);

                        const nextCell: Record<string, unknown> = {
                            ...existingCell,
                            value: cleanedValue,
                            confidence: this.pickNumber(healedCell, ['confidence']) || 0.9,
                            type: this.pickString(existingCell, ['type']) || subSchema?.type || 'text'
                        };

                        if (healedRef) nextCell.ref = healedRef;
                        if (healedPage) nextCell.page_number = healedPage;
                        if (healedBBox) nextCell.bbox = healedBBox;
                        if (isUncertain) nextCell.is_uncertain = true;

                        row[task.sub_key] = nextCell;
                        healedCellCount += 1;
                    }
                } catch (err) {
                    console.warn('[ExtractionService] Table-cell healing batch failed:', err);
                }
            }

            console.log(`[ExtractionService] Table-cell healing completed. healed_cells=${healedCellCount}`);
        }

        if (hasUsage) {
            result._debug_info = {
                ...(result._debug_info || {}),
                healing_pass_tokens: usageAccumulator,
            };
        }

        return result;
    }

    private _ensureBBoxFormat(bbox: any): number[] | undefined {
        if (!bbox) return undefined;
        try {
            if (Array.isArray(bbox) && bbox.length > 0) {
                // Case 1: Point2D[] ({x, y}[]) - Azure SDK v4 형태
                if (typeof bbox[0] === 'object' && bbox[0] !== null && 'x' in bbox[0]) {
                    const xs = bbox.map((p: any) => p.x).filter((v: any) => !isNaN(v));
                    const ys = bbox.map((p: any) => p.y).filter((v: any) => !isNaN(v));
                    if (xs.length === 0 || ys.length === 0) return undefined;
                    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
                }

                // Case 2: flat number[] [x1, y1, x2, y2, ...]
                if (bbox.length >= 8) {
                    const xs = bbox.filter((v: number, i: number) => i % 2 === 0 && !isNaN(v));
                    const ys = bbox.filter((v: number, i: number) => i % 2 === 1 && !isNaN(v));
                    if (xs.length === 0 || ys.length === 0) return undefined;
                    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
                } else if (bbox.length >= 4) {
                    const coords = bbox.slice(0, 4).map(v => isNaN(v) ? 0 : v);
                    return coords;
                }
            } else if (typeof bbox === 'object' && bbox !== null) {
                const x1 = Number(bbox.x1 ?? bbox.x ?? 0);
                const y1 = Number(bbox.y1 ?? bbox.y ?? 0);
                const x2 = bbox.x2 !== undefined ? Number(bbox.x2) : (Number(bbox.w ?? 0) + x1);
                const y2 = bbox.y2 !== undefined ? Number(bbox.y2) : (Number(bbox.h ?? 0) + y1);
                return [x1, y1, x2, y2];
            }
        } catch { /* ignore */ }
        return undefined;
    }

    /**
     * OCR words에서 추출된 값과 매칭하여 정확한 bbox 좌표를 획득 (from before)
     * LLM이 추측한 bbox 대신 OCR이 인식한 실제 단어 위치를 사용
     */
    private _snapBBoxToWords(
        value: string,
        approximateBBox: number[] | undefined,
        words: Array<{ content: string; polygon?: any; boundingPolygon?: any; confidence?: number }>
    ): number[] | undefined {
        if (!value || !words || words.length === 0) return approximateBBox;

        const cleanToken = (t: string) =>
            String(t).replace(/\s/g, '').replace(/,/g, '').replace(/\./g, '').replace(/-/g, '').toLowerCase();

        const valueClean = cleanToken(value);
        if (!valueClean) return approximateBBox;

        const getBBoxCenter = (b: number[]): [number, number] =>
            [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

        const getDist = (b1: number[], b2: number[]): number => {
            const c1 = getBBoxCenter(b1);
            const c2 = getBBoxCenter(b2);
            return Math.sqrt((c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2);
        };

        /**
         * polygon을 [x1, y1, x2, y2] bbox로 변환
         * Azure SDK는 Point2D[] ({x, y}[]) 또는 flat number[] 을 반환
         */
        const polygonToBBox = (poly: any): number[] | null => {
            if (!poly) return null;

            // Case 1: Point2D[] ({x, y}[]) - Azure SDK v4 형태
            if (Array.isArray(poly) && poly.length > 0 && typeof poly[0] === 'object' && 'x' in poly[0]) {
                const xs = poly.map((p: { x: number }) => p.x);
                const ys = poly.map((p: { y: number }) => p.y);
                return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
            }

            // Case 2: flat number[] [x1, y1, x2, y2, ...] - before 프로젝트 형태
            if (Array.isArray(poly) && poly.length >= 8 && typeof poly[0] === 'number') {
                const xs = poly.filter((_: number, i: number) => i % 2 === 0);
                const ys = poly.filter((_: number, i: number) => i % 2 === 1);
                return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
            }

            // Case 3: 4-element array [x1, y1, x2, y2]
            if (Array.isArray(poly) && poly.length >= 4 && typeof poly[0] === 'number') {
                return [poly[0], poly[1], poly[2], poly[3]];
            }

            return null;
        };

        /**
         * word에서 polygon 가져오기 (polygon 또는 boundingPolygon)
         */
        const getWordPolygon = (w: { polygon?: any; boundingPolygon?: any }): any => {
            return w.polygon || w.boundingPolygon;
        };

        interface Candidate {
            bbox: number[];
            score: number;
        }
        const candidates: Candidate[] = [];

        // 1. 정확히 일치하는 단어 검색
        for (const w of words) {
            const wContentClean = cleanToken(w.content);
            if (wContentClean === valueClean) {
                const bbox = polygonToBBox(getWordPolygon(w));
                if (bbox) candidates.push({ bbox, score: 1000 + wContentClean.length });
            }
        }

        // 2. 부분 일치 검색 (없으면)
        if (candidates.length === 0) {
            for (const w of words) {
                const wContentClean = cleanToken(w.content);
                // 1자(단일 기호, 숫자)는 제외하되, 2자(13, 02 등)는 날짜 구성 요소로서 허용
                if (wContentClean.length < 2 && valueClean.length > 5) continue;

                if (valueClean.includes(wContentClean) || wContentClean.includes(valueClean)) {
                    let score = wContentClean.length;

                    // 날짜 특화 가중치: 추출된 값의 뒷부분(월/일)과 일치하면 더 높은 점수 부여
                    // 연도(2026 등)는 헤더 등에 중복이 많아 오버 매칭 확률이 높기 때문
                    if (valueClean.endsWith(wContentClean) && valueClean.length >= 6) {
                        score += 20;
                    }
                    // 4자리 연도만 있는 경우 가중치 낮춤
                    if (/^(19|20)\d{2}$/.test(wContentClean)) {
                        score -= 10; // 연도 가중치 더 낮춤
                    }

                    const bbox = polygonToBBox(getWordPolygon(w));
                    if (bbox) candidates.push({ bbox, score });
                }
            }
        }

        // 가장 점수가 높은 후보 선택
        if (candidates.length > 0) {
            candidates.sort((a, b) => b.score - a.score);
            return candidates[0].bbox;
        }

        // 3. 연속 단어 조합 검색 (없으면)
        if (candidates.length === 0) {
            for (let i = 0; i < words.length; i++) {
                let combined = '';
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (let j = i; j < Math.min(i + 10, words.length); j++) {
                    combined += cleanToken(words[j].content);
                    const bbox = polygonToBBox(getWordPolygon(words[j]));
                    if (bbox) {
                        minX = Math.min(minX, bbox[0]);
                        minY = Math.min(minY, bbox[1]);
                        maxX = Math.max(maxX, bbox[2]);
                        maxY = Math.max(maxY, bbox[3]);
                    }
                    // 포함 관계 검사 방향 수정: valueClean이 combined를 포함하는 경우도 허용 (2/13 등 분절 대응)
                    if (combined === valueClean || valueClean.includes(combined) || combined.includes(valueClean)) {
                        candidates.push({
                            bbox: [minX, minY, maxX, maxY],
                            score: 50 + combined.length
                        });
                        if (combined.length >= valueClean.length) break;
                    }
                }
            }
        }

        if (candidates.length === 0) return approximateBBox;
        if (!approximateBBox) {
            candidates.sort((a, b) => b.score - a.score);
            return candidates[0].bbox;
        }

        // 가장 가까운 후보 선택
        let bestBBox = candidates[0].bbox;
        let minDist = Infinity;
        for (const cand of candidates) {
            const d = getDist(approximateBBox, cand.bbox);
            if (d < minDist) {
                minDist = d;
                bestBBox = cand.bbox;
            }
        }
        return bestBBox;
    }

    /**
     * 여러 페이지에서 값을 찾아 bbox 스냅 시도
     */
    private _findAndSnapBBox(
        value: string,
        rawBBox: number[] | undefined,
        defaultPage: number,
        pages: any[]
    ): { snappedBBox: number[] | undefined; finalPage: number } {
        if (!value || !pages || pages.length === 0) {
            return { snappedBBox: rawBBox, finalPage: defaultPage };
        }

        // 1차: 지정된 페이지에서 시도
        const targetPageData = pages.find((p: any) => (p.pageNumber || p.page_number) === defaultPage);
        if (targetPageData?.words) {
            const snapped = this._snapBBoxToWords(value, rawBBox, targetPageData.words);
            if (snapped && snapped !== rawBBox) {
                return { snappedBBox: snapped, finalPage: defaultPage };
            }
        }

        // 2차: 다른 페이지에서 검색
        for (const pageData of pages) {
            const pageNum = pageData.pageNumber || pageData.page_number;
            if (pageNum === defaultPage) continue;
            if (pageData.words) {
                const snapped = this._snapBBoxToWords(value, rawBBox, pageData.words);
                if (snapped && snapped !== rawBBox) {
                    return { snappedBBox: snapped, finalPage: pageNum };
                }
            }
        }

        return { snappedBBox: rawBBox, finalPage: defaultPage };
    }

    /**
     * bbox 좌표를 0-100 퍼센트로 정규화 (from before)
     * 다양한 좌표 형식 지원: 인치, 포인트, 픽셀
     */
    private _normalizeBBox(
        bbox: number[] | undefined,
        pageWidth: number = 0,
        pageHeight: number = 0
    ): number[] | undefined {
        if (!bbox || bbox.length < 4) return undefined;

        const [x1, y1, x2, y2] = bbox;
        const coords = [x1, y1, x2, y2];
        const maxCoord = Math.max(...coords);
        const allWithinRatio = coords.every(v => v >= 0 && v <= 1.01);
        const allWithinPercent = coords.every(v => v >= 0 && v <= 101);

        // Case 1: 페이지 크기가 제공된 경우 → 정밀 변환
        if (pageWidth > 0 && pageHeight > 0) {
            // Case 1-1: 0~1 비율 좌표 (CU에서 종종 등장)
            if (allWithinRatio && (pageWidth > 100 || pageHeight > 100)) {
                return [
                    x1 * 100,
                    y1 * 100,
                    x2 * 100,
                    y2 * 100
                ];
            }

            // Case 1-2: 이미 0~100 퍼센트 좌표
            if (allWithinPercent) {
                const looksLikeAbsoluteInch =
                    pageWidth <= 30 &&
                    pageHeight <= 30 &&
                    maxCoord <= Math.max(pageWidth, pageHeight) + 1;

                if (!looksLikeAbsoluteInch) {
                    return bbox;
                }
            }

            // Case 1-3: 절대 좌표(페이지 단위) → 퍼센트 변환
            return [
                (x1 / pageWidth) * 100,
                (y1 / pageHeight) * 100,
                (x2 / pageWidth) * 100,
                (y2 / pageHeight) * 100
            ];
        }

        // Case 2: 페이지 크기 없음 + 0~1 비율 좌표
        if (allWithinRatio) {
            return [
                x1 * 100,
                y1 * 100,
                x2 * 100,
                y2 * 100
            ];
        }

        // Case 3: 페이지 크기 없음 + 인치 좌표(추정)
        if (coords.every(v => v >= 0 && v <= 20)) {
            const defaultW = 8.27;  // A4 Width
            const defaultH = 11.69; // A4 Height
            return [
                Number(((x1 / defaultW) * 100).toFixed(4)),
                Number(((y1 / defaultH) * 100).toFixed(4)),
                Number(((x2 / defaultW) * 100).toFixed(4)),
                Number(((y2 / defaultH) * 100).toFixed(4))
            ];
        }

        // Case 4: 픽셀/포인트 좌표
        if (x2 > 100 || y2 > 100) {
            const estW = Math.max(x2 * 1.1, 612);
            const estH = Math.max(y2 * 1.1, 792);
            return [
                (x1 / estW) * 100,
                (y1 / estH) * 100,
                (x2 / estW) * 100,
                (y2 / estH) * 100
            ];
        }

        // Case 5: 이미 퍼센트
        if (allWithinPercent) {
                return bbox;
        }

        return undefined;
    }
}
