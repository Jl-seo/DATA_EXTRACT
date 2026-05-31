'use server';
import 'server-only';

import CosmosDBService from "@/services/CosmosDBService";
import { PatchOperation } from "@azure/cosmos";
import PermissionService from '@/services/PermissionService';
import {
  SITE_CONFIG_ID,
  SITE_CONFIG_PARTITION_KEY,
  SiteConfig
} from '@/scheme/siteConfig';
import { getRedisClient } from '@/utils/redis';
import { getCurrentEnvConfig } from '@/lib/env';
import { DAOMEnvConfig } from '@/scheme/env';
import { revalidatePath } from 'next/cache';
import dayjs from '@/lib/dayjs';
import BlobStorageService from '@/services/BlobStorageService';

export async function getSiteConfig(envConfig?: DAOMEnvConfig) {
  if (!envConfig) envConfig = await getCurrentEnvConfig();

  const redisKey = `@daom_app/${envConfig.id}/site_config`;
  const redis = getRedisClient();

  try {
    const cached = await redis.get(redisKey);
    if (cached) {
      const parsed = SiteConfig.parse(JSON.parse(cached));
      // console.log('[DEBUG] Cache Hit for SiteConfig:', parsed.app_description);
      return parsed;
    }
  } catch (e) {
    console.error('Failed to get site config from redis', e);
  }

  const db = new CosmosDBService(envConfig);
  try {
    const container = await db.getContainer('refdata');
    const { resource } = await container
      .item(SITE_CONFIG_ID, SITE_CONFIG_PARTITION_KEY)
      .read<SiteConfig>();

    const config = SiteConfig.parse(resource || {});
    // console.log('[DEBUG] DB Fetch for SiteConfig:', config.app_description);

    // Cache to Redis
    try {
      await redis.set(redisKey, JSON.stringify(config), 'EX', 60 * 60 * 24); // 1 day
    } catch (e) {
      console.error('Failed to set site config to redis', e);
    }

    return config;
  } catch (e) {
    console.error('Failed to fetch site config', e);
    return SiteConfig.parse({});
  }
}

export async function getAppConfig(envConfig?: DAOMEnvConfig) {
  if (!envConfig) envConfig = await getCurrentEnvConfig();

  const siteConfig = await getSiteConfig(envConfig);

  return {
    id: envConfig.id,
    site_config: siteConfig,
    features: {
      multifile_upload: envConfig.multifile_upload ?? false,
      meta_prompt: envConfig.meta_prompt ?? false,
    },
    is_dev_mode: process.env.DAOM_DEV_MODE === 'true',
  } as const
}

/**
 * 사이트 설정 업데이트 (이미지 업로드 포함)
 * Super Admin 권한 필요
 */
