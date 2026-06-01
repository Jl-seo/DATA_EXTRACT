'use server';

import 'server-only';
import CosmosDBService from '@/services/CosmosDBService';
import PermissionService from '@/services/PermissionService';
import { getCurrentEnvConfig } from '@/lib/env';
import {
    Menu,
    DEFAULT_MENUS,
    CreateMenuRequest,
    UpdateMenuRequest,
    DeleteMenuRequest,
} from '@/scheme/menu';
import { getCurrentUserInfo } from './user';

const MENUS_CONTAINER = 'menus';

/**
 * 기본 메뉴 시드 (테넌트별 최초 1회)
 */
async function seedMenusIfNeeded(tenantId: string, cosmosDBService: CosmosDBService) {
    const container = await cosmosDBService.getContainer(MENUS_CONTAINER);

    const query = "SELECT c.id FROM c WHERE c.partition_key = 'menu' AND c.tenant_id = @tenant_id";
    const parameters = [{ name: '@tenant_id', value: tenantId }];

    const { resources } = await container.items
        .query({ query, parameters }, { partitionKey: 'menu' })
        .fetchAll();

    if (resources.length > 0) {
        return; // 이미 시드됨
    }

    // 기본 메뉴 생성
    for (const menuData of DEFAULT_MENUS) {
        const menu: Menu = {
            ...menuData,
            tenant_id: tenantId,
            partition_key: 'menu',
        };
        try {
            await container.items.create(menu);
        } catch (error: any) {
            // 409 Conflict: 이미 존재하는 메뉴는 무시
            if (error.code !== 409) {
                throw error;
            }
        }
    }
}

/**
 * 모든 메뉴 조회
 */
export async function listMenus(): Promise<Menu[]> {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const currentUser = await permissionService.getCurrentUser();

    if (!currentUser) {
        throw new Error('인증되지 않은 사용자입니다');
    }

    const cosmosDBService = new CosmosDBService(envConfig);

    // 메뉴 시드 (필요시)
    await seedMenusIfNeeded(envConfig.id, cosmosDBService);

    const container = await cosmosDBService.getContainer(MENUS_CONTAINER);

    const query = "SELECT * FROM c WHERE c.partition_key = 'menu' AND c.tenant_id = @tenant_id ORDER BY c[\"order\"]";
    const parameters = [{ name: '@tenant_id', value: envConfig.id }];

    const { resources } = await container.items
        .query({ query, parameters }, { partitionKey: 'menu' })
        .fetchAll();

    return resources as Menu[];
}

/**
 * 사용자가 접근 가능한 메뉴 조회 (그룹 권한 기반)
 */
export async function getAccessibleMenus(): Promise<Menu[]> {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const currentUser = await permissionService.getCurrentUser();

    if (!currentUser) {
        throw new Error('인증되지 않은 사용자입니다');
    }

    // TODO: 사용자 그룹의 권한(permissions.menus)을 기반으로 필터링
    // 현재는 모든 메뉴 반환 (프론트엔드에서 필터링 가능)
    return await listMenus();
}

/**
 * 메뉴 생성 (관리자 전용)
 */
export async function createMenu(request: CreateMenuRequest): Promise<Menu> {
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
    const validated = CreateMenuRequest.parse(request);

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(MENUS_CONTAINER);

    const newMenu: Menu = {
        ...validated,
        tenant_id: envConfig.id,
        partition_key: 'menu',
    };

    await container.items.create(newMenu);
    return newMenu;
}

/**
 * 메뉴 정보 수정 (관리자 전용)
 */
export async function updateMenu(request: UpdateMenuRequest): Promise<boolean> {
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
    const validated = UpdateMenuRequest.parse(request);

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(MENUS_CONTAINER);

    const query = "SELECT * FROM c WHERE c.partition_key = 'menu' AND c.id = @id AND c.tenant_id = @tenant_id";
    const parameters = [
        { name: '@id', value: validated.menuId },
        { name: '@tenant_id', value: envConfig.id },
    ];

    const { resources } = await container.items
        .query({ query, parameters }, { partitionKey: 'menu' })
        .fetchAll();

    if (resources.length === 0) {
        throw new Error('메뉴를 찾을 수 없습니다');
    }

    const menuData = resources[0];
    if (validated.name !== undefined) menuData.name = validated.name;
    if (validated.icon !== undefined) menuData.icon = validated.icon;
    if (validated.order !== undefined) menuData.order = validated.order;

    await container.items.upsert(menuData);
    return true;
}

/**
 * 메뉴 삭제 (관리자 전용)
 */
export async function deleteMenu(request: DeleteMenuRequest): Promise<boolean> {
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
    const validated = DeleteMenuRequest.parse(request);

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(MENUS_CONTAINER);

    await container.item(validated.menuId, 'menu').delete();
    return true;
}
