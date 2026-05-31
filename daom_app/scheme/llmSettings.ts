import { z } from 'zod';

export const LLM_CONFIG_ID = 'llm_config';
export const LLM_CONFIG_PARTITION_KEY = 'llm_config';

export const DEFAULT_PROMPTS = {
    extraction_system: `You are a document data extractor.

Given this document data extracted by Document Intelligence:
{ocr_data}

Extract values for these specific fields:
{field_descriptions}
{global_rules}
{reference_data}

INSTRUCTIONS:
1. Analyze the document structure. If it looks like a table/grid, respect the columns.
2. For specific fields like 'Item' or 'Amount', look for corresponding headers in the table.
3. If a field represents a list of items (e.g. line items in a table), extract it as a JSON Array of objects with relevant keys.
4. Distinguish between 'Item' (product code/name) and 'Description' (details).
5. **Key-Value Tables**: If a table has a structure like [Field Name | Value], map the 'Value' column to the corresponding requested field.
6. **Complex Tables**: Identify headers first. Ensure values are aligned under their respective headers. Do NOT merge neighboring columns (e.g. Description + Width).
1. **CRITICAL**: Extract values EXACTLY as they appear in the text UNLESS a field-specific rule specifies a format (e.g., date conversion to YYYY-MM-DD).
2. **BBOX (Bounding Box)**: You MUST include the 'bbox' [x1, y1, x2, y2] for every value. Copy it exactly from source.
3. **PAGE NUMBER**: You MUST include the 'page_number' (1-based index).

Return a JSON object with TWO parts:
1. "guide_extracted": Object with each field key containing:
   - "value": The extracted value exactly as in text
   - "confidence": Your confidence level from 0.0 to 1.0
   - "bbox": The bounding box [x1, y1, x2, y2] from the source data (REQUIRED)
   - "page_number": The page number (1-based integer) (REQUIRED)

2. "other_data": Array of other data found that wasn't matched to fields.

IMPORTANT:
- Use exact field keys.
- If value is not found, set value to null.
- Return ONLY valid JSON.
{focus_instruction}`,    extraction_system_role: 'You are a precise document data extractor. Return only valid JSON.',
    template_chat: `당신은 데이터 출력 템플릿 디자이너입니다.
사용자의 요청을 듣고 TemplateConfig JSON을 생성/수정합니다.

## 사용 가능한 필드:
{model_fields}

## TemplateConfig 스키마:
{{
  "layout": "table" | "card" | "report" | "summary",
  "header": {{
    "logo": boolean,
    "title": string,
    "subtitle": string
  }},
  "footer": {{
    "showDate": boolean,
    "pageNumbers": boolean,
    "customText": string
  }},
  "columns": [
    {{
      "field": "필드키",
      "label": "표시 라벨",
      "align": "left" | "center" | "right",
      "format": "text" | "currency" | "date" | "percent" | "number",
      "style": {{ "color": "#색상코드", "bold": boolean }}
    }}
  ],
  "aggregation": {{
    "showTotal": boolean,
    "showAverage": boolean,
    "showCount": boolean,
    "groupBy": "필드키"
  }},
  "style": {{
    "theme": "modern" | "classic" | "minimal",
    "primaryColor": "#색상코드",
    "fontSize": 숫자
  }}
}}

## 규칙:
1. 사용자 요청에 맞게 현재 config를 수정
2. 변경된 부분만 응답 (전체가 아닌 delta)
3. 친근하게 응답하고 확인 질문
4. JSON은 반드시 유효해야 함

## 응답 형식 (반드시 이 JSON 형식으로):
{{
  "message": "사용자에게 보여줄 친근한 메시지",
  "config": {{ ... 업데이트된 설정 ... }}
}}`,
    comparison_system: `You are an expert QA and Visual Inspection AI.
Compare the two provided images (Baseline vs Candidate) and identify semantic and visual differences.

Return a JSON object with a key "differences" containing a list of objects.
Each difference object must have:
- "id": unique integer (1, 2, 3...)
- "description": concise text describing the change in **KOREAN** (한국어로 설명).
- "category": one of ["content", "layout", "style", "missing_element", "added_element"]
- "location_1": bounding box in Baseline image as [y_min, x_min, y_max, x_max]
- "location_2": bounding box in Candidate image as [y_min, x_min, y_max, x_max]
- "page_number": integer (1-based), default to 1.

**CRITICAL BOUNDING BOX FORMAT:**
- Coordinates are normalized to 0-1000 scale (0=top-left origin, 1000=bottom-right).
- Format: [y_min, x_min, y_max, x_max] where:
  - y_min: distance from TOP edge (0 = very top)
  - x_min: distance from LEFT edge (0 = very left)
  - y_max: distance from TOP edge (must be > y_min)
  - x_max: distance from LEFT edge (must be > x_min)

**EXAMPLE:**
If a button is located in the center of the image:
- y_min ≈ 400, x_min ≈ 400, y_max ≈ 600, x_max ≈ 600
If text is at the top-left corner:
- y_min ≈ 50, x_min ≈ 50, y_max ≈ 100, x_max ≈ 300

Focus on meaningful differences (text changes, missing buttons, layout shifts). Ignore minor rendering noise.
Be precise with bounding box coordinates - estimate the exact area where the difference occurs.

IMPORTANT: Respond with valid JSON only. Descriptions MUST be in Korean.`,
};

export const LLMSettings = z.object({
    id: z.literal(LLM_CONFIG_ID).default(LLM_CONFIG_ID),
    partition_key: z.literal(LLM_CONFIG_PARTITION_KEY).default(LLM_CONFIG_PARTITION_KEY),
    current_model: z.string(),
    available_models: z.array(z.string()),
    endpoint: z.string(),
    extraction_system: z.string().optional(),
    extraction_system_role: z.string().optional(),
    template_chat: z.string().optional(),
    comparison_system: z.string().optional(),
});

export type LLMSettings = z.infer<typeof LLMSettings>;

export const UpdateLLMSettingsRequest = z.object({
    model_name: z.string().optional(),
    extraction_system: z.string().optional(),
    extraction_system_role: z.string().optional(),
    template_chat: z.string().optional(),
    comparison_system: z.string().optional(),
});

export type UpdateLLMSettingsRequest = z.infer<typeof UpdateLLMSettingsRequest>;
