import 'server-only';
import crypto from 'crypto';
import { DocIntelligenceService } from "./DocIntelligenceService";
import { OpenAIService } from "./OpenAIService";
import { ExtractionService } from "./ExtractionService";
import CosmosDBService from "./CosmosDBService";
import BlobStorageService from "./BlobStorageService";
import MSFlowService from "./MSFlowService";
import { ExtractionModel } from "@/scheme/extractionModel";
import { ExtractionLog } from "@/scheme/extractionLog";
import { sendWebhook } from "@/lib/webhook";
import { buildErrorTrace } from "@/lib/errorTrace";
import { logAction } from "@/actions/audit";
import { DAOMEnvConfig } from "@/scheme/env";

export interface ConnectorUser {
    name: string;
    upn: string;
    oid: string;
}

export class ConnectorService {
    private envConfig: DAOMEnvConfig;
    private user: ConnectorUser;

    constructor(envConfig: DAOMEnvConfig, user: ConnectorUser) {
        this.envConfig = envConfig;
        this.user = user;
    }

    /**
     * 값만 재귀적으로 추출
     */
    private recursiveClean(data: any): any {
        if (data && typeof data === 'object' && 'value' in data) return this.recursiveClean(data.value);
        if (Array.isArray(data)) return data.map(v => this.recursiveClean(v));
        if (data && typeof data === 'object') {
            const c: any = {};
            for (const [k, v] of Object.entries(data)) { 
                if (k !== 'bbox') c[k] = this.recursiveClean(v); 
            }
            return c;
        }
        return data;
    }

    private getLogTimestampMs(log: Record<string, unknown>): number {
        const modifiedAtRaw = log.modified_at;
        const createdAtRaw = log.created_at;

        const modifiedAtMs = typeof modifiedAtRaw === 'string' ? Date.parse(modifiedAtRaw) : Number.NaN;
        if (Number.isFinite(modifiedAtMs)) return modifiedAtMs;

        const createdAtMs = typeof createdAtRaw === 'string' ? Date.parse(createdAtRaw) : Number.NaN;
        if (Number.isFinite(createdAtMs)) return createdAtMs;

        return 0;
    }

    private extractLlmModelFromUnknown(value: unknown): string | undefined {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
        const record = value as Record<string, unknown>;
        const snakeCase = record.llm_model;
        if (typeof snakeCase === 'string' && snakeCase.trim()) return snakeCase.trim();
        const camelCase = record.llmModel;
        if (typeof camelCase === 'string' && camelCase.trim()) return camelCase.trim();
        return undefined;
    }

    private isVisionModeEnabled(betaFeatures: unknown): boolean {
        if (!betaFeatures || typeof betaFeatures !== 'object' || Array.isArray(betaFeatures)) return false;
        const features = betaFeatures as Record<string, unknown>;
        const ocrEngine = typeof features.ocr_engine === 'string'
            ? features.ocr_engine.trim().toLowerCase()
            : '';
        const legacyVisionFlag = features.vision_extraction === true || features.use_vision_extraction === true;
        return ocrEngine === 'vision' || legacyVisionFlag;
    }

    private resolveWebhookDocType(log: Record<string, unknown>, fallbackIndex: number): string {
        const metadataRaw = log.metadata;
        const metadata = metadataRaw && typeof metadataRaw === 'object' && !Array.isArray(metadataRaw)
            ? metadataRaw as Record<string, unknown>
            : null;

        const metadataType = typeof metadata?.type === 'string' ? metadata.type.trim() : '';
        if (metadataType) return metadataType;

        const filename = typeof log.filename === 'string' ? log.filename.trim() : '';
        if (filename) return filename;

        return `Document_${fallbackIndex + 1}`;
    }

