/**
 * Startup Initialization Service
 * Runs once per tenant to seed default data
 */

import 'server-only';
import CosmosDBService from '@/services/CosmosDBService';
import { getCurrentEnvConfig } from '@/lib/env';
import { DEFAULT_MENUS } from '@/scheme/menu';
import dayjs from '@/lib/dayjs';

const SYSTEM_ADMIN_GROUP_ID = 'system-admins';
const SYSTEM_ADMIN_GROUP_NAME = 'System Admins';

/**
 * System Admins 그룹 생성 (superAdmin 권한)
 */
async function seedSystemAdminGroup(cosmosDBService: CosmosDBService, tenantId: string) {
    const container = await cosmosDBService.getContainer('groups');

    const query = 'SELECT * FROM c WHERE c.id = @id AND c.tenant_id = @tenant_id';
    const parameters = [
        { name: '@id', value: SYSTEM_ADMIN_GROUP_ID },
        { name: '@tenant_id', value: tenantId },
    ];

    const { resources } = await container.items.query({ query, parameters }).fetchAll();

    if (resources.length > 0) {
        console.log('System Admins group already exists');
        return;
    }

    // Create System Admins group
    const groupData = {
        id: SYSTEM_ADMIN_GROUP_ID,
        name: SYSTEM_ADMIN_GROUP_NAME,
        description: '시스템 관리자 그룹 - 모든 권한',
        tenant_id: tenantId,
        members: [],
        permissions: {
            superAdmin: true,
            models: [],
            menus: [],
        },
        created_by: 'system',
        created_at: dayjs().utc().toISOString(),
    };

    await container.items.create(groupData);
    console.log(`Created System Admins group for tenant ${tenantId}`);
}

/**
 * 기본 메뉴 시드
 */
async function seedDefaultMenus(cosmosDBService: CosmosDBService, tenantId: string) {
    const container = await cosmosDBService.getContainer('menus');

    const query = 'SELECT c.id FROM c WHERE c.tenant_id = @tenant_id';
    const parameters = [{ name: '@tenant_id', value: tenantId }];

    const { resources } = await container.items.query({ query, parameters }).fetchAll();

    if (resources.length > 0) {
        console.log('Menus already seeded');
        return;
    }

    // Create default menus
    for (const menuData of DEFAULT_MENUS) {
        const menu = {
            ...menuData,
            tenant_id: tenantId,
        };
        await container.items.create(menu);
    }

    console.log(`Seeded ${DEFAULT_MENUS.length} default menus for tenant ${tenantId}`);
}

/**
 * 전체 초기화 작업 실행
 */
export async function runStartupTasks(): Promise<{ success: boolean; message: string }> {
    try {
        const envConfig = await getCurrentEnvConfig();
        const cosmosDBService = new CosmosDBService(envConfig);

        console.log(`Running startup tasks for tenant ${envConfig.id}...`);

        // Seed System Admins group
        await seedSystemAdminGroup(cosmosDBService, envConfig.id);

        // Seed default menus
        await seedDefaultMenus(cosmosDBService, envConfig.id);

        console.log('Startup tasks completed');
        return { success: true, message: 'Initialization completed successfully' };
    } catch (error) {
        console.error('Startup tasks failed:', error);
        return { success: false, message: `Initialization failed: ${error}` };
    }
}
