'use server';
import 'server-only';

import { SqlParameter } from '@azure/cosmos';
import {
    ExtractionLog,
    ExtractionLogListRequest,
} from '@/scheme/extractionLog';
import CosmosDBService from '@/services/CosmosDBService';
import PermissionService from '@/services/PermissionService';
import { getCurrentEnvConfig } from '@/lib/env';
import dayjs from '@/lib/dayjs';

export async function listExtractionLogs(
    req: ExtractionLogListRequest,
    count: boolean = false
) {
    req = ExtractionLogListRequest.parse(req);
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer('extraction_logs');
    const modelContainer = await cosmosDBService.getContainer('extraction_models');

    const lines: string[] = ['SELECT'];
    if (count) {
        lines.push('VALUE COUNT(1)');
    } else {
        // Selective projection: 리스트 화면에 필요한 필드만 조회 (추출 결과 등 대용량 필드 제외)
        lines.push('c.id, c.partition_key, c.model_id, c.model_name, c.status, c.filename, c.created_at, c.created_by, c.is_grouped, c.group_count, c.super_model_id, c.retry_count, c.error_message, c.modified_at, c.metadata');
    }
    lines.push('FROM c WHERE 1=1');

    const p: SqlParameter[] = [];

    // Filter by modelId
    if (req.modelId) {
        let isSuperModel = false;
        try {
            const { resource: model } = await modelContainer.item(req.modelId, 'model').read<{ is_super_model?: boolean }>();
            isSuperModel = model?.is_super_model === true;
        } catch {
            // 모델 문서를 찾지 못한 경우 기존 단건 필터로 처리
            isSuperModel = false;
        }

        if (isSuperModel) {
            // 상위 모델 선택 시: 하위 모델 로그(model_id/partition_key) + 상위 식별자(super_model_id)까지 함께 조회
            lines.push('AND (c.model_id = @modelId OR c.super_model_id = @modelId OR c.partition_key = @modelId)');
        } else {
            // 일반 모델 선택 시 partition_key 기준으로 빠르게 스코프 조회
            lines.push('AND c.partition_key = @modelId');
        }
        p.push({ name: '@modelId', value: req.modelId });
    }

    // Filter by filename
    if (req.filename) {
        lines.push('AND (CONTAINS(c.filename, @filename, true) OR CONTAINS(c.metadata.mail_subject, @filename, true))');
        p.push({ name: '@filename', value: req.filename });
    }

    // Filter by status
    if (req.status) {
        lines.push('AND c.status = @status');
        p.push({ name: '@status', value: req.status });
    }

    // Filter by createdBy
    if (req.createdBy) {
        lines.push('AND (CONTAINS(c.created_by.name, @createdBy, true))');
        p.push({ name: '@createdBy', value: req.createdBy });
    }

    // Filter by Date
    if (req.dateStart) {
        lines.push('AND c.created_at >= @dateStart');
        p.push({ name: '@dateStart', value: req.dateStart });
    }

    if (req.dateEnd) {
        lines.push('AND c.created_at <= @dateEnd');
        p.push({
            name: '@dateEnd',
            value: dayjs(req.dateEnd).utc().add(1, 'day').toISOString()
        });
    }

    // Access Control: Show all for admin, own for user
    const role = await permissionService.getGlobalRole();
    if (role === 'none') {
        console.warn(`[listExtractionLogs] Unauthorized access attempt by ${user.upn}`);
        throw new Error('Unauthorized: User not registered');
    }

    if (role !== 'admin') {
        lines.push('AND c.created_by.object_id = @userId');
        p.push({ name: '@userId', value: user.oid });
    }

    lines.push('ORDER BY c.created_at DESC');

    if (!count) {
        if (req.offset !== undefined && req.pageSize !== undefined) {
            lines.push('OFFSET @offset LIMIT @limit');
            p.push({ name: '@offset', value: req.offset });
            p.push({ name: '@limit', value: req.pageSize });
        }
    }

    const query = {
        query: lines.join(' '),
        parameters: p,
    };

    const { resources } = await container.items.query(query).fetchAll();

    if (count) {
        return resources[0] as number;
    }
    return resources as ExtractionLog[];
}

