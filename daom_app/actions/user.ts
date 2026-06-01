'use server';

import 'server-only';
import CosmosDBService from '@/services/CosmosDBService';
import PermissionService from '@/services/PermissionService';
import { getCurrentEnvConfig } from '@/lib/env';
import { User, UserRole, UpdateUserRoleRequest } from '@/scheme/user';
import dayjs from '@/lib/dayjs';

const USERS_CONTAINER = 'users';
const PARTITION_KEY = '/tenant_id';

/**
 * 현재 사용자 정보 조회 (자동 등록)
 * 첫 로그인 시 자동으로 DB에 등록됩니다.
 */
export async function getCurrentUserInfo(): Promise<User> {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const currentUser = await permissionService.getCurrentUser();

    if (!currentUser) {
        throw new Error('인증되지 않은 사용자입니다');
    }

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(USERS_CONTAINER);

    // 기존 사용자 조회
    const query = 'SELECT * FROM c WHERE c.id = @id';
    const parameters = [{ name: '@id', value: currentUser.oid }];

    const { resources } = await container.items
        .query({ query, parameters })
        .fetchAll();

    const globalRole = await permissionService.getGlobalRole();
    const isAdmin = globalRole === 'admin';


    if (resources.length > 0) {
        // 마지막 로그인 시각 업데이트
        const userData = resources[0] as User;
        userData.last_login = dayjs().utc().toISOString();

        // Admin 권한이 있으면 역할을 Admin으로 표시 (DB에는 저장하지 않음 - 필요 시 저장하도록 변경 가능)
        if (isAdmin) {

            userData.role = 'Admin';
        }

        // DB에는 last_login만 업데이트하고, role이 이미 Admin인 경우 등에만 저장되는지 확인 필요
        // 현재는 upsert(userData)이므로 role 변경사항도 DB에 저장될 수 있습니다.
        await container.items.upsert(userData);
        return userData;
    }

    // 신규 사용자 등록
    const newUser: User = {
        id: currentUser.oid,
        email: currentUser.upn,
        name: currentUser.name,
        role: isAdmin ? 'Admin' : 'Viewer', // Admin 권한이 있으면 처음부터 Admin으로
        tenant_id: envConfig.id,
        created_at: dayjs().utc().toISOString(),
        last_login: dayjs().utc().toISOString(),
        groups: [],
    };

    await container.items.create(newUser);
    return newUser;
}

/**
 * 테넌트의 사용자 목록 조회 (관리자 전용)
 */
export async function listUsers(search?: string): Promise<User[]> {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const currentUser = await permissionService.getCurrentUser();

    if (!currentUser) {
        throw new Error('인증되지 않은 사용자입니다');
    }

    // 권한 체크 (Admin만 가능)
    const userInfo = await getCurrentUserInfo();
    if (userInfo.role !== 'Admin') {
        throw new Error('권한이 없습니다');
    }

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(USERS_CONTAINER);

    let query = 'SELECT * FROM c WHERE c.tenant_id = @tenant_id';
    const parameters: Array<{ name: string; value: string }> = [
        { name: '@tenant_id', value: envConfig.id }
    ];

    if (search) {
        query += ' AND (CONTAINS(LOWER(c.name), @search) OR CONTAINS(LOWER(c.email), @search))';
        parameters.push({ name: '@search', value: search.toLowerCase() });
    }

    const { resources } = await container.items
        .query({ query, parameters })
        .fetchAll();

    return resources as User[];
}

/**
 * 특정 사용자 조회 (관리자 전용)
 */
export async function getUserById(userId: string): Promise<User | null> {
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
    const container = await cosmosDBService.getContainer(USERS_CONTAINER);

    const query = 'SELECT * FROM c WHERE c.id = @id';
    const parameters = [{ name: '@id', value: userId }];

    const { resources } = await container.items
        .query({ query, parameters })
        .fetchAll();

    return resources.length > 0 ? (resources[0] as User) : null;
}

/**
 * 사용자 역할 변경 (관리자 전용)
 */
export async function updateUserRole(request: UpdateUserRoleRequest): Promise<boolean> {
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
    const validated = UpdateUserRoleRequest.parse(request);

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(USERS_CONTAINER);

    const query = 'SELECT * FROM c WHERE c.id = @id AND c.tenant_id = @tenant_id';
    const parameters = [
        { name: '@id', value: validated.userId },
        { name: '@tenant_id', value: envConfig.id }
    ];

    const { resources } = await container.items
        .query({ query, parameters })
        .fetchAll();

    if (resources.length === 0) {
        throw new Error('사용자를 찾을 수 없습니다');
    }

    const userData = resources[0];
    userData.role = validated.role;
    await container.items.upsert(userData);

    return true;
}
