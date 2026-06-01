'use server';
import 'server-only';
import { z } from 'zod';
import { after } from 'next/server';

import { SqlParameter } from '@azure/cosmos';
import CosmosDBService from '@/services/CosmosDBService';
import PermissionService from '@/services/PermissionService';
import { getCurrentEnvConfig } from '@/lib/env';
import {
    ExtractionModel,
    ExtractionModelCreateRequest,
    ExtractionModelListRequest,
    ExtractionModelUpdateRequest,
    FieldDefinition,
} from '@/scheme/extractionModel';
import { ExtractionLog } from '@/scheme/extractionLog';
import { logAction } from '@/actions/audit';
import { OpenAIService } from '@/services/OpenAIService';
import { DocIntelligenceService } from '@/services/DocIntelligenceService';

export async function listExtractionModels(
    req: ExtractionModelListRequest,
    count: boolean = false
) {
    req = ExtractionModelListRequest.parse(req);
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const role = await permissionService.getGlobalRole();
    if (!role || role === 'none') {
        throw new Error('Unauthorized: User not registered');
    }

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer('extraction_models');

    const lines: string[] = ['SELECT'];
    if (count) {
        lines.push('VALUE COUNT(1)');
    } else {
        lines.push('*');
    }
    lines.push("FROM c WHERE c.partition_key = 'model'");

    const p: SqlParameter[] = [];

    if (req.keyword) {
        lines.push('AND (CONTAINS(c.name, @keyword, true) OR CONTAINS(c.description, @keyword, true))');
        p.push({ name: '@keyword', value: req.keyword });
    }

    if (req.isActive !== undefined) {
        lines.push('AND c.is_active = @isActive');
        p.push({ name: '@isActive', value: req.isActive });
    }

    // Role-based filtering for Models
    if (role !== 'admin') {
        const authModelIds = await permissionService.getAuthorizedModelIds();
        if (authModelIds.length === 0) {
            // No access to any model
            return count ? 0 : [];
        }
        if (!authModelIds.includes('*')) {
            lines.push('AND ARRAY_CONTAINS(@authModelIds, c.id)');
            p.push({ name: '@authModelIds', value: authModelIds });
        }
    }

    lines.push('ORDER BY c.created_at DESC');

    if (!count) {
        if (req.offset !== undefined && req.pageSize !== undefined) {
            lines.push(`OFFSET ${Number(req.offset)} LIMIT ${Number(req.pageSize)}`);
        }
    }

    const query = {
        query: lines.join(' '),
        parameters: p,
    };

    const { resources } = await container.items
        .query(query, { partitionKey: 'model' })
        .fetchAll();

    if (count) {
        return resources[0] as number;
    }
    return resources as ExtractionModel[];
}

export async function getExtractionModelNameMapByIds(modelIds: string[]): Promise<Record<string, string>> {
    const validatedIds = z.array(z.string().trim().min(1)).parse(modelIds);
    if (validatedIds.length === 0) return {};

    const uniqueIds = Array.from(new Set(validatedIds));
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const role = await permissionService.getGlobalRole();
    if (!role || role === 'none') {
        throw new Error('Unauthorized: User not registered');
    }

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer('extraction_models');

    const lines: string[] = [
        'SELECT c.id, c.name',
        "FROM c WHERE c.partition_key = 'model'",
        'AND ARRAY_CONTAINS(@modelIds, c.id)'
    ];
    const parameters: SqlParameter[] = [{ name: '@modelIds', value: uniqueIds }];

    if (role !== 'admin') {
        const authModelIds = await permissionService.getAuthorizedModelIds();
        if (authModelIds.length === 0) return {};
        if (!authModelIds.includes('*')) {
            lines.push('AND ARRAY_CONTAINS(@authModelIds, c.id)');
            parameters.push({ name: '@authModelIds', value: authModelIds });
        }
    }

    const { resources } = await container.items.query<{ id: string; name: string }>({
        query: lines.join(' '),
        parameters
    }, { partitionKey: 'model' }).fetchAll();

    const map: Record<string, string> = {};
    resources.forEach((model) => {
        map[model.id] = model.name;
    });
    return map;
}