export async function getExtractionStats(modelId: string) {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) throw new Error('Unauthorized');
    const role = await permissionService.getGlobalRole();

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer('extraction_logs');
    const modelsContainer = await cosmosDBService.getContainer('extraction_models');

    const { resource: model } = await modelsContainer.item(modelId, 'model').read<{ is_super_model?: boolean }>();
    const isSuperModel = model?.is_super_model === true;

    if (isSuperModel) {
        let superQuery = `
            SELECT c.id, c.status, c.created_at, c.metadata
            FROM c
            WHERE (c.model_id = @modelId OR c.super_model_id = @modelId)
        `;
        const superParams: SqlParameter[] = [{ name: '@modelId', value: modelId }];

        if (role !== 'admin') {
            superQuery += ' AND c.created_by.object_id = @userId';
            superParams.push({ name: '@userId', value: user.oid });
        }

        const { resources } = await container.items.query<{
            id: string;
            status?: string;
            created_at?: string;
            metadata?: { mail_subject?: string; guid?: string };
        }>({
            query: superQuery,
            parameters: superParams
        }).fetchAll();

        const groups = new Map<string, Array<{
            id: string;
            status?: string;
            created_at?: string;
            metadata?: { mail_subject?: string; guid?: string };
        }>>();

        resources.forEach((log) => {
            const mailSubject = log.metadata?.mail_subject;
            const guid = log.metadata?.guid;
            const groupKey = (mailSubject || guid)
                ? `${mailSubject || 'no-subject'}_${guid || 'no-guid'}`
                : `single_${log.id}`;
            const existing = groups.get(groupKey) || [];
            existing.push(log);
            groups.set(groupKey, existing);
        });

        let success = 0;
        let processing = 0;
        let error = 0;

        groups.forEach((groupLogs) => {
            const hasError = groupLogs.some((log) => log.status === 'error' || log.status === 'failed');
            if (hasError) {
                error += 1;
                return;
            }

            const hasProcessing = groupLogs.some((log) =>
                log.status === 'processing' ||
                log.status === 'pending' ||
                log.status === 'extracting' ||
                log.status === 'running'
            );
            if (hasProcessing) {
                processing += 1;
                return;
            }

            success += 1;
        });

        return {
            total: groups.size,
            success,
            processing,
            error
        };
    }

    // 기본 쿼리 및 조건 설정 (partition_key 활용)
    const baseQuery = 'SELECT VALUE COUNT(1) FROM c WHERE 1=1';
    let filterQuery = ' AND (c.partition_key = @modelId OR c.super_model_id = @modelId)';
    const parameters = [{ name: '@modelId', value: modelId }];

    if (role !== 'admin') {
        filterQuery += ' AND c.created_by.object_id = @userId';
        parameters.push({ name: '@userId', value: user.oid });
    }

    const runQuery = async (status?: string) => {
        let q = baseQuery + filterQuery;
        const p = [...parameters];
        if (status) {
            q += ' AND c.status = @status';
            p.push({ name: '@status', value: status });
        }
        const { resources } = await container.items.query({ query: q, parameters: p }).fetchAll();
        return resources[0] as number;
    };

    const [total, success, processing, error] = await Promise.all([
        runQuery(),
        runQuery('success'),
        runQuery('processing'),
        runQuery('error')
    ]);

    return { total, success, processing, error };
}

import BlobStorageService from '@/services/BlobStorageService';