    private pickWebhookLogsByDocType(logs: Record<string, unknown>[]): Array<{ docType: string; log: Record<string, unknown> }> {
        const firstSeenOrder: string[] = [];
        const bestByDocType = new Map<string, { log: Record<string, unknown>; ts: number }>();

        logs.forEach((log, idx) => {
            const docType = this.resolveWebhookDocType(log, idx);
            if (!bestByDocType.has(docType)) firstSeenOrder.push(docType);

            const ts = this.getLogTimestampMs(log);
            const existing = bestByDocType.get(docType);
            if (!existing || ts >= existing.ts) {
                bestByDocType.set(docType, { log, ts });
            }
        });

        return firstSeenOrder
            .map((docType) => {
                const matched = bestByDocType.get(docType);
                if (!matched) return null;
                return { docType, log: matched.log };
            })
            .filter((item): item is { docType: string; log: Record<string, unknown> } => item !== null);
    }

    /**
     * 핵심 추출 + 완료 후 그룹 Webhook 체크
     */
    public async runExtractionWithGroupWebhook(
        fileId: string,
        modelId: string,
        metadata: Record<string, any> | null,
        webhookUrl: string | null,
        host: string
    ) {
        console.log(`[ConnectorService] Starting extraction for fileId=${fileId}, modelId=${modelId}`);

        const cosmosDBService = new CosmosDBService(this.envConfig);
        const blobStorageService = new BlobStorageService(this.envConfig);
        const docIntelService = new DocIntelligenceService(this.envConfig);

        const modelContainer = await cosmosDBService.getContainer('extraction_models');
        const { resource: model } = await modelContainer.item(modelId, 'model').read<ExtractionModel>();
        if (!model) throw new Error('Model not found');

        const openaiService = new OpenAIService(this.envConfig, { defaultModel: model.llm_model });
        const extractionService = new ExtractionService(docIntelService, openaiService);

        const filesContainer = await cosmosDBService.getContainer('files');
        const { resources: files } = await filesContainer.items.query({
            query: 'SELECT * FROM c WHERE c.id = @id',
            parameters: [{ name: '@id', value: fileId }]
        }).fetchAll();
        const fileRecord = files[0];
        if (!fileRecord) throw new Error('File record not found');

        // super_model_id 찾기
        let superModelId: string | undefined;
        const { resources: superModels } = await modelContainer.items.query({
            query: 'SELECT c.id FROM c WHERE ARRAY_CONTAINS(c.sub_model_ids, @modelId)',
            parameters: [{ name: '@modelId', value: modelId }]
        }).fetchAll();
        if (superModels[0]) superModelId = superModels[0].id;

        const logsContainer = await cosmosDBService.getContainer('extraction_logs');
        const logId = crypto.randomUUID();

        const initLog: ExtractionLog = {
            id: logId,
            model_id: modelId,
            super_model_id: superModelId,
            status: 'processing',
            filename: fileRecord.filename,
            file: fileRecord,
            created_at: new Date().toISOString(),
            created_by: { name: this.user.name, object_id: this.user.oid, upn: this.user.upn },
            modified_at: new Date().toISOString(),
            modified_by: { name: this.user.name, object_id: this.user.oid, upn: this.user.upn },
            partition_key: modelId,
            metadata: metadata || undefined,
            webhook_url: webhookUrl || undefined,
            retry_count: 0,
            lease: { owner: null, until: null }
        };

        await logsContainer.items.create(initLog);

        const actualBlobPath = `${this.envConfig.id}/${fileRecord.blob_path}`;
        const cleanups: Array<() => Promise<void>> = [];
        let llmModelForAudit = '';
        const issueTempSas = async () => {
            const issued = await blobStorageService.generateTempSasUrl(actualBlobPath, BlobStorageService.SAS.READ(120));
            cleanups.push(issued.cleanup);
            return issued;
        };

        try {
            try {
                llmModelForAudit = await openaiService.getResolvedDeployment();
            } catch (llmResolveError) {
                console.warn(`[ConnectorService] LLM 모델 조회 실패 (logId=${logId}):`, llmResolveError);
            }
            const isExcel = fileRecord.filename.toLowerCase().endsWith('.xlsx') || 
                            fileRecord.filename.toLowerCase().endsWith('.xls') || 
                            fileRecord.filename.toLowerCase().endsWith('.csv');
            const useVision = this.isVisionModeEnabled(model.beta_features);

            const getFreshFileSource = async (): Promise<string | Buffer> => {
                const { sasUrl, tempBlobPath } = await issueTempSas();

                if (isExcel || useVision) {
                    console.log(`[ConnectorService] Downloading buffer for ${fileRecord.filename} (isExcel=${isExcel}, useVision=${useVision})...`);
                    return tempBlobPath
                        ? await blobStorageService.downloadTempBuffer(tempBlobPath)
                        : await blobStorageService.downloadBuffer(actualBlobPath);
                }

                console.log(`[ConnectorService] Using fresh SAS URL for standard PDF extraction: ${fileRecord.filename}`);
                return sasUrl;
            };

            const result = await extractionService.extract(getFreshFileSource, model, fileRecord.filename);

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
            };

            const { data: finalPreviewData } = await blobStorageService.maybeOffloadData(logId, previewData);
            const llmModelFromResult =
                this.extractLlmModelFromUnknown(result._debug_info) ||
                (typeof result.llm_model === 'string' ? result.llm_model : undefined) ||
                llmModelForAudit;

            const successLog = {
                ...initLog,
                status: 'success' as const,
                extracted_data: cleanData,
                preview_data: finalPreviewData,
                debug_data: {
                    ...(result._debug_info || {}),
                    llm_model: llmModelFromResult || undefined,
                    beta_metadata: result.beta_metadata || {},
                },
                metadata: {
                    ...(initLog.metadata || {}),
                    di_page_count: result.di_page_count,
                    token_usage: result.token_usage,
                },
                modified_at: new Date().toISOString(),
                modified_by: { name: this.user.name, object_id: this.user.oid, upn: this.user.upn }
            };

            const {
                document: successLogToSave,
                itemSizeBytes,
                offloadedFields
            } = await blobStorageService.fitDocumentToItemLimit({
                logId,
                document: successLog as unknown as Record<string, unknown>
            });
            console.info('[ConnectorService] success log size', {
                logId,
                itemSizeBytes,
                offloadedFields
            });

            await logsContainer.item(logId, modelId).replace(successLogToSave);
            console.log(`[ConnectorService] Job ${logId} success.`);

            console.log(`[ConnectorService] Logging action with result: di_page_count=${result.di_page_count}, hasTokenUsage=${!!result.token_usage}`);

            await logAction({
                userId: this.user.oid, userEmail: this.user.upn, tenantId: this.envConfig.id,
                action: 'EXTRACT', resourceType: 'extraction', resourceId: logId,
                status: 'SUCCESS', details: { 
                    modelId, 
                    modelName: model.name,
                    llmModel: llmModelFromResult || undefined,
                    filename: fileRecord.filename,
                    diPageCount: result.di_page_count,
                    tokenUsage: result.token_usage
                }
            });

            // Webhook 발송 (그룹 완료 체크 포함)
            try {
                await this.triggerGroupWebhookIfComplete(
                    successLog as unknown as ExtractionLog,
                    model,
                    host,
                    webhookUrl || ''
                );
            } catch (webhookErr: any) {
                console.error(`[ConnectorService] Webhook failed for job ${logId}:`, webhookErr.message);
            }
        } catch (error: any) {
            console.error(`[ConnectorService] Job ${logId} failed:`, error);
            const errorTrace = buildErrorTrace(error, {
                phase: 'connector_extraction',
                log_id: logId,
                model_id: modelId,
                file_id: fileId,
                filename: fileRecord.filename,
            });
            await logsContainer.item(logId, modelId).replace({
                ...initLog,
                status: 'error',
                error_message: error.message,
                debug_data: {
                    error_trace: errorTrace,
                    llm_model: llmModelForAudit || undefined,
                },
                modified_at: new Date().toISOString()
            });
            await logAction({
                userId: this.user.oid, userEmail: this.user.upn, tenantId: this.envConfig.id,
                action: 'EXTRACT', resourceType: 'extraction', resourceId: logId,
                status: 'FAILURE',
                details: {
                    modelId,
                    modelName: model.name,
                    llmModel: llmModelForAudit || undefined,
                    filename: fileRecord.filename,
                    error: error.message,
                    error_trace: errorTrace,
                }
            });
        } finally {
            if (cleanups.length > 0) {
                console.log(`[ConnectorService] Connector cleanup for ${logId} (count=${cleanups.length})`);
                await Promise.allSettled(
                    cleanups.map((fn) => fn().catch((e) => {
                        console.error("[ConnectorService] Connector cleanup failed:", e);
                    }))
                );
            }
        }
    }

    private async triggerGroupWebhookIfComplete(
        currentLog: ExtractionLog,
        model: ExtractionModel | null,
        host: string,
        webhookUrl: string
    ) {
        const guid = currentLog.metadata?.guid;
        const mailSubject = currentLog.metadata?.mail_subject;

        if (!guid && !mailSubject) {
            await this.sendGroupWebhook([currentLog], model, host, webhookUrl);
            return;
        }

        const rawFileCount = currentLog.metadata?.file_cnt;
        const fileCount = (() => {
            if (typeof rawFileCount === 'number') return rawFileCount;
            if (typeof rawFileCount === 'string') {
                const parsed = Number.parseInt(rawFileCount, 10);
                return Number.isFinite(parsed) ? parsed : NaN;
            }
            return NaN;
        })();
        const waitSeconds = Number.isFinite(fileCount) && fileCount > 0 ? fileCount * 30 : 30;

        console.log(
            `[ConnectorService] Waiting ${waitSeconds}s for group sync (file_cnt=${rawFileCount ?? 'n/a'}, guid=${guid}, mailSubject=${mailSubject})...`
        );
        await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

        const cosmosDBService = new CosmosDBService(this.envConfig);
        const logsContainer = await cosmosDBService.getContainer('extraction_logs');

        let groupQuery: string;
        const groupParams: { name: string; value: string }[] = [];

        if (guid && mailSubject) {
            groupQuery = `SELECT * FROM c WHERE c.metadata.guid = @guid AND c.metadata.mail_subject = @mailSubject ORDER BY c.created_at ASC`;
            groupParams.push({ name: '@guid', value: guid });
            groupParams.push({ name: '@mailSubject', value: mailSubject });
        } else if (guid) {
            groupQuery = `SELECT * FROM c WHERE c.metadata.guid = @guid ORDER BY c.created_at ASC`;
            groupParams.push({ name: '@guid', value: guid });
        } else {
            groupQuery = `SELECT * FROM c WHERE c.metadata.mail_subject = @mailSubject ORDER BY c.created_at ASC`;
            groupParams.push({ name: '@mailSubject', value: mailSubject! });
        }

        const { resources: groupLogs } = await logsContainer.items.query({
            query: groupQuery,
            parameters: groupParams
        }).fetchAll();

        if (groupLogs.length === 0) return;

        const stillProcessing = groupLogs.filter((l: any) =>
            l.status === 'processing' || l.status === 'pending'
        );

        if (stillProcessing.length > 0) return;

        const successLogs = groupLogs.filter((l: any) => l.status === 'success');
        if (successLogs.length === 0) return;

        const lockKey = guid || mailSubject?.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown';
        const lockId = `webhook_lock_${lockKey}`;
        
        try {
            await logsContainer.items.create({
                id: lockId,
                partition_key: '_webhook_lock',
                created_at: new Date().toISOString(),
                logs_count: groupLogs.length,
                success_count: successLogs.length,
                ttl: 86400
            });
        } catch {
            return;
        }

        let finalWebhookUrl = webhookUrl;
        if (!finalWebhookUrl) {
            const modelContainer = await cosmosDBService.getContainer('extraction_models');
            const { resources: parentModels } = await modelContainer.items.query({
                query: 'SELECT * FROM c WHERE ARRAY_CONTAINS(c.sub_model_ids, @modelId) AND c.partition_key = @pk',
                parameters: [
                    { name: '@modelId', value: currentLog.model_id },
                    { name: '@pk', value: 'model' }
                ]
            }).fetchAll();
            const parentWithWebhook = parentModels.find((m: any) => m.webhook_url?.trim());
            if (parentWithWebhook) finalWebhookUrl = parentWithWebhook.webhook_url.trim();
        }

        if (!finalWebhookUrl) return;

        await this.sendGroupWebhook(successLogs, model, host, finalWebhookUrl);
    }

    private async sendGroupWebhook(
        logs: any[],
        model: ExtractionModel | null,
        host: string,
        webhookUrl: string
    ) {
        const blobStorageService = new BlobStorageService(this.envConfig);
        const hydrateMaybeOffloaded = async (value: unknown): Promise<unknown> => {
            if (!BlobStorageService.isOffloadedReference(value)) return value;
            try {
                return await blobStorageService.downloadJson(value.blob_path);
            } catch (e) {
                console.error('[ConnectorService] 오프로딩 데이터 복원 실패:', e);
                return value;
            }
        };

        const getConfidence = (guideExtracted: any) => {
            const m: Record<string, number> = {};
            if (guideExtracted) {
                Object.entries(guideExtracted).forEach(([k, f]: [string, any]) => {
                    if (f && typeof f === 'object' && 'confidence' in f) m[k] = f.confidence;
                });
            }
            return m;
        };

        let resultData: any;
        if (logs.length === 1) {
            const singleLog = logs[0];
            const extractedData = await hydrateMaybeOffloaded(singleLog.extracted_data);
            const previewData = await hydrateMaybeOffloaded(singleLog.preview_data);
            resultData = {
                data: this.recursiveClean(extractedData),
                confidence_data: getConfidence((previewData as any)?.guide_extracted)
            };
        } else {
            const normalizedLogs = this.pickWebhookLogsByDocType(
                logs.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
            );
            const aggregated: Record<string, any> = {};
            for (let idx = 0; idx < normalizedLogs.length; idx++) {
                const log = normalizedLogs[idx].log;
                const extractedData = await hydrateMaybeOffloaded(log.extracted_data);
                const previewData = await hydrateMaybeOffloaded(log.preview_data);
                const docType = normalizedLogs[idx].docType || `Document_${idx + 1}`;
                aggregated[docType] = {
                    data: this.recursiveClean(extractedData),
                    confidence_data: getConfidence((previewData as any)?.guide_extracted)
                };
            }
            resultData = aggregated;
        }

        const protocol = host.includes('localhost') ? 'http' : 'https';
        const firstLog = logs[0];
        const reviewModelId = firstLog.super_model_id || firstLog.model_id;
        const reviewUrl = `${protocol}://${host}/extraction/run/${reviewModelId}?logId=${firstLog.id}`;

        const webhookPayload = {
            event: 'extraction_confirmed',
            log_id: firstLog.id,
            model_id: firstLog.model_id,
            model_name: model?.name || 'Unknown Model',
            filename: firstLog.filename,
            review_url: reviewUrl,
            extracted_data: resultData,
            metadata: firstLog.metadata,
            user: { name: this.user.name, email: this.user.upn, object_id: this.user.oid },
            timestamp: new Date().toISOString()
        };

        let authToken: string | undefined;
        const urlLower = webhookUrl.toLowerCase();
        const hasSig = urlLower.includes('sig=');
        const isPowerAutomate = urlLower.includes('flow.microsoft.com') ||
            urlLower.includes('logic.azure.com') ||
            urlLower.includes('windows.net') ||
            urlLower.includes('powerplatform.com');

        if (isPowerAutomate && !hasSig) {
            try {
                const msFlowService = new MSFlowService(this.envConfig);
                const tokenResponse = await msFlowService.getMSFlowAuthToken('https://service.flow.microsoft.com/.default');
                if (tokenResponse) {
                    authToken = typeof tokenResponse === 'string' ? tokenResponse : (tokenResponse as any).token || (tokenResponse as any).accessToken;
                }
            } catch (e: any) {
                console.error('[ConnectorService] Auth token failed:', e.message);
            }
        }

        await sendWebhook(webhookUrl, webhookPayload, authToken, this.envConfig.webhook_secret);
        
        await logAction({
            userId: this.user.oid,
            userEmail: this.user.upn,
            tenantId: this.envConfig.id,
            action: 'WEBHOOK',
            resourceType: 'extraction',
            resourceId: firstLog.id,
            status: 'SUCCESS',
            details: {
                modelId: firstLog.model_id,
                modelName: model?.name,
                llmModel: this.extractLlmModelFromUnknown(firstLog.debug_data),
                filename: firstLog.filename,
                webhookUrl
            },
        });
    }
}
