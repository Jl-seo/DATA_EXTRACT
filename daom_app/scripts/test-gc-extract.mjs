// 로컬 LLM(Ollama 등 OpenAI 호환)으로 "검체 라벨 → 구조화 JSON" 추출을 테스트한다.
// DAOM 실제 추출 흐름(스키마 + global_rules + JSON 모드 + temperature 0)을 그대로 흉내낸다.
//
// 사용법:
//   node scripts/test-gc-extract.mjs
// 환경변수로 주소/모델 바꾸기:
//   LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=qwen2.5:3b node scripts/test-gc-extract.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:11434/v1';
const MODEL = process.env.LLM_MODEL || 'qwen2.5:3b';

// 1) 실제 DAOM 스키마 로드 (model_gc_specimen.json)
const model = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'model_gc_specimen.json'), 'utf-8'),
);

// 2) 필드 목록을 LLM이 읽기 쉬운 형태로 변환
const fieldLines = model.fields
    .map((f) => {
        const req = f.is_required ? ' (필수)' : '';
        const sub = f.sub_fields
            ? ` -> 하위필드: ${f.sub_fields.map((s) => `${s.key}(${s.label})`).join(', ')}`
            : '';
        return `- ${f.key} (${f.label}, ${f.type})${req}: ${f.description || ''}${sub}`;
    })
    .join('\n');

// 3) 시스템 프롬프트: DAOM의 global_rules를 그대로 사용
const systemPrompt = `너는 의료 검체 라벨/검사의뢰서에서 정보를 추출하는 도우미다.
아래 규칙과 필드 정의에 따라, 주어진 OCR 텍스트에서 값을 추출해 JSON으로만 답하라.

[규칙]
${model.global_rules}

[추출할 필드]
${fieldLines}

[출력 형식]
- 위 필드 key를 그대로 사용한 JSON 객체 하나만 출력한다.
- 값을 못 찾으면 null. test_items는 배열(각 원소는 {test_code, test_name}).
- 확신이 없으면 원문을 보존하고 "other_data" 키에 사유를 적는다.
- JSON 외 다른 말은 절대 출력하지 마라.`;

// 4) 테스트용 가짜 검체 라벨 OCR 텍스트 (실제 환자정보 아님)
const sampleOcr = `검체 라벨
바코드: GC2406-0001837
수진자명: 홍길동
등록번호: 1234567
의뢰기관: 녹십자의료재단 강남센터
의뢰의: 김영희
검체종류: 혈청 (Serum)
채취일시: 2026-05-30 09:15
의뢰일자: 2026.05.30
검사항목: [v] CBC  [v] 공복혈당(FBS)  [ ] 갑상선(TSH)`;

console.log('=== 테스트 설정 ===');
console.log('  서버 :', BASE_URL);
console.log('  모델 :', MODEL);
console.log('\n=== 입력(검체 라벨 OCR 텍스트) ===\n' + sampleOcr);
console.log('\n=== LLM 추출 중... (CPU면 몇 초~십몇 초 걸립니다) ===\n');

const t0 = Date.now();
let res;
try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            model: MODEL,
            temperature: 0, // DAOM과 동일: 결정론적 추출
            response_format: { type: 'json_object' }, // JSON 모드
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `다음 OCR 텍스트에서 추출하라:\n\n${sampleOcr}` },
            ],
        }),
    });
} catch (e) {
    console.error('❌ 서버에 연결하지 못했습니다:', e.message);
    console.error('   → Ollama가 켜져 있는지, 주소(' + BASE_URL + ')가 맞는지 확인하세요.');
    process.exit(1);
}

if (!res.ok) {
    console.error(`❌ 서버가 오류를 반환했습니다 (HTTP ${res.status})`);
    console.error(await res.text());
    process.exit(1);
}

const data = await res.json();
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const raw = data.choices?.[0]?.message?.content ?? '';

console.log(`=== LLM 원본 응답 (${elapsed}초 소요) ===\n` + raw + '\n');

console.log('=== 결과 검증 ===');
let parsed;
try {
    parsed = JSON.parse(raw);
    console.log('✅ JSON 파싱 성공\n');
    console.log(JSON.stringify(parsed, null, 2));
} catch {
    console.log('⚠️  JSON 파싱 실패 — 모델이 JSON 외 텍스트를 섞었을 수 있어요.');
    console.log('    작은 모델에서 가끔 발생합니다. 더 큰 모델이면 안정적입니다.');
    process.exit(0);
}

// 5) 핵심 필드가 잘 뽑혔는지 간단 채점
const checks = [
    ['specimen_barcode', 'GC2406-0001837'],
    ['patient_name', '홍길동'],
    ['ordering_hospital', '녹십자'],
];
console.log('\n=== 핵심 항목 채점 ===');
let ok = 0;
for (const [key, expect] of checks) {
    const val = String(parsed[key] ?? '');
    const pass = val.includes(expect);
    if (pass) ok++;
    console.log(`  ${pass ? '✅' : '❌'} ${key}: "${val}" ${pass ? '' : `(기대값에 "${expect}" 포함 안 됨)`}`);
}
console.log(`\n점수: ${ok}/${checks.length} 핵심 항목 정확`);
console.log(
    ok === checks.length
        ? '\n🎉 로컬 LLM이 검체 라벨에서 데이터를 제대로 뽑았습니다!'
        : '\n참고: 작은 3b 모델이라 일부 틀릴 수 있어요. 더 큰 모델일수록 정확해집니다.',
);
