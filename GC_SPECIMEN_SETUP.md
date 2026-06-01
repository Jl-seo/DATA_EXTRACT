# GC 검체 수집 — 도입 가이드 (P1: OCR 추출/보정 코어)

녹십자 검체 수집을 위해 DAOM에 적용한 **추출 모델 + 보정 규칙**의 도입 절차.

## 1. 추출 모델 등록
시드 파일: [`daom_app/model_gc_specimen.json`](daom_app/model_gc_specimen.json)
(검체 라벨/검사의뢰서 필드 + 식별자·고유명사 보정 규칙 포함)

등록 방법(택1):
- **관리자 → 모델 스튜디오**에서 필드를 동일하게 생성, 또는
- 모델 생성 액션/스크립트로 `model_gc_specimen.json`(= `ExtractionModelCreateRequest` 형태) 주입.

필드: `specimen_barcode`(검체바코드·식별자), `patient_name`(수진자명·고유명사),
`patient_reg_no`(등록번호·식별자), `ordering_hospital`(의뢰기관), `ordering_doctor`(의뢰의),
`specimen_type`(검체종류), `collected_at`/`requested_at`(일시), `test_items`(검사항목 표: 코드/명).

## 2. 보정 정책 (이번 PR에 반영됨)
- **단어별 OCR 신뢰도 ≤ 0.7** → 프롬프트에 `[교정 필요 의심 단어]` 태깅(집중 교정 유도).
  - `daom_app/scheme/pipeline.ts`(AzureOcrWord.confidence), `daom_app/services/ExtractionService.ts`(buildPrompt).
- **환각 방지 가드레일**: 바코드/등록번호 등 식별자·수진자/병원명 등 고유명사는 임의 변경 금지,
  불확실하면 원문 보존 + `other_data`로 사람 검증 라우팅.
- **사전 정규화는 후처리** 유지(DAOM 현행): 프롬프트엔 사전 미주입.

## 3. 사전(마스터) 준비
**관리자 → 사전 관리**에서 다음 카테고리를 엑셀/CSV(`code,name,alias…`)로 업로드:
- `검사항목`, `의뢰기관`, `검체종류`
모델 필드의 `dictionary_id`가 위 카테고리와 연결되어 추출 후 표준 코드로 정규화됩니다.

## 4. 로컬 LLM(폐쇄망) 검증
**관리자 → 일반설정 → LLM → "로컬 LLM 연결 테스트"** 또는
`POST /api/v1/llm/test  {"baseUrl":"http://localhost:8000/v1","model":"<repo-id>"}`.
민감정보 규제상 추출 LLM은 폐쇄망 vLLM 사용(퍼블릭 LLM 금지). env `openai[]`에
`{"provider":"vllm","endpoint":"<vLLM /v1>","deploymentId":"<모델>","key":""}` 등록.

## 다음 단계 (별도 PR 예정)
- **P2**: 바코드 → LIS 역조회(목업 교체) + 마스터 API/웹훅 동기화 → 수진자/병원 확정.
- **P3**: 검체 총괄조회 그리드(추출값 vs LIS 대조).
- **P5(선택·후순위)**: AKS vLLM/KAITO + KEDA + A100(운영 클러스터 무변경, dev 우선).
