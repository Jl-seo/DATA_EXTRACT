import 'server-only';
import { OpenAIService } from '../OpenAIService';
import { ExtractionModel } from '@/scheme/extractionModel';
import { PipelineResult, EngineerOutput } from '@/scheme/pipeline';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

/**
 * beta_features.document_context_hint에 저장되는 문서 유형 힌트 인터페이스.
 * 검체 라벨 등 특화 문서 추출 시 프롬프트에 도메인 컨텍스트를 주입하여 정확도를 높입니다.
 */
interface DocumentContextHint {
    /** 문서 유형 (예: "의료 검체 라벨") */
    document_type?: string;
    /** 예상 텍스트 언어 (예: ["한국어"]) */
    language_hints?: string[];
    /** 필드별 추가 힌트 */
    field_hints?: Record<string, {
        /** 필드에 대한 추가 설명 (예: "한국인 이름 2~4글자") */
        hint?: string;
        /** 추출 예시 (예: ["김영수", "박지현"]) */
        examples?: string[];
        /** 자주 발생하는 OCR 오류 패턴 (예: ["초성/종성 혼동 주의"]) */
        common_errors?: string[];
    }>;
}

export class VisionPipeline {
    private openaiClient: OpenAIService;

    constructor(openaiClient: OpenAIService) {
        this.openaiClient = openaiClient;
    }

    public async execute(
        model: ExtractionModel,
        fileContentBuffer: Buffer,
        filename: string = "",
        mimeType: string = ""
    ): Promise<PipelineResult> {
        const startTime = Date.now();

        // 1. Encode Image
        const actualMimeType = mimeType || this.guessMime(filename);
        const base64Image = fileContentBuffer.toString('base64');
        const dataUrl = `data:${actualMimeType};base64,${base64Image}`;

        const imageSizeKb = fileContentBuffer.length / 1024;
        console.log(`[VisionPipeline] Image: ${filename} (${Math.round(imageSizeKb)}KB, ${actualMimeType})`);

        // 2. Build Prompt
        const systemPrompt = await this.buildSystemPrompt(model);

        // 3. Call GPT-4 Vision
        const messages: ChatCompletionMessageParam[] = [
            { role: 'system' as const, content: systemPrompt },
            {
                role: 'user' as const,
                content: [
                    {
                        type: "text",
                        text: "이 이미지에서 모든 필드를 추출하세요. Return valid JSON."
                    },
                    {
                        type: "image_url",
                        image_url: { url: dataUrl, detail: "high" }
                    }
                ]
            }
        ];
        const debugMessages = [
            { role: 'system', content: systemPrompt },
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: '이 이미지에서 모든 필드를 추출하세요. Return valid JSON.'
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${actualMimeType};base64,[omitted]`,
                            detail: 'high'
                        }
                    }
                ]
            }
        ];

        const llmResult = await this.callVisionLlm(messages);

        // 4. Build Result
        let guideExtracted = (llmResult.guide_extracted as Record<string, unknown>) || {};

        if (Object.keys(guideExtracted).length === 0 && !llmResult.error) {
            const possibleFields = new Set((model.fields || []).map(f => f.key));
            const hasAnyField = Object.keys(llmResult).some(k => possibleFields.has(k));
            if (hasAnyField) {
                guideExtracted = {};
                for (const [k, v] of Object.entries(llmResult)) {
                    if (k !== "_token_usage" && k !== "error") {
                        guideExtracted[k] = v;
                    }
                }
            }
        }

        const totalUsage = llmResult._token_usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

        return {
            guide_extracted: guideExtracted,
            raw_content: `[Vision Extraction] ${filename}`,
            raw_tables: [],
            token_usage: totalUsage,
            _debug_info: {
                token_usage: totalUsage,
                llm_request_bodies: [{
                    extraction_mode: 'vision',
                    json_mode: true,
                    max_tokens: 16384,
                    messages: debugMessages,
                }],
            },
            error: llmResult.error as string | undefined,
            beta_metadata: {
                pipeline_mode: "vision-extraction",
                image_size_kb: imageSizeKb,
                mime_type: actualMimeType
            },
            model_name: model.name || "",
            duration_seconds: (Date.now() - startTime) / 1000
        };
    }

    /**
     * beta_features.document_context_hint에서 문서 유형 힌트를 추출합니다.
     * 검체 라벨 등 특화 문서의 추출 정확도를 높이기 위해 프롬프트에 도메인 컨텍스트를 주입합니다.
     */
    private resolveDocumentContextHint(model: ExtractionModel): DocumentContextHint | null {
        const betaFeatures = model.beta_features;
        if (!betaFeatures || typeof betaFeatures !== 'object') return null;

        const hint = (betaFeatures as Record<string, unknown>).document_context_hint;
        if (!hint || typeof hint !== 'object') return null;

        return hint as DocumentContextHint;
    }

    private async buildSystemPrompt(model: ExtractionModel): Promise<string> {
        const contextHint = this.resolveDocumentContextHint(model);

        const fieldsDesc = (model.fields || []).map(f => {
            const parts = [`- **${f.key}** (${f.label})`];
            if (f.description) parts.push(`  설명: ${f.description}`);
            if (f.rules) parts.push(`  규칙: ${f.rules}`);
            if (f.is_required) parts.push(`  [필수 수집 필드]`);
            // [주의] dictionary_id는 LLM 프롬프트에 노출하지 않음. performDictionaryNormalization 후처리에서만 적용.
            if (f.validation_regex) parts.push(`  [검증 규칙(Regex): ${f.validation_regex}]`);
            parts.push(`  타입: ${f.type}`);

            // Document Context Hint: 필드별 힌트 주입
            const fieldHint = contextHint?.field_hints?.[f.key];
            if (fieldHint) {
                if (fieldHint.hint) parts.push(`  [컨텍스트 힌트: ${fieldHint.hint}]`);
                if (fieldHint.examples && fieldHint.examples.length > 0) {
                    parts.push(`  [추출 예시: ${fieldHint.examples.join(', ')}]`);
                }
                if (fieldHint.common_errors && fieldHint.common_errors.length > 0) {
                    parts.push(`  [⚠️ 자주 발생하는 OCR 오류: ${fieldHint.common_errors.join('; ')}]`);
                }
            }

            return parts.join("\n");
        });

        const fieldDescriptions = fieldsDesc.join("\n");

        let globalRulesText = "";
        if (model.global_rules) {
            globalRulesText = `\n\n## 전체 규칙\n${model.global_rules}`;
        }

        let refDataText = "";
        if (model.reference_data && Object.keys(model.reference_data).length > 0) {
            const refJson = JSON.stringify(model.reference_data, null, 2);
            refDataText = `\n\n## 참고 데이터 (Reference Data)\n${refJson}`;
        }

        // Document Context Hint: 전체 문서 유형 컨텍스트 섹션 생성
        let contextHintText = "";
        if (contextHint) {
            const contextParts: string[] = ["\n\n## 문서 컨텍스트 (CRITICAL)"];
            if (contextHint.document_type) {
                contextParts.push(`이 이미지는 **${contextHint.document_type}** 입니다.`);
            }
            if (contextHint.language_hints && contextHint.language_hints.length > 0) {
                const langs = contextHint.language_hints.join(', ');
                contextParts.push(`예상 텍스트 언어: ${langs}`);
                contextParts.push(`**중요**: ${langs} 텍스트의 글자 정확도에 특별히 주의하세요. 특히 손글씨의 경우 비슷한 글자를 혼동하지 않도록 문맥을 고려하여 판별하세요.`);
            }
            contextHintText = contextParts.join("\n");
        }

        return `You are a Vision AI Field Extractor.
You receive an image (photo of a physical object, label, document, etc.) and must extract data into structured JSON.

## TASK
1. LOOK at the image carefully — read ALL visible text (printed AND handwritten).
2. MAP the text to the fields defined below.
3. Return a JSON object with the key "guide_extracted" containing each field.

## OUTPUT FORMAT
For EACH field, return:
{
  "guide_extracted": {
    "<field_key>": {
      "value": "<extracted value or null>",
      "confidence": <0.0-1.0>,
      "source_text": "<exact text seen in image>"
    }
  }
}

## FIELDS TO EXTRACT
${fieldDescriptions}
${globalRulesText}
${refDataText}
${contextHintText}

## INSTRUCTIONS:
- If a field's value is not visible in the image, set value to null and confidence to 0.0.
- For handwritten text, do your best to interpret it and set confidence accordingly (0.3-0.7).
- For clearly printed text, set confidence to 1.0.
- Read text in ALL languages (Korean, English, etc.).
- Read numbers, dates, and codes carefully — do NOT skip digits.
- Return ONLY valid JSON. No markdown, no explanation.
`;
    }

