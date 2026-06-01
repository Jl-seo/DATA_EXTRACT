import { z } from 'zod';

export const ThemeConfig = z.object({
    id: z.literal('theme_config').default('theme_config'),
    partition_key: z.literal('theme_config').default('theme_config'),

    // Theme mode: light, dark, or system
    theme: z.enum(['light', 'dark', 'system']).default('system'),

    // UI density for spacing and text size
    density: z.enum(['compact', 'normal', 'comfortable']).default('normal'),

    // Border radius in rem units  
    radius: z.number().min(0).max(1).default(0.5),

    // Color values (using HSL format)
    colors: z.object({
        light: z.object({
            primary: z.string().default('221.2 83.2% 53.3%'),
            ring: z.string().default('221.2 83.2% 53.3%'),
        }).optional(),
        dark: z.object({
            primary: z.string().default('217.2 91.2% 59.8%'),
            ring: z.string().default('217.2 91.2% 59.8%'),
        }).optional(),
    }).default({}),
});

export type ThemeConfig = z.infer<typeof ThemeConfig>;

export const THEME_CONFIG_ID = 'theme_config';
export const THEME_CONFIG_PARTITION_KEY = 'theme_config';

// Theme presets for quick application
export const themePresets = {
    blue: {
        name: '파랑 (기본)',
        primary: 'oklch(0.6723 0.1606 244.9955)',
    },
    purple: {
        name: '보라',
        primary: 'oklch(0.6500 0.1800 300.0000)',
    },
    green: {
        name: '녹색',
        primary: 'oklch(0.6500 0.1500 145.0000)',
    },
    orange: {
        name: '주황',
        primary: 'oklch(0.7000 0.1800 45.0000)',
    },
} as const;
