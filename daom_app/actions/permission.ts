'use server';

import PermissionService from '@/services/PermissionService';
import { getCurrentEnvConfig } from '@/lib/env';
import { GroupMember, ModelPermission } from '@/scheme/permission';
import { type ExtractionPermissionSummary } from '@/lib/extractionPermission';

// Helper to get service instance (async)
const getPermissionService = async () => {
  const config = await getCurrentEnvConfig();
  return new PermissionService(config);
};

export async function getPermissionGroups() {
  const service = await getPermissionService();
  return await service.getPermissionGroups();
}

export async function getUserModelRoles() {
  const service = await getPermissionService();
  return await service.getUserModelRoles();
}

export async function getExtractionPermissionSummary(): Promise<ExtractionPermissionSummary> {
  const service = await getPermissionService();
  const role = await service.getGlobalRole();

  if (role === 'admin') {
    return {
      isGlobalAdmin: true,
      roles: [{ modelId: '*', modelName: '모든 모델', role: 'Admin' }],
    };
  }

  return {
    isGlobalAdmin: false,
    roles: await service.getUserModelRoles(),
  };
}

export async function createPermissionGroup(name: string, description: string, superAdmin: boolean) {
  const service = await getPermissionService();
  return await service.createPermissionGroup(name, description, superAdmin);
}

export async function updatePermissionGroup(id: string, name: string, description: string) {
  const service = await getPermissionService();
  return await service.updatePermissionGroup(id, name, description);
}

export async function deletePermissionGroup(id: string) {
  const service = await getPermissionService();
  return await service.deletePermissionGroup(id);
}

export async function addMemberToGroup(groupId: string, member: GroupMember) {
  const service = await getPermissionService();
  return await service.addMemberToGroup(groupId, member);
}

export async function removeMemberFromGroup(groupId: string, memberId: string) {
  const service = await getPermissionService();
  return await service.removeMemberFromGroup(groupId, memberId);
}

export async function updateGroupPermissions(groupId: string, superAdmin: boolean, models: ModelPermission[]) {
  const service = await getPermissionService();
  return await service.updateGroupPermissions(groupId, superAdmin, models);
}

export async function searchEntraUsers(query: string) {
  const service = await getPermissionService();
  return await service.searchEntraUsers(query);
}

export async function searchEntraGroups(query: string) {
  const service = await getPermissionService();
  return await service.searchEntraGroups(query);
}

// Global Permissions
import {
  GlobalPermissionListRequest,
  GlobalPermissionsCreateRequest,
  GlobalPermissionUpdateRoleRequest,
  GlobalPermissionDeleteRequest,
  GlobalPermissionBulkDeleteRequest
} from '@/scheme/permission';

export async function getGlobalPermissions(req: GlobalPermissionListRequest) {
  const service = await getPermissionService();
  return await service.getGlobalPermissions(req);
}

export async function createGlobalPermissions(req: GlobalPermissionsCreateRequest) {
  const service = await getPermissionService();
  return await service.createGlobalPermissions(req);
}

export async function updateGlobalPermissionRole(req: GlobalPermissionUpdateRoleRequest) {
  const service = await getPermissionService();
  return await service.updateGlobalPermissionRole(req);
}

export async function deleteGlobalPermission(req: GlobalPermissionDeleteRequest) {
  const service = await getPermissionService();
  return await service.deleteGlobalPermission(req);
}

export async function deleteGlobalPermissions(req: GlobalPermissionBulkDeleteRequest) {
  const service = await getPermissionService();
  return await service.deleteGlobalPermissions(req);
}