export async function updateSiteConfigAction(formData: FormData) {
  const envConfig = await getCurrentEnvConfig();
  const permissionService = new PermissionService(envConfig);

  // Admin Check
  if ((await permissionService.getGlobalRole()) !== 'admin') {
    throw new Error('Unauthorized');
  }
  const user = await permissionService.getCurrentUser();
  if (!user) throw new Error('User not found');

  const currentConfig = await getSiteConfig(envConfig);
  const blobStorageService = new BlobStorageService(envConfig);

  // Helper to handle upload or keep existing
  const processField = async (
    fieldKey: string,
    currentUrl?: string,
    currentFilename?: string
  ): Promise<{ url: string | null; filename?: string }> => {
    const file = formData.get(`${fieldKey}_file`);

    if (file instanceof File && file.size > 0) {
      try {
        const { url } = await blobStorageService.uploadAsset(file);
        return { url, filename: file.name };
      } catch (e) {
        console.error(`Failed to upload ${fieldKey}`, e);
        throw e;
      }
    }

    const urlFromForm = formData.get(fieldKey) as string || '';

    if (urlFromForm === 'undefined') {
      return { url: null, filename: undefined };
    }

    if (urlFromForm === currentUrl) {
      return { url: urlFromForm, filename: currentFilename };
    }
    return { url: urlFromForm, filename: undefined };
  };

  const appIconResult = await processField('app_icon', currentConfig.app_icon?.src, currentConfig.app_icon?.filename);
  const appFaviconResult = await processField('app_favicon', currentConfig.app_favicon?.src, currentConfig.app_favicon?.filename);
  const loginIconResult = await processField('login_icon', currentConfig.login_icon?.src, currentConfig.login_icon?.filename);
  const characterIconResult = await processField('character_icon', currentConfig.character_icon?.src, currentConfig.character_icon?.filename);

  const newData: any = {};
  const app_name = formData.get('app_name') as string;
  if (app_name) newData.app_name = app_name;

  const theme = formData.get('theme') as string;
  if (theme) newData.theme = theme;

  const radius = formData.get('radius') as string;
  if (radius) newData.radius = Number(radius);

  const density = formData.get('density') as string;
  if (density) newData.density = density;

  const primaryColor = formData.get('primary_color') as string;
  if (primaryColor) newData.primary_color = primaryColor;

  if (appIconResult.url !== undefined) newData.app_icon = appIconResult.url ? { src: appIconResult.url, filename: appIconResult.filename } : undefined;
  if (appFaviconResult.url !== undefined) newData.app_favicon = appFaviconResult.url ? { src: appFaviconResult.url, filename: appFaviconResult.filename } : undefined;
  if (loginIconResult.url !== undefined) newData.login_icon = loginIconResult.url ? { src: loginIconResult.url, filename: loginIconResult.filename } : undefined;
  if (characterIconResult.url !== undefined) newData.character_icon = characterIconResult.url ? { src: characterIconResult.url, filename: characterIconResult.filename } : undefined;

  const app_description = formData.get('app_description') as string;

  if (app_description !== null) newData.app_description = app_description;

  const favoritesStr = formData.get('favorites') as string;
  if (favoritesStr) {
    try {
      newData.favorites = JSON.parse(favoritesStr);

    } catch (e) {
      console.error('Failed to parse favorites', e);
    }
  }

  const languagesStr = formData.get('languages') as string;
  if (languagesStr) {
    try {
      newData.languages = JSON.parse(languagesStr);
    } catch (e) {
      console.error('Failed to parse languages', e);
    }
  }

  // Asset Cleanup
  const cleanupAsset = async (oldUrl: string, newUrl: string) => {


    if (oldUrl && oldUrl !== newUrl && oldUrl.startsWith('/api/settings/')) {
      try {
        const filename = oldUrl.split('/').pop();
        if (filename) {
          const blobPath = `${envConfig.id}/settings/${filename}`;
          await blobStorageService.deleteBlob(blobPath);
        }
      } catch (e) {
        console.error('Failed to cleanup asset:', oldUrl, e);
      }
    }
  };

  await Promise.all([
    cleanupAsset(currentConfig.app_icon?.src || '', newData.app_icon?.src || ''),
    cleanupAsset(currentConfig.app_favicon?.src || '', newData.app_favicon?.src || ''),
    cleanupAsset(currentConfig.login_icon?.src || '', newData.login_icon?.src || ''),
    cleanupAsset(currentConfig.character_icon?.src || '', newData.character_icon?.src || ''),
  ]);

  // Persist to DB using Patch
  const db = new CosmosDBService(envConfig);
  const container = await db.getContainer('refdata');

  const now = dayjs().utc().toISOString();
  const operations: PatchOperation[] = [
    { op: 'replace', path: '/modified_at', value: now },
    {
      op: 'replace', path: '/modified_by', value: {
        name: user.name,
        object_id: user.oid,
        upn: user.upn,
      }
    }
  ];

  if (newData.app_name) operations.push({ op: 'set', path: '/app_name', value: newData.app_name });

  if ('app_icon' in newData) {
    if (newData.app_icon) operations.push({ op: 'set', path: '/app_icon', value: newData.app_icon });
    else if (currentConfig.app_icon) operations.push({ op: 'remove', path: '/app_icon' });
  }

  if ('app_favicon' in newData) {
    if (newData.app_favicon) operations.push({ op: 'set', path: '/app_favicon', value: newData.app_favicon });
    else operations.push({ op: 'set', path: '/app_favicon', value: { src: '/icon.png' } });
  }

  if ('login_icon' in newData) {
    if (newData.login_icon) operations.push({ op: 'set', path: '/login_icon', value: newData.login_icon });
    else if (currentConfig.login_icon) operations.push({ op: 'remove', path: '/login_icon' });
  }

  if ('character_icon' in newData) {
    if (newData.character_icon) operations.push({ op: 'set', path: '/character_icon', value: newData.character_icon });
    else if (currentConfig.character_icon) operations.push({ op: 'remove', path: '/character_icon' });
  }

  if ('app_description' in newData) {
    operations.push({ op: 'set', path: '/app_description', value: newData.app_description });
  }
  if (newData.favorites) operations.push({ op: 'set', path: '/favorites', value: newData.favorites });
  if (newData.languages) operations.push({ op: 'set', path: '/languages', value: newData.languages });

  if (newData.theme) operations.push({ op: 'set', path: '/theme', value: newData.theme });
  if (newData.radius !== undefined) operations.push({ op: 'set', path: '/radius', value: newData.radius });
  if (newData.density) operations.push({ op: 'set', path: '/density', value: newData.density });
  if (newData.primary_color) operations.push({ op: 'set', path: '/primary_color', value: newData.primary_color });


  let updatedDoc: SiteConfig | undefined;

  try {
    const { resource } = await container
      .item(SITE_CONFIG_ID, SITE_CONFIG_PARTITION_KEY)
      .patch<SiteConfig>(operations);
    updatedDoc = resource;
  } catch (e: any) {
    if (e.code === 404) {
      // 최초 생성 시 (Patch 실패 시) - 전체 기본값을 채워서 생성
      const fullDoc = SiteConfig.parse({
        ...newData,
        created_at: now,
        created_by: {
          name: user.name,
          object_id: user.oid,
          upn: user.upn,
        },
        modified_at: now,
        modified_by: {
          name: user.name,
          object_id: user.oid,
          upn: user.upn,
        },
      });
      const { resource } = await container.items.upsert<SiteConfig>(fullDoc);
      updatedDoc = resource;
    } else {
      throw e;
    }
  }

  // Update Redis Cache with the latest full document(캐시 처리)
  if (updatedDoc) {
    try {
      const redisKey = `@daom_app/${envConfig.id}/site_config`;
      const redis = getRedisClient();
      await redis.set(redisKey, JSON.stringify(updatedDoc), 'EX', 60 * 60 * 24);
    } catch (e) {
      console.error('Failed to update site config in redis', e);
    }
  }

  revalidatePath('/', 'layout');
  return { success: true };
}
