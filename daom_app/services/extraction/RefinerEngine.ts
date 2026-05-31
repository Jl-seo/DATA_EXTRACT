import 'server-only';
import { RefMapItem } from './LayoutParser';
import { ExtractionModel } from '@/scheme/extractionModel';

export interface ExtractedField {
    value: any;
    confidence: number;
    bbox?: number[] | null;
    page_number?: number;
    type?: string;
    source_text?: string;
    is_uncertain?: boolean;
    warning_msg?: string;
}

export class RefinerEngine {

    public static constructDesignerPrompt(model: ExtractionModel): string {
        const name = model.name || "Unknown Model";
        const description = model.description || "";
        const globalRules = model.global_rules || "";
        const referenceData = model.reference_data || null;
        const dataStructure = model.data_structure || "data";
        const fields = model.fields || [];

        const TABLE_FIELD_TYPES = ['list', 'table', 'array'];

        const fieldsJson = JSON.stringify(fields.map(f => ({
            key: f.key,
            label: f.label,
            description: f.description,
            rules: f.rules,
            type: f.type,
            is_required: f.is_required, // 필수 여부 추가
            sub_fields: (f as any).sub_fields // Include sub_fields for table types
        })), null, 2);

        let refDataSection = "";
        if (referenceData) {
            let refJson = JSON.stringify(referenceData, null, 2);
            if (refJson.length > 5000) {
                refJson = refJson.substring(0, 5000) + "\n... [TRUNCATED]";
            }
            refDataSection = `\nREFERENCE DATA:\n${refJson}\n`;
        }

        let calibrationSection = "";
        if (globalRules) {
            calibrationSection = `\nCALIBRATION RULES (from admin):\n${globalRules}\n`;
        }

        const commonKeys = fields.filter(f => !TABLE_FIELD_TYPES.includes(f.type || '')).map(f => f.key);
        const tableKeys = fields.filter(f => TABLE_FIELD_TYPES.includes(f.type || '')).map(f => f.key);

        let typeGuidance = "";
        if (commonKeys.length > 0) typeGuidance += `\nCOMMON FIELDS (single values): ${commonKeys.join(', ')}`;
        if (tableKeys.length > 0) typeGuidance += `\nTABLE FIELDS (list of rows): ${tableKeys.join(', ')}`;

        return `You are a Document Extraction Architect.

Given an extraction model schema and calibration rules, generate a WORK ORDER
that an extraction engineer will follow to extract data from a document.

MODEL: ${name}
DOMAIN: ${description || 'General Document'}
DATA STRUCTURE: ${dataStructure}${typeGuidance}

MODEL SCHEMA:
${fieldsJson}
${calibrationSection}${refDataSection}

### OUTPUT: A JSON object with this structure:
{
  "work_order": {
    "document_type": "brief description",
    "extraction_mode": "data" or "table",
    "common_fields": [
      {
        "key": "field_key", 
        "instruction": "Detailed extraction command", 
        "rules": ["rule 1 from schema", "rule 2 from schema"],
        "expected_format": "type"
      }
    ],
    "table_fields": [
      {
        "key": "field_key",
        "instruction": "Detailed extraction command",
        "columns": {
          "col_key": {
            "instruction": "command", 
            "source_hint": "likely header variations",
            "rules": ["column rule from schema"]
          }
        },
        "rules": ["table level rule from schema"],
        "include_when": ["..."],
        "exclude_when": ["..."],
        "group_row_behavior": "...",
        "field_inheritance": { "sub_key": "source" }
      }
    ],
    "integrity_rules": [
      "Copy values exactly as written.",
      "Missing values must be null.",
      "Extract in original language."
    ]
  }
}

### ARCHITECT RULES:
1. **FIELD CLASSIFICATION**: 
   - "list", "table", "array" → table_fields.
   - All others → common_fields.
2. **ROW CLASSIFICATION PASSTHROUGH (CRITICAL)**: 
   - If a table field has "include_when", "exclude_when", "group_row_behavior", or "field_inheritance" in its schema, YOU MUST COPY THEM VERBATIM into the work order. These are absolute business rules.
3. **SUB-FIELD DEFINITION**: 
   - For table_fields, you MUST use the "sub_fields" array to define the "columns" object. 
   - If "sub_fields" is empty, infer column keys from the field description/rules and use clean snake_case.
4. **RULE PRESERVATION**: 
   - DO NOT SUMMARIZE the user's "description" and "rules". Copy them exactly into the "rules" array.
5. **FIELD COVERAGE**: 
   - Input has ${fields.length} fields → Output MUST have ${fields.length} entries + 1 unmapped entry. Skipping one field is a failure.

### ALWAYS APPEND THIS ENTRY to common_fields:
{
  "key": "unmapped_critical_info",
  "instruction": "Scan the entire document for text marked as 'Important', 'Note', '주의', '특약', '비고', 'Remark', or similar annotations that do NOT belong to any field above. Copy verbatim. If none found, return null.",
  "expected_format": "text",
  "rules": ["Do not duplicate data already extracted in other fields"]
}

STYLE: No prose. Only explicit architectural commands.
`;
    }

