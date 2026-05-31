import 'server-only';
import { ResourcePoolBase } from './ResourcePoolBase';
import { OpenAIResource } from '@/scheme/docIntel';
import { DAOMEnvConfig } from '@/scheme/env';
import OpenAI, { AzureOpenAI } from 'openai';

interface OpenAIServiceOptions {
    defaultModel?: string | null;
}

export class OpenAIService extends ResourcePoolBase<OpenAIResource> {
    private defaultModel: string | undefined;

    constructor(envConfig: DAOMEnvConfig, options?: OpenAIServiceOptions) {
        const resources = envConfig.openai ?? [];
        super(envConfig, resources);
        this.defaultModel = options?.defaultModel?.trim() || undefined;
    }

    setDefaultModel(model?: string | null): void {
        this.defaultModel = model?.trim() || undefined;
    }

    getClient(resourceOverride?: OpenAIResource): AzureOpenAI {
        const resource = resourceOverride || this.getBestResource().resource;
        if (!resource) throw new Error('Missing OpenAI env config');

        return new AzureOpenAI({
            endpoint: resource.endpoint,
            apiKey: resource.key,
            apiVersion: resource.apiVersion,
        });
    }

    private async resolveTargetModel(model?: string): Promise<string> {
        if (model && model.trim()) return model.trim();
        if (this.defaultModel) return this.defaultModel;
        try {
            const { getLLMSettings } = await import('@/actions/llmSettings');
            const settings = await getLLMSettings();
            if (settings.current_model?.trim()) {
                return settings.current_model.trim();
            }
        } catch (error) {
            console.warn('[OpenAIService] current_model 조회 실패. 리소스 기본 deploymentId로 진행합니다.', error);
        }
        return this.getBestResource().resource?.deploymentId || 'gpt-4o';
    }

    async getResolvedDeployment(model?: string): Promise<string> {
        return this.resolveTargetModel(model);
    }

    private pickResourceForDeployment(deploymentName: string): { resource?: OpenAIResource; index?: number } {
        const matched: Array<{ resource: OpenAIResource; index: number }> = [];
        this.resources.forEach((resource, index) => {
            if (resource.deploymentId === deploymentName) {
                matched.push({ resource, index });
            }
        });

        if (matched.length > 0) {
            const picked = matched[Math.floor(Math.random() * matched.length)];
            return picked;
        }

        return { resource: undefined, index: undefined };
    }

    private isGpt41Deployment(deploymentName: string): boolean {
        const normalized = deploymentName.toLowerCase();
        return normalized.includes('gpt-4.1') || normalized.includes('gpt41');
    }

    private isGpt55Deployment(deploymentName: string): boolean {
        const normalized = deploymentName.toLowerCase();
        return (
            normalized.includes('gpt-5.5')
            || normalized.includes('gpt5.5')
            || normalized.includes('gpt55')
            || normalized.includes('gpt-55')
        );
    }

    private isGpt5MiniDeployment(deploymentName: string): boolean {
        const normalized = deploymentName.toLowerCase();
        return (
            normalized.includes('gpt-5-mini')
            || normalized.includes('gpt5-mini')
            || normalized.includes('gpt5mini')
        );
    }

    private isGpt5NanoDeployment(deploymentName: string): boolean {
        const normalized = deploymentName.toLowerCase();
        return (
            normalized.includes('gpt-5-nano')
            || normalized.includes('gpt5-nano')
            || normalized.includes('gpt5nano')
        );
    }

