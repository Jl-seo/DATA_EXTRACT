import { type ExtractionStatusType } from './constants/status';

/**
 * Sub-document structure for multi-page document splitting
 */
export interface SubDocument {
    id?: string;
    model_id?: string;
    index: number;
    type?: string;
    page_range?: [number, number];
    page_ranges?: number[];
    filename?: string;
    status: 'success' | 'error' | 'review_needed';
    data?: {
        guide_extracted: Record<string, any>;
        other_data: any[];
    };
    file?: {
        filename: string;
        blob_path: string;
    };
    raw_content?: string;
    beta_metadata?: {
        parsed_content?: string;
        [key: string]: any;
    };
    history?: any[];
}

/**
 * Preview data structure returned from extraction job
 */
export interface PreviewData {
    guide_extracted: Record<string, any>;
    other_data: Array<{ column: string; value: any; confidence?: number; bbox?: number[] }>;
    model_fields: Array<{ key: string; label: string }>;
    debug_data?: any;
    sub_documents?: SubDocument[];
    raw_content?: string;
    beta_metadata?: {
        parsed_content?: string;
        [key: string]: any;
    };
    mode?: 'extraction' | 'comparison';
    raw_tables?: any[];
    comparison_result?: {
        differences: Array<{
            id: string | number;
            description: string;
            category: string;
            location_1: number[] | null;
            location_2: number[] | null;
            page_number?: number;
        }>;
        error?: string;
    };
    comparisons?: Array<{
        candidate_index: number;
        result: {
            differences: Array<{
                id: string | number;
                description: string;
                category: string;
                location_1: number[] | null;
                location_2: number[] | null;
                page_number?: number;
            }>;
            error?: string;
        };
        file_url?: string;
        error?: string;
    }>;
}

/**
 * Extraction model definition
 */
export interface ExtractionModel {
    id: string;
    name: string;
    description: string;
    llm_model?: string | null;
    webhook_url?: string | null;
    fields: Array<{
        key: string;
        label: string;
        type?: string;
        sub_fields?: Array<{ key: string; label: string; type?: string }>;
    }>;
    allowedGroups?: string[];
    model_type?: 'extraction' | 'comparison';
    beta_features?: {
        use_optimized_prompt?: boolean;
        use_virtual_excel_ocr?: boolean;
        use_vision_extraction?: boolean;
        disable_parallel_paging?: boolean;
        multifile_strategy?: 'separate' | 'merged';
        ocr_engine?: 'di' | 'cu' | 'vision';
        cu_analyzer_id?: string;
        cu_api_version?: string;
        enable_barcode_scan?: boolean;
        barcode_multi_scan?: boolean;
        use_direct_table_mapper?: boolean;
        vision_extraction?: boolean;
        [key: string]: string | number | boolean | null | undefined;
    };
    is_super_model?: boolean;
    sub_model_ids?: string[];
    data_structure?: string;
}


/**
 * Extraction log record from database
 */
export interface ExtractionLog {
    id: string;
    model_id: string;
    super_model_id?: string;
    model_name?: string;
    user_id?: string;        // 하위 호환 (API에서 매핑)
    user_name?: string;      // 하위 호환 (API에서 매핑)
    user_email?: string;
    created_by?: {           // DB 실제 필드
        name?: string;
        object_id?: string;
        upn?: string;
    };
    modified_by?: {
        name?: string;
        object_id?: string;
        upn?: string;
    };
    filename: string;
    file_url?: string;
    file?: { id: string; filename: string; blob_path: string };
    status: ExtractionStatusType | string;
    extracted_data?: Record<string, any>;
    preview_data?: PreviewData;
    job_id?: string;
    debug_data?: any;
    error?: string;
    error_message?: string;  // DB 실제 필드
    created_at: string;
    updated_at?: string;
    modified_at?: string;
    retry_count?: number;
    metadata?: Record<string, any>;
    webhook_url?: string;
    is_grouped?: boolean;
    group_count?: number;
    logs?: ExtractionLog[];
}


/**
 * PDF 페이지 위에 오버레이할 하이라이트 영역 (bbox 기반)
 */
export interface Highlight {
    fieldKey?: string;
    content: string;
    pageIndex: number; // 0-based
    position: {
        polygon?: number[];
        boundingRect: {
            x1: number;
            y1: number;
            x2: number;
            y2: number;
            width: number;
            height: number;
        };
    };
}

export type ViewStep = 'history' | 'upload' | 'review' | 'complete';
export type ExtractionStatus = ExtractionStatusType | 'idle';