    public static constructEngineerPrompt(workOrder: any, referenceData?: any, globalRules?: string, fields?: Array<{ key: string, label?: string, description?: string | null, rules?: string | null, is_required?: boolean | null, sub_fields?: Array<{ key: string, label?: string, description?: string | null, rules?: string | null, is_required?: boolean | null }> | null }>): string {
        const woInner = workOrder.work_order || workOrder;
        const workOrderJson = JSON.stringify(workOrder, null, 2);

        const integrityRules: string[] = woInner.integrity_rules || [];
        const integrityRulesStr = integrityRules.length > 0
            ? integrityRules.map((r: string) => `- ${r}`).join('\n')
            : "- Extract values exactly as written.";

        const exampleParts: string[] = [];
        const allKeys: string[] = [];

        for (const cf of (woInner.common_fields || [])) {
            const key = cf.key || "field";
            allKeys.push(key);
            exampleParts.push(`    "${key}": {"value": "...", "ref": "W1"}`);
        }

        for (const tf of (woInner.table_fields || [])) {
            const key = tf.key || "table";
            allKeys.push(key);
            const cols = tf.columns || {};
            if (Object.keys(cols).length > 0) {
                const colExamples = Object.keys(cols).slice(0, 3).map(ck => `"${ck}": {"value": "...", "ref": "C1"}`).join(', ');
                exampleParts.push(`    "${key}": [\n      {${colExamples}}\n    ]`);
            } else {
                exampleParts.push(`    "${key}": [\n      {"col1": {"value": "...", "ref": "C1"}}\n    ]`);
            }
        }

        const exampleJson = exampleParts.length > 0
            ? `{\n  "guide_extracted": {\n${exampleParts.join(",\n")}\n  }\n}`
            : `{"guide_extracted": {"field": {"value": "...", "ref": "TAG"}}}`;

        const fieldKeyList = allKeys.map(k => `"${k}"`).join(", ");

        let prompt = `You are a High-Precision Document Extraction Engineer.
Follow the WORK ORDER below EXACTLY. Your goal is 100% data completeness with zero hallucination.

### WORK ORDER:
${workOrderJson}
`;

        // 글로벌 룰이 있으면 Work Order 바로 뒤에 삽입 (Designer를 거치지 않고 직접 전달)
        if (globalRules && globalRules.trim()) {
            prompt += `
### DOCUMENT RULES (CRITICAL - MUST FOLLOW):
${globalRules}
`;
        }

        prompt += `
### TAG FORMAT GUIDE (Read before processing):
The document text contains inline tags that mark source locations:
- ^W{id} = Word tag (e.g., "^W3 Invoice").
- ^P{id} = Paragraph tag (marks start of a block).
- ^C{id} = Cell tag (used inside markdown tables).

**EXTRACTION RULE**: When you extract a value, list ALL relevant tag IDs in "ref" (comma-separated).
Example: If "2024-01-15" spans "^W7 2024" and "^W8 -01-15", output:
  {"value": "2024-01-15", "ref": "W7, W8"}

For table cells: "| ^C5 KRPUS |" → {"value": "KRPUS", "ref": "C5"}


### EXTRACTION INSTRUCTIONS:
1. **FULL SCAN**: Scan the document from START to END. Check every paragraph, table row, and footer. Do NOT stop early. 
2. **MULTIPLE TABLES (CRITICAL)**: If the document contains MULTIPLE separate physical tables for the same field (e.g., items continuing on page 2), you MUST extract rows from EVERY matching table and combine them into a SINGLE array.
3. **DENORMALIZATION**: If a table has merged cells or hierarchical headers (one parent value spanning multiple child rows), **YOU MUST REPEAT** the parent value in EVERY child row. Every row object must be complete.
4. **CHECKBOXES & SELECTION MARKS**:
    - \`:selected:\` = CHECKED (True/Yes).
    - \`:unselected:\` = UNCHECKED (False/No).
    - If a field rule asks for "selected items", filter out rows/values marked \`:unselected:\`.
5. **LANGUAGE**: Extract values in the ORIGINAL language. Do NOT translate unless explicitly requested.
6. **LITERAL EXTRACTION (CRITICAL)**: Extract values **EXACTLY** as they appear in the text (e.g., "JEJU" should stay "JEJU", not "KRJEJ"). Do **NOT** perform automatic transformation (e.g., name → code) unless explicitly requested in the field-specific rules.
7. **TABLE GRID ALIGNMENT (CRITICAL)**: Markdown tables represent the physical layout.
    - Every \`| ... |\` column corresponds to a specific header.
    - Even if a cell ONLY contains a tag (e.g., \`| ^C15 |\`) with no text, it represents a valid empty column. 
    - **Do NOT skip empty columns.** If a column is empty, return \`{"value": null, "ref": "C..."}\`.
    - If you shift values to the wrong column, the extraction is a failure.
### NULL HANDLING & INTEGRITY (CRITICAL):
- **HONESTY OVER GUESSING**: A missing value is ALWAYS better than a wrong value. If a value does not exist, return {"value": null, "ref": null}.
- **NO HALLUCINATION**: NEVER invent, guess, or extrapolate data.
- **NO CROSS-ROW COPYING**: For table rows: if a cell is empty, return null. Do NOT copy from adjacent rows unless it's a "Carry Forward" rule.


### SELF-VERIFICATION RULES:
If ANY of these apply, add "is_uncertain": true and "warning_msg": "reason":
1. **AMBIGUITY**: 2+ candidate values found.
2. **DATA CORRUPTION**: OCR errors (0 vs O) or garbled text. 
3. **FORMAT MISMATCH**: Data format differs from work order expectation.


### ALLOWED FIELD KEYS:
${fieldKeyList}

### OUTPUT FORMAT:
${exampleJson}

### SHARED INTEGRITY RULES:
${integrityRulesStr}
`;

        // 필드별 원본 description/rules를 Engineer에게 직접 전달(Designer 해석 오류 방지)
        if (fields && fields.length > 0) {
            const fieldGuideLines: string[] = [];
            for (const f of fields) {
                const parts: string[] = [`[${f.key}]${f.is_required ? ' [REQUIRED]' : ''}`];
                if (f.label) parts.push(`Label: ${f.label}`);
                if (f.description) parts.push(`Description: ${f.description}`);
                if (f.rules) parts.push(`Rules: ${f.rules}`);
                if (f.sub_fields && f.sub_fields.length > 0) {
                    const subLines = f.sub_fields.map(sub => {
                        const sp: string[] = [`  - ${sub.key}${sub.is_required ? ' [REQUIRED]' : ''}`];
                        if (sub.label) sp.push(`(${sub.label})`);
                        if (sub.description) sp.push(`Desc: ${sub.description}`);
                        if (sub.rules) sp.push(`Rules: ${sub.rules}`);
                        return sp.join(' ');
                    });
                    parts.push(`Sub-fields:\n${subLines.join('\n')}`);
                }
                fieldGuideLines.push(parts.join(' | '));
            }
            prompt += `
FIELD EXTRACTION GUIDE (Original schema — follow these descriptions and rules exactly. These OVERRIDE global integrity rules if they conflict):
${fieldGuideLines.join('\n')}
`;
        }

        if (referenceData) {
            let refJson = JSON.stringify(referenceData, null, 2);
            if (refJson.length > 10000) refJson = refJson.substring(0, 10000) + "\n... [TRUNCATED]";
            
            prompt += `
### REFERENCE DATA:
${refJson}
`;

            // daom_old 레거시 로직 감지 및 주입
            const legacyRules: string[] = [];
            const ref = referenceData as any;

            if (ref.mapping_table) {
                legacyRules.push(`- **SURCHARGE MAPPING**: Use 'mapping_table' to resolve extracted names into correct keys. (e.g., if you see "Ocean Freight", map it to "XOCF" fields)`);
            }
            if (ref.route_master_logic) {
                legacyRules.push(`- **ROUTE-SPECIFIC LOGIC**: Identify the Region/Route first. Apply mandatory checks and notes from 'route_master_logic' for that region.`);
            }
            if (ref.dynamic_calculation_rules) {
                const calc = ref.dynamic_calculation_rules;
                if (calc.feeder_logic) legacyRules.push(`- **FEEDER/ADD-ON LOGIC**: ${calc.feeder_logic.rule}`);
                if (calc.transport_mode) legacyRules.push(`- **TRANSPORT MODE (UNPIVOT)**: ${calc.transport_mode.rule}`);
            }
            if (ref.extraction_system_rules) {
                const sys = ref.extraction_system_rules;
                if (sys.unpivot_action) {
                    const triggers = (sys.unpivot_trigger || []).join(', ');
                    legacyRules.push(`- **UNPIVOT (ROW SPLITTING) [CRITICAL]**: If a field (like POD/POL) contains delimiters [${triggers}], you MUST split them and create a separate row for each value.`);
                }
                if (sys.currency_safety) legacyRules.push(`- **CURRENCY SAFETY**: ${sys.currency_safety}`);
                if (sys.latest_version_rule) legacyRules.push(`- **VERSION SELECTION**: ${sys.latest_version_rule}`);
            }

            if (legacyRules.length > 0) {
                prompt += `
### LEGACY BUSINESS RULES (MANDATORY):
${legacyRules.join('\n')}
`;
            }

            prompt += `
INSTRUCTIONS FOR REFERENCE DATA:
- **PRIORITIZE** document text over reference_data. If a value is visible in the text, extract it **EXACTLY** as written.
- Use reference_data only to **validate/disambiguate** extracted values. Do **NOT** fill blank/missing source cells from reference_data unless field rules explicitly require fallback/default filling.
- Only perform transformation (e.g., mapping a name to a code) if a specific field's rules explicitly require it.
- If a field cannot be resolved even with reference_data, return null.
`;
        }
        return prompt;

    }

