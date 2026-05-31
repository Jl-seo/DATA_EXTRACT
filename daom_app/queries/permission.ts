import {
  createGlobalPermissions,
  deleteGlobalPermission,
  deleteGlobalPermissions,
  updateGlobalPermissionRole,
} from '@/actions/permission';
import {
  GlobalPermission,
  GlobalPermissionDeleteRequest,
  GlobalPermissionListRequest,
  GlobalPermissionsCreateRequest,
  GlobalPermissionUpdateRoleRequest,
  GlobalPermissionBulkDeleteRequest,
} from '@/scheme/permission';
import { queryOptions, useMutation } from '@tanstack/react-query';

export function buildGlobalPermissionListQuery(req: GlobalPermissionListRequest) {
  req = GlobalPermissionListRequest.parse(req);
  return queryOptions<GlobalPermission[]>({
    queryKey: ['/global-permissions', { params: req }],
  });
}

export function buildGlobalPermissionCountQuery(req: GlobalPermissionListRequest) {
  req = GlobalPermissionListRequest.parse({
    ...req,
    offset: null,
    pageSize: null,
    count: true,
  } satisfies GlobalPermissionListRequest);

  return queryOptions<number>({
    queryKey: ['/global-permissions', { params: req }],
  });
}

export function useGlobalPermissionsCreate() {
  return useMutation({
    mutationFn: (req: GlobalPermissionsCreateRequest) =>
      createGlobalPermissions(req),
  });
}

export function useGlobalPermissionUpdateRole() {
  return useMutation({
    mutationFn: (req: GlobalPermissionUpdateRoleRequest) =>
      updateGlobalPermissionRole(req),
  });
}

export function useGlobalPermissionDelete() {
  return useMutation({
    mutationFn: (req: GlobalPermissionDeleteRequest) => deleteGlobalPermission(req),
  });
}

export function useGlobalPermissionBulkDelete() {
  return useMutation({
    mutationFn: (req: GlobalPermissionBulkDeleteRequest) => deleteGlobalPermissions(req),
  });
}
