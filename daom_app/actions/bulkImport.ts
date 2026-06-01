'use server';

import PermissionService from '@/services/PermissionService';
import { getCurrentEnvConfig } from '@/lib/env';

interface BulkUserEntry {
    email: string;
    name: string;
    groups: string[];
}

interface BulkImportResult {
    total: number;
    created: number;
    updated: number;
    failed: number;
    errors: string[];
}

export async function bulkImportUsers(users: BulkUserEntry[]): Promise<BulkImportResult> {
    const config = await getCurrentEnvConfig();
    const service = new PermissionService(config);

    const result: BulkImportResult = {
        total: users.length,
        created: 0,
        updated: 0,
        failed: 0,
        errors: [],
    };

    try {
        // Fetch all existing groups to match by name
        const existingGroups = await service.getPermissionGroups();
        const groupNameMap = new Map(existingGroups.map((g) => [g.name.toLowerCase(), g.id]));

        for (const user of users) {
            let userSuccess = true;
            for (const groupName of user.groups) {
                if (!groupName) continue;

                try {
                    const lowerName = groupName.toLowerCase();
                    let groupId = groupNameMap.get(lowerName);

                    // If group doesn't exist, create it
                    if (!groupId) {
                        const newGroup = await service.createPermissionGroup(groupName, '자동 생성된 그룹', false);
                        groupId = newGroup.id;
                        groupNameMap.set(lowerName, groupId);
                    }

                    // Resolve OID from Entra ID if possible
                    let memberId = user.email;
                    try {
                        const entraUser = await service.getEntraUserByEmail(user.email);
                        if (entraUser) {
                            memberId = entraUser.id;
                        }
                    } catch (err) {
                        console.warn(`[bulkImport] Failed to resolve OID for ${user.email}, using email as fallback.`);
                    }

                    // Add member
                    await service.addMemberToGroup(groupId, {
                        type: 'user',
                        id: memberId,
                        displayName: user.name,
                    });
                } catch (err: any) {
                    userSuccess = false;
                    result.errors.push(`[${user.email}] ${groupName} 그룹 추가 실패: ${err.message}`);
                }
            }

            if (userSuccess) {
                result.created++;
            } else {
                result.failed++;
            }
        }
    } catch (error: any) {
        result.errors.push(`일괄 등록 중 오류 발생: ${error.message}`);
        result.failed += users.length - result.created;
    }

    return result;
}
