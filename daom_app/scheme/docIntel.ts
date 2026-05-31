import { z } from 'zod';

export const AIServiceResource = z.object({
    id: z.string(),
    key: z.string(),
    region: z.string().optional(),
});

export const DocIntelResource = AIServiceResource.extend({
    endpoint: z.string(), // Must have endpoint
});

export type DocIntelResource = z.infer<typeof DocIntelResource>;

export const OpenAIResource = AIServiceResource.extend({
    endpoint: z.string(),
    deploymentId: z.string().optional(), // For Azure OpenAI
    apiVersion: z.string().default('2023-05-15'),
});

export type OpenAIResource = z.infer<typeof OpenAIResource>;

export const ContentUnderstandingResource = z.object({
    id: z.string().default('content-understanding'),
    key: z.string(),
    region: z.string().optional(),
    endpoint: z.string(),
    default_analyzer_id: z.string().optional(),
    api_version: z.string().default('2025-11-01'),
});

export type ContentUnderstandingResource = z.infer<typeof ContentUnderstandingResource>;
