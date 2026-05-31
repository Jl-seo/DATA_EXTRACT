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
    deploymentId: z.string().optional(), // Azure: 배포명 / vLLM: HF 모델 repo id
    apiVersion: z.string().default('2023-05-15'),
    // 'azure'(기본) = Azure OpenAI, 'vllm' = 사내/폐쇄망 vLLM(OpenAI 호환, KAITO 등).
    // 보안 정책상 퍼블릭 LLM이 금지된 환경에서는 vllm 리소스만 등록한다.
    provider: z.enum(['azure', 'vllm']).default('azure'),
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
