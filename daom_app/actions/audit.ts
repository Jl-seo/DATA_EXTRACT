'use server';

import 'server-only';
import CosmosDBService from '@/services/CosmosDBService';
import PermissionService from '@/services/PermissionService';
import { getCurrentEnvConfig } from '@/lib/env';
import {
    AuditLogEntry,
    AuditAction,
    AuditResource,
    ListAuditLogsRequest,
    AuditLogsListResponse,
} from '@/scheme/audit';
import { getCurrentUserInfo } from './user';
import dayjs from '@/lib/dayjs';
import { listExtractionModels } from './extractionModel';
import { DashboardStatsResponse } from '@/scheme/dashboard';
import type { ExtractionModel } from '@/scheme/extractionModel';

const AUDIT_CONTAINER = 'audit_logs';

/**
 * Audit 로그 기록
 * 모든 Server Action에서 호출 가능
 */
export async function logAction(options: {
    userId: string;
    userEmail: string;
    tenantId: string;
    action: AuditAction;
    resourceType: AuditResource;
    resourceId: string;
    status?: 'SUCCESS' | 'FAILURE';
    changes?: Record<string, { old?: any; new?: any }> | null;
    details?: Record<string, any> | null;
    metadata?: Record<string, any> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
}): Promise<string | null> {
    try {
        const envConfig = await getCurrentEnvConfig();
        const cosmosDBService = new CosmosDBService(envConfig);
        const container = await cosmosDBService.getContainer(AUDIT_CONTAINER);

        const entry: AuditLogEntry = {
            id: crypto.randomUUID(),
            timestamp: dayjs().utc().toISOString(),
            user_id: options.userId,
            user_email: options.userEmail,
            tenant_id: options.tenantId,
            action: options.action,
            resource_type: options.resourceType,
            resource_id: options.resourceId,
            status: options.status || 'SUCCESS',
            changes: options.changes || null,
            metadata: options.metadata || null,
            details: options.details || null,
            ip_address: options.ipAddress || null,
            user_agent: options.userAgent || null,
        };

        await container.items.create(entry);
        return entry.id;
    } catch (error) {
        console.error('Failed to create audit log:', error);
        return null;
    }
}

/**
 * Audit 로그 목록 조회 (관리자 전용)
 */
export async function listAuditLogs(
    request: ListAuditLogsRequest
): Promise<AuditLogsListResponse> {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const currentUser = await permissionService.getCurrentUser();

    if (!currentUser) {
        throw new Error('인증되지 않은 사용자입니다');
    }

    // 권한 체크
    const userInfo = await getCurrentUserInfo();
    if (userInfo.role !== 'Admin') {
        throw new Error('권한이 없습니다');
    }

    // Request 검증
    const validated = ListAuditLogsRequest.parse(request);

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(AUDIT_CONTAINER);

    // Build query
    const conditions: string[] = ['c.tenant_id = @tenant_id'];
    const parameters: Array<{ name: string; value: any }> = [
        { name: '@tenant_id', value: envConfig.id },
    ];

    if (validated.user_id) {
        conditions.push('c.user_id = @user_id');
        parameters.push({ name: '@user_id', value: validated.user_id });
    }

    if (validated.resource_type) {
        conditions.push('c.resource_type = @resource_type');
        parameters.push({ name: '@resource_type', value: validated.resource_type });
    }

    if (validated.action) {
        conditions.push('c.action = @action');
        parameters.push({ name: '@action', value: validated.action });
    }

    if (validated.start_date) {
        conditions.push('c.timestamp >= @start_date');
        parameters.push({ name: '@start_date', value: validated.start_date });
    }

    if (validated.end_date) {
        conditions.push('c.timestamp <= @end_date');
        parameters.push({ name: '@end_date', value: validated.end_date });
    }

    const query = `
    SELECT * FROM c
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.timestamp DESC
    OFFSET ${validated.offset} LIMIT ${validated.limit}
  `;

    const { resources } = await container.items
        .query({ query, parameters })
        .fetchAll();

    return {
        items: resources as AuditLogEntry[],
        total: resources.length, // Simplified - 실제로는 별도 count query 필요
    };
}

/**
 * 대시보드 통계 조회 (관리자 전용)
 * @param days 통계를 집계할 최근 일수 (기본 7일)
 */
