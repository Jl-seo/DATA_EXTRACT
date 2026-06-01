'use server';

import 'server-only';
import OpenAI from 'openai';
import { getCurrentEnvConfig } from '@/lib/env';
import PermissionService from '@/services/PermissionService';
import { OpenAIService } from '@/services/OpenAIService';
import { OpenAIResource } from '@/scheme/docIntel';
import { LocalLlmTestRequest, LocalLlmTestResult } from '@/scheme/llmTest';

/**
 * 로컬/폐쇄망 LLM(OpenAI 호환) 연결 테스트.
 *
 * 추출 파이프라인이 실제로 사용하는 OpenAIService.getCompletion 코드 경로를 그대로 태워서,
 * (1) 엔드포인트 도달성, (2) 추론 동작, (3) JSON 모드(response_format) 지원 여부를 확인한다.
 * JSON 모드는 DAOM 추출이 의존하므로 필수 점검 항목이다.
 *
 * 쿠버네티스/인프라 변경 없이, 로컬에 띄운 vLLM·Ollama·LM Studio 등을 바로 검증할 수 있다.
 */
export async function testLocalLlm(input: LocalLlmTestRequest): Promise<LocalLlmTestResult> {
    const req = LocalLlmTestRequest.parse(input);

    const envConfig = await getCurrentEnvConfig();

    // 로그인 사용자만 허용(임의의 외부 LLM 프록시 남용 방지)
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) {
        return {
            ok: false,
            endpoint: req.baseUrl,
            model: req.model,
            latencyMs: 0,
            error: 'Unauthorized: 로그인이 필요합니다.',
        };
    }

    // 임시 vLLM 리소스를 주입한 OpenAIService 구성(영구 설정 변경 없음)
    const resource: OpenAIResource = {
        id: 'local-llm-test',
        provider: 'vllm',
        endpoint: req.baseUrl,
        key: req.apiKey || 'not-needed',
        deploymentId: req.model,
        apiVersion: '2023-05-15',
    };
    const service = new OpenAIService(
        { ...envConfig, openai: [resource] },
        { defaultModel: req.model }
    );

    const endpointHost = (() => {
        try {
            return new URL(req.baseUrl).host;
        } catch {
            return req.baseUrl;
        }
    })();

    // (선택) /v1/models 조회 — 지원하지 않는 서버도 있으므로 실패해도 무시
    let modelsAvailable: string[] | undefined;
    try {
        const client: OpenAI = service.getClient(resource);
        const list = await client.models.list();
        modelsAvailable = list.data?.map((m) => m.id).filter(Boolean);
    } catch {
        modelsAvailable = undefined;
    }

    const start = Date.now();
    try {
        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            {
                role: 'system',
                content:
                    '너는 연결 테스트용 어시스턴트다. 반드시 아래 형식의 JSON 객체만 출력하라: ' +
                    '{"ok": true, "echo": "<사용자 입력 요약>"}',
            },
            { role: 'user', content: req.prompt || '로컬 LLM 연결 테스트입니다. 한국어로 응답하세요.' },
        ];

        // jsonMode=true 로 호출하여 response_format 지원 여부까지 검증
        const resp = await service.getCompletion(messages, req.model, true, 256);
        const content = resp.choices?.[0]?.message?.content ?? '';

        let jsonMode = false;
        try {
            JSON.parse(content);
            jsonMode = true;
        } catch {
            jsonMode = false;
        }

        return {
            ok: true,
            endpoint: endpointHost,
            model: req.model,
            latencyMs: Date.now() - start,
            modelsAvailable,
            sampleOutput: content,
            jsonMode,
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            endpoint: endpointHost,
            model: req.model,
            latencyMs: Date.now() - start,
            modelsAvailable,
            error: message,
        };
    }
}
