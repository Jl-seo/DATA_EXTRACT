'use server';
import 'server-only';

import CosmosDBService from "@/services/CosmosDBService";
import { getCurrentEnvConfig } from '@/lib/env';
import { DAOMEnvConfig } from '@/scheme/env';
import { ThemeConfig, THEME_CONFIG_ID, THEME_CONFIG_PARTITION_KEY } from '@/scheme/themeConfig';
import { getRedisClient } from '@/utils/redis';
import { revalidatePath } from 'next/cache';

export async function getThemeConfig(envConfig?: DAOMEnvConfig) {
    if (!envConfig) envConfig = await getCurrentEnvConfig();

    const redisKey = `@daom_app/${envConfig.id}/theme_config`;
    const redis = getRedisClient();

    try {
        const cached = await redis.get(redisKey);
        if (cached) {
            return ThemeConfig.parse(JSON.parse(cached));
        }
    } catch (e) {
        console.error('Failed to get theme config from redis', e);
    }

    const db = new CosmosDBService(envConfig);
    try {
        const container = await db.getContainer('refdata');
        const { resource } = await container
            .item(THEME_CONFIG_ID, THEME_CONFIG_PARTITION_KEY)
            .read<ThemeConfig>();

        const config = ThemeConfig.parse(resource || {});

        // Cache to Redis
        try {
            await redis.set(redisKey, JSON.stringify(config), 'EX', 60 * 60 * 24); // 1 day
        } catch (e) {
            console.error('Failed to set theme config to redis', e);
        }

        return config;
    } catch (e) {
        console.error('Failed to fetch theme config', e);
        return ThemeConfig.parse({});
    }
}

export async function updateThemeConfig(updates: Partial<ThemeConfig>) {
    const envConfig = await getCurrentEnvConfig();
    const db = new CosmosDBService(envConfig);
    const container = await db.getContainer('refdata');

    const currentConfig = await getThemeConfig(envConfig);
    const newConfig = { ...currentConfig, ...updates };

    try {
        await container.items.upsert(newConfig);

        // Update Redis cache
        const redisKey = `@daom_app/${envConfig.id}/theme_config`;
        const redis = getRedisClient();
        await redis.set(redisKey, JSON.stringify(newConfig), 'EX', 60 * 60 * 24);

        revalidatePath('/', 'layout');
        return { success: true };
    } catch (e) {
        console.error('Failed to update theme config', e);
        throw new Error('테마 설정 업데이트 실패');
    }
}
