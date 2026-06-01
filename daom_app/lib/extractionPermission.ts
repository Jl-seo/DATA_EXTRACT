import type { ModelPermission } from '@/scheme/permission';

export interface ExtractionPermissionSummary {
    isGlobalAdmin: boolean;
    roles: ModelPermission[];
}

export const EMPTY_EXTRACTION_PERMISSION_SUMMARY: ExtractionPermissionSummary = {
    isGlobalAdmin: false,
    roles: [],
};

export const canEditExtractionModel = (
    summary: ExtractionPermissionSummary,
    targetModelId?: string | null
): boolean => {
    if (!targetModelId) return false;
    if (summary.isGlobalAdmin) return true;

    return summary.roles.some((role) => {
        return role.role === 'Admin' && (role.modelId === targetModelId || role.modelId === '*');
    });
};
