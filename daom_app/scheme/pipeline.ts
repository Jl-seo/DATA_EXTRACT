import { AnalyzeResult } from '@/services/DocIntelligenceService';

// Base types from Azure
export interface AzureOcrPage {
    pageNumber?: number;
    page_number?: number;
    width?: number;
    height?: number;
    words?: AzureOcrWord[];
}

export interface AzureOcrWord {
    content: string;
    boundingBox?: number[];
    polygon?: number[];
    span?: { offset: number; length: number };
}

export interface AzureOcrTable {
    cells?: AzureOcrTableCell[];
    [key: string]: unknown;
}

export interface AzureOcrTableCell {
    content?: string;
    rowIndex?: number;
    row_index?: number;
    columnIndex?: number;
    column_index?: number;
    rowSpan?: number;
    row_span?: number;
    columnSpan?: number;
    column_span?: number;
    boundingRegions?: Array<{ polygon: number[]; pageNumber?: number; page_number?: number }>;
    bounding_regions?: Array<{ polygon: number[]; pageNumber?: number; page_number?: number }>;
    spans?: Array<{ offset: number; length: number }>;
}

export interface AzureOcrParagraph {
    content: string;
    spans?: Array<{ offset: number; length: number }>;
    boundingRegions?: Array<{ polygon: number[]; pageNumber?: number; page_number?: number }>;
    bounding_regions?: Array<{ polygon: number[]; pageNumber?: number; page_number?: number }>;
    [key: string]: unknown;
}

// Augmented Types for LayoutParser
export interface PipelineOcrPage extends AzureOcrPage {
    global_page_number: number;
    file_id: string;
    file_content_offset: number;
    page_number?: number;
}

export interface PipelineOcrTable extends AzureOcrTable {
    file_id: string;
    file_content_offset: number;
}

export interface PipelineOcrParagraph extends AzureOcrParagraph {
    file_id: string;
    file_content_offset: number;
}

export interface PipelineOcrData extends AnalyzeResult {
    _is_direct_markdown?: boolean;
    pages?: AzureOcrPage[];
    tables?: AzureOcrTable[];
    paragraphs?: AzureOcrParagraph[];
}

export interface WorkOrderField {
    key: string;
    instruction: string;
    expected_format?: string;
    rules?: string[];
    columns?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface WorkOrder {
    work_order: {
        document_type?: string;
        extraction_mode?: string;
        common_fields?: WorkOrderField[];
        table_fields?: WorkOrderField[];
        integrity_rules?: string[];
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface EngineerTokenUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

export interface EngineerOutput {
    _truncated?: boolean;
    _token_usage?: EngineerTokenUsage;
    [key: string]: unknown;
}

export interface PipelineResult {
    guide_extracted: Record<string, unknown>;
    raw_content: string;
    raw_tables: unknown[];
    token_usage: EngineerTokenUsage;
    work_order?: WorkOrder;
    other_data?: unknown[];
    error?: string;
    beta_metadata: {
        parsed_content?: string;
        ref_map?: Record<string, unknown>;
        pipeline_mode: string;
        image_size_kb?: number;
        mime_type?: string;
    };
    model_name: string;
    duration_seconds: number;
    _debug_info?: {
        token_usage: EngineerTokenUsage;
        llm_request_bodies?: Array<Record<string, unknown>>;
    };
}
