import { z } from 'zod';
import dayjs from '@/lib/dayjs';

/**
 * Group Member Schema
 * - type: "user" 또는 "entra_group"
 * - id: 사용자 ID 또는 Entra 그룹 ID
 * - displayName: UI 표시용 이름
 */
export const GroupMember = z.object({
    type: z.enum(['user', 'entra_group']),
    id: z.string(),
    displayName: z.string(),
});

export type GroupMember = z.infer<typeof GroupMember>;

/**
 * Model Permission Schema
 * - modelId: 모델 ID
 * - modelName: 모델 이름 (UI 표시용)
 * - role: "Admin" 또는 "User"
 */
export const ModelPermission = z.object({
    modelId: z.string(),
    modelName: z.string(),
    role: z.enum(['Admin', 'User']),
});

export type ModelPermission = z.infer<typeof ModelPermission>;

/**
 * Group Permissions Schema
 * - superAdmin: 모든 모델 및 메뉴 접근 가능
 * - models: 모델별 권한 목록
 * - menus: 접근 가능한 메뉴 ID 목록
 */
export const GroupPermissions = z.object({
    superAdmin: z.boolean().default(false),
    models: z.array(ModelPermission).default([]),
});

export type GroupPermissions = z.infer<typeof GroupPermissions>;

/**
 * Group Schema
 */
export const Group = z.object({
    id: z.string().default(() => crypto.randomUUID()),
    name: z.string().min(1),
    description: z.string().default(''),
    tenant_id: z.string(),
    members: z.array(GroupMember).default([]),
    permissions: GroupPermissions.default({ superAdmin: false, models: [] }),
    created_by: z.string(),
    created_at: z.string().default(() => dayjs().utc().toISOString()),
});

export type Group = z.infer<typeof Group>;

// Request Types
export const CreateGroupRequest = z.object({
    name: z.string().min(1, '그룹 이름을 입력해주세요'),
    description: z.string().default(''),
    superAdmin: z.boolean().default(false),
});

export type CreateGroupRequest = z.infer<typeof CreateGroupRequest>;

export const UpdateGroupRequest = z.object({
    groupId: z.string(),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
});

export type UpdateGroupRequest = z.infer<typeof UpdateGroupRequest>;

export const AddMemberRequest = z.object({
    groupId: z.string(),
    type: z.enum(['user', 'entra_group']),
    id: z.string(),
    displayName: z.string(),
});

export type AddMemberRequest = z.infer<typeof AddMemberRequest>;

export const RemoveMemberRequest = z.object({
    groupId: z.string(),
    memberId: z.string(),
});

export type RemoveMemberRequest = z.infer<typeof RemoveMemberRequest>;

export const SetPermissionsRequest = z.object({
    groupId: z.string(),
    superAdmin: z.boolean().default(false),
    models: z.array(ModelPermission).default([]),
});

export type SetPermissionsRequest = z.infer<typeof SetPermissionsRequest>;

export const DeleteGroupRequest = z.object({
    groupId: z.string(),
});

export type DeleteGroupRequest = z.infer<typeof DeleteGroupRequest>;

// Response Types
export const GroupResponse = Group;
export type GroupResponse = z.infer<typeof GroupResponse>;