export async function createExtractionModel(req: ExtractionModelCreateRequest) {
    req = ExtractionModelCreateRequest.parse(req);
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer('extraction_models');

    const model: ExtractionModel = ExtractionModel.parse({
        ...req,
        //partition_key: 'model', // Add partition key
        partition_key: 'model', // Add partition key
        created_by: {
            name: user.name,
            object_id: user.oid,
            upn: user.upn,
        },
        modified_by: {
            name: user.name,
            object_id: user.oid,
            upn: user.upn,
        },
    });

    const { resource } = await container.items.create(model);

    if (resource) {
        try {
            const globalRole = await permissionService.getGlobalRole();
            const isSuperAdmin = await permissionService.isSuperAdmin();
            if (globalRole !== 'admin' && !isSuperAdmin) {
                const userGroups = await permissionService.getPermissionGroups();
                for (const group of userGroups) {
                    if (!group.permissions) group.permissions = { superAdmin: false, models: [] };
                    if (!group.permissions.models) group.permissions.models = [];
                    
                    const hasModel = group.permissions.models.some((m: any) => m.modelId === resource.id);
                    if (!hasModel) {
                        const newModels = [...group.permissions.models, { modelId: resource.id, modelName: resource.name, role: 'Admin' as const }];
                        await permissionService.updateGroupPermissions(group.id, group.permissions.superAdmin, newModels);
                    }
                }
                await permissionService.clearUserModelRolesCache();
            }
        } catch (e) {
            console.error('[createExtractionModel] Failed to auto-assign model permission to creator groups:', e);
            // We ignore the error so creation still succeeds, but log it.
        }
    }

    // 감사 로그: 모델 생성
    await logAction({
        userId: user.oid,
        userEmail: user.upn,
        tenantId: envConfig.id,
        action: 'CREATE',
        resourceType: 'model',
        resourceId: model.id,
        status: 'SUCCESS',
        details: { name: model.name },
    });

    return resource;
}

const DuplicateExtractionModelRequest = z.object({
    sourceModelId: z.string().trim().min(1, '원본 모델 ID가 필요합니다.'),
    name: z.string().trim().min(1, '모델 이름을 입력하세요.'),
});

export type DuplicateExtractionModelRequest = z.infer<typeof DuplicateExtractionModelRequest>;

export async function duplicateExtractionModel(req: DuplicateExtractionModelRequest) {
    const validatedReq = DuplicateExtractionModelRequest.parse(req);
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const role = await permissionService.getGlobalRole();
    if (!role || role === 'none') {
        throw new Error('Unauthorized: User not registered');
    }

    if (role !== 'admin') {
        const authModelIds = await permissionService.getAuthorizedModelIds();
        if (!authModelIds.includes('*') && !authModelIds.includes(validatedReq.sourceModelId)) {
            throw new Error('Unauthorized: No access to source model');
        }
    }

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer('extraction_models');
    const { resource: sourceModel } = await container.item(validatedReq.sourceModelId, 'model').read();
    if (!sourceModel) throw new Error('Model not found');

    const source = ExtractionModel.parse(sourceModel);
    if (source.is_super_model) {
        throw new Error('Super model cannot be duplicated');
    }

    const createReq = ExtractionModelCreateRequest.parse({
        ...source,
        name: validatedReq.name,
    });

    const copiedModelDocument: ExtractionModel = ExtractionModel.parse({
        ...createReq,
        partition_key: 'model',
        created_by: {
            name: user.name,
            object_id: user.oid,
            upn: user.upn,
        },
        modified_by: {
            name: user.name,
            object_id: user.oid,
            upn: user.upn,
        },
    });

    const { resource: copiedModel } = await container.items.create(copiedModelDocument);

    if (copiedModel) {
        try {
            const globalRole = await permissionService.getGlobalRole();
            const isSuperAdmin = await permissionService.isSuperAdmin();
            if (globalRole !== 'admin' && !isSuperAdmin) {
                const userGroups = await permissionService.getPermissionGroups();
                for (const group of userGroups) {
                    if (!group.permissions) group.permissions = { superAdmin: false, models: [] };
                    if (!group.permissions.models) group.permissions.models = [];

                    const hasModel = group.permissions.models.some((m) => m.modelId === copiedModel.id);
                    if (!hasModel) {
                        const newModels = [...group.permissions.models, { modelId: copiedModel.id, modelName: copiedModel.name, role: 'Admin' as const }];
                        await permissionService.updateGroupPermissions(group.id, group.permissions.superAdmin, newModels);
                    }
                }
                await permissionService.clearUserModelRolesCache();
            }
        } catch (e) {
            console.error('[duplicateExtractionModel] Failed to auto-assign model permission to creator groups:', e);
        }
    }

    await logAction({
        userId: user.oid,
        userEmail: user.upn,
        tenantId: envConfig.id,
        action: 'CREATE',
        resourceType: 'model',
        resourceId: copiedModelDocument.id,
        status: 'SUCCESS',
        details: {
            name: validatedReq.name,
            duplicated_from: validatedReq.sourceModelId,
            source_name: source.name,
        },
    });

    return copiedModel;
}

