// 로컬 Vision LLM으로 "검체 라벨 사진 → 구조화 JSON"을 한 번에 추출하는 테스트.
// DAOM의 VisionPipeline.ts 흐름(이미지를 base64 data URL로 LLM에 직접 전달)을 그대로 흉내낸다.
//
// 사용법:
//   node scripts/test-gc-vision.mjs <이미지경로>
//   예) node scripts/test-gc-vision.mjs ~/Desktop/label.jpg
//
// 환경변수:
//   LLM_BASE_URL  (기본 http://localhost:11434/v1)
//   LLM_MODEL     (기본 qwen2.5vl:3b  — 그림을 볼 수 있는 vision 모델이어야 함)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:11434/v1';
const MODEL = process.env.LLM_MODEL || 'qwen2.5vl:3b';

// 0) 이미지 경로 인자 확인
const imgPath = process.argv[2];
if (!imgPath) {
    console.error('❌ 사용법: node scripts/test-gc-vision.mjs <이미지경로>');
    console.error('   예) node scripts/test-gc-vision.mjs ~/Desktop/label.jpg');
    process.exit(1);
}
const resolved = imgPath.replace(/^~/, process.env.HOME || '');
if (!fs.existsSync(resolved)) {
    console.error(`❌ 파일을 찾을 수 없습니다: ${resolved}`);
    process.exit(1);
}

// 1) 이미지 → base64 data URL (DAOM VisionPipeline과 동일)
const ext = path.extname(resolved).toLowerCase();
const mime = ext === '.png' ? 'image/png'
    : ext === '.webp' ? 'image/webp'
    : ext === '.gif' ? 'image/gif'
    : 'image/jpeg';
const base64 = fs.readFileSync(resolved).toString('base64');
const dataUrl = `data:${mime};base64,${base64}`;

// 2) 실제 DAOM 스키마 + global_rules 로드
const model = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'model_gc_specimen.json'), 'utf-8'),
);
const fieldLines = model.fields
    .map((f) => {
        const req = f.is_required ? ' (필수)' : '';
        const sub = f.sub_fields
            ? ` -> 하위필드: ${f.sub_fields.map((s) => `${s.key}(${s.label})`).join(', ')}`
            : '';
        return `- ${f.key} (${f.label}, ${f.type})${req}: ${f.description || ''}${sub}`;
    })
    .join('\n');

const systemPrompt = `너는 의료 검체 라벨/검사의뢰서 이미지에서 정보를 추출하는 도우미다.
이미지를 보고 아래 규칙과 필드 정의에 따라 값을 추출해 JSON으로만 답하라.

[규칙]
${model.global_rules}

[추출할 필드]
${fieldLines}

[출력 형식]
- 위 필드 key를 그대로 사용한 JSON 객체 하나만 출력한다.
- 값을 못 찾으면 null. test_items는 배열(각 원소는 {test_code, test_name}).
- 확신이 없으면 원문을 보존하고 "other_data" 키에 사유를 적는다.
- JSON 외 다른 말은 절대 출력하지 마라.`;

console.log('=== 테스트 설정 ===');
console.log('  서버 :', BASE_URL);
console.log('  모델 :', MODEL, '(vision 모델이어야 함)');
console.log('  이미지:', resolved, `(${Math.round(fs.statSync(resolved).size / 1024)}KB)`);
console.log('\n=== 이미지 보는 중... (CPU면 수십 초~몇 분 걸릴 수 있어요) ===\n');

const t0 = Date.now();
let res;
try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            model: MODEL,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: '이 이미지에서 모든 필드를 추출하세요. Return valid JSON.' },
                        { type: 'image_url', image_url: { url: dataUrl } },
                    ],
                },
            ],
        }),
    });
} catch (e) {
    console.error('❌ 서버 연결 실패:', e.message);
    console.error('   → Ollama 실행 중인지, 주소(' + BASE_URL + ')가 맞는지 확인하세요.');
    process.exit(1);
}

if (!res.ok) {
    const body = await res.text();
    console.error(`❌ 서버 오류 (HTTP ${res.status})`);
    console.error(body);
    if (/model.*not found|no such model/i.test(body)) {
        console.error(`\n💡 vision 모델이 없을 수 있어요. 먼저: ollama pull ${MODEL}`);
    }
    process.exit(1);
}

const data = await res.json();
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const raw = data.choices?.[0]?.message?.content ?? '';

console.log(`=== LLM 원본 응답 (${elapsed}초) ===\n` + raw + '\n');

console.log('=== 결과 ===');
try {
    const parsed = JSON.parse(raw);
    console.log('✅ JSON 파싱 성공\n');
    console.log(JSON.stringify(parsed, null, 2));
    console.log('\n🎉 로컬 Vision LLM이 사진에서 직접 데이터를 뽑았습니다!');
    console.log('   (값이 정확한지는 실제 라벨과 눈으로 대조해 보세요.)');
} catch {
    console.log('⚠️  JSON 파싱 실패 — 작은 모델에서 가끔 발생합니다. 위 원본 응답을 확인하세요.');
}