export async function getExtractionLog(id: string) {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const role = await permissionService.getGlobalRole();
    if (role === 'none') throw new Error('Unauthorized: User not registered');

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer('extraction_logs');

    let logId = id;
    let isRequestingGroup = false;

    if (id.startsWith('group_')) {
        logId = id.replace('group_', '');
        isRequestingGroup = true;
    } else if (id.startsWith('single_')) {
        logId = id.replace('single_', '');
    }

    const { resources: baseLogs } = await container.items.query({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: logId }]
    }).fetchAll();

    let log = baseLogs[0] as any;
    if (!log) return undefined;

    // 만약 그룹 조청이거나, 해당 로그가 상위 모델 소속이라면 그룹화 수행
    if (isRequestingGroup || log.super_model_id) {
        const mailSubject = log.metadata?.mail_subject;
        const guid = log.metadata?.guid;

        if (mailSubject || guid) {
            const { resources: groupLogs } = await container.items.query({
                query: `
                    SELECT * FROM c 
                    WHERE (c.model_id = @modelId OR c.super_model_id = @modelId OR c.model_id = @superId OR c.super_model_id = @superId)
                    AND c.metadata.mail_subject = @mailSubject
                    AND c.metadata.guid = @guid
                    ORDER BY c.created_at DESC
                `,
                parameters: [
                    { name: '@modelId', value: log.model_id },
                    { name: '@superId', value: log.super_model_id || log.model_id },
                    { name: '@mailSubject', value: mailSubject || null },
                    { name: '@guid', value: guid || null }
                ]
            }).fetchAll();

            if (groupLogs.length > 0) {
                const latestLog = groupLogs[0];
                // 최신 데이터가 우선순위를 갖도록 역순으로 reduce (Latest Wins)
                const mergedData = [...groupLogs].reverse().reduce((acc, l) => ({ ...acc, ...(l.extracted_data || {}) }), {});
                const subModels = Array.from(new Set(groupLogs.map(l => l.model_id)));

                // 상태 합성
                let finalStatus = 'success';
                if (groupLogs.some(l => l.status === 'error' || l.status === 'failed')) finalStatus = 'error';
                else if (groupLogs.some(l => l.status === 'processing' || l.status === 'extracting')) finalStatus = 'processing';

                log = {
                    ...latestLog,
                    id: `group_${latestLog.id}`,
                    status: finalStatus,
                    extracted_data: mergedData,
                    is_grouped: true,
                    group_count: groupLogs.length,
                    sub_model_ids: subModels,
                    logs: groupLogs
                };

                // 그룹 내 모든 로그의 SAS URL 갱신
                try {
                    const blobStorageService = new BlobStorageService(envConfig);
                    const refreshedLogs = await Promise.all(groupLogs.map(async (l: any) => {
                        if (l.file?.blob_path) {
                            const actualBlobPath = `${envConfig.id}/${l.file.blob_path}`;
                            const newUrl = await blobStorageService.generateSasUrl(
                                actualBlobPath,
                                BlobStorageService.SAS.READ(60)
                            );
                            return { ...l, file_url: newUrl };
                        }
                        return l;
                    }));
                    log.logs = refreshedLogs;
                } catch (e) {
                    console.warn('[getExtractionLog] Grouped logs SAS URL 갱신 실패:', e);
                }
            }
        }
    }

    // blob_path가 있으면 저장된 file_url 만료 여부와 무관하게 항상 새 SAS URL 발급
    if (log && log.file?.blob_path) {
        try {
            const blobStorageService = new BlobStorageService(envConfig);
            const actualBlobPath = `${envConfig.id}/${log.file.blob_path}`;
            log.file_url = await blobStorageService.generateSasUrl(
                actualBlobPath,
                BlobStorageService.SAS.READ(60)
            );
        } catch (e) {
            console.warn('[getExtractionLog] SAS URL 생성 실패:', log.file.blob_path, e);
        }
    }

    // 비교 분석 문서들의 SAS URL 갱신
    const comparisons = log?.preview_data?.comparisons || (log?.preview_data as any)?.guide_extracted?.comparisons;
    if (log && comparisons && Array.isArray(comparisons)) {
        try {
            const blobStorageService = new BlobStorageService(envConfig);
            const updatedComparisons = await Promise.all(comparisons.map(async (comp: any) => {
                // candidate_files에서 해당 인덱스의 파일 정보를 찾음
                const fileInfo = log.candidate_files?.[comp.candidate_index];
                if (fileInfo?.blob_path) {
                    const actualPath = `${envConfig.id}/${fileInfo.blob_path}`;
                    const newUrl = await blobStorageService.generateSasUrl(
                        actualPath,
                        BlobStorageService.SAS.READ(60)
                    );
                    return { ...comp, file_url: newUrl };
                }
                return comp;
            }));

            log.preview_data.comparisons = updatedComparisons;
            if (log.preview_data.guide_extracted) {
                log.preview_data.guide_extracted.comparisons = updatedComparisons;
            }
        } catch (e) {
            console.warn('[getExtractionLog] 후보 문서 SAS URL 갱신 실패:', e);
        }
    }

    // --- Offloading 처리: preview_data가 오프로딩된 경우 데이터를 직접 가져와 병합 ---
    const blobStorageService = new BlobStorageService(envConfig);

    const fetchOffloadedField = async (
        targetLog: Record<string, unknown>,
        field: 'preview_data' | 'debug_data' | 'extracted_data'
    ) => {
        const fieldValue = targetLog[field];
        if (!BlobStorageService.isOffloadedReference(fieldValue)) return;

        try {
            const offloadedData = await blobStorageService.downloadJson(fieldValue.blob_path);
            targetLog[field] = offloadedData as unknown;
        } catch (e) {
            console.error(`[getExtractionLog] Failed to fetch offloaded ${field} for ${String(targetLog.id)}:`, e);
        }
    };

    const fetchOffloadedData = async (targetLog: any) => {
        if (!targetLog || typeof targetLog !== 'object') return;
        const recordTarget = targetLog as Record<string, unknown>;
        await Promise.all([
            fetchOffloadedField(recordTarget, 'preview_data'),
            fetchOffloadedField(recordTarget, 'debug_data'),
            fetchOffloadedField(recordTarget, 'extracted_data')
        ]);
    };

    // 1. 단일 로그 처리
    await fetchOffloadedData(log);

    // 2. 그룹 로그 내의 개별 로그들 처리 (필요 시)
    if (log.is_grouped && log.logs) {
        await Promise.all(log.logs.map(fetchOffloadedData));
    }

    // multi-merged 원본 파일 목록의 SAS URL 갱신
    const sourceFiles = (log?.preview_data as any)?.beta_metadata?.source_files;
    if (log && Array.isArray(sourceFiles) && sourceFiles.length > 0) {
        try {
            const blobStorageService = new BlobStorageService(envConfig);
            const refreshedSourceFiles = await Promise.all(
                sourceFiles.map(async (source: any) => {
                    if (!source || typeof source !== 'object') return source;

                    const blobPathFromSource = typeof source.blob_path === 'string' ? source.blob_path : '';
                    const blobPathFromMainFile =
                        source.file_id === log?.file?.id && typeof log?.file?.blob_path === 'string'
                            ? log.file.blob_path
                            : '';
                    const blobPathFromCandidates = Array.isArray(log?.candidate_files)
                        ? (log.candidate_files.find((candidate: any) => candidate?.id === source.file_id)?.blob_path || '')
                        : '';

                    const chosenBlobPath = blobPathFromSource || blobPathFromMainFile || blobPathFromCandidates;
                    if (!chosenBlobPath) return source;

                    const actualPath = chosenBlobPath.startsWith(`${envConfig.id}/`)
                        ? chosenBlobPath
                        : `${envConfig.id}/${chosenBlobPath}`;

                    const refreshedUrl = await blobStorageService.generateSasUrl(
                        actualPath,
                        BlobStorageService.SAS.READ(60)
                    );

                    return {
                        ...source,
                        blob_path: chosenBlobPath,
                        file_url: refreshedUrl,
                    };
                })
            );

            if (!log.preview_data.beta_metadata) {
                log.preview_data.beta_metadata = {};
            }
            log.preview_data.beta_metadata.source_files = refreshedSourceFiles;
        } catch (e) {
            console.warn('[getExtractionLog] multi-merged source_files SAS URL 갱신 실패:', e);
        }
    }

    return log as ExtractionLog | undefined;
}

