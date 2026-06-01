import { z } from 'zod';
import dayjs from '@/lib/dayjs';
import { UserObject } from './common';

/**
 * User Schema
 * - id: Entra ID object_id (oid)
 * - email: 사용자 이메일
 * - name: 표시 이름
 * - role: Admin, Editor, Viewer
 * - tenant_id: 테넌트 ID
 * - created_at: 생성 시각
 * - last_login: 마지막 로그인
 * - groups: 소속 그룹 ID 목록
 */

export const UserRole = z.enum(['Admin', 'Editor', 'Viewer']);
export type UserRole = z.infer<typeof UserRole>;

export const User = z.object({
    id: z.string(),
    email: z.string().email(),
    name: z.string(),
    role: UserRole,
    tenant_id: z.string(),
    created_at: z.string().default(() => dayjs().utc().toISOString()),
    last_login: z.string().default(() => dayjs().utc().toISOString()),
    groups: z.array(z.string()).default([]),
});

export type User = z.infer<typeof User>;

// Request/Response Types
export const UserListRequest = z.object({
    search: z.string().optional(),
});

export type UserListRequest = z.infer<typeof UserListRequest>;

export const UpdateUserRoleRequest = z.object({
    userId: z.string(),
    role: UserRole,
});

export type UpdateUserRoleRequest = z.infer<typeof UpdateUserRoleRequest>;

export const UserResponse = User.pick({
    id: true,
    email: true,
    name: true,
    role: true,
    tenant_id: true,
    created_at: true,
    last_login: true,
    groups: true,
});

export type UserResponse = z.infer<typeof UserResponse>;
