'use server';

import 'server-only';
import CosmosDBService from '@/services/CosmosDBService';
import PermissionService from '@/services/PermissionService';
import { getCurrentEnvConfig } from '@/lib/env';
import {
    Group,
    GroupPermissions,
    CreateGroupRequest,
    UpdateGroupRequest,
    AddMemberRequest,
    RemoveMemberRequest,
    SetPermissionsRequest,
    DeleteGroupRequest,
} from '@/scheme/group';
import { getCurrentUserInfo } from './user';
import dayjs from '@/lib/dayjs';

const GROUPS_CONTAINER = 'groups';

/**
 * 테넌트의 그룹 목록 조회
 */
export async function listGroups(): Promise<Group[]> {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const currentUser = await permissionService.getCurrentUser();

    if (!currentUser) {
        throw new Error('인증되지 않은 사용자입니다');
    }

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(GROUPS_CONTAINER);

    const query = 'SELECT * FROM c WHERE c.tenant_id = @tenant_id';
    const parameters = [{ name: '@tenant_id', value: envConfig.id }];

    const { resources } = await container.items
        .query({ query, parameters })
        .fetchAll();

    return resources as Group[];
}

/**
 * 그룹 생성 (관리자 전용)
 */
export async function createGroup(request: CreateGroupRequest): Promise<Group> {
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
    const validated = CreateGroupRequest.parse(request);

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(GROUPS_CONTAINER);

    const newGroup: Group = {
        id: crypto.randomUUID(),
        name: validated.name,
        description: validated.description,
        tenant_id: envConfig.id,
        members: [],
        permissions: {
            superAdmin: validated.superAdmin,
            models: [],
        },
        created_by: currentUser.oid,
        created_at: dayjs().utc().toISOString(),
    };

    await container.items.create(newGroup);
    return newGroup;
}

/**
 * 그룹 정보 조회
 */
export async function getGroupById(groupId: string): Promise<Group | null> {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const currentUser = await permissionService.getCurrentUser();

    if (!currentUser) {
        throw new Error('인증되지 않은 사용자입니다');
    }

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(GROUPS_CONTAINER);

    const query = 'SELECT * FROM c WHERE c.id = @id';
    const parameters = [{ name: '@id', value: groupId }];

    const { resources } = await container.items
        .query({ query, parameters })
        .fetchAll();

    return resources.length > 0 ? (resources[0] as Group) : null;
}

/**
 * 그룹 정보 수정 (관리자 전용)
 */
export async function updateGroup(request: UpdateGroupRequest): Promise<Group> {
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
    const validated = UpdateGroupRequest.parse(request);

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(GROUPS_CONTAINER);

    const query = 'SELECT * FROM c WHERE c.id = @id AND c.tenant_id = @tenant_id';
    const parameters = [
        { name: '@id', value: validated.groupId },
        { name: '@tenant_id', value: envConfig.id }
    ];

    const { resources } = await container.items
        .query({ query, parameters })
        .fetchAll();

    if (resources.length === 0) {
        throw new Error('그룹을 찾을 수 없습니다');
    }

    const groupData = resources[0];
    if (validated.name !== undefined) groupData.name = validated.name;
    if (validated.description !== undefined) groupData.description = validated.description;

    await container.items.upsert(groupData);
    return groupData as Group;
}

/**
 * 그룹에 멤버 추가 (관리자 전용)
 */
export async function addMemberToGroup(request: AddMemberRequest): Promise<boolean> {
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
    const validated = AddMemberRequest.parse(request);

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(GROUPS_CONTAINER);

    const query = 'SELECT * FROM c WHERE c.id = @id AND c.tenant_id = @tenant_id';
    const parameters = [
        { name: '@id', value: validated.groupId },
        { name: '@tenant_id', value: envConfig.id }
    ];

    const { resources } = await container.items
        .query({ query, parameters })
        .fetchAll();

    if (resources.length === 0) {
        throw new Error('그룹을 찾을 수 없습니다');
    }

    const groupData = resources[0];
    const members = groupData.members || [];

    // 중복 체크
    if (!members.some((m: { id: string }) => m.id === validated.id)) {
        members.push({
            type: validated.type,
            id: validated.id,
            displayName: validated.displayName,
        });
        groupData.members = members;
        await container.items.upsert(groupData);
    }

    return true;
}

/**
 * 그룹에서 멤버 제거 (관리자 전용)
 */
export async function removeMemberFromGroup(request: RemoveMemberRequest): Promise<boolean> {
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
    const validated = RemoveMemberRequest.parse(request);

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(GROUPS_CONTAINER);

    const query = 'SELECT * FROM c WHERE c.id = @id AND c.tenant_id = @tenant_id';
    const parameters = [
        { name: '@id', value: validated.groupId },
        { name: '@tenant_id', value: envConfig.id }
    ];

    const { resources } = await container.items
        .query({ query, parameters })
        .fetchAll();

    if (resources.length === 0) {
        throw new Error('그룹을 찾을 수 없습니다');
    }

    const groupData = resources[0];
    groupData.members = (groupData.members || []).filter(
        (m: { id: string }) => m.id !== validated.memberId
    );

    await container.items.upsert(groupData);
    return true;
}

/**
 * 그룹 권한 설정 (관리자 전용)
 */
export async function setGroupPermissions(request: SetPermissionsRequest): Promise<boolean> {
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
    const validated = SetPermissionsRequest.parse(request);

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(GROUPS_CONTAINER);

    const query = 'SELECT * FROM c WHERE c.id = @id AND c.tenant_id = @tenant_id';
    const parameters = [
        { name: '@id', value: validated.groupId },
        { name: '@tenant_id', value: envConfig.id }
    ];

    const { resources } = await container.items
        .query({ query, parameters })
        .fetchAll();

    if (resources.length === 0) {
        throw new Error('그룹을 찾을 수 없습니다');
    }

    const groupData = resources[0];
    groupData.permissions = {
        superAdmin: validated.superAdmin,
        models: validated.models,
    };

    await container.items.upsert(groupData);
    return true;
}

/**
 * 그룹 삭제 (관리자 전용)
 */
export async function deleteGroup(request: DeleteGroupRequest): Promise<boolean> {
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
    const validated = DeleteGroupRequest.parse(request);

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(GROUPS_CONTAINER);

    await container.item(validated.groupId, envConfig.id).delete();
    return true;
}
