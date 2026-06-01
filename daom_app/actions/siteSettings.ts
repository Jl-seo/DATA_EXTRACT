'use server';

import 'server-only';
import CosmosDBService from '@/services/CosmosDBService';
import PermissionService from '@/services/PermissionService';
import { getCurrentEnvConfig } from '@/lib/env';
import {
    SiteConfig,
    UpdateSiteConfigRequest,
    SITE_CONFIG_ID,
} from '@/scheme/siteSettings';
import { getCurrentUserInfo } from './user';

const CONFIG_CONTAINER = 'refdata';

/**
 * Site Config 조회
 */
export async function getSiteConfig(): Promise<SiteConfig> {
    const envConfig = await getCurrentEnvConfig();
    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(CONFIG_CONTAINER);

    try {
        const { resource } = await container.item(SITE_CONFIG_ID, SITE_CONFIG_ID).read();

        if (!resource) {
            // 기본 설정 반환
            return SiteConfig.parse({});
        }

        // Cosmos 메타데이터 제거
        const { id, _rid, _self, _etag, _attachments, _ts, ...config } = resource;
        return SiteConfig.parse(config);
    } catch (error) {
        // 문서가 없으면 기본값 반환
        return SiteConfig.parse({});
    }
}

/**
 * Site Config 업데이트 (관리자 전용)
 */
export async function updateSiteConfig(request: UpdateSiteConfigRequest): Promise<SiteConfig> {
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
    const validated = UpdateSiteConfigRequest.parse(request);

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(CONFIG_CONTAINER);

    // 기존 설정 로드 또는 기본값
    let currentConfig: SiteConfig;
    try {
        const { resource } = await container.item(SITE_CONFIG_ID, SITE_CONFIG_ID).read();
        if (resource) {
            const { id, _rid, _self, _etag, _attachments, _ts, ...config } = resource;
            currentConfig = SiteConfig.parse(config);
        } else {
            currentConfig = SiteConfig.parse({});
        }
    } catch (error) {
        currentConfig = SiteConfig.parse({});
    }

    // 업데이트 병합
    const updatedConfig = { ...currentConfig, ...validated };
    const doc = { id: SITE_CONFIG_ID, ...updatedConfig };

    await container.items.upsert(doc);
    return SiteConfig.parse(updatedConfig);
}

/**
 * Site Config 초기화 (관리자 전용)
 */
export async function resetSiteConfig(): Promise<SiteConfig> {
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

    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer(CONFIG_CONTAINER);

    const defaultConfig = SiteConfig.parse({});
    const doc = { id: SITE_CONFIG_ID, ...defaultConfig };

    await container.items.upsert(doc);
    return defaultConfig;
}
