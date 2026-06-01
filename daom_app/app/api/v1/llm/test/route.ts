import { NextRequest, NextResponse } from 'next/server';
import { createApiErrorResponse } from '@/lib/apiError';
import { testLocalLlm } from '@/actions/llmTest';
import { LocalLlmTestRequest } from '@/scheme/llmTest';

/**
 * POST /api/v1/llm/test
 * 로컬/폐쇄망 LLM(OpenAI 호환) 연결 테스트.
 *
 * body: { baseUrl, model, apiKey?, prompt? }
 * 예) curl -X POST .../api/v1/llm/test -H 'content-type: application/json' \
 *        -d '{"baseUrl":"http://localhost:8000/v1","model":"upstage/SOLAR-10.7B-Instruct-v1.0"}'
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const parsed = LocalLlmTestRequest.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: 'baseUrl, model 은 필수입니다.', issues: parsed.error.issues },
                { status: 400 }
            );
        }

        const result = await testLocalLlm(parsed.data);
        return NextResponse.json(result, { status: result.ok ? 200 : 502 });
    } catch (error: unknown) {
        return createApiErrorResponse({
            req,
            source: 'api/v1/llm/test',
            error,
            status: 500,
            defaultMessage: 'Internal Server Error',
            exposeMessage: true,
        });
    }
}
