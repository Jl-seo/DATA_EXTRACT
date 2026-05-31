import { z } from 'zod';

/**
 * Site Colors Schema (Light/Dark 테마별)
 */
export const SiteColors = z.object({
    primary: z.string(),
    primaryForeground: z.string(),
    secondary: z.string(),
    secondaryForeground: z.string(),
    background: z.string(),
    foreground: z.string(),
    card: z.string(),
    cardForeground: z.string(),
    muted: z.string(),
    mutedForeground: z.string(),
    accent: z.string(),
    accentForeground: z.string(),
    destructive: z.string(),
    border: z.string(),
    input: z.string(),
    ring: z.string(),
    sidebar: z.string(),
    sidebarForeground: z.string(),
    sidebarPrimary: z.string(),
    sidebarPrimaryForeground: z.string(),
    sidebarAccent: z.string(),
    sidebarAccentForeground: z.string(),
    sidebarBorder: z.string(),
});

export type SiteColors = z.infer<typeof SiteColors>;

/**
 * Color Config Schema (Light + Dark modes)
 */
export const ColorConfig = z.object({
    light: SiteColors,
    dark: SiteColors,
});

export type ColorConfig = z.infer<typeof ColorConfig>;

/**
 * Site Configuration Schema
 */
export const SiteConfig = z.object({
    siteName: z.string().default('DAOM'),
    siteDescription: z.string().default('문서 자동화'),
    logoUrl: z.string().nullable().default(null),
    faviconUrl: z.string().nullable().default(null),
    theme: z.enum(['light', 'dark', 'system']).default('system'),
    colors: ColorConfig.nullable().default(null),
    fontFamily: z.string().default('Inter, ui-sans-serif, system-ui, sans-serif'),
    customCss: z.string().nullable().default(null),
    radius: z.number().default(0.5),
    density: z.enum(['compact', 'normal', 'comfortable']).default('normal'),
});

export type SiteConfig = z.infer<typeof SiteConfig>;

// Request/Response Types
export const UpdateSiteConfigRequest = SiteConfig.partial();
export type UpdateSiteConfigRequest = z.infer<typeof UpdateSiteConfigRequest>;

export const SiteConfigResponse = SiteConfig;
export type SiteConfigResponse = z.infer<typeof SiteConfigResponse>;

// Fixed document ID for singleton config
export const SITE_CONFIG_ID = 'site_config';
