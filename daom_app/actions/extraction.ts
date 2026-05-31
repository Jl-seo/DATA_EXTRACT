'use server';
import 'server-only';

import { headers } from 'next/headers';
import { after } from 'next/server';
import { ExtractionLog } from '@/scheme/extractionLog';
import { ExtractionModel } from '@/scheme/extractionModel';
import { DocIntelligenceService } from '@/services/DocIntelligenceService';
import { OpenAIService } from '@/services/OpenAIService';
import { ExtractionService } from '@/services/ExtractionService';
import CosmosDBService from '@/services/CosmosDBService';
import BlobStorageService from '@/services/BlobStorageService';
import PermissionService from '@/services/PermissionService';
import MSFlowService from '@/services/MSFlowService';
import { getCurrentEnvConfig } from '@/lib/env';
import { buildErrorTrace } from '@/lib/errorTrace';
import { logAction } from '@/actions/audit';
import { sendWebhook } from '@/lib/webhook';
import { DAOMEnvConfig } from '@/scheme/env';
import { z } from 'zod';

export async function startExtraction(
    fileId: string,
    modelId: string,
    candidateFileIds?: string[],
    metadata?: Record<string, any> | null,
    webhookUrl?: string | null
) {
    fileId = fileId.trim();
    modelId = modelId.trim();

    // 1. Setup Services & Auth
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const cosmosDBService = new CosmosDBService(envConfig);
    const blobStorageService = new BlobStorageService(envConfig);
    const docIntelService = new DocIntelligenceService(envConfig);

    // 2. Fetch Model
    const modelContainer = await cosmosDBService.getContainer('extraction_models');
    const { resource: model } = await modelContainer.item(modelId, 'model').read<ExtractionModel>();
    if (!model) throw new Error('Model not found');

    const openaiService = new OpenAIService(envConfig, { defaultModel: model.llm_model });
    const extractionService = new ExtractionService(docIntelService, openaiService);

    // 3. Fetch File Info (Simulated - assuming fileId is effectively the blob name or ID in 'files')    
    const filesContainer = await cosmosDBService.getContainer('files');
    // Assuming fileId is the 'id' in files container. We need partition key?
    // We'll query by ID
    const { resources: files } = await filesContainer.items.query({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: fileId }]
    }).fetchAll();

    const fileRecord = files[0];
    if (!fileRecord) throw new Error('File record not found');

    const filename = fileRecord.filename;
    // stored path in blob? 'files' schema says 'blob_path'
    const blobPath = fileRecord.blob_path;

    // 4. Create Init Log (최소 정보로 우선 생성하여 즉시 응답)
    const logsContainer = await cosmosDBService.getContainer('extraction_logs');
    const logId = crypto.randomUUID();

    const initLog: ExtractionLog = {
        id: logId,
        model_id: modelId,
        super_model_id: undefined, // after()에서 조회 후 업데이트
        status: 'processing',
        filename: filename,
        file: fileRecord,
        candidate_files: undefined, // after()에서 조회 후 업데이트
        created_at: new Date().toISOString(),
        created_by: { name: user.name, object_id: user.oid, upn: user.upn },
        modified_at: new Date().toISOString(),
        modified_by: { name: user.name, object_id: user.oid, upn: user.upn },
        partition_key: modelId,
        metadata: metadata || undefined,
        webhook_url: webhookUrl || undefined,
        retry_count: 0,
        lease: { owner: null, until: null }
    };

    await logsContainer.items.create(initLog);

    // 5. 무거운 조회 및 추출 프로세스는 after() 블록에서 수행
    after(async () => {
        const actualBlobPath = `${envConfig.id}/${blobPath}`;
        const cleanups: (() => Promise<void>)[] = [];
        let llmModelForAudit = '';

        try {
            console.log(`[Extraction] Starting background initialization for ${logId}...`);
            try {
                llmModelForAudit = await openaiService.getResolvedDeployment();
            } catch (llmSettingError) {
                console.warn(`[Extraction] LLM 설정 조회 실패 (logId=${logId}):`, llmSettingError);
            }

            // 5.1. 후보 파일 조회 (비동기 이동)
            const candidates: any[] = [];
            if (candidateFileIds && candidateFileIds.length > 0) {
                for (const cId of candidateFileIds) {
                    const { resources: cRecords } = await filesContainer.items.query({
                        query: 'SELECT * FROM c WHERE c.id = @id',
                        parameters: [{ name: '@id', value: cId }]
                    }).fetchAll();
                    if (cRecords[0]) candidates.push(cRecords[0]);
                }
            }

            // 5.2. Super Model ID 조회 (비동기 이동)
            let superModelId: string | undefined = undefined;
            const { resources: superModels } = await modelContainer.items.query({
                query: 'SELECT c.id FROM c WHERE ARRAY_CONTAINS(c.sub_model_ids, @modelId)',
                parameters: [{ name: '@modelId', value: modelId }]
            }).fetchAll();
            if (superModels[0]) superModelId = superModels[0].id;

            // 5.3. 로그 업데이트 (필요한 경우에만)
            if (candidates.length > 0 || superModelId) {
                initLog.candidate_files = candidates.length > 0 ? candidates : undefined;
                initLog.super_model_id = superModelId;

                // [V21 FIX] undefined 값을 패치하려고 하면 Cosmos DB에서 400 에러 발생하므로 조건부 패치 수행
                const patchOps: any[] = [];
                if (initLog.candidate_files !== undefined) {
                    patchOps.push({ op: 'set', path: '/candidate_files', value: initLog.candidate_files });
                }
                if (initLog.super_model_id !== undefined) {
                    patchOps.push({ op: 'set', path: '/super_model_id', value: initLog.super_model_id });
                }

                if (patchOps.length > 0) {
                    await logsContainer.item(logId, modelId).patch(patchOps);
                }
            }

            console.log(`[Extraction] Starting background job ${logId} for ${filename}...`);

            let result: any;
            // If it's a comparison model, run comparison pipeline
            if (model.model_type === 'comparison' && candidates.length > 0) {
                const { sasUrl: tempSasUrl, cleanup: mainCleanup } = await blobStorageService.generateTempSasUrl(
                    actualBlobPath,
                    BlobStorageService.SAS.READ(120)
                );
                if (mainCleanup) cleanups.push(mainCleanup);

                const candidateSasUrls: string[] = [];
                for (const cand of candidates) {
                    const candPath = `${envConfig.id}/${cand.blob_path}`;
                    const { sasUrl: candSas, cleanup: candCleanup } = await blobStorageService.generateTempSasUrl(
                        candPath,
                        BlobStorageService.SAS.READ(120)
                    );
                    if (candCleanup) cleanups.push(candCleanup);
                    candidateSasUrls.push(candSas);
                }
                result = await extractionService.compare(tempSasUrl, candidateSasUrls, model);
            } else {
                const lowerFilename = filename.toLowerCase();
                const isExcelFile =
                    lowerFilename.endsWith('.xlsx') ||
                    lowerFilename.endsWith('.xls') ||
                    lowerFilename.endsWith('.csv');
                const useVision = isVisionModeEnabled(model.beta_features);
                const getFreshFileSource = async (): Promise<string | Buffer> => {
                    const { sasUrl, tempBlobPath, cleanup } = await blobStorageService.generateTempSasUrl(
                        actualBlobPath,
                        BlobStorageService.SAS.READ(120)
                    );
                    if (cleanup) cleanups.push(cleanup);

                    // 랜딩존/사설 네트워크에서 SAS URL fetch TLS 실패를 피하기 위해
                    // Excel/Vision 경로는 Blob SDK로 Buffer를 직접 다운로드해 전달한다.
                    if (isExcelFile || useVision) {
                        return tempBlobPath
                            ? await blobStorageService.downloadTempBuffer(tempBlobPath)
                            : await blobStorageService.downloadBuffer(actualBlobPath);
                    }

                    return sasUrl;
                };

                result = await extractionService.extract(getFreshFileSource, model, filename);
            }

            if (result) {
                // 7.1. Create Clean Data for extracted_data (Values only)
                const cleanData: Record<string, any> = {};
                Object.entries(result.guide_extracted).forEach(([key, field]: [string, any]) => {
                    cleanData[key] = (field && typeof field === 'object' && 'value' in field) ? field.value : field;
                });

                const previewData = {
                    other_data: result.other_data || [],
                    raw_content: result.raw_content || '',
                    raw_tables: result.raw_tables || [],
                    guide_extracted: result.guide_extracted,
                    beta_metadata: result.beta_metadata || {},
                    comparisons: result.comparisons || (result.guide_extracted as any)?.comparisons,
                    mode: result.mode || (model.model_type === 'comparison' ? 'comparison' : 'extraction'),
                    comparison_count: result.comparison_count || (result.mode === 'comparison' ? (result.comparisons?.length || 0) : 0)
                };

                const { data: finalPreviewData } = await blobStorageService.maybeOffloadData(logId, previewData);

                const successLog = {
                    ...initLog,
                    status: 'success' as const,
                    extracted_data: cleanData,
                    preview_data: finalPreviewData,
                    debug_data: {
                        ...(result._debug_info || {}),
                        beta_metadata: result.beta_metadata,
                    },
                    modified_at: new Date().toISOString()
                };
                const llmModelFromResult =
                    extractLlmModelFromUnknown(result._debug_info) ||
                    (typeof result.llm_model === 'string' ? result.llm_model : undefined) ||
                    llmModelForAudit;
                successLog.debug_data = {
                    ...(successLog.debug_data || {}),
                    llm_model: llmModelFromResult || undefined,
                };

                const {
                    document: successLogToSave,
                    itemSizeBytes,
                    offloadedFields
                } = await blobStorageService.fitDocumentToItemLimit({
                    logId,
                    document: sanitizeForStorage(successLog) as Record<string, unknown>
                });

                console.info('[Extraction] success log size', {
                    logId,
                    itemSizeBytes,
                    offloadedFields
                });

                // replace 대신 upsert 사용 (404 방지)
                await logsContainer.items.upsert(successLogToSave);
                console.log(`[Extraction] Background job ${logId} success.`);

                // 7.2. Trigger Automatic Webhook if configured
                try {
                    const host = await getHost();
                    await executeWebhook(successLog, model, envConfig, user, host);
                } catch (webhookErr: any) {
                    console.error(`[Extraction] Automatic webhook failed for ${logId}:`, webhookErr.message);
                }

                // 감사 로그: 추출 성공
                await logAction({
                    userId: user.oid,
                    userEmail: user.upn,
                    tenantId: envConfig.id,
                    action: 'EXTRACT',
                    resourceType: 'extraction',
                    resourceId: logId,
                    status: 'SUCCESS',
                    details: {
                        modelId,
                        modelName: model.name,
                        llmModel: llmModelFromResult || undefined,
                        filename,
                        diPageCount: result.di_page_count,
                        tokenUsage: result._debug_info?.token_usage || result.token_usage
                    },
                });
            }
        } catch (error: any) {
            console.error(`[Extraction] Background job ${logId} failed:`, error);
            const errorTrace = buildErrorTrace(error, {
                phase: 'background_extraction',
                log_id: logId,
                model_id: modelId,
                filename,
            });
            const failedDebug = extractFailedExtractionDebug(error);

            const failedPreviewData = failedDebug.ocr_text_preview
                ? {
                    other_data: [],
                    raw_content: failedDebug.ocr_text_preview,
                    raw_tables: [],
                    guide_extracted: {},
                    mode: 'extraction' as const,
                }
                : undefined;

            // Update Log with Error
            const errorLog = {
                ...initLog,
                status: 'error',
                error_message: error.message || String(error),
                preview_data: failedPreviewData,
                debug_data: {
                    error_trace: errorTrace,
                    llm_model: llmModelForAudit || undefined,
                    extraction_path: failedDebug.extraction_path,
                    failed_ocr_text: failedDebug.ocr_text_preview,
                    failed_ocr_text_length: failedDebug.ocr_text_length,
                    failed_page_count: failedDebug.page_count,
                },
                modified_at: new Date().toISOString()
            };

            // replace 대신 upsert 사용
            await logsContainer.items.upsert(errorLog);

            // 감사 로그: 추출 실패
            await logAction({
                userId: user.oid,
                userEmail: user.upn,
                tenantId: envConfig.id,
                action: 'EXTRACT',
                    resourceType: 'extraction',
                    resourceId: logId,
                    status: 'FAILURE',
                    details: {
                        modelId,
                        modelName: model.name,
                        llmModel: llmModelForAudit || undefined,
                        filename,
                        error: error.message || String(error),
                        error_trace: errorTrace,
                    },
                });
        } finally {
            // Clean up all temporary blobs
            if (cleanups.length > 0) {
                console.log(`[Extraction] Cleaning up ${cleanups.length} temporary blobs for ${logId}...`);
                await Promise.all(cleanups.map(cleanup => cleanup().catch(e => console.warn('[Extraction] Cleanup failed:', e))));
            }
        }
    });

    return initLog;
}

