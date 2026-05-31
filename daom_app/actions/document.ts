'use server';

import 'server-only';
import BlobStorageService from '@/services/BlobStorageService';
import { DocIntelligenceService } from '@/services/DocIntelligenceService';
import { getCurrentEnvConfig } from '@/lib/env';
import { AnalysisRequest, AnalysisResponse } from '@/scheme/document';

/**
 * 문서 분석 (OCR + 구조화)
 * 기존 extraction 로직 활용
 */
export async function analyzeDocument(request: AnalysisRequest): Promise<AnalysisResponse> {
    try {
        const validated = AnalysisRequest.parse(request);
        const envConfig = await getCurrentEnvConfig();

        // Use existing DocIntelligence service
        const docIntelService = new DocIntelligenceService(envConfig);
        const result = await docIntelService.analyzeDocument(validated.file_url);

        return {
            status: 'SUCCESS',
            extracted_text: result.content || '',
            structured_data: result,
        };
    } catch (error) {
        return {
            status: 'ERROR',
            extracted_text: `Analysis failed: ${error}`,
        };
    }
}
