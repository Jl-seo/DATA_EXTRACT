import { z } from 'zod';

// 로컬/폐쇄망 LLM(OpenAI 호환: vLLM, Ollama, LM Studio, llama.cpp 등) 연결 테스트 요청/응답 스키마.
export const LocalLlmTestRequest = z.object({
    // OpenAI 호환 base URL. 예) http://localhost:8000/v1, http://<vllm-host>/v1
    baseUrl: z.string().min(1),
    // 모델 식별자(HF repo id 또는 서버에 로드된 모델명). 예) upstage/SOLAR-10.7B-Instruct-v1.0
    model: z.string().min(1),
    // 폐쇄망 vLLM은 보통 불필요. 필요 시 토큰.
    apiKey: z.string().optional(),
    // 테스트용 사용자 프롬프트(미지정 시 기본 한글 문장).
    prompt: z.string().optional(),
});

export type LocalLlmTestRequest = z.infer<typeof LocalLlmTestRequest>;

export interface LocalLlmTestResult {
    ok: boolean;
    endpoint: string;          // 호스트(로그/표시용)
    model: string;
    latencyMs: number;         // 추론 왕복 시간
    modelsAvailable?: string[]; // /v1/models 결과(지원 시)
    sampleOutput?: string;      // 모델 응답 원문
    jsonMode?: boolean;         // response_format=json_object 정상 동작 여부(추출에 필수)
    error?: string;
}