    public static constructHealingPrompt(
        workOrder: any,
        missingFields: Array<{ key: string, label: string, instruction: string, rules?: string[] }>,
        taggedText: string,
        referenceData?: any,
        globalRules?: string
    ): string {
        const prompt = `You are a High-Precision Document Extraction Auditor.
The initial extraction pass FAILED to find several MANDATORY fields. 
Failure to find these fields results in a system-wide validation error. 
Your mission is to perform a targeted "Deep Dive" into the document text to recover these missing values.

### MISSING MANDATORY FIELDS:
${missingFields.map(f => {
            const fieldTypeStr = (f as any).isSubField ? "Column in Table" : "Field";
            const contextStr = (f as any).isSubField ? ` (Parent Table: ${f.key.split('.')[0]})` : "";
            return `- [${f.key}] (Label: ${f.label}) [Type: ${fieldTypeStr}]: ${f.instruction} ${f.rules ? `| Rules: ${f.rules.join('; ')}` : ''}${contextStr}`;
        }).join('\n')}



### DOCUMENT TEXT FOR REVIEW:
${taggedText}

### CRITICAL AUDIT INSTRUCTIONS:
1. **FOCUS EXCLUSIVELY** on the missing fields listed above. Do NOT waste tokens on other data.
2. **RE-EXAMINE page boundaries, headers, and footer notes carefully.** Sometimes mandatory data is hidden in small print.
3. **NO SUMMARY**: Do not provide explanations. Provide the data.
4. **MANDATORY FIND**: If the data is even remotely present (partial match, OCR typos), you MUST extract it and flag it with "is_uncertain": true. 
5. **BBOX ACCURACY**: List ALL tag IDs (comma-separated) that correspond to the extracted value for precise highlighting.
6. **FORMATTING**: Return values directly. Do NOT wrap values in double brackets like [[value]] or other signs.
7. **TABLE CONTEXT**: If multiple missing fields belong to the same parent table, ensure you search for them together as they likely exist in the same row/header area.
8. **FORBIDDEN (No Lists)**: For row-specific data (e.g., THICKNESS, QUANTITY, PRICE), do NOT return a comma-separated list of all options found in headers (e.g. "0.25, 0.35, 0.45"). Only return a unique value corresponding to a specific row context, or return null if it's just a general list of options.
9. Return null ONLY if the information is absolutely, 100% missing from the text.



### OUTPUT FORMAT:
Return ONLY a valid JSON object starting with "guide_extracted":
{
  "guide_extracted": {
    ${missingFields.map(f => `"${f.key}": {"value": "...", "ref": "..."}`).join(',\n    ')}
  }
}



${globalRules ? `\nGLOBAL RULES:\n${globalRules}` : ''}
${referenceData ? `\nREFERENCE DATA PROVIDED for validation.` : ''}
`;
        return prompt;
    }


