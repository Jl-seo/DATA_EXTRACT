import { NextResponse } from 'next/server';
import type { SqlParameter } from '@azure/cosmos';
import CosmosDBService from '@/services/CosmosDBService';
import { getCurrentEnvConfig } from '@/lib/env';
import PermissionService from '@/services/PermissionService';

type LogMetadata = {
    mail_subject?: string;
    guid?: string;
};

type NormalizedLog = Record<string, unknown> & {
    id?: string;
    model_id?: string;
    status?: string;
    filename?: string;
    created_at?: string;
    metadata?: LogMetadata;
    extracted_data?: Record<string, unknown>;
    user_id: string;
    user_name?: string;
    updated_at?: string;
    error?: string;
};

type GroupedLog = NormalizedLog & {
    id: string;
    status: string;
    filename: string;
    is_grouped: boolean;
    group_count: number;
    sub_model_ids: string[];
    logs: NormalizedLog[];
};

type OwnerScope = 'all' | 'mine' | 'others';

const parseOwnerScope = (value: string): OwnerScope => {
    if (value === 'mine' || value === 'others') {
        return value;
    }
    return 'all';
};

export async function GET(
    request: Request,
    { params }: { params: Promise<{ modelId: string }> }
) {
    try {
        const { modelId } = await params;
        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '100');
        const offset = parseInt(searchParams.get('offset') || '0');
        const keyword = searchParams.get('keyword')?.trim() || '';
        const filename = searchParams.get('filename')?.trim() || '';
        const createdBy = searchParams.get('createdBy')?.trim() || '';
        const ownerScope = parseOwnerScope(searchParams.get('ownerScope')?.trim() || '');
        const status = searchParams.get('status')?.trim() || '';
        const dateStart = searchParams.get('dateStart')?.trim() || '';
        const dateEnd = searchParams.get('dateEnd')?.trim() || '';

        const envConfig = await getCurrentEnvConfig();
        const permissionService = new PermissionService(envConfig);
        const user = await permissionService.getCurrentUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const role = await permissionService.getGlobalRole();
        if (role === 'none') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (role !== 'admin' && ownerScope === 'others') {
            return NextResponse.json([]);
        }

        const cosmosDBService = new CosmosDBService(envConfig);
        const logsContainer = await cosmosDBService.getContainer('extraction_logs');
        const modelsContainer = await cosmosDBService.getContainer('extraction_models');

        // 모델 정보 조회 (상위 모델 여부 확인용)
        // extraction_models의 파티션 키는 'partition_key' 필드이며 기본값은 'model'입니다.
        const { resource: model } = await modelsContainer.item(modelId, 'model').read();
        const isSuperModel = model?.is_super_model === true;

        const projection = 'c.id, c.partition_key, c.model_id, c.super_model_id, c.model_name, c.status, c.filename, c.created_at, c.created_by, c.is_grouped, c.group_count, c.retry_count, c.error_message, c.modified_at, c.metadata';
        let query = `SELECT ${projection} FROM c WHERE c.model_id = @modelId`;
        const parameters: SqlParameter[] = [{ name: '@modelId', value: modelId }];

        // 상위 모델인 경우 super_model_id로도 조회
        if (isSuperModel) {
            query = `SELECT ${projection} FROM c WHERE (c.model_id = @modelId OR c.super_model_id = @modelId)`;
        } else {
            if (filename) {
                query += ' AND (CONTAINS(c.filename, @filename, true) OR CONTAINS(c.metadata.mail_subject, @filename, true))';
                parameters.push({ name: '@filename', value: filename });
            }
            if (status) {
                query += ' AND c.status = @status';
                parameters.push({ name: '@status', value: status });
            }
            if (dateStart) {
                query += ' AND c.created_at >= @dateStart';
                parameters.push({ name: '@dateStart', value: dateStart });
            }
            if (dateEnd) {
                query += ' AND c.created_at <= @dateEnd';
                parameters.push({ name: '@dateEnd', value: dateEnd });
            }
        }

        if (keyword) {
            query += ' AND (CONTAINS(c.filename, @keyword, true) OR CONTAINS(c.created_by.name, @keyword, true) OR CONTAINS(c.user_name, @keyword, true))';
            parameters.push({ name: '@keyword', value: keyword });
        }

        if (createdBy) {
            query += ' AND (CONTAINS(c.created_by.name, @createdBy, true) OR CONTAINS(c.created_by.upn, @createdBy, true) OR CONTAINS(c.user_name, @createdBy, true) OR CONTAINS(c.user_email, @createdBy, true))';
            parameters.push({ name: '@createdBy', value: createdBy });
        }

        if (role !== 'admin' || ownerScope === 'mine') {
            query += ' AND c.created_by.object_id = @currentUserId';
            parameters.push({ name: '@currentUserId', value: user.oid });
        } else if (ownerScope === 'others') {
            query += ' AND (NOT IS_DEFINED(c.created_by.object_id) OR c.created_by.object_id != @currentUserId)';
            parameters.push({ name: '@currentUserId', value: user.oid });
        }

        // 상위 모델은 "그룹화 후 페이지네이션"을 적용해야 통계/목록 건수가 일치합니다.
        // 따라서 상위 모델일 때는 우선 전체를 조회하고, 그룹화 뒤에 offset/limit을 적용합니다.
        const listQuery = isSuperModel
            ? {
                query: `${query} ORDER BY c.created_at DESC`,
                parameters
            }
            : {
                query: `${query} ORDER BY c.created_at DESC OFFSET @offset LIMIT @limit`,
                parameters: [
                    ...parameters,
                    { name: '@limit', value: limit },
                    { name: '@offset', value: offset }
                ]
            };

        const { resources: logs } = await logsContainer.items.query(listQuery).fetchAll();

        // 목록 조회는 경량 필드만 정규화 (대용량 preview_data / SAS URL 생성 제외)
        const normalized: NormalizedLog[] = logs.map((log: Record<string, unknown>) => ({
            ...log,
            user_id: (log.created_by as { object_id?: string } | undefined)?.object_id || (log.user_id as string | undefined) || 'unknown',
            user_name: (log.created_by as { name?: string } | undefined)?.name || (log.user_name as string | undefined),
            updated_at: (log.modified_at as string | undefined) || (log.updated_at as string | undefined) || (log.created_at as string | undefined),
            error: (log.error_message as string | undefined) || (log.error as string | undefined),
        }));

        // 상위 모델인 경우 그룹화 로직 적용
        if (isSuperModel && normalized.length > 0) {
            const groups: Record<string, NormalizedLog[]> = {};

            normalized.forEach(log => {
                const metadata = log.metadata || {};
                const mailSubject = metadata.mail_subject;
                const guid = metadata.guid;

                // mail_subject나 guid가 있는 경우에만 그룹화 키 생성, 없으면 개별 건으로 처리
                if (mailSubject || guid) {
                    const groupKey = `${mailSubject || 'no-subject'}_${guid || 'no-guid'}`;
                    if (!groups[groupKey]) {
                        groups[groupKey] = [];
                    }
                    groups[groupKey].push(log);
                } else {
                    // 그룹화할 정보가 없으면 고유 키로 단독 그룹화
                    const groupKey = `single_${log.id || crypto.randomUUID()}`;
                    groups[groupKey] = [log];
                }
            });

            const groupedResult: GroupedLog[] = Object.values(groups).map(groupLogs => {
                // 상위 모델인 경우 무조건 그룹 구조(is_grouped=true)로 반환하여 리치 뷰가 적용되도록 함

                // 최신 로그 기준 베이스 생성
                const latestLog = groupLogs[0];
                const latestMetadata = latestLog.metadata || {};

                // 상태 합성: 하나라도 error면 error, 하나라도 processing이면 processing, 모두 success면 success
                let finalStatus = 'success';
                if (groupLogs.some(l => l.status === 'error' || l.status === 'failed')) {
                    finalStatus = 'error';
                } else if (groupLogs.some(l => l.status === 'processing' || l.status === 'extracting')) {
                    finalStatus = 'processing';
                }

                // 추출 데이터 병합
                const mergedData = groupLogs.reduce<Record<string, unknown>>((acc, log) => {
                    if (log.extracted_data) {
                        return { ...acc, ...log.extracted_data };
                    }
                    return acc;
                }, {});

                // 그룹 정보 요약
                const subModels = Array.from(
                    new Set(groupLogs.map(l => l.model_id).filter((modelKey): modelKey is string => typeof modelKey === 'string' && modelKey.length > 0))
                );

                return {
                    ...latestLog,
                    id: `group_${latestLog.id || crypto.randomUUID()}`, // 그룹임을 나타내는 가상 ID
                    status: finalStatus,
                    extracted_data: mergedData,
                    is_grouped: true,
                    group_count: groupLogs.length,
                    sub_model_ids: subModels,
                    // 파일명은 메일 제목으로 대체하거나 유지
                    filename: latestMetadata.mail_subject || latestLog.filename || 'Untitled',
                    logs: groupLogs // 상세 조회를 위해 원본 로그들 포함
                };
            });

            const filteredGroups = groupedResult.filter((group) => {
                if (filename) {
                    const targetFilename = String(group.filename || '').toLowerCase();
                    if (!targetFilename.includes(filename.toLowerCase())) {
                        return false;
                    }
                }

                if (status && group.status !== status) {
                    return false;
                }

                const createdTime = new Date(String(group.created_at)).getTime();
                if (!Number.isNaN(createdTime) && dateStart) {
                    const startTime = new Date(dateStart).getTime();
                    if (!Number.isNaN(startTime) && createdTime < startTime) {
                        return false;
                    }
                }
                if (!Number.isNaN(createdTime) && dateEnd) {
                    const endTime = new Date(dateEnd).getTime();
                    if (!Number.isNaN(endTime) && createdTime > endTime) {
                        return false;
                    }
                }

                return true;
            });

            // 그룹화된 결과를 최신순 정렬 후 페이지네이션 적용
            const sortedGroups = filteredGroups.sort((a, b) =>
                new Date(String(b.created_at || '')).getTime() - new Date(String(a.created_at || '')).getTime()
            );
            const pagedGroups = sortedGroups.slice(offset, offset + limit);
            return NextResponse.json(pagedGroups);
        }

        return NextResponse.json(normalized);

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        const stack = error instanceof Error ? error.stack : undefined;
        console.error('[API] Failed to fetch model extraction logs:', message);
        if (stack) console.error(stack);
        return NextResponse.json(
            { error: 'Failed to fetch model extraction logs', message },
            { status: 500 }
        );
    }
}