export async function updateExtractionModel(req: ExtractionModelUpdateRequest) {
    req = ExtractionModelUpdateRequest.parse(req);
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer('extraction_models');

    // Fetch existing
    const { resource: existing } = await container.item(req.id, 'model').read();
    if (!existing) throw new Error('Model not found');

    const updated = {
        ...existing,
        ...req,
        partition_key: 'model', // Ensure partition key is present
        modified_by: {
            name: user.name,
            object_id: user.oid,
            upn: user.upn,
        },
        modified_at: new Date().toISOString(),
    };

    // Zod validate again to ensure integrity
    const validated = ExtractionModel.parse(updated);

    const { resource } = await container.items.upsert(validated);

    // 감사 로그: 모델 수정
    await logAction({
        userId: user.oid,
        userEmail: user.upn,
        tenantId: envConfig.id,
        action: 'UPDATE',
        resourceType: 'model',
        resourceId: req.id,
        status: 'SUCCESS',
        details: { name: existing.name },
    });

    return resource;
}

export async function deleteExtractionModel(id: string) {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    // Check admin role if needed (skipping for now based on generic requirements)

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer('extraction_models');

    await container.item(id, 'model').delete();

    // 관련된 모든 권한 그룹에서 해당 모델 삭제
    try {
        const permissionsContainer = await cosmosDBService.getContainer('permissions');
        const { resources: allGroups } = await permissionsContainer.items
            .query("SELECT * FROM c WHERE c.partition_key = 'group'")
            .fetchAll();

        for (const group of allGroups) {
            const currentModels = group.permissions?.models || [];
            if (currentModels.some((m: any) => m.modelId === id)) {
                const newModels = currentModels.filter((m: any) => m.modelId !== id);
                await permissionService.updateGroupPermissions(group.id, group.permissions?.superAdmin || false, newModels);
            }
        }
        // 사용자의 권한 캐시 정보 갱신을 위해 캐시 삭제
        await permissionService.clearUserModelRolesCache();
    } catch (e) {
        console.error('[deleteExtractionModel] Failed to remove deleted model from groups:', e);
    }

    // 감사 로그: 모델 삭제
    await logAction({
        userId: user.oid,
        userEmail: user.upn,
        tenantId: envConfig.id,
        action: 'DELETE',
        resourceType: 'model',
        resourceId: id,
        status: 'SUCCESS',
    });

    return true;
}

export async function getExtractionModel(id: string) {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const role = await permissionService.getGlobalRole();
    if (!role || role === 'none') {
        throw new Error('Unauthorized: User not registered');
    }

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer('extraction_models');

    try {
        const { resource } = await container.item(id, 'model').read();
        if (!resource) {
            throw new Error(`Model not found: ${id}`);
        }
        return resource as ExtractionModel;
    } catch (error) {
        console.error('[getExtractionModel] Error reading model:', error);
        throw error;
    }
}

