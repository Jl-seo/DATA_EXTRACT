import { NextResponse } from 'next/server';
import { listExtractionLogs } from '@/actions/extractionLog';
import CosmosDBService from '@/services/CosmosDBService';
import { getCurrentEnvConfig } from '@/lib/env';
import type { ExtractionLog } from '@/scheme/extractionLog';

type ExtractionListStatus = 'success' | 'error' | 'processing' | 'pending';

type ExtractionLogListItem = Pick<
    ExtractionLog,
    | 'id'
    | 'partition_key'
    | 'model_id'
    | 'model_name'
    | 'status'
    | 'filename'
    | 'created_at'
    | 'created_by'
    | 'is_grouped'
    | 'group_count'
    | 'super_model_id'
    | 'retry_count'
    | 'error_message'
    | 'modified_at'
    | 'metadata'
> & {
    user_id?: string;
    user_name?: string;
    updated_at?: string;
    error?: string;
    logs?: ExtractionLogListItem[];
    sub_model_ids?: string[];
};

function normalizeLog(log: ExtractionLogListItem): ExtractionLogListItem {
    const displayFilename = log.metadata?.mail_subject || log.filename;
    return {
        ...log,
        filename: displayFilename,
        user_id: log.created_by?.object_id || log.user_id || 'unknown',
        user_name: log.created_by?.name || log.user_name,
        updated_at: log.modified_at || log.updated_at || log.created_at,
        error: log.error_message || log.error,
    };
}

function normalizeGroupedStatus(status: string | null | undefined): ExtractionListStatus {
    if (!status) return 'processing';
    if (status === 'error' || status === 'failed') return 'error';
    if (status === 'success') return 'success';
    return 'processing';
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);

        // Parse basic pagination parameters
        const limit = parseInt(searchParams.get('limit') || '200');
        const offset = parseInt(searchParams.get('offset') || '0');

        // Optional filter parameters
        const modelId = searchParams.get('modelId') || undefined;
        const filename = searchParams.get('filename') || undefined;
        const status = searchParams.get('status') as ExtractionListStatus | undefined;

        let isSuperModel = false;
        let superModelName: string | undefined;
        if (modelId) {
            const envConfig = await getCurrentEnvConfig();
            const cosmosDBService = new CosmosDBService(envConfig);
            const modelsContainer = await cosmosDBService.getContainer('extraction_models');
            try {
                const { resource: model } = await modelsContainer.item(modelId, 'model').read<{ is_super_model?: boolean; name?: string }>();
                isSuperModel = model?.is_super_model === true;
                superModelName = model?.name;
            } catch {
                isSuperModel = false;
                superModelName = undefined;
            }
        }

        const requestParams = {
            // 상위 모델은 그룹화 후 페이징해야 하므로 raw 로그는 충분히 넓게 먼저 조회
            pageSize: isSuperModel ? 5000 : limit,
            offset: isSuperModel ? 0 : offset,
            modelId,
            filename,
            // 상위 모델은 그룹 상태를 합성해야 하므로 raw status 필터를 여기서 미적용
            status: isSuperModel ? undefined : status,
        };

        const logs = await listExtractionLogs(requestParams, false) as ExtractionLogListItem[];

        const normalized = logs.map(normalizeLog);

        if (isSuperModel) {
            const groups = new Map<string, ExtractionLogListItem[]>();
            normalized.forEach((log) => {
                const mailSubject = log.metadata?.mail_subject || null;
                const guid = log.metadata?.guid || null;
                const groupKey = (mailSubject || guid)
                    ? `${mailSubject || 'no-subject'}_${guid || 'no-guid'}`
                    : `single_${log.id}`;
                const group = groups.get(groupKey) ?? [];
                group.push(log);
                groups.set(groupKey, group);
            });

            const grouped = Array.from(groups.values()).map((groupLogs) => {
                const sortedGroupLogs = groupLogs.sort(
                    (a, b) => new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime()
                );
                const latestLog = sortedGroupLogs[0];

                let finalStatus: ExtractionListStatus = 'success';
                if (sortedGroupLogs.some((log) => normalizeGroupedStatus(log.status) === 'error')) {
                    finalStatus = 'error';
                } else if (sortedGroupLogs.some((log) => normalizeGroupedStatus(log.status) === 'processing')) {
                    finalStatus = 'processing';
                }

                return {
                    ...latestLog,
                    id: `group_${latestLog.id}`,
                    model_id: modelId || latestLog.model_id,
                    model_name: superModelName || latestLog.model_name,
                    status: finalStatus,
                    is_grouped: true,
                    group_count: sortedGroupLogs.length,
                    sub_model_ids: Array.from(new Set(sortedGroupLogs.map((log) => log.model_id))),
                    filename: latestLog.metadata?.mail_subject || latestLog.filename,
                    logs: sortedGroupLogs,
                };
            });

            const groupedByStatus = status
                ? grouped.filter((log) => normalizeGroupedStatus(log.status) === status)
                : grouped;

            const sortedGroups = groupedByStatus.sort(
                (a, b) => new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime()
            );
            const pagedGroups = sortedGroups.slice(offset, offset + limit);
            return NextResponse.json(pagedGroups);
        }

        return NextResponse.json(normalized);
    } catch (error) {
        console.error('[API] Failed to fetch extraction logs:', error);
        return NextResponse.json(
            { error: 'Failed to fetch extraction logs' },
            { status: 500 }
        );
    }
}