    public static postProcessWithRef(
        engineerOutput: any,
        refMap: Record<string, RefMapItem>,
        tableFieldKeys: string[] = []
    ): Record<string, any> {
        const resolveRef = (cell: any, isTable: boolean = false) => {
            if (cell && typeof cell === 'object' && !Array.isArray(cell) && 'value' in cell) {
                const refIdStr = cell.ref;
                // refId가 쉼표로 구분된 목록일 수 있는 경우(comma-separated list) 처리
                const refIds = (refIdStr || "").split(',').map((s: string) => s.trim().replace('^', ''));

                const value = cell.value;
                const resolved: any = { value: value };

                const validBboxes: any[] = [];
                const sourceTexts: string[] = [];
                let primaryPage: number | null = null;

                for (const id of refIds) {
                    if (id && refMap[id]) {
                        const info = refMap[id];
                        if (info.bbox) {
                            // [Aggregation Filter] 동일 페이지 내, 그리고 첫 태그와 수직 거리가 가까운 경우에만 병합 (장거리 오매칭 방지)
                            if (primaryPage !== null && info.page_number !== primaryPage) continue;

                            const currentBBox = Array.isArray(info.bbox) ? info.bbox : [];
                            if (validBboxes.length > 0 && currentBBox.length >= 4) {
                                const firstY = validBboxes[1]; // y1 of the first tag
                                const currentY = currentBBox[1]; // y1 of the current tag

                                // [Field Isolation] 일반 필드(Scalar)는 3%, 테이블 셀은 15% 임계값 적용
                                const heightThreshold = isTable ? 15 : 3;
                                if (Math.abs(currentY - firstY) > heightThreshold) continue;
                            }

                            if (Array.isArray(info.bbox)) validBboxes.push(...info.bbox);
                            else validBboxes.push(info.bbox);

                            if (primaryPage === null) primaryPage = info.page_number || null;
                        }
                        if (info.text) sourceTexts.push(info.text);
                    }
                }

                if (validBboxes.length > 0) {
                    resolved.bbox = validBboxes;
                    resolved.page_number = primaryPage;
                    resolved.confidence = cell.is_uncertain ? 0.5 : 1.0;
                    resolved.source_text = sourceTexts.join(' ');
                    if (!value && sourceTexts.length > 0) {
                        resolved.value = sourceTexts.join(' ');
                    }
                } else if (refIds.length > 0 && refIds[0]) {
                    resolved.bbox = null;
                    resolved.page_number = null;
                    resolved.confidence = 0.3;
                } else {
                    resolved.bbox = null;
                    resolved.page_number = null;
                    resolved.confidence = 0.0;
                }

                if (cell.is_uncertain) {
                    resolved.is_uncertain = true;
                    resolved.warning_msg = cell.warning_msg || "";
                }

                return resolved;
            } else if (typeof cell === 'string' && cell.trim().startsWith('^C')) {
                const refId = cell.trim();
                const cleanId = refId.replace('^', '');
                if (refMap[cleanId]) {
                    const refInfo = refMap[cleanId];
                    return {
                        value: refInfo.text || "",
                        bbox: refInfo.bbox,
                        page_number: refInfo.page_number,
                        confidence: 1.0,
                        source_text: refInfo.text || "",
                        ref_id: refId
                    };
                } else {
                    return { value: cell, confidence: 0.2, validation_status: "invalid_ref" };
                }
            }
            return cell;
        }

        const result: Record<string, any> = {};
        const guide = engineerOutput.guide_extracted || {};

        for (const [key, rawItem] of Object.entries(guide)) {
            let item = rawItem;
            // 1. 테이블 필드 여부 결정 (모델 정의 또는 출력 형식 기반)
            const isTableByModel = tableFieldKeys.includes(key);
            let isTableByData = Array.isArray(item);

            // LLM이 테이블을 {"value": [...], "ref": "..."}로 잘못 감싸서 반환한 경우 보정
            if (!isTableByData && item && typeof item === 'object' && Array.isArray((item as any).value)) {
                isTableByData = true;
                item = (item as any).value;
            }

            if (isTableByModel || isTableByData) {
                // 테이블(Table) 필드 처리
                const rows: any[] = [];
                const allTableBboxes: number[] = [];
                const pageBBoxes: Record<number, number[]> = {};
                let firstPage: number | null = null;
                const itemsToProcess = Array.isArray(item) ? item : [];

                for (const row of itemsToProcess) {
                    if (row && typeof row === 'object' && !Array.isArray(row)) {
                        const processedRow: any = {};
                        for (const [colKey, cell] of Object.entries(row)) {
                            // 테이블 셀 내 병합은 isTable=true 허용
                            const resolved = resolveRef(cell, true);
                            processedRow[colKey] = resolved;

                            // 테이블 전체 영역 계산 및 페이지별 그룹화를 위해 모든 셀의 bbox 수집
                            if (resolved && typeof resolved === 'object' && resolved.bbox) {
                                if (Array.isArray(resolved.bbox)) {
                                    allTableBboxes.push(...resolved.bbox);

                                    // [NEW] 페이지별 좌표 수집 (Multi-page highlight 지원용)
                                    if (resolved.page_number) {
                                        if (!pageBBoxes[resolved.page_number]) pageBBoxes[resolved.page_number] = [];
                                        pageBBoxes[resolved.page_number].push(...resolved.bbox);
                                    }
                                }
                                if (firstPage === null && resolved.page_number) {
                                    firstPage = resolved.page_number;
                                }
                            }
                        }
                        rows.push(processedRow);
                    } else {
                        rows.push(row);
                    }
                }

                // 테이블 전체 하이라이트 영역 계산 (병합)을 위해 배열 객체에 커스텀 속성 부여
                // isTableByModel 이 true 인 경우에만 수행 (일반 필드 내 다중 결과가 병합되는 것을 방지)
                if (isTableByModel && allTableBboxes.length > 0) {
                    (rows as any)._table_bbox = allTableBboxes;
                    (rows as any)._table_page = firstPage;
                    (rows as any)._table_page_bboxes = pageBBoxes;
                }

                result[key] = rows;
            } else if (item && typeof item === 'object' && 'value' in item) {
                // 일반 필드는 isTable=false 로 타이트하게 병합
                result[key] = resolveRef(item, false);
            } else {
                result[key] = resolveRef({ value: item }, false);
            }
        }

        return { guide_extracted: result };
    }
}