    async getCompletion(
        messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        model?: string,
        jsonMode: boolean = false,
        maxTokens: number = 4096,
        temperature: number = 0.0, // 추출 결과 일관성을 위해 기본값 0.0 (결정론적 응답)
        seed: number = 42,          // daom_old와 동일하게 고정 시드 적용 (재추출 시 동일 결과 보장)
        useStream: boolean = false
    ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
        let retries = 0;
        const maxRetries = 5;
        const deploymentName = await this.resolveTargetModel(model);

        const useMaxCompletionTokens = !this.isGpt41Deployment(deploymentName);
        const useTemperature =
            !this.isGpt55Deployment(deploymentName) &&
            !this.isGpt5MiniDeployment(deploymentName) &&
            !this.isGpt5NanoDeployment(deploymentName);

        const createRequest = () => {
            const request: any = {
                messages,
                model: deploymentName,
            };

            if (useTemperature) {
                request.temperature = temperature;
            }

            if (jsonMode) {
                request.response_format = { type: 'json_object' };
            }

            request.seed = seed;

            if (useMaxCompletionTokens) {
                request.max_completion_tokens = maxTokens;
            } else {
                request.max_tokens = maxTokens;
            }

            return request;
        };

        while (retries < maxRetries) {
            try {
                const { resource, index } = this.pickResourceForDeployment(deploymentName);
                if (!resource) {
                    throw new Error(
                        `[OpenAIService] 선택된 모델(${deploymentName})과 일치하는 OpenAI 리소스를 찾을 수 없습니다. env의 openai[].deploymentId를 확인하세요.`
                    );
                }
                const client = this.getClient(resource);

                const endpointHost = (() => {
                    try {
                        return new URL(resource.endpoint).host;
                    } catch {
                        return resource.endpoint;
                    }
                })();

                console.log(
                    `[OpenAIService] 호출 시작 | deployment=${deploymentName} | resourceIndex=${index ?? -1} | resourceId=${resource.id || 'unknown'} | endpoint=${endpointHost} | jsonMode=${jsonMode} | stream=${useStream} | tokenParam=${useMaxCompletionTokens ? 'max_completion_tokens' : 'max_tokens'} | tokenValue=${maxTokens} | temperature=${useTemperature ? temperature : 'omitted'}`
                );

                let response: OpenAI.Chat.Completions.ChatCompletion;
                if (useStream) {
                    const streamRunner = client.chat.completions.stream(
                        {
                            ...createRequest(),
                            stream_options: { include_usage: true },
                        }
                    );
                    response = await streamRunner.finalChatCompletion();
                } else {
                    response = await client.chat.completions.create(createRequest());
                }
                const usage = response.usage;
                console.log(
                    `[OpenAIService] 호출 완료 | deployment=${deploymentName} | stream=${useStream} | prompt=${usage?.prompt_tokens ?? 0} | completion=${usage?.completion_tokens ?? 0} | total=${usage?.total_tokens ?? 0}`
                );
                return response;
            } catch (error: any) {
                // Azure OpenAI Rate Limit (429) 처리
                if (error.status === 429) {
                    retries++;
                    if (retries >= maxRetries) throw error;

                    // 헤더에서 대기 시간 추출 (없으면 기본 10초)
                    const retryAfter = parseInt(error.headers?.['retry-after'] || '10');
                    const waitMs = (retryAfter * 1000) + (Math.random() * 2000); // 약간의 지터 추가
                    
                    console.warn(`[OpenAIService] 429 Rate Limit 감지 (시도 ${retries}/${maxRetries}). ${Math.round(waitMs)}ms 대기 후 재시도...`);
                    await new Promise(resolve => setTimeout(resolve, waitMs));
                    continue;
                }
                throw error;
            }
        }
        throw new Error("OpenAI 호출 최대 재시도 횟수를 초과했습니다.");
    }

    async compareImages(url1: string, url2: string): Promise<ComparisonResult> {
        const { getLLMSettings } = await import('@/actions/llmSettings');
        const settings = await getLLMSettings();
        const systemPrompt = settings.comparison_system || `
    You are an expert QA and Visual Inspection AI.
    Compare the two provided images (Baseline vs Candidate) and identify semantic and visual differences.

    Return a JSON object with a key "differences" containing a list of objects.
    Each difference object must have:
    - "id": unique integer (1, 2, 3...)
    - "description": concise text describing the change in **KOREAN** (한국어로 설명).
    - "category": one of ["content", "layout", "style", "missing_element", "added_element"]
    - "location_1": bounding box in Baseline image as [y_min, x_min, y_max, x_max]
    - "location_2": bounding box in Candidate image as [y_min, x_min, y_max, x_max]
    - "page_number": integer (1-based), default to 1.

    **CRITICAL BOUNDING BOX FORMAT:**
    - Coordinates are normalized to 0-1000 scale (0=top-left origin, 1000=bottom-right).
    - Format: [y_min, x_min, y_max, x_max] where:
      - y_min: distance from TOP edge (0 = very top)
      - x_min: distance from LEFT edge (0 = very left)
      - y_max: distance from TOP edge (must be > y_min)
      - x_max: distance from LEFT edge (must be > x_min)

    **EXAMPLE:**
    If a button is located in the center of the image:
    - y_min ≈ 400, x_min ≈ 400, y_max ≈ 600, x_max ≈ 600
    If text is at the top-left corner:
    - y_min ≈ 50, x_min ≈ 50, y_max ≈ 100, x_max ≈ 300

    Focus on meaningful differences (text changes, missing buttons, layout shifts). Ignore minor rendering noise.
    Be precise with bounding box coordinates - estimate the exact area where the difference occurs.

    IMPORTANT: Respond with valid JSON only. Descriptions MUST be in Korean.
        `;

        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
            {
                role: "user",
                content: [
                    { type: "text", text: "Compare these two images. Image 1 is Baseline. Image 2 is Candidate." },
                    { type: "image_url", image_url: { url: url1 } },
                    { type: "image_url", image_url: { url: url2 } }
                ]
            }
        ];

        const response = await this.getCompletion(messages, undefined, true);
        const content = response.choices[0].message.content;

        if (!content) {
            throw new Error("No content received from OpenAI");
        }

        return JSON.parse(content) as ComparisonResult;
    }
}

export interface ComparisonDiff {
    id: number;
    description: string;
    category: "content" | "layout" | "style" | "missing_element" | "added_element";
    location_1: [number, number, number, number];
    location_2: [number, number, number, number];
    page_number: number;
}

export interface ComparisonResult {
    differences: ComparisonDiff[];
}
