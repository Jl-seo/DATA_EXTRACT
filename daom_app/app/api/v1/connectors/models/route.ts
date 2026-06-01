import { NextRequest, NextResponse } from 'next/server';
import { getCurrentEnvConfig } from '@/lib/env';
import PermissionService from '@/services/PermissionService';
import CosmosDBService from '@/services/CosmosDBService';
import { createApiErrorResponse } from '@/lib/apiError';

/**
 * GET /api/v1/connectors/models
 * 커넥터(외부 연동)용 모델 목록 조회 API
 */
export async function GET(req: NextRequest) {
    try {
        const envConfig = await getCurrentEnvConfig();
        const permissionService = new PermissionService(envConfig);

        // 1. 인증 확인 (토큰 유효성만 검사, result/upload API와 동일한 방식)
        const user = await permissionService.getCurrentUser();
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 2. 모델 목록 조회
        const cosmosDBService = new CosmosDBService(envConfig);
        const container = await cosmosDBService.getContainer('extraction_models');

        // 활성화된 모델만 조회
        const querySpec = {
            query: "SELECT c.id, c.name, c.description FROM c WHERE c.partition_key = 'model' AND c.is_active = true ORDER BY c.created_at DESC"
        };

        const { resources: models } = await container.items
            .query(querySpec, { partitionKey: 'model' })
            .fetchAll();

        // 3. 응답 반환
        return NextResponse.json({
            models: models.map(m => ({
                id: m.id,
                name: m.name,
                description: m.description || ''
            }))
        });

    } catch (error: unknown) {
        return createApiErrorResponse({
            req,
            source: 'api/v1/connectors/models',
            error,
            status: 500,
            defaultMessage: 'Internal Server Error',
            exposeMessage: true,
        });
    }
}