export async function deleteExtractionLog(id: string) {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer('extraction_logs');

    type DeletionTarget = {
        id: string;
        partition_key?: string;
        model_id?: string;
    };

    const deleteByDocument = async (doc: DeletionTarget) => {
        const partitionKey = doc.partition_key || doc.model_id;
        if (!partitionKey) {
            throw new Error(`Missing partition key for log: ${doc.id}`);
        }
        await container.item(doc.id, partitionKey).delete();
    };

    // 1. Retrieve the log first (handles group_/single_ prefixes internally)
    const log = await getExtractionLog(id);
    if (!log) throw new Error('Extraction log not found');

    // 2. If it's a grouped log, delete all child logs
    if (log.is_grouped && log.logs && Array.isArray(log.logs)) {
        const deletePromises = log.logs.map((child) => deleteByDocument({
            id: child.id,
            partition_key: child.partition_key,
            model_id: child.model_id
        }));
        await Promise.all(deletePromises);
        return { success: true, count: log.logs.length };
    }

    // 3. Otherwise delete the single physical log
    // getExtractionLog returns the real ID even if prefixed with 'group_' or 'single_'
    await deleteByDocument({
        id: log.id,
        partition_key: log.partition_key,
        model_id: log.model_id
    });
    return { success: true };
}