const StartMultiExtractionRequest = z.object({
    fileIds: z.array(z.string().trim().min(1)).min(1),
    modelId: z.string().trim().min(1),
    strategy: z.enum(['separate', 'merged']).default('separate'),
});

export async function startMultiExtraction(
    fileIds: string[],
    modelId: string,
    strategy: 'separate' | 'merged' = 'separate'
) {
    const parsed = StartMultiExtractionRequest.parse({ fileIds, modelId, strategy });

    if (parsed.strategy === 'separate') {
        const startedLogs: ExtractionLog[] = [];
        for (const singleFileId of parsed.fileIds) {
            const started = await startExtraction(
                singleFileId,
                parsed.modelId,
                undefined,
                {
                    upload_mode: 'multi-separate',
                    source_file_ids: [singleFileId],
                    batch_file_ids: parsed.fileIds,
                }
            );
            startedLogs.push(started);
        }
        return startedLogs;
    }

    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const cosmosDBService = new CosmosDBService(envConfig);
    const blobStorageService = new BlobStorageService(envConfig);
    const docIntelService = new DocIntelligenceService(envConfig);

    const modelContainer = await cosmosDBService.getContainer('extraction_models');
    const { resource: model } = await modelContainer.item(parsed.modelId, 'model').read<ExtractionModel>();
    if (!model) throw new Error('Model not found');

    const openaiService = new OpenAIService(envConfig, { defaultModel: model.llm_model });
    const extractionService = new ExtractionService(docIntelService, openaiService);

    const filesContainer = await cosmosDBService.getContainer('files');
    type SourceFileRecord = NonNullable<ExtractionLog['file']>;
    const fileRecords: SourceFileRecord[] = [];
    for (const sourceFileId of parsed.fileIds) {
        const { resources } = await filesContainer.items.query({
            query: 'SELECT * FROM c WHERE c.id = @id',
            parameters: [{ name: '@id', value: sourceFileId }]
        }).fetchAll();
        const matched = resources[0] as SourceFileRecord | undefined;
        if (!matched) {
            throw new Error(`File record not found: ${sourceFileId}`);
        }
        fileRecords.push(matched);
    }

    const logsContainer = await cosmosDBService.getContainer('extraction_logs');
    const logId = crypto.randomUUID();
    const initLog: ExtractionLog = {
        id: logId,
        model_id: parsed.modelId,
        super_model_id: undefined,
        status: 'processing',
        filename: `MULTI_MERGED_${new Date().toISOString()}.json`,
        file: fileRecords[0],
        candidate_files: fileRecords.slice(1),
        created_at: new Date().toISOString(),
        created_by: { name: user.name, object_id: user.oid, upn: user.upn },
        modified_at: new Date().toISOString(),
        modified_by: { name: user.name, object_id: user.oid, upn: user.upn },
        partition_key: parsed.modelId,
        metadata: {
            upload_mode: 'multi-merged',
            source_file_ids: parsed.fileIds,
            source_filenames: fileRecords.map((item) => item.filename),
        },
        retry_count: 0,
        lease: { owner: null, until: null }
    };
    await logsContainer.items.create(initLog);

    after(async () => {
        const cleanups: Array<() => Promise<void>> = [];
        let llmModelForAudit = '';

        try {
            try {
                llmModelForAudit = await openaiService.getResolvedDeployment();
            } catch (llmSettingError) {
                console.warn(`[startMultiExtraction] LLM 설정 조회 실패 (logId=${logId}):`, llmSettingError);
            }

            const sourceInputs: Array<{
                fileId: string;
                filename: string;
                blob_path: string;
                getFreshFileSource: () => Promise<string | Buffer>;
            }> = [];

            for (const fileRecord of fileRecords) {
                const actualBlobPath = `${envConfig.id}/${fileRecord.blob_path}`;
                const lowerFilename = fileRecord.filename.toLowerCase();
                const isExcelFile =
                    lowerFilename.endsWith('.xlsx') ||
                    lowerFilename.endsWith('.xls') ||
                    lowerFilename.endsWith('.csv');
                const useVision = isVisionModeEnabled(model.beta_features);

                const getFreshFileSource = async (): Promise<string | Buffer> => {
                    const { sasUrl, tempBlobPath, cleanup } = await blobStorageService.generateTempSasUrl(
                        actualBlobPath,
                        BlobStorageService.SAS.READ(120)
                    );
                    if (cleanup) cleanups.push(cleanup);

                    if (isExcelFile || useVision) {
                        return tempBlobPath
                            ? await blobStorageService.downloadTempBuffer(tempBlobPath)
                            : await blobStorageService.downloadBuffer(actualBlobPath);
                    }
                    return sasUrl;
                };

                sourceInputs.push({
                    fileId: fileRecord.id,
                    filename: fileRecord.filename,
                    blob_path: fileRecord.blob_path,
                    getFreshFileSource,
                });
            }

            const mergedSinglePass = await extractionService.extractMergedSinglePass(
                sourceInputs.map((source) => ({
                    filename: source.filename,
                    fileSource: source.getFreshFileSource,
                })),
                model
            );
            const extractionResult = mergedSinglePass.result;
            const mergedGuide = (extractionResult.guide_extracted || {}) as Record<string, unknown>;
            const mergedOtherData = Array.isArray(extractionResult.other_data) ? extractionResult.other_data : [];
            const extractedDebug = isRecord(extractionResult._debug_info) ? extractionResult._debug_info : {};
            const llmRequestBodies = Array.isArray(extractedDebug.llm_request_bodies) ? extractedDebug.llm_request_bodies : [];
            const llmResponseBodies = Array.isArray(extractedDebug.llm_response_bodies) ? extractedDebug.llm_response_bodies : [];

            const cleanData: Record<string, unknown> = {};
            Object.entries(mergedGuide).forEach(([fieldKey, fieldValue]) => {
                if (isRecord(fieldValue) && 'value' in fieldValue) {
                    cleanData[fieldKey] = fieldValue.value as unknown;
                    return;
                }
                cleanData[fieldKey] = fieldValue;
            });

            const previewData = {
                other_data: mergedOtherData,
                raw_content: extractionResult.raw_content || '',
                raw_tables: Array.isArray(extractionResult.raw_tables) ? extractionResult.raw_tables : [],
                guide_extracted: mergedGuide,
                llm_request_bodies: llmRequestBodies,
                llm_response_bodies: llmResponseBodies,
                sub_documents: sourceInputs.map((source, index) => ({
                    id: `${logId}_source_${index}`,
                    index,
                    type: source.filename,
                    filename: source.filename,
                    status: 'success' as const,
                    data: {
                        // 통합추출 모드의 우측 결과 패널은 단일 통합 추출 결과를 유지
                        guide_extracted: mergedGuide,
                        other_data: mergedOtherData,
                    },
                    file: {
                        filename: source.filename,
                        blob_path: source.blob_path,
                    },
                    raw_content: mergedSinglePass.source_ocr[index]?.raw_content || '',
                    debug_data: {
                        extraction_path: mergedSinglePass.source_ocr[index]?.engine || mergedSinglePass.extraction_path,
                        page_count: mergedSinglePass.source_ocr[index]?.page_count || 0,
                    },
                })),
                beta_metadata: {
                    merge_strategy: 'multi-merged-single-pass',
                    source_count: sourceInputs.length,
                    source_files: sourceInputs.map((source) => ({
                        file_id: source.fileId,
                        filename: source.filename,
                        blob_path: source.blob_path,
                    })),
                    source_ocr: mergedSinglePass.source_ocr,
                },
                mode: 'extraction',
            };

            const { data: finalPreviewData } = await blobStorageService.maybeOffloadData(logId, previewData);
            const successLog: ExtractionLog = {
                ...initLog,
                status: 'success',
                extracted_data: cleanData,
                preview_data: finalPreviewData as ExtractionLog['preview_data'],
                debug_data: {
                    ...(extractedDebug || {}),
                    llm_model: llmModelForAudit || extractLlmModelFromUnknown(extractedDebug) || undefined,
                    source_result_count: sourceInputs.length,
                    source_ocr: mergedSinglePass.source_ocr,
                },
                modified_at: new Date().toISOString(),
            };

            const {
                document: successLogToSave,
            } = await blobStorageService.fitDocumentToItemLimit({
                logId,
                document: sanitizeForStorage(successLog) as Record<string, unknown>
            });
            await logsContainer.items.upsert(successLogToSave);

            try {
                const host = await getHost();
                await executeWebhook(successLog, model, envConfig, user, host);
            } catch (webhookErr: unknown) {
                const webhookMessage = webhookErr instanceof Error ? webhookErr.message : String(webhookErr);
                console.error(`[Extraction] Automatic webhook failed for ${logId}: ${webhookMessage}`);
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorTrace = buildErrorTrace(error, {
                phase: 'multi_merged_extraction',
                log_id: logId,
                model_id: parsed.modelId,
            });
            const failedDebug = extractFailedExtractionDebug(error);

            const failedPreviewData = failedDebug.ocr_text_preview
                ? {
                    other_data: [],
                    raw_content: failedDebug.ocr_text_preview,
                    raw_tables: [],
                    guide_extracted: {},
                    mode: 'extraction' as const,
                }
                : undefined;

            const errorLog: ExtractionLog = {
                ...initLog,
                status: 'error',
                error_message: errorMessage,
                preview_data: failedPreviewData as ExtractionLog['preview_data'],
                debug_data: {
                    error_trace: errorTrace,
                    llm_model: llmModelForAudit || undefined,
                    extraction_path: failedDebug.extraction_path,
                    failed_ocr_text: failedDebug.ocr_text_preview,
                    failed_ocr_text_length: failedDebug.ocr_text_length,
                    failed_page_count: failedDebug.page_count,
                },
                modified_at: new Date().toISOString()
            };

            await logsContainer.items.upsert(errorLog);
        } finally {
            if (cleanups.length > 0) {
                await Promise.all(cleanups.map((cleanup) => cleanup().catch(() => undefined)));
            }
        }
    });

    return [initLog];
}

/**
 * Recursively extracts only the 'value' from rich metadata structures
 * to create a clean summary for database storage.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extractFailedExtractionDebug(error: unknown): {
    extraction_path?: string;
    ocr_text_preview?: string;
    ocr_text_length?: number;
    page_count?: number;
} {
    if (!isRecord(error)) return {};
    const extractionPath = typeof error.extraction_path === 'string' ? error.extraction_path : undefined;
    const ocrTextPreview = typeof error.ocr_text_preview === 'string' ? error.ocr_text_preview : undefined;
    const ocrTextLength = typeof error.ocr_text_length === 'number' ? error.ocr_text_length : undefined;
    const pageCount = typeof error.page_count === 'number' ? error.page_count : undefined;
    return {
        extraction_path: extractionPath,
        ocr_text_preview: ocrTextPreview,
        ocr_text_length: ocrTextLength,
        page_count: pageCount,
    };
}

function isVisionModeEnabled(betaFeatures: unknown): boolean {
    if (!isRecord(betaFeatures)) return false;
    const ocrEngine = typeof betaFeatures.ocr_engine === 'string'
        ? betaFeatures.ocr_engine.trim().toLowerCase()
        : '';
    const legacyVisionFlag = betaFeatures.vision_extraction === true || betaFeatures.use_vision_extraction === true;
    return ocrEngine === 'vision' || legacyVisionFlag;
}

function extractLlmModelFromUnknown(value: unknown): string | undefined {
    if (!isRecord(value)) return undefined;
    const llmModel = value.llm_model;
    if (typeof llmModel === 'string' && llmModel.trim()) {
        return llmModel.trim();
    }
    const camelCaseModel = value.llmModel;
    if (typeof camelCaseModel === 'string' && camelCaseModel.trim()) {
        return camelCaseModel.trim();
    }
    return undefined;
}

function sanitizeForStorage(data: unknown): unknown {
    if (data === undefined) return undefined;
    if (data === null) return null;

    if (typeof data === 'bigint') {
        const asNumber = Number(data);
        return Number.isSafeInteger(asNumber) ? asNumber : data.toString();
    }

    if (typeof data === 'number') {
        return Number.isFinite(data) ? data : null;
    }

    if (Array.isArray(data)) {
        return data
            .map((item) => sanitizeForStorage(item))
            .filter((item) => item !== undefined);
    }

    if (isRecord(data)) {
        const cleaned: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(data)) {
            const sanitized = sanitizeForStorage(v);
            if (sanitized !== undefined) {
                cleaned[k] = sanitized;
            }
        }
        return cleaned;
    }

    return data;
}

function recursiveClean(data: unknown): unknown {
    if (isRecord(data) && 'value' in data) {
        return recursiveClean((data as Record<string, unknown>).value);
    }
    if (Array.isArray(data)) {
        return data.map((item) => recursiveClean(item));
    }
    if (isRecord(data)) {
        const cleaned: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(data)) {
            if (k === 'bbox') continue; // Explicitly skip bbox
            const nextVal = recursiveClean(v);
            if (nextVal !== undefined) {
                cleaned[k] = nextVal;
            }
        }
        return cleaned;
    }
    return sanitizeForStorage(data);
}

function getLogTimestampMs(log: Record<string, unknown>): number {
    const modifiedAtRaw = log.modified_at;
    const createdAtRaw = log.created_at;

    const modifiedAtMs = typeof modifiedAtRaw === 'string' ? Date.parse(modifiedAtRaw) : Number.NaN;
    if (Number.isFinite(modifiedAtMs)) return modifiedAtMs;

    const createdAtMs = typeof createdAtRaw === 'string' ? Date.parse(createdAtRaw) : Number.NaN;
    if (Number.isFinite(createdAtMs)) return createdAtMs;

    return 0;
}

function resolveWebhookDocType(log: Record<string, unknown>, fallbackIndex: number): string {
    const metadata = isRecord(log.metadata) ? log.metadata : null;
    const metadataType = typeof metadata?.type === 'string' ? metadata.type.trim() : '';
    if (metadataType) return metadataType;

    const filename = typeof log.filename === 'string' ? log.filename.trim() : '';
    if (filename) return filename;

    return `Document_${fallbackIndex + 1}`;
}

function pickWebhookLogsByDocType(
    logs: Array<Record<string, unknown>>,
    preferredLogIds?: string[]
): Array<{ docType: string; log: Record<string, unknown> }> {
    const firstSeenOrder: string[] = [];
    const bestByDocType = new Map<string, { log: Record<string, unknown>; ts: number }>();

    logs.forEach((log, idx) => {
        const docType = resolveWebhookDocType(log, idx);
        if (!bestByDocType.has(docType)) firstSeenOrder.push(docType);

        const ts = getLogTimestampMs(log);
        const existing = bestByDocType.get(docType);
        if (!existing || ts >= existing.ts) {
            bestByDocType.set(docType, { log, ts });
        }
    });

    if (Array.isArray(preferredLogIds) && preferredLogIds.length > 0) {
        for (const preferredLogId of preferredLogIds) {
            const preferred = logs.find((item) => typeof item.id === 'string' && item.id === preferredLogId);
            if (!preferred) continue;

            const preferredDocType = resolveWebhookDocType(preferred, 0);
            if (!bestByDocType.has(preferredDocType)) {
                firstSeenOrder.push(preferredDocType);
            }
            // 수동 전송 시 현재 선택된 히스토리를 우선 보장
            bestByDocType.set(preferredDocType, {
                log: preferred,
                ts: Number.MAX_SAFE_INTEGER
            });
        }
    }

    return firstSeenOrder
        .map((docType) => {
            const matched = bestByDocType.get(docType);
            if (!matched) return null;
            return { docType, log: matched.log };
        })
        .filter((item): item is { docType: string; log: Record<string, unknown> } => item !== null);
}

export type UpdateExtractionDataResult =
    | {
        ok: true;
        data: ExtractionLog | undefined;
    }
    | {
        ok: false;
        error: {
            code: string;
            message: string;
            detail?: string;
            errorId: string;
            timestamp: string;
            requestSizeBytes?: number;
        };
    };

export async function updateExtractionData(
    logId: string,
    modelId: string,
    richGuideData: Record<string, unknown>, // Rich data with metadata
    otherData?: unknown[],
    subDocIndex?: number // Optional index for super model sub-documents
) : Promise<UpdateExtractionDataResult> {
    let requestSizeBytes = 0;

    try {
        logId = logId.trim();
        modelId = modelId.trim();
        const envConfig = await getCurrentEnvConfig();
        const permissionService = new PermissionService(envConfig);
        const user = await permissionService.getCurrentUser();
        if (!user) {
            return {
                ok: false,
                error: {
                    code: 'UNAUTHORIZED',
                    message: '인증이 만료되었거나 권한이 없습니다. 다시 로그인 후 시도해 주세요.',
                    errorId: crypto.randomUUID(),
                    timestamp: new Date().toISOString()
                }
            };
        }

        const cosmosDBService = new CosmosDBService(envConfig);
        const logsContainer = await cosmosDBService.getContainer('extraction_logs');

        // Fetch existing log
        const { resource: existingLog } = await logsContainer.item(logId, modelId).read<ExtractionLog>();
        if (!existingLog) {
            return {
                ok: false,
                error: {
                    code: 'LOG_NOT_FOUND',
                    message: '저장 대상 로그를 찾을 수 없습니다.',
                    errorId: crypto.randomUUID(),
                    timestamp: new Date().toISOString()
                }
            };
        }

        requestSizeBytes = Buffer.byteLength(
            JSON.stringify({
                richGuideData: sanitizeForStorage(richGuideData),
                otherData: sanitizeForStorage(otherData || [])
            }),
            'utf8'
        );
        console.info('[updateExtractionData] request summary', {
            logId,
            modelId,
            userOid: user.oid,
            subDocIndex,
            requestSizeBytes
        });

        // 1. Determine if we need to merge for super model
        const sanitizedRichGuideData = sanitizeForStorage(richGuideData) as Record<string, unknown>;
        const sanitizedOtherData = sanitizeForStorage(
            otherData || existingLog.preview_data?.other_data || []
        ) as unknown[];

        let cleanData = recursiveClean(sanitizedRichGuideData);
        const updatedPreviewData = {
            ...(isRecord(existingLog.preview_data) ? existingLog.preview_data : {}),
            other_data: sanitizedOtherData,
            modified_at: new Date().toISOString()
        } as Record<string, unknown>;

        if (
            subDocIndex !== undefined &&
            Array.isArray((updatedPreviewData as { sub_documents?: unknown[] }).sub_documents) &&
            (updatedPreviewData as { sub_documents: unknown[] }).sub_documents[subDocIndex]
        ) {
            // Update specific sub-document
            const subDocs = [...((updatedPreviewData as { sub_documents: unknown[] }).sub_documents)];
            const target = subDocs[subDocIndex];
            if (isRecord(target)) {
                const prevData = isRecord(target.data) ? target.data : {};
                subDocs[subDocIndex] = {
                    ...target,
                    data: {
                        ...prevData,
                        guide_extracted: sanitizedRichGuideData
                    }
                };
            }
            updatedPreviewData.sub_documents = subDocs;

            // Re-calculate merged data from all sub-documents
            const mergedClean: Record<string, unknown> = {};
            const mergedRich: Record<string, unknown> = {};

            (updatedPreviewData.sub_documents as unknown[]).forEach((sd) => {
                if (!isRecord(sd) || !isRecord(sd.data) || !('guide_extracted' in sd.data)) return;
                const docType = typeof sd.type === 'string' && sd.type ? sd.type : `Document_${String(sd.index ?? '')}`;
                mergedClean[docType] = recursiveClean(sd.data.guide_extracted);
                mergedRich[docType] = sanitizeForStorage(sd.data.guide_extracted);
            });

            cleanData = mergedClean;
            updatedPreviewData.guide_extracted = mergedRich;
        } else {
            // Standard logic
            updatedPreviewData.guide_extracted = sanitizedRichGuideData;
        }

        // 2. Update log with both rich and clean data
        const previewDataToSaveRaw = {
            ...updatedPreviewData,
            // Preserve comparison fields if they exist
            comparisons:
                (updatedPreviewData as { comparisons?: unknown }).comparisons ||
                (sanitizedRichGuideData as { comparisons?: unknown })?.comparisons,
            mode:
                (updatedPreviewData as { mode?: unknown }).mode ||
                (isRecord(existingLog.preview_data) ? existingLog.preview_data.mode : undefined),
            comparison_count:
                (updatedPreviewData as { comparison_count?: unknown }).comparison_count ||
                (isRecord(existingLog.preview_data) ? existingLog.preview_data.comparison_count : undefined)
        };
        const previewDataToSave = sanitizeForStorage(previewDataToSaveRaw);

        const blobStorageService = new BlobStorageService(envConfig);
        const { data: finalPreviewData } = await blobStorageService.maybeOffloadData(logId, previewDataToSave);

        const updatedLog: ExtractionLog = {
            ...existingLog,
            extracted_data: sanitizeForStorage(cleanData) as Record<string, unknown>,
            preview_data: sanitizeForStorage(finalPreviewData) as ExtractionLog['preview_data'],
            modified_at: new Date().toISOString(),
            modified_by: {
                name: user.name,
                object_id: user.oid,
                upn: user.upn
            }
        };

        const {
            document: updatedLogToSave,
            itemSizeBytes,
            offloadedFields
        } = await blobStorageService.fitDocumentToItemLimit({
            logId,
            document: sanitizeForStorage(updatedLog) as Record<string, unknown>
        });
        console.info('[updateExtractionData] document size', {
            logId,
            modelId,
            itemSizeBytes,
            offloadedFields
        });

        // replace 대신 upsert 사용
        const { resource: replaced } = await logsContainer.items.upsert(updatedLogToSave);

        // Audit log: Update extraction
        await logAction({
            userId: user.oid,
            userEmail: user.upn,
            tenantId: envConfig.id,
            action: 'UPDATE',
            resourceType: 'extraction',
            resourceId: logId,
            status: 'SUCCESS',
            details: {
                modelId,
                modelName: existingLog.model_name,
                llmModel: extractLlmModelFromUnknown(existingLog.debug_data),
                filename: existingLog.filename
            },
        });

        return { ok: true, data: replaced as ExtractionLog | undefined };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errorId = crypto.randomUUID();
        const lower = message.toLowerCase();
        let code = 'SAVE_FAILED';
        let detail = '서버 처리 중 예외가 발생했습니다.';

        if (lower.includes('too large') || lower.includes('requestentitytoolarge') || lower.includes('413')) {
            code = 'PAYLOAD_TOO_LARGE';
            detail = '저장 데이터가 서버 허용 크기를 초과했습니다.';
        } else if (lower.includes('header') || lower.includes('431')) {
            code = 'HEADER_TOO_LARGE';
            detail = '인증 헤더/쿠키 크기가 커서 요청이 거부되었습니다.';
        } else if (lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('401') || lower.includes('403')) {
            code = 'UNAUTHORIZED';
            detail = '인증 또는 권한 검증에 실패했습니다.';
        } else if (lower.includes('timeout')) {
            code = 'TIMEOUT';
            detail = '저장 요청이 시간 초과되었습니다.';
        }

        console.error('[updateExtractionData] save failed', {
            errorId,
            logId,
            modelId,
            subDocIndex,
            requestSizeBytes,
            error: message,
            stack: error instanceof Error ? error.stack : undefined
        });

        return {
            ok: false,
            error: {
                code,
                message: `데이터 저장 실패 (${code})`,
                detail: `${detail} 원인: ${message}`,
                errorId,
                timestamp: new Date().toISOString(),
                requestSizeBytes: requestSizeBytes || undefined
            }
        };
    }
}

async function getHost() {
    let host = 'localhost:3000';
    try {
        const heads = await headers();
        host = heads.get('host') || host;
    } catch { /* background context */ }
    return host;
}

