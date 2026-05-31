import { z } from 'zod';

/**
 * Menu Schema
 * - id: 메뉴 ID (고유)
 * - name: 메뉴 이름 (한글)
 * - icon: 아이콘 이름 (Lucide React)
 * - order: 정렬 순서
 * - parent: 부모 메뉴 ID (null이면 최상위)
 * - tenant_id: 테넌트 ID
 */

export const Menu = z.object({
    id: z.string(),
    name: z.string().min(1),
    icon: z.string(),
    order: z.number().int().min(0),
    parent: z.string().nullable().default(null),
    tenant_id: z.string(),
    partition_key: z.string().default('menu'),//cosmos db partition key 명시적 지정
});

export type Menu = z.infer<typeof Menu>;

// 기본 메뉴 시드 데이터
export const DEFAULT_MENUS = [
    { id: 'upload', name: '문서 업로드', icon: 'Upload', order: 1, parent: null },
    { id: 'history', name: '추출 히스토리', icon: 'History', order: 2, parent: null },
    { id: 'models', name: '모델 스튜디오', icon: 'Layers', order: 3, parent: null },
    { id: 'settings', name: '설정', icon: 'Settings', order: 4, parent: null },
    { id: 'settings-general', name: '일반', icon: 'Settings', order: 1, parent: 'settings' },
    { id: 'settings-logs', name: '로그', icon: 'ClipboardList', order: 2, parent: 'settings' },
    { id: 'settings-permissions', name: '권한 관리', icon: 'Shield', order: 3, parent: 'settings' },
];

// Request/Response Types
export const MenuListRequest = z.object({
    accessibleOnly: z.boolean().default(false),
});

export type MenuListRequest = z.infer<typeof MenuListRequest>;

export const CreateMenuRequest = z.object({
    id: z.string().min(1, '메뉴 ID를 입력해주세요'),
    name: z.string().min(1, '메뉴 이름을 입력해주세요'),
    icon: z.string().min(1, '아이콘을 입력해주세요'),
    order: z.number().int().min(0),
    parent: z.string().nullable().default(null),
});

export type CreateMenuRequest = z.infer<typeof CreateMenuRequest>;

export const UpdateMenuRequest = z.object({
    menuId: z.string(),
    name: z.string().min(1).optional(),
    icon: z.string().optional(),
    order: z.number().int().min(0).optional(),
});

export type UpdateMenuRequest = z.infer<typeof UpdateMenuRequest>;

export const DeleteMenuRequest = z.object({
    menuId: z.string(),
});

export type DeleteMenuRequest = z.infer<typeof DeleteMenuRequest>;

export const MenuResponse = Menu;
export type MenuResponse = z.infer<typeof MenuResponse>;