    private async callVisionLlm(messages: ChatCompletionMessageParam[]): Promise<EngineerOutput> {
        try {
            const response = await this.openaiClient.getCompletion(messages, undefined, true, 16384);

            const content = response.choices[0].message.content || "{}";
            const parsed = JSON.parse(content) as EngineerOutput;

            if (response.usage) {
                parsed._token_usage = {
                    prompt_tokens: response.usage.prompt_tokens,
                    completion_tokens: response.usage.completion_tokens,
                    total_tokens: response.usage.total_tokens
                };
            }

            return parsed;
        } catch (error) {
            console.error("[VisionPipeline] LLM/Parse Error:", error);
            return { guide_extracted: {}, error: `Vision API Error: ${String(error)}` } as EngineerOutput;
        }
    }

    private guessMime(filename: string): string {
        if (!filename) return "image/jpeg";
        const ext = filename.lastIndexOf('.') !== -1 ? filename.substring(filename.lastIndexOf('.') + 1).toLowerCase() : "";

        switch (ext) {
            case 'png': return 'image/png';
            case 'gif': return 'image/gif';
            case 'webp': return 'image/webp';
            case 'bmp': return 'image/bmp';
            case 'tiff':
            case 'tif': return 'image/tiff';
            case 'jpg':
            case 'jpeg':
            default: return 'image/jpeg';
        }
    }
}