async function resolveWebhookUrl(
    log: ExtractionLog,
    model: ExtractionModel | null | undefined,
    envConfig: DAOMEnvConfig
): Promise<string> {
    let finalWebhookUrl = (model?.webhook_url || '').trim();

    // 현재 모델에 URL이 없으면 상위 모델 URL을 확인
    if (!finalWebhookUrl && log.super_model_id) {
        const cosmosDBService = new CosmosDBService(envConfig);
        const modelContainer = await cosmosDBService.getContainer('extraction_models');
        const { resource: superModel } = await modelContainer.item(log.super_model_id, 'model').read<ExtractionModel>();
        if (superModel?.webhook_url) {
            finalWebhookUrl = superModel.webhook_url.trim();
        }
    }

    // 그래도 없으면 로그에 저장된 URL 확인
    if (!finalWebhookUrl && log.webhook_url) {
        finalWebhookUrl = log.webhook_url.trim();
    }

    return finalWebhookUrl;
}

/**
 * Common webhook execution logic for both manual and automatic triggers
 */
async function executeWebhook(
    log: ExtractionLog,
    model: ExtractionModel | null | undefined,
    envConfig: DAOMEnvConfig,
    user: { name: string; upn: string; oid: string },
    host: string,
    options?: { currentSubDocLogIds?: string[] }
) {
    // 1. Resolve Webhook URL
    const finalWebhookUrl = await resolveWebhookUrl(log, model, envConfig);

    if (!finalWebhookUrl) {
        throw new Error('Webhook URL이 설정되지 않았습니다. 상위/현재 모델 또는 로그에 webhook_url을 설정해 주세요.');
    }

    // 2. Extract confidence data helper
    const getConfidenceData = (guideExtracted: any) => {
        const confidenceMap: Record<string, number> = {};
        if (guideExtracted) {
            Object.entries(guideExtracted).forEach(([key, field]: [string, any]) => {
                if (field && typeof field === 'object' && 'confidence' in field) {
                    confidenceMap[key] = field.confidence;
                }
            });
        }
        return confidenceMap;
    };

    // 3. Aggregate data if part of a Super Model group
    const cosmosDBService = new CosmosDBService(envConfig);
    const logsContainer = await cosmosDBService.getContainer('extraction_logs');
    const blobStorageService = new BlobStorageService(envConfig);
    const mailSubject = log.metadata?.mail_subject;
    const guid = log.metadata?.guid;
    let finalPayloadData: any = null;

    const hydrateMaybeOffloaded = async (value: unknown): Promise<unknown> => {
        if (!BlobStorageService.isOffloadedReference(value)) return value;
        try {
            return await blobStorageService.downloadJson(value.blob_path);
        } catch (e) {
            console.error('[Webhook] offloaded data hydrate failed:', e);
            return value;
        }
    };

    if (mailSubject || guid) {
        const query = `
            SELECT * FROM c 
            WHERE (c.model_id = @modelId OR c.super_model_id = @modelId OR c.model_id = @superId OR c.super_model_id = @superId)
            AND c.metadata.mail_subject = @mailSubject
            AND c.metadata.guid = @guid
        `;
        const { resources: groupLogs } = await logsContainer.items.query({
            query,
            parameters: [
                { name: '@modelId', value: log.model_id },
                { name: '@superId', value: log.super_model_id || log.model_id },
                { name: '@mailSubject', value: mailSubject || null },
                { name: '@guid', value: guid || null }
            ]
        }).fetchAll();

        if (groupLogs.length > 1) {
            const preferredLogIds = (() => {
                const fromClient = options?.currentSubDocLogIds?.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) || [];
                if (fromClient.length > 0) return Array.from(new Set(fromClient));
                return [log.id];
            })();

            const normalizedGroupLogs = pickWebhookLogsByDocType(
                groupLogs.filter((item): item is Record<string, unknown> => isRecord(item)),
                preferredLogIds
            );
            const aggregated: Record<string, any> = {};
            for (let idx = 0; idx < normalizedGroupLogs.length; idx++) {
                const gLog = normalizedGroupLogs[idx].log;
                const extractedData = await hydrateMaybeOffloaded(gLog.extracted_data);
                const previewData = await hydrateMaybeOffloaded(gLog.preview_data);
                const previewRecord = isRecord(previewData) ? previewData : {};
                const data = recursiveClean(extractedData || {});
                const conf = getConfidenceData(previewRecord.guide_extracted);
                const docType = normalizedGroupLogs[idx].docType || `Document_${idx + 1}`;
                aggregated[docType] = { data, confidence_data: conf };
            }
            finalPayloadData = aggregated;
        }
    }

    if (!finalPayloadData) {
        const singleExtractedData = await hydrateMaybeOffloaded(log.extracted_data);
        const singlePreviewData = await hydrateMaybeOffloaded(log.preview_data);
        const singlePreviewRecord = isRecord(singlePreviewData) ? singlePreviewData : {};
        finalPayloadData = {
            data: recursiveClean(singleExtractedData),
            confidence_data: getConfidenceData(singlePreviewRecord.guide_extracted)
        };
    }

    // 4. Construct Payload
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const reviewModelId = log.super_model_id || log.model_id;
    const reviewUrl = `${protocol}://${host}/extraction/run/${reviewModelId}?logId=${log.id}`;

    const webhookPayload = {
        event: 'extraction_confirmed',
        log_id: log.id,
        model_id: log.model_id,
        model_name: model?.name || 'Unknown Model',
        filename: log.filename,
        file_url: (log as any).file_url || log.file?.filename,
        review_url: reviewUrl,
        extracted_data: finalPayloadData,
        metadata: log.metadata,
        user: { name: user.name, email: user.upn, object_id: user.oid },
        timestamp: new Date().toISOString()
    };

    // 5. Authentication
    let authToken: string | undefined;
    const webhookUrl = finalWebhookUrl;
    const urlLower = webhookUrl.toLowerCase();
    const hasSig = urlLower.includes('sig=');
    const isPowerAutomate = urlLower.includes('flow.microsoft.com') ||
        urlLower.includes('logic.azure.com') ||
        urlLower.includes('windows.net') ||
        urlLower.includes('powerplatform.com');

    if (isPowerAutomate && !hasSig) {
        try {
            const scope = 'https://service.flow.microsoft.com/.default';
            const msFlowService = new MSFlowService(envConfig);
            const tokenResponse = await msFlowService.getMSFlowAuthToken(scope);
            if (tokenResponse) {
                authToken = typeof tokenResponse === 'string' ? tokenResponse : (tokenResponse as any).token;
                if (!authToken && (tokenResponse as any).accessToken) authToken = (tokenResponse as any).accessToken;
            }
        } catch (e: any) {
            console.error('[Webhook] Auth failed:', e.message);
        }
    }

    // 6. Send
    await sendWebhook(webhookUrl, webhookPayload, authToken, envConfig.webhook_secret);

    // 7. Audit Log
    await logAction({
        userId: user.oid,
        userEmail: user.upn,
        tenantId: envConfig.id,
        action: 'WEBHOOK',
        resourceType: 'extraction',
        resourceId: log.id,
        status: 'SUCCESS',
        details: {
            modelId: log.model_id,
            modelName: model?.name,
            llmModel: extractLlmModelFromUnknown(log.debug_data),
            filename: log.filename,
            webhookUrl
        },
    });
}

