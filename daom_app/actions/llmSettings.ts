'use server';

import 'server-only';
import CosmosDBService from '@/services/CosmosDBService';
import PermissionService from '@/services/PermissionService';
import { getCurrentEnvConfig } from '@/lib/env';
import { revalidatePath } from 'next/cache';
import {
    LLMSettings,
    UpdateLLMSettingsRequest,
    LLM_CONFIG_ID,
    LLM_CONFIG_PARTITION_KEY,
    DEFAULT_PROMPTS,
} from '@/scheme/llmSettings';
import { getCurrentUserInfo } from './user';

const CONFIG_CONTAINER = 'refdata';
const FALLBACK_MODEL = 'diagpt-chat-model-gpt-4.1';

function getEnvDeploymentModels(envConfig: Awaited<ReturnType<typeof getCurrentEnvConfig>>): string[] {
    const models = envConfig.openai
        .map((resource) => resource.deploymentId?.trim())
        .filter((deploymentId): deploymentId is string => Boolean(deploymentId));
    return Array.from(new Set(models));
}

/**
 * LLM Config 조회
 */
export async function getLLMSettings(): Promise<LLMSettings> {
    const envConfig = await getCurrentEnvConfig();
    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(CONFIG_CONTAINER);
    const envDeploymentModels = getEnvDeploymentModels(envConfig);

    try {
        const { resource } = await container.item(LLM_CONFIG_ID, LLM_CONFIG_PARTITION_KEY).read();


        const defaultOpenAI = envConfig.openai?.[0];
        const defaultValues = {
            current_model: defaultOpenAI?.deploymentId || envDeploymentModels[0] || FALLBACK_MODEL,
            available_models: envDeploymentModels.length > 0 ? envDeploymentModels : [FALLBACK_MODEL],
            endpoint: defaultOpenAI?.endpoint || '',
            ...DEFAULT_PROMPTS
        };

        if (!resource) {

            return LLMSettings.parse(defaultValues);
        }

        const normalizedCurrentModel = defaultValues.available_models.includes(resource?.current_model || '')
            ? (resource?.current_model as string)
            : defaultValues.current_model;

        const settings = LLMSettings.parse({
            ...defaultValues,
            ...resource,
            current_model: normalizedCurrentModel,
            available_models: defaultValues.available_models
        });

        return settings;
    } catch (e) {
        console.error(`[getLLMSettings] Error:`, e);
        const defaultOpenAI = envConfig.openai?.[0];
        return LLMSettings.parse({
            current_model: defaultOpenAI?.deploymentId || envDeploymentModels[0] || FALLBACK_MODEL,
            available_models: envDeploymentModels.length > 0 ? envDeploymentModels : [FALLBACK_MODEL],
            endpoint: defaultOpenAI?.endpoint || '',
            ...DEFAULT_PROMPTS
        });
    }
}

/**
 * LLM Config 업데이트 (관리자 전용)
 */
export async function updateLLMSettings(request: UpdateLLMSettingsRequest): Promise<LLMSettings> {
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
    const validated = UpdateLLMSettingsRequest.parse(request);

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(CONFIG_CONTAINER);

    // 기존 설정 로드
    const currentConfig = await getLLMSettings();

    // 업데이트 병합
    const envDeploymentModels = getEnvDeploymentModels(envConfig);
    const allowedModels = envDeploymentModels.length > 0 ? envDeploymentModels : [FALLBACK_MODEL];
    const requestedModel = validated.model_name || currentConfig.current_model;
    const normalizedModel = allowedModels.includes(requestedModel) ? requestedModel : allowedModels[0];

    const updatedConfig = LLMSettings.parse({
        ...currentConfig,
        ...validated,
        current_model: normalizedModel,
        available_models: allowedModels
    });

    // Remove model_name as it's not in LLMSettings schema
    if ('model_name' in updatedConfig) {
        delete (updatedConfig as any).model_name;
    }

    await container.items.upsert(updatedConfig);


    revalidatePath('/admin', 'layout');
    return updatedConfig;
}