export async function createMockSuperModelLog(superModelId: string, invoiceLogId: string, blLogId: string) {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer('extraction_logs');

    // Fetch source logs
    const invoiceLog = await getExtractionLog(invoiceLogId);
    const blLog = await getExtractionLog(blLogId);



    if (!invoiceLog || !blLog) throw new Error('Source logs not found');

    const mergedData = {
        invoice: invoiceLog.extracted_data,
        bl: blLog.extracted_data,
        _source_logs: [invoiceLogId, blLogId]
    };

    const newLog: ExtractionLog = ExtractionLog.parse({
        id: crypto.randomUUID(),
        model_id: superModelId,
        status: 'success',
        filename: `MOCK_SUPER_MODEL_${dayjs().format('YYYYMMDD_HHmmss')}.json`,
        file: invoiceLog.file,
        extracted_data: mergedData,
        preview_data: {
            ...invoiceLog.preview_data,
            sub_documents: [
                {
                    index: 0,
                    type: 'Invoice',
                    status: 'success',
                    data: {
                        guide_extracted: invoiceLog.preview_data?.guide_extracted || invoiceLog.extracted_data || {},
                        other_data: invoiceLog.preview_data?.other_data || []
                    },
                    file: invoiceLog.file,
                    raw_content: invoiceLog.preview_data?.raw_content || ''
                },
                {
                    index: 1,
                    type: 'BL',
                    status: 'success',
                    data: {
                        guide_extracted: blLog.preview_data?.guide_extracted || blLog.extracted_data || {},
                        other_data: blLog.preview_data?.other_data || []
                    },
                    file: blLog.file,
                    raw_content: blLog.preview_data?.raw_content || ''
                }
            ],
            invoice: invoiceLog.preview_data,
            bl: blLog.preview_data
        },
        created_at: dayjs().utc().toISOString(),
        created_by: {
            name: user.name,
            object_id: user.oid,
            upn: user.upn,
        },
    });

    const { resource } = await container.items.create(newLog);
    return resource;
}
