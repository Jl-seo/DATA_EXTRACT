import { z } from 'zod';

/**
 * Document Upload Response
 */
export const DocumentUploadResponse = z.object({
    filename: z.string(),
    url: z.string(),
    message: z.string(),
});

export type DocumentUploadResponse = z.infer<typeof DocumentUploadResponse>;

/**
 * Analysis Request
 */
export const AnalysisRequest = z.object({
    file_url: z.string().url(),
    model_id: z.string().optional(),
    language: z.string().default('ko'),
});

export type AnalysisRequest = z.infer<typeof AnalysisRequest>;

/**
 * Analysis Response
 */
export const AnalysisResponse = z.object({
    status: z.enum(['SUCCESS', 'ERROR', 'PENDING']),
    extracted_text: z.string().optional(),
    structured_data: z.record(z.string(), z.any()).optional(),
});

export type AnalysisResponse = z.infer<typeof AnalysisResponse>;