export async function triggerExtractionWebhook(
    logId: string,
    modelId: string,
    options?: { currentSubDocLogIds?: string[] }
) {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const cosmosDBService = new CosmosDBService(envConfig);
    const logsContainer = await cosmosDBService.getContainer('extraction_logs');

    // Fetch existing log
    const { resource: log } = await logsContainer.item(logId, modelId).read<ExtractionLog>();
    if (!log) throw new Error('Log not found');

    const modelContainer = await cosmosDBService.getContainer('extraction_models');
    const { resource: model } = await modelContainer.item(modelId, 'model').read<ExtractionModel>();

    const host = await getHost();
    await executeWebhook(log, model, envConfig, user, host, options);

    return { success: true };
}

export async function canTriggerExtractionWebhook(
    logId: string,
    modelId: string
) {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const cosmosDBService = new CosmosDBService(envConfig);
    const logsContainer = await cosmosDBService.getContainer('extraction_logs');

    const { resource: log } = await logsContainer.item(logId, modelId).read<ExtractionLog>();
    if (!log) {
        return {
            canTrigger: false,
            reason: 'Log not found',
        };
    }

    const modelContainer = await cosmosDBService.getContainer('extraction_models');
    const { resource: model } = await modelContainer.item(modelId, 'model').read<ExtractionModel>();
    const webhookUrl = await resolveWebhookUrl(log, model, envConfig);

    return {
        canTrigger: !!webhookUrl,
        reason: webhookUrl
            ? null
            : 'Webhook URL이 설정되지 않았습니다. 상위/현재 모델 또는 로그에 webhook_url을 설정해 주세요.',
    };
}

export async function retryExtraction(logId: string, modelId: string) {
    const envConfig = await getCurrentEnvConfig();
    const cosmosDBService = new CosmosDBService(envConfig);
    const logsContainer = await cosmosDBService.getContainer('extraction_logs');

    // Fetch existing log to get file info
    const { resource: log } = await logsContainer.item(logId, modelId).read<ExtractionLog>();
    if (!log || !log.file || !log.file.id) throw new Error('Cannot retry: File information missing in log');

    // Start a new extraction attempt using the same file
    return await startExtraction(log.file.id, modelId, undefined, log.metadata, log.webhook_url);
}

export async function startBatchExtraction(
    fileIds: string[],
    modelId: string
) {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const results = [];
    // 순차적으로 호출 (필요시 병렬 Promise.all로 변경 가능하나, DB 쓰기 충돌/Rate Limit 고려)
    for (const fileId of fileIds) {
        try {
            const res = await startExtraction(fileId, modelId);
            results.push({ fileId, success: true, log: res });
        } catch (error: any) {
            results.push({ fileId, success: false, error: error.message });
        }
    }
    return results;
}
