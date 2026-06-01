import 'server-only';
import { ResourcePoolBase } from './ResourcePoolBase';
import { DocIntelResource } from '@/scheme/docIntel';
import { DAOMEnvConfig } from '@/scheme/env';
import { DocumentAnalysisClient, AzureKeyCredential, FormRecognizerFeature } from '@azure/ai-form-recognizer';

export interface AnalyzeResult {
    content: string;
    pages?: any[];
    paragraphs?: any[];
    tables?: any[];
    keyValuePairs?: any[];
    documents?: any[];
    styles?: any[];
}

export class DocIntelligenceService extends ResourcePoolBase<DocIntelResource> {
    constructor(envConfig: DAOMEnvConfig) {
        const resources = envConfig.document_intelligence ?? [];
        super(envConfig, resources);
    }

    // TEMP: DI 고해상도 OCR 옵션 임시 활성화 (확인 후 false로 복구)
    private readonly enableHighResolutionOcr = false;

    /**
     * Analyze document from URL or Base64/Buffer
     * @param fileSource URL string or base64 encoded string (or Buffer if supported by client)
     * @param modelId Azure model ID (default: prebuilt-layout)
     */
    async analyzeDocument(
        fileSource: string | Buffer,
        modelId: string = 'prebuilt-layout'
    ): Promise<AnalyzeResult> {
        const { resource, index } = this.getBestResource();
        if (!resource) {
            throw new Error('No Document Intelligence resource available');
        }

        const endpointHost = (() => {
            try {
                return new URL(resource.endpoint).host;
            } catch {
                return resource.endpoint;
            }
        })();

        const client = new DocumentAnalysisClient(
            resource.endpoint,
            new AzureKeyCredential(resource.key)
        );
        const analyzeOptions = this.enableHighResolutionOcr
            ? { features: [FormRecognizerFeature.OcrHighResolution] }
            : undefined;

        try {
            let poller;

            if (this.isUrl(fileSource)) {
                console.log(
                    `[DocIntelligence] 호출 시작 | model=${modelId} | resourceIndex=${index ?? -1} | resourceId=${resource.id || 'unknown'} | endpoint=${endpointHost} | source=url | highRes=${this.enableHighResolutionOcr}`
                );
                poller = await client.beginAnalyzeDocumentFromUrl(modelId, fileSource as string, analyzeOptions);
            } else {
                console.log(
                    `[DocIntelligence] 호출 시작 | model=${modelId} | resourceIndex=${index ?? -1} | resourceId=${resource.id || 'unknown'} | endpoint=${endpointHost} | source=buffer | highRes=${this.enableHighResolutionOcr}`
                );

                const buffer = typeof fileSource === 'string'
                    ? Buffer.from(fileSource, 'base64')
                    : fileSource;
                poller = await client.beginAnalyzeDocument(modelId, buffer, analyzeOptions);
            }

            const result = await poller.pollUntilDone();
            console.log(
                `[DocIntelligence] 호출 완료 | model=${modelId} | pages=${result.pages?.length || 0} | contentLength=${result.content?.length || 0}`
            );

            return {
                content: result.content || '',
                pages: result.pages || [],
                paragraphs: result.paragraphs || [],
                tables: result.tables || [],
                keyValuePairs: result.keyValuePairs || [],
                documents: result.documents || [],
                styles: result.styles || []
            };
        } catch (error: any) {
            const detail = error.details || error.message || String(error);
            console.error('[DocIntelligence] Analysis failed:', {
                message: error.message,
                code: error.code,
                statusCode: error.statusCode,
                details: detail,
                modelId
            });
            const wrapped = new Error(`[DI] Analysis failed: ${error.message || String(error)}`) as Error & Record<string, unknown>;
            wrapped.service = 'di';
            wrapped.phase = 'analyze';
            wrapped.model_id = modelId;
            wrapped.resource_id = resource.id || null;
            wrapped.endpoint = endpointHost;
            wrapped.source_type = this.isUrl(fileSource) ? 'url' : 'buffer';
            wrapped.code = typeof error.code === 'string' ? error.code : undefined;
            wrapped.status = typeof error.statusCode === 'number' ? error.statusCode : undefined;
            wrapped.details = detail;
            wrapped.cause = error;
            throw wrapped;
        }

    }

    /**
     * Helper to check if file source is a URL
     */
    private isUrl(source: string | Buffer): boolean {
        if (typeof source !== 'string') return false;
        return source.startsWith('http://') || source.startsWith('https://');
    }
}
