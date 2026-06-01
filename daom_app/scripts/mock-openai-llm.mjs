#!/usr/bin/env node
/**
 * Mock OpenAI-compatible LLM server (zero dependencies).
 *
 * DAOM 로컬 LLM 연결 테스트(testLocalLlm) 및 추출 vLLM 경로를 GPU 없이 검증하기 위한 목업.
 * - GET  /v1/models            : 모델 목록
 * - POST /v1/chat/completions  : 채팅 완료. response_format=json_object 이면 JSON만 반환(JSON 모드 검증).
 *
 * 사용:
 *   node scripts/mock-openai-llm.mjs           # 기본 http://localhost:8000/v1
 *   PORT=9000 node scripts/mock-openai-llm.mjs
 *
 * DAOM 설정:
 *   baseUrl = http://localhost:8000/v1
 *   model   = mock-solar
 */
import http from 'node:http';

const PORT = Number(process.env.PORT || 8000);
const MODEL = process.env.MODEL || 'mock-solar';

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.replace(/\/$/, '').endsWith('/models')) {
    return send(res, 200, {
      object: 'list',
      data: [{ id: MODEL, object: 'model', owned_by: 'mock' }],
    });
  }

  if (req.method === 'POST' && req.url.includes('/chat/completions')) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(raw || '{}'); } catch { /* ignore */ }

      const wantsJson =
        payload?.response_format?.type === 'json_object' ||
        payload?.response_format?.type === 'json_schema';

      const userMsg =
        [...(payload.messages || [])].reverse().find((m) => m.role === 'user')?.content || '';

      // JSON 모드 요청이면 반드시 파싱 가능한 JSON만, 아니면 평문.
      const content = wantsJson
        ? JSON.stringify({ ok: true, echo: String(userMsg).slice(0, 80) })
        : `connection ok: ${String(userMsg).slice(0, 80)}`;

      return send(res, 200, {
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: payload.model || MODEL,
        choices: [
          { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    });
    return;
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[mock-openai-llm] listening on http://localhost:${PORT}/v1  (model: ${MODEL})`);
  console.log(`  DAOM: baseUrl=http://localhost:${PORT}/v1  model=${MODEL}`);
});