export async function getDashboardStats(days: number = 7): Promise<DashboardStatsResponse> {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const currentUser = await permissionService.getCurrentUser();

    if (!currentUser) {
        throw new Error('인증되지 않은 사용자입니다');
    }

    // 권한 체크
    const userInfo = await getCurrentUserInfo();
    if (userInfo.role !== 'Admin') {
        throw new Error('권한이 없습니다');
    }

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer('extraction_logs');

    type DashboardLog = {
        id: string;
        model_id: string;
        super_model_id?: string | null;
        status?: string;
        created_at?: string;
        modified_at?: string;
        filename?: string;
        created_by?: {
            name?: string;
            upn?: string;
        };
        metadata?: {
            guid?: string;
            mail_subject?: string;
        };
    };

    type AggregatedLog = {
        id: string;
        model_id: string;
        status: string;
        created_at: string;
        filename: string;
        created_by?: {
            name?: string;
            upn?: string;
        };
    };

    const isErrorStatus = (status?: string) => status === 'error' || status === 'failed';
    const isProcessingStatus = (status?: string) =>
        status === 'processing' || status === 'pending' || status === 'extracting' || status === 'running';
    const isSuccessStatus = (status?: string) => status === 'success' || status === 'completed';

    // days <= 0 이면 전체 기간 집계
    const isAllPeriod = days <= 0;
    const dailyTrendDays = isAllPeriod ? 30 : Math.max(1, days);
    const windowStart = dayjs().utc().startOf('day').subtract(dailyTrendDays - 1, 'day').toISOString();
    const query = `
    SELECT c.id, c.model_id, c.super_model_id, c.status, c.created_at, c.modified_at, c.filename, c.created_by, c.metadata
    FROM c
    ${isAllPeriod ? '' : 'WHERE c.created_at >= @windowStart'}
    ORDER BY c.created_at DESC
    `;
    const { resources: logs } = await container.items.query<DashboardLog>(
        isAllPeriod
            ? { query }
            : {
                query,
                parameters: [{ name: '@windowStart', value: windowStart }]
            }
    ).fetchAll();

    // 모델 목록 조회하여 ID -> Name 매핑 생성
    const allModelsResult = await listExtractionModels({ offset: 0, pageSize: 1000 }, false);
    const allModels: ExtractionModel[] = Array.isArray(allModelsResult) ? allModelsResult : [];
    const modelMap: Record<string, string> = {};
    allModels.forEach((m) => {
        modelMap[m.id] = m.name;
    });

    // 상위모델 로그는 그룹 단위로 집계한다.
    const aggregatedMap = new Map<string, DashboardLog[]>();
    for (const log of logs) {
        // 엄격 모드: super_model_id가 실제 저장된 로그만 상위모델로 처리한다.
        const parentModelId = log.super_model_id || undefined;
        if (parentModelId) {
            const guid = log.metadata?.guid;
            const mailSubject = log.metadata?.mail_subject;
            const groupDiscriminator = guid || mailSubject || log.id;
            const groupKey = `${parentModelId}::${groupDiscriminator}`;
            const existing = aggregatedMap.get(groupKey) || [];
            existing.push(log);
            aggregatedMap.set(groupKey, existing);
        } else {
            const existing = aggregatedMap.get(log.id) || [];
            existing.push(log);
            aggregatedMap.set(log.id, existing);
        }
    }

    const aggregatedLogs: AggregatedLog[] = [];
    aggregatedMap.forEach((groupLogs) => {
        const sorted = [...groupLogs].sort((a, b) =>
            new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime()
        );
        const latest = sorted[0];
        if (!latest) return;

        let finalStatus = 'success';
        if (groupLogs.some((g) => isErrorStatus(g.status))) {
            finalStatus = 'error';
        } else if (groupLogs.some((g) => isProcessingStatus(g.status))) {
            finalStatus = 'processing';
        } else if (!groupLogs.some((g) => isSuccessStatus(g.status))) {
            finalStatus = latest.status || 'unknown';
        }

        const parentModelId = latest.super_model_id || undefined;
        const modelIdForDashboard = parentModelId || latest.model_id;
        const filename = latest.metadata?.mail_subject || latest.filename || 'Unknown File';

        aggregatedLogs.push({
            id: latest.id,
            model_id: modelIdForDashboard,
            status: finalStatus,
            created_at: latest.created_at || dayjs().utc().toISOString(),
            filename,
            created_by: latest.created_by
        });
    });

    aggregatedLogs.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // 지표 초기화 (최근 N일 그룹 집계 기준)
    const windowStartMs = dayjs(windowStart).valueOf();
    const periodAggregatedLogs = isAllPeriod
        ? aggregatedLogs
        : aggregatedLogs.filter((log) => {
            const createdAtMs = dayjs(log.created_at).valueOf();
            return Number.isFinite(createdAtMs) && createdAtMs >= windowStartMs;
        });

    const total_extractions = periodAggregatedLogs.length;
    let success_count = 0;

    for (const log of periodAggregatedLogs) {
        if (isSuccessStatus(log.status)) success_count++;
    }

    const success_rate = total_extractions > 0 ? Math.round((success_count / total_extractions) * 1000) / 10 : 0;

    // 1. 일별 추이 (전달받은 days 일수만큼 집계)
    const daily_trend_days = dailyTrendDays;
    const daily_trend_map: Record<string, number> = {};
    const today = dayjs().utc().startOf('day');

    for (let i = 0; i < daily_trend_days; i++) {
        const dateStr = today.subtract(i, 'day').format('YYYY-MM-DD');
        daily_trend_map[dateStr] = 0;
    }

    for (const log of periodAggregatedLogs) {
        if (!log.created_at) continue;
        const logDateStr = log.created_at.split('T')[0];
        if (daily_trend_map[logDateStr] !== undefined) {
            daily_trend_map[logDateStr]++;
        }
    }

    const daily_trend = Object.keys(daily_trend_map)
        .sort()
        .map(date => ({
            date,
            count: daily_trend_map[date]
        }));

    // 2. 모델별 사용량
    const model_usage_map: Record<string, number> = {};
    for (const log of periodAggregatedLogs) {
        const modelName = modelMap[log.model_id] || 'Unknown Model';
        model_usage_map[modelName] = (model_usage_map[modelName] || 0) + 1;
    }

    const model_usage = Object.keys(model_usage_map)
        .map(name => ({
            name,
            value: model_usage_map[name]
        }))
        .sort((a, b) => b.value - a.value);

    // 3. 최근 활동 (상위 5건)
    const recent_activity = periodAggregatedLogs.slice(0, 5).map(log => ({
        id: log.id,
        model: modelMap[log.model_id] || 'Unknown Model',
        filename: log.filename || 'Unknown File',
        status: log.status || 'unknown',
        timestamp: log.created_at,
        user: log.created_by?.name || log.created_by?.upn || 'Unknown',
    }));

    return {
        summary: {
            total_extractions,
            success_rate,
            active_models: Object.keys(modelMap).length,
        },
        daily_trend,
        model_usage,
        recent_activity,
    };
}
