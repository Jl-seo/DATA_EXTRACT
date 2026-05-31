import { z } from 'zod';
import { UserObject } from './common';
import dayjs from '@/lib/dayjs';

export const SITE_CONFIG_ID = 'site_config';
export const SITE_CONFIG_PARTITION_KEY = 'site_config';

const AssetConfig = z.object({
  src: z.string(),
  filename: z.string().optional(),
});

// 기본 설정(env) - 앱이름, 앱 아이콘
export const SiteConfig = z.object({
  id: z.literal(SITE_CONFIG_ID).default(SITE_CONFIG_ID),
  partition_key: z.literal(SITE_CONFIG_PARTITION_KEY).default(SITE_CONFIG_PARTITION_KEY),

  app_name: z.string().optional().default('DAOM'),
  app_favicon: AssetConfig.optional().default({ src: '/icon.png' }),
  app_icon: AssetConfig.optional(),
  login_icon: AssetConfig.optional(),
  character_icon: AssetConfig.optional(),
  app_description: z.string().optional().default('문서 자동화'),

  theme: z.enum(['light', 'dark', 'system']).optional().default('system'),
  radius: z.number().optional().default(0.5),
  density: z.enum(['compact', 'normal', 'comfortable']).optional().default('normal'),
  primary_color: z.string().optional().default('oklch(0.6723 0.1606 244.9955)'),

  // Content preferences
  favorites: z.array(z.object({
    code: z.string(),
    name: z.string(),
  })).optional().default([]),
  languages: z.array(z.object({
    code: z.string(),
    name: z.string(),
  })).optional().default([]),



  created_at: z.string().default(() => dayjs().utc().toISOString()),
  created_by: UserObject.optional(),
  modified_at: z.string().optional(),
  modified_by: UserObject.optional(),
});

export type SiteConfig = z.infer<typeof SiteConfig>;

