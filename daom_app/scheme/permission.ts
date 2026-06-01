// _scheme/permission.ts
import { z } from 'zod';
import dayjs from '@/lib/dayjs';
import { UserObject } from './common';

export const GLOBAL_PERMISSION_PARTITION_KEY = 'global:global' as const;

export const PermissionTargetType = z.enum(['user', 'group', 'group:M365', 'group:Security']);
export type PermissionTargetType = z.infer<typeof PermissionTargetType>;

export const GlobalPermissionRoleType = z.enum(['admin', 'user']);
export type GlobalPermissionRoleType = z.infer<typeof GlobalPermissionRoleType>;

// global permission
const GlobalPermissionBase = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  partition_key: z.literal(GLOBAL_PERMISSION_PARTITION_KEY).default(GLOBAL_PERMISSION_PARTITION_KEY), // global:global (추후 변경 여지 있음)
  role: GlobalPermissionRoleType,
  target_type: PermissionTargetType,
  target: UserObject,
  created_at: z.string().default(() => dayjs().utc().toISOString()),
  created_by: UserObject,
  modified_at: z.string().optional(),
  modified_by: UserObject.optional(),
});

export const GlobalPermission = GlobalPermissionBase.transform((data) => ({
  ...data,
  modified_at: data.modified_at ?? data.created_at,
  modified_by: data.modified_by ?? data.created_by,
}));

// global permission request
export const GlobalPermissionListRequest = z.object({
  offset: z.coerce.number().nullish().default(0),
  pageSize: z.coerce.number().nullish().default(10),
  nameOrUpn: z.string().nullish(),
  role: z.enum(['all', 'admin', 'user']).default('all'),
  limit: z.coerce.number().nullish().default(10),
  count: z.coerce.boolean().optional(),
});

// global permission create request
export const GlobalPermissionCreateRequest = z.object({
  target_type: PermissionTargetType,
  target: UserObject,
  role: GlobalPermissionRoleType,
});
export const GlobalPermissionsCreateRequest = z.array(GlobalPermissionCreateRequest);

// global permission delete request
export const GlobalPermissionDeleteRequest = z.object({ id: z.string() });

export const GlobalPermissionBulkDeleteRequest = z.object({
  ids: z.array(z.string()),
});

export const GlobalPermissionUpdateRoleRequest = z.object({
  id: z.string(),
  role: GlobalPermissionRoleType,
});

// Types
export type GlobalPermission = z.infer<typeof GlobalPermission>;
export type GlobalPermissionListRequest = z.infer<typeof GlobalPermissionListRequest>;
export type GlobalPermissionCreateRequest = z.infer<typeof GlobalPermissionCreateRequest>;
export type GlobalPermissionSelectedUser = z.infer<typeof GlobalPermissionCreateRequest>;
export type GlobalPermissionsCreateRequest = z.infer<typeof GlobalPermissionsCreateRequest>;
export type GlobalPermissionDeleteRequest = z.infer<typeof GlobalPermissionDeleteRequest>;
export type GlobalPermissionBulkDeleteRequest = z.infer<typeof GlobalPermissionBulkDeleteRequest>;
export type GlobalPermissionUpdateRoleRequest = z.infer<typeof GlobalPermissionUpdateRoleRequest>;

// Permission Group Schema
export const GroupMemberSchema = z.object({
  type: z.enum(['user', 'entra_group']),
  id: z.string(),
  displayName: z.string(),
});
export type GroupMember = z.infer<typeof GroupMemberSchema>;

export const ModelPermissionSchema = z.object({
  modelId: z.string(),
  modelName: z.string(),
  role: z.enum(['Admin', 'User']),
});
export type ModelPermission = z.infer<typeof ModelPermissionSchema>;

export const GroupPermissionsSchema = z.object({
  superAdmin: z.boolean().default(false),
  models: z.array(ModelPermissionSchema).default([]),
});
export type GroupPermissions = z.infer<typeof GroupPermissionsSchema>;

export const PermissionGroupSchema = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  partition_key: z.literal('group').default('group'),
  name: z.string(),
  description: z.string().optional(),
  members: z.array(GroupMemberSchema).default([]),
  permissions: GroupPermissionsSchema.default({ superAdmin: false, models: [] }),
  created_at: z.string().default(() => dayjs().utc().toISOString()),
  created_by: z.string().optional(), // User ID
  updated_at: z.string().optional(),
});
export type PermissionGroup = z.infer<typeof PermissionGroupSchema>;