export async function refineExtractionSchema(
    currentFields: FieldDefinition[],
    command: string
): Promise<FieldDefinition[]> {
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const openAIService = new OpenAIService(envConfig);

    const systemPrompt = `
You are an expert at designing data schemas for document extraction.
Your task is to modify the provided list of fields based on the user's natural language command.

Current Fields:
${JSON.stringify(currentFields, null, 2)}

Command:
"${command}"

Rules for modification:
1. "key" must be a snake_case string (e.g., "invoice_number").
2. "type" MUST be one of: "text", "number", "date", "table". (Always use lowercase).
3. "label" should be a human-readable description or prompt for extraction in Korean.
4. "rules" can contain specific extraction or formatting instructions.
5. If the command asks to add a field, create a new FieldDefinition object.
6. If the command asks to modify a field, update the existing object properties.
7. If the command asks to delete a field, remove it from the list.
8. Support nested fields for "table" type in "sub_fields" property if requested.
9. Return a JSON object with a "fields" key containing the COMPLETELY UPDATED and FULL list of all fields.

CRITICAL: Return ONLY a valid JSON object starting with { "fields": ... }. Ensure all existing fields are preserved unless explicitly asked to be removed/modified.
`;

    const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: 'Please provide the updated schema as a JSON object with a "fields" key.' }
    ];

    try {
        const response = await openAIService.getCompletion(messages, undefined, true);
        let content = response.choices[0].message.content;

        if (!content) {
            throw new Error('No content received from OpenAI');
        }

        // Remove markdown code blocks if present
        if (content.includes('```')) {
            const lines = content.split('\n');
            const startIndex = lines.findIndex(l => l.startsWith('```'));
            const endIndex = lines.findLastIndex(l => l.startsWith('```'));
            if (startIndex !== -1 && endIndex !== -1 && startIndex !== endIndex) {
                content = lines.slice(startIndex + 1, endIndex).join('\n').trim();
            } else {
                content = content.replace(/```(json)?/g, '').trim();
            }
        }

        const refinedFields = JSON.parse(content);
        
        // Ensure it's an array, handle different JSON structures
        let fieldsArray: any[] = [];
        if (Array.isArray(refinedFields)) {
            fieldsArray = refinedFields;
        } else if (refinedFields && refinedFields.fields && Array.isArray(refinedFields.fields)) {
            fieldsArray = refinedFields.fields;
        } else if (refinedFields && typeof refinedFields === 'object') {
            // Try to find any array property if 'fields' is missing
            const keys = Object.keys(refinedFields);
            const arrayKey = keys.find(k => Array.isArray(refinedFields[k]));
            if (arrayKey) {
                fieldsArray = refinedFields[arrayKey];
            }
        }

        if (fieldsArray.length === 0 && currentFields.length > 0) {
            console.error('[refineExtractionSchema] Warning: AI returned empty fields but input was not empty. AI Output:', content);
            throw new Error('AI가 스키마를 초기화했습니다. 다시 시도해 주세요.');
        }
        
        return z.array(FieldDefinition).parse(fieldsArray);
    } catch (error) {
        console.error('[refineExtractionSchema] Error:', error);
        if (error instanceof z.ZodError) {
            console.error('[refineExtractionSchema] Zod Validation Error:', JSON.stringify(error.format(), null, 2));
            throw new Error('AI가 생성한 스키마 형식이 올바르지 않습니다.');
        }
        if (error instanceof SyntaxError) {
            throw new Error('AI가 유효하지 않은 JSON을 반환했습니다.');
        }
        throw error instanceof Error ? error : new Error('AI를 통한 스키마 정제에 실패했습니다.');
    }
}

/**
 * 샘플 문서를 분석하여 필드를 자동 제안합니다. (비동기 처리)
 */
export async function analyzeSampleDocument(formData: FormData): Promise<{ logId: string }> {
    const file = formData.get('file') as File;
    const analyzerModelId = (formData.get('modelId') as string) || 'prebuilt-layout';

    if (!file) {
        throw new Error('파일이 업로드되지 않았습니다.');
    }

    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const cosmosDBService = new CosmosDBService(envConfig);
    const logsContainer = await cosmosDBService.getContainer('extraction_logs');

    const logId = crypto.randomUUID();
    const initLog = ExtractionLog.parse({
        id: logId,
        model_id: 'sample-analysis',
        status: 'processing',
        filename: file.name,
        created_at: new Date().toISOString(),
        created_by: {
            name: user.name,
            object_id: user.oid,
            upn: user.upn
        },
        partition_key: 'sample-analysis',
    });

    await logsContainer.items.create(initLog);

    // Convert File to Buffer before background task starts
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    after(async () => {
        try {
            const docIntel = new DocIntelligenceService(envConfig);
            const openAIService = new OpenAIService(envConfig);

            // 1. Analyze Document using Azure DI
            const result = await docIntel.analyzeDocument(buffer, analyzerModelId);

            // 2. Prepare summary for OpenAI
            const analysisSummary = {
                modelId: analyzerModelId,
                contentSnippet: result.content.substring(0, 3000),
                fieldsFound: result.documents?.[0]?.fields 
                    ? Object.keys(result.documents[0].fields as Record<string, any>) 
                    : [],
                keyValuePairs: result.keyValuePairs?.slice(0, 50).map(kv => ({
                    key: kv.key?.content,
                    value: kv.value?.content
                })) || []
            };

            const systemPrompt = `
You are an expert at designing data schemas for document extraction.
Given the analysis results of a sample document from Azure Document Intelligence, suggest a professional and complete list of data fields (keys, labels, types, and extraction rules) that should be defined for this document type.

Analysis Context:
${JSON.stringify(analysisSummary, null, 2)}

Rules for generating the schema:
1. "key": must be a snake_case identifier (e.g., "invoice_number").
2. "label": must be a clear, user-friendly Korean name (e.g., "송장 번호").
3. "type": must be one of: "text", "number", "date", "table".
4. "rules": This is the most important part. Write a detailed extraction instruction in Korean (Prompt) that guides an LLM to find and format this specific field from the document. Include formatting rules or exception handling if applicable.
5. "description": A brief explanation of what this field represents.

Return ONLY a JSON object with a "fields" key containing an array of FieldDefinition objects.
`;

            const messages = [
                { role: 'system' as const, content: systemPrompt },
                { role: 'user' as const, content: 'Please provide the suggested schema as a JSON object with a "fields" key.' }
            ];

            let finalFields: FieldDefinition[] = [];
            try {
                const response = await openAIService.getCompletion(messages, undefined, true);
                let content = response.choices[0].message.content;

                if (!content) throw new Error('No content from AI');
                content = content.replace(/```json/g, '').replace(/```/g, '').trim();
                
                const parsed = JSON.parse(content);
                const fieldsArray = Array.isArray(parsed) ? parsed : (parsed.fields || []);
                finalFields = z.array(FieldDefinition).parse(fieldsArray);
            } catch (aiError) {
                console.error('[analyzeSampleDocument] AI Polishing failed, falling back to basic mapping:', aiError);
                
                if (result.documents && result.documents.length > 0) {
                    const doc = result.documents[0];
                    if (doc.fields) {
                        for (const [key, field] of Object.entries(doc.fields as Record<string, any>)) {
                            finalFields.push({
                                key: key.toLowerCase().replace(/[^a-z0-9]/g, '_'),
                                label: key,
                                type: mapAzureTypeToDAOM(field.type),
                                description: '',
                                rules: `문서에서 ${key} 정보를 추출하세요.`
                            });
                        }
                    }
                } else if (result.keyValuePairs && result.keyValuePairs.length > 0) {
                    for (const kv of result.keyValuePairs) {
                        if (kv.key && kv.key.content) {
                            const key = kv.key.content.toLowerCase().trim().replace(/[^a-z0-9가-힣]/g, '_');
                            if (!key) continue;
                            finalFields.push({ key, label: kv.key.content, type: 'text' as const, description: '', rules: `${kv.key.content} 값을 추출하세요.` });
                        }
                    }
                }
                finalFields = finalFields.slice(0, 20);
            }

            // Update Log with success result
            await logsContainer.item(logId, 'sample-analysis').replace({
                ...initLog,
                status: 'success',
                extracted_data: { fields: finalFields },
                modified_at: new Date().toISOString()
            });

        } catch (error: any) {
            console.error('[analyzeSampleDocument] Background analysis failed:', error);
            // Update Log with error result
            await logsContainer.item(logId, 'sample-analysis').replace({
                ...initLog,
                status: 'error',
                error_message: error.message || String(error),
                modified_at: new Date().toISOString()
            });
        }
    });

    return { logId };
}

/**
 * Azure DI 타입을 시스템 타입으로 매핑합니다.
 */
function mapAzureTypeToDAOM(azureType: string): 'text' | 'number' | 'date' | 'table' {
    switch (azureType) {
        case 'number':
        case 'currency':
        case 'integer':
            return 'number';
        case 'date':
        case 'time':
            return 'date';
        case 'list':
        case 'array':
            return 'table';
        default:
            return 'text';
    }
}
