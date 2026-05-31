# DAOM (Document Analysis & Operations Management)

DAOM은 Digital Experts Consulting에서 개발한 **문서 분석 및 운영 관리 플랫폼**입니다. Azure의 강력한 AI 서비스(Document Intelligence, OpenAI)를 결합하여 문서에서 데이터를 정교하게 추출하고 관리할 수 있도록 지원합니다.

---

## 🚀 핵심 기능

- **문서 데이터 추출**: Azure Document Intelligence와 LLM(GPT-4.1)을 활용한 고성능 데이터 추출 파이프라인.
- **모델 관리 (Model Studio)**: 추출하려는 문서의 스키마와 규칙을 정의하고 테스트할 수 있는 환경 제공.
- **커넥터 서비스 (Connector)**: 외부 시스템과의 연동을 위한 단건/일괄 업로드 API 지원 및 Webhook 알림.
- **권한 관리**: 세분화된 그룹 및 사용자별 권한 제어.
- **추출 이력 관리**: 데이터 추출 과정의 로그 및 결과 데이터를 한눈에 확인하고 검증 가능.

---

## 🛠 기술 스택

### Frontend / Framework
- **Framework**: [Next.js 15+ (App Router)](https://nextjs.org/)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (Strict Typing)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/), [Shadcn UI](https://ui.shadcn.com/)
- **State Management**: [TanStack Query (React Query)](https://tanstack.com/query/latest)
- **Validation**: [Zod](https://zod.dev/)

### Backend / Infrastructure
- **Cloud**: Azure (Microsoft)
  - **Database**: Azure Cosmos DB
  - **Storage**: Azure Blob Storage
  - **AI/LLM**: Azure OpenAI (GPT-4.1), Azure Document Intelligence
- **Authentication**: Microsoft Entra ID (MSAL)

---

## 📁 프로젝트 구조 및 명명 규칙

이 프로젝트는 재사용성과 유지보수성을 극대화하기 위해 다음과 같은 특수한 디렉토리 구조를 가집니다.

- **`_` 로 시작하는 경로**: 전역적으로 재사용되는 핵심 모듈들입니다.
  - `_service`: 비즈니스 로직 및 외부 연동 (Azure, OpenAI 등)
  - `_lib`: 핵심 유틸리티 및 전역 설정
  - `_scheme`: Zod 및 TypeScript 타입 정의
  - `_hooks`: 공통 React Hooks
  - `_actions`: Next.js Server Actions
  - `_queries`: React Query Hooks
  - `_types`: 공통 인터페이스 및 타입
- **`app/`**: Next.js App Router 기반의 페이지 및 API 라우트
- **`components/`**: UI 컴포넌트 (`shadcn` 기반 및 비즈니스 컴포넌트)

---

## 🔧 개발 환경 설정

### 1. 의존성 설치
```bash
npm install
```

### 2. 환경 변수 설정
`.env.development` 파일 또는 `env.development.json` 파일을 설정해야 합니다. (기존 설정팀에 문의)

### 3. 개발 서버 실행
```bash
npm run dev
```
기본적으로 [http://localhost:3000](http://localhost:3000)에서 실행됩니다.

---

## 📜 개발 규칙 (Coding Standards)

1. **보안 우선**: 클라이언트 데이터 조작 가능성을 인지하고 서버 측에서 철저히 검증합니다.
2. **타입 안전성**: `any`나 `unknown` 사용을 금지하며, `zod`를 활용한 런타임 검증을 준수합니다.
3. **재사용성**: 새로운 모듈을 만들기 전에 `_` 디렉토리 내의 기존 모듈을 먼저 확인합니다.
4. **Server Actions**: 모든 Server Action은 공개 API와 같다고 가정하고 방어적으로 코딩하며 권한 체크를 수행합니다.
5. **Tailwind CSS**: 레이아웃 및 스타일링은 Tailwind CSS를 우선적으로 활용합니다.

---

## 📄 라이선스
Copyright © 2026 **Digital Experts Consulting**. All rights reserved.
