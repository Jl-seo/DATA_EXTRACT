'use server';

import { getCurrentEnvConfig } from '@/lib/env';
import PermissionService from '@/services/PermissionService';
import { OpenAIService } from '@/services/OpenAIService';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

export async function processTemplateChat(
    messages: ChatMessage[],
    currentConfig: any,
    modelFields: Array<{ key: string; label: string; type: string }>
) {
    // 1. Check permissions
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();

    if (!user) {
        throw new Error("Unauthorized");
    }

    // 2. Init OpenAI Service
    const openai = new OpenAIService(envConfig);

    // 3. Build System Prompt guiding the AI to return JSON
    const systemPrompt = `You are an AI Template Assistant for a document extraction application.
The user wants to customize the output data visualization template.
You will receive the current chat history, the current template configuration, and the available fields in the document model.

YOUR TASK:
Interpret the user's latest message and modify the template configuration accordingly.
You MUST output a valid JSON object with the following exact structure:
{
  "message": "A friendly response to the user explaining what you did in Korean.",
  "config": {
    // The completely updated template configuration object (merge your changes into the current config)
  }
}

AVAILABLE FIELDS IN MODEL:
${JSON.stringify(modelFields, null, 2)}

CURRENT TEMPLATE CONFIGURATION:
${JSON.stringify(currentConfig, null, 2)}

TEMPLATE CONFIGURATION SCHEMA (TypeScript interface for reference):
interface TemplateConfig {
    layout?: 'table' | 'card';
    columns?: Array<{
        field: string;
        label: string;
        align?: 'left' | 'center' | 'right';
        format?: 'text' | 'number' | 'currency' | 'date' | 'percent';
        width?: string;
        style?: { color?: string; bold?: boolean };
    }>;
    header?: {
        title?: string;
        subtitle?: string;
        logo?: boolean;
    };
    footer?: {
        showDate?: boolean;
        customText?: string;
        pageNumbers?: boolean;
    };
    aggregation?: {
        showTotal?: boolean;
    };
    style?: {
        primaryColor?: string;
        fontSize?: number;
    };
}

RULES:
- Always respond in Korean.
- Be friendly and helpful.
- If the user asks for a table, set layout to "table" and auto-generate the columns array using the AVAILABLE FIELDS.
- If the user asks to change a color, update style.primaryColor. (Use hex codes like #ef4444 for red, #3b82f6 for blue).
- If the user asks for a title, update header.title.
- Only output the raw JSON object. Do not wrap in markdown \`\`\`json block. Just the raw JSON.`;

    // 4. Build Messages for LLM
    const llmMessages: ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content } as ChatCompletionMessageParam))
    ];

    try {
        const response = await openai.getCompletion(llmMessages, undefined, true);
        const content = response.choices[0].message.content || "{}";

        const parsed = JSON.parse(content);

        return {
            success: true,
            message: parsed.message || "설정을 업데이트 했습니다.",
            config: parsed.config || currentConfig
        };
    } catch (error: any) {
        console.error("[TemplateChat] AI processing failed:", error);
        return {
            success: false,
            message: "AI 서버와 통신 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
            error: error.message
        };
    }
}
