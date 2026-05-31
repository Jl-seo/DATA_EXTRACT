import { z } from 'zod';
import { UserObject } from './common';
import { File } from './file'; // Reuse File schema
import dayjs from '@/lib/dayjs';

export const EXTRACTION_SUCCESS = { log: 'success', title: '완료' } as const;
export const EXTRACTION_ERROR = { log: 'error', title: '실패' } as const;
export const EXTRACTION_PROCESSING = { log: 'processing', title: '진행 중' } as const;
export const EXTRACTION_PENDING = { log: 'pending', title: '대기 중' } as const;

export const EXTRACTION_STATUS = z.enum([
    EXTRACTION_SUCCESS.log,
    EXTRACTION_ERROR.log,
    EXTRACTION_PROCESSING.log,
    EXTRACTION_PENDING.log,
]);
export type EXTRACTION_STATUS = z.infer<typeof EXTRACTION_STATUS>;

/**
 * <extraction_log 스키마>
 * id: uuid
 * model_id: 사용된 ExtractionModel ID
 * status: success, error, processing
 * filename: 파일명
 * file_url: Blob URL
 * extracted_data: 추출된 핵심 데이터 (JSON)
 * preview_data: UI 렌더링용 미리보기 데이터 (bbox 등 포함)
 * debug_data: 디버깅용 Raw 데이터
 * error_message: 에러 메시지
 * created_at: 만든 날짜
 * created_by: 만든 사람
 */

export const ExtractionLogBase = z.object({
    id: z.string().default(() => crypto.randomUUID()),
    partition_key: z.string().optional(), // Usually model_id
    model_id: z.string(),
    model_name: z.string().optional(), // Denormalized for display

    status: EXTRACTION_STATUS.default(EXTRACTION_PENDING.log),

    filename: z.string(),
    file: File.optional(), // Full file object if available
    file_url: z.string().optional().nullable(), // SAS URL for UI display
    candidate_files: z.array(z.any()).optional(), // List of candidate files for comparison

    extracted_data: z.any().optional().nullable(),
    preview_data: z.any().optional().nullable(),
    debug_data: z.any().optional().nullable(),

    metadata: z.record(z.string(), z.any()).optional().nullable(),
    webhook_url: z.string().url().optional().nullable(),
    super_model_id: z.string().optional().nullable(),

    error_message: z.string().optional().nullable(),

    created_at: z.string().default(() => dayjs().utc().toISOString()),
    created_by: UserObject,
    modified_at: z.string().optional(),
    modified_by: UserObject.optional(),

    // Job specific fields (merged from ExtractionJob for simplicity in Next.js)
    next_checked_at: z.string().optional(),
    retry_count: z.number().default(0),
    lease: z.object({
        owner: z.string().nullable(),
        until: z.string().nullable(),
    }).default({
        owner: null,
        until: null,
    }),

    // Grouped fields (Super Models)
    is_grouped: z.boolean().optional(),
    group_count: z.number().optional(),
    sub_model_ids: z.array(z.string()).optional(),
    logs: z.array(z.any()).optional(),
});

export const ExtractionLog = ExtractionLogBase.transform((data) => ({
    ...data,
    partition_key: data.partition_key ?? data.model_id,
    modified_at: data.modified_at ?? data.created_at,
    modified_by: data.modified_by ?? data.created_by,
}));

export type ExtractionLog = z.infer<typeof ExtractionLog>;

// --- Requests ---

export const ExtractionLogListRequest = z.object({
    offset: z.coerce.number().nullish().default(0),
    pageSize: z.coerce.number().nullish().default(10),
    modelId: z.string().nullish(),
    filename: z.string().nullish(),
    status: EXTRACTION_STATUS.nullish(),
    dateStart: z.string().nullish(),
    dateEnd: z.string().nullish(),
    createdBy: z.string().nullish(),
    count: z.coerce.boolean().optional(),
});

export type ExtractionLogListRequest = z.infer<typeof ExtractionLogListRequest>;

export const ExtractionLogCreateRequest = z.object({
    model_id: z.string(),
    file_id: z.string(), // Reference to uploaded file
});

export type ExtractionLogCreateRequest = z.infer<typeof ExtractionLogCreateRequest>;

export const ExtractionStatusPoolRequest = z.object({
    limit: z.coerce.number().nullish().default(20),
});

export type ExtractionStatusPoolRequest = z.infer<typeof ExtractionStatusPoolRequest>;
