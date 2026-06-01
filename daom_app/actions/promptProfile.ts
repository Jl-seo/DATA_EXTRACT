'use server';
import 'server-only';

import { SqlParameter } from '@azure/cosmos';

import BlobStorageService from '@/services/BlobStorageService';
import CosmosDBService from '@/services/CosmosDBService';
import { DocIntelligenceService } from '@/services/DocIntelligenceService';
import { OpenAIService } from '@/services/OpenAIService';
import PermissionService from '@/services/PermissionService';
import { getCurrentEnvConfig } from '@/lib/env';
import { ExtractionModel, type FieldDefinition } from '@/scheme/extractionModel';
import { File, SOURCE_TYPE } from '@/scheme/file';
import {
  ConfirmPromptDraftRequest,
  GenerateMetaPromptDraftRequest,
  PromptModelPatch,
  PromptProfile,
  PromptSelection,
  PromptSelectionSnippet,
  PromptVersion,
  UpdatePromptDraftRequest,
} from '@/scheme/promptProfile';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getPageNumber(page: unknown): number | null {
  if (!isRecord(page)) return null;
  const candidates = [
    toFiniteNumber(page.pageNumber),
    toFiniteNumber(page.page_number),
    toFiniteNumber(page.pageIndex),
    toFiniteNumber(page.page_index),
  ].filter((value): value is number => value !== null);

  if (candidates.length === 0) return null;
  const value = Math.floor(candidates[0]);
  return value >= 1 ? value : value + 1;
}

function getPageDimension(page: unknown, key: 'width' | 'height'): number {
  if (!isRecord(page)) return 1;
  const raw =
    toFiniteNumber(page[key]) ??
    toFiniteNumber(page[key === 'width' ? 'pageWidth' : 'pageHeight']) ??
    toFiniteNumber(page[key === 'width' ? 'page_width' : 'page_height']);
  return raw && raw > 0 ? raw : 1;
}

function normalizePolygon(rawPolygon: unknown): number[] {
  if (!Array.isArray(rawPolygon)) return [];
  if (rawPolygon.length === 0) return [];

  if (rawPolygon.every((entry) => typeof entry === 'number')) {
    const numeric = rawPolygon.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry));
    return numeric.length >= 8 ? numeric : [];
  }

  const points: number[] = [];
  rawPolygon.forEach((entry) => {
    if (!isRecord(entry)) return;
    const x = toFiniteNumber(entry.x);
    const y = toFiniteNumber(entry.y);
    if (x === null || y === null) return;
    points.push(x, y);
  });
  return points.length >= 8 ? points : [];
}

function wordInsideSelection(
  selection: PromptSelection,
  polygon: number[],
  pageWidth: number,
  pageHeight: number
): boolean {
  if (polygon.length < 8) return false;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 1 < polygon.length; i += 2) {
    xs.push(polygon[i]);
    ys.push(polygon[i + 1]);
  }
  if (xs.length === 0 || ys.length === 0) return false;

  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;

  const minX = (selection.bbox.x / 1000) * pageWidth;
  const maxX = ((selection.bbox.x + selection.bbox.width) / 1000) * pageWidth;
  const minY = (selection.bbox.y / 1000) * pageHeight;
  const maxY = ((selection.bbox.y + selection.bbox.height) / 1000) * pageHeight;

  return centerX >= minX && centerX <= maxX && centerY >= minY && centerY <= maxY;
}

function buildSelectionSnippetsFromAnalyzeResult(
  analyzeResult: { pages?: unknown[] },
  selections: PromptSelection[]
): PromptSelectionSnippet[] {
  const pages = Array.isArray(analyzeResult.pages) ? analyzeResult.pages : [];
  const snippets: PromptSelectionSnippet[] = [];

  selections.forEach((selection) => {
    const page = pages.find((pageItem) => getPageNumber(pageItem) === selection.page_number);
    if (!page || !isRecord(page)) {
      snippets.push({
        selection_id: selection.id,
        page_number: selection.page_number,
        text: '',
        word_count: 0,
      });
      return;
    }

    const pageWidth = getPageDimension(page, 'width');
    const pageHeight = getPageDimension(page, 'height');
    const wordsRaw = Array.isArray(page.words) ? page.words : [];

    const words: string[] = [];
    wordsRaw.forEach((wordItem) => {
      if (!isRecord(wordItem)) return;
      const content = typeof wordItem.content === 'string' ? wordItem.content.trim() : '';
      if (!content) return;
      const polygon = normalizePolygon(wordItem.polygon);
      if (!wordInsideSelection(selection, polygon, pageWidth, pageHeight)) return;
      words.push(content);
    });

    snippets.push({
      selection_id: selection.id,
      page_number: selection.page_number,
      text: words.join(' ').trim(),
      word_count: words.length,
    });
  });

  return snippets;
}

async function assertModelAccess(permissionService: PermissionService, modelId: string) {
  const role = await permissionService.getGlobalRole();
  if (!role || role === 'none') {
    throw new Error('Unauthorized');
  }
  if (role === 'admin') return;

  const authorizedModelIds = await permissionService.getAuthorizedModelIds();
  if (authorizedModelIds.includes('*')) return;
  if (!authorizedModelIds.includes(modelId)) {
    throw new Error('Unauthorized model access');
  }
}

async function getProfileByModelId(modelId: string) {
  const envConfig = await getCurrentEnvConfig();
  const cosmosDBService = new CosmosDBService(envConfig);
  const container = await cosmosDBService.getContainer('prompt_profiles');
  const query = {
    query: `SELECT * FROM c WHERE c.partition_key = 'prompt_profile' AND c.model_id = @modelId OFFSET 0 LIMIT 1`,
    parameters: [{ name: '@modelId', value: modelId }] as SqlParameter[],
  };
  const { resources } = await container.items.query(query, { partitionKey: 'prompt_profile' }).fetchAll();
  const first = resources[0];
  if (!first) return null;
  return PromptProfile.parse(first);
}

export async function getPromptProfile(modelId: string) {
  const envConfig = await getCurrentEnvConfig();
  const permissionService = new PermissionService(envConfig);
  await assertModelAccess(permissionService, modelId);
  return await getProfileByModelId(modelId);
}

function getNextVersionNumber(versions: PromptVersion[]): number {
  if (versions.length === 0) return 1;
  return Math.max(...versions.map((version) => version.version)) + 1;
}

function normalizeFieldKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractCurrentFieldRules(fields: FieldDefinition[]): Record<string, string> {
  const rulesMap: Record<string, string> = {};

  const walk = (nodes: FieldDefinition[]) => {
    nodes.forEach((field) => {
      const rule = typeof field.rules === 'string' ? field.rules.trim() : '';
      if (rule) {
        rulesMap[field.key] = rule;
      }
      if (Array.isArray(field.sub_fields) && field.sub_fields.length > 0) {
        walk(field.sub_fields);
      }
    });
  };

  walk(fields);
  return rulesMap;
}

type FieldGuideItem = {
  key: string;
  label: string;
  type: string;
  current_rule: string;
  parent_table_key?: string;
};

function buildFieldGuideItems(fields: FieldDefinition[], parentTableKey?: string): FieldGuideItem[] {
  const items: FieldGuideItem[] = [];
  fields.forEach((field) => {
    items.push({
      key: field.key,
      label: field.label,
      type: field.type,
      current_rule: typeof field.rules === 'string' ? field.rules : '',
      parent_table_key: parentTableKey,
    });

    if (Array.isArray(field.sub_fields) && field.sub_fields.length > 0) {
      items.push(...buildFieldGuideItems(field.sub_fields, field.key));
    }
  });
  return items;
}

function collectAllowedFieldKeys(fields: FieldDefinition[]): Set<string> {
  const keys = new Set<string>();
  const walk = (nodes: FieldDefinition[]) => {
    nodes.forEach((field) => {
      keys.add(field.key);
      if (Array.isArray(field.sub_fields) && field.sub_fields.length > 0) {
        walk(field.sub_fields);
      }
    });
  };
  walk(fields);
  return keys;
}

function sanitizeFieldRules(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  Object.entries(value).forEach(([key, raw]) => {
    if (typeof raw !== 'string') return;
    const rule = raw.trim();
    if (!rule) return;
    result[key] = rule;
  });
  return result;
}

function sanitizeReferenceDataPatch(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return { ...value };
}

function hasAnyFieldRule(fieldRules: Record<string, string>): boolean {
  return Object.keys(fieldRules).length > 0;
}

function filterFieldRulesByAllowedKeys(
  fieldRules: Record<string, string>,
  allowedKeys: Set<string>
): Record<string, string> {
  const filtered: Record<string, string> = {};
  Object.entries(fieldRules).forEach(([key, rule]) => {
    if (allowedKeys.has(key)) {
      filtered[key] = rule;
    }
  });
  return filtered;
}

function resolveFieldRuleForKey(fieldKey: string, fieldRules: Record<string, string>): string | undefined {
  const direct = fieldRules[fieldKey];
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }

  const normalizedKey = normalizeFieldKey(fieldKey);
  const matchedEntry = Object.entries(fieldRules).find(([key]) => normalizeFieldKey(key) === normalizedKey);
  if (!matchedEntry) return undefined;
  const rule = matchedEntry[1].trim();
  return rule || undefined;
}

function applyFieldRulesToFields(fields: FieldDefinition[], fieldRules: Record<string, string>): FieldDefinition[] {
  return fields.map((field) => {
    const updatedRule = resolveFieldRuleForKey(field.key, fieldRules);
    const nextSubFields = Array.isArray(field.sub_fields) && field.sub_fields.length > 0
      ? applyFieldRulesToFields(field.sub_fields, fieldRules)
      : field.sub_fields;

    return {
      ...field,
      rules: updatedRule ?? field.rules,
      sub_fields: nextSubFields ?? undefined,
    };
  });
}

function mergeReferenceData(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  Object.entries(patch).forEach(([key, patchValue]) => {
    const baseValue = result[key];
    if (isRecord(baseValue) && isRecord(patchValue)) {
      result[key] = mergeReferenceData(baseValue, patchValue);
      return;
    }
    result[key] = patchValue;
  });

  return result;
}

type OutputTemplateValue =
  | 'string or null'
  | OutputTemplateObject
  | OutputTemplateObject[];

interface OutputTemplateObject {
  [key: string]: OutputTemplateValue;
}

function buildFieldOutputTemplate(field: FieldDefinition): OutputTemplateValue {
  if (field.type !== 'table') {
    return 'string or null';
  }

  const subFields = Array.isArray(field.sub_fields) ? field.sub_fields : [];
  const rowTemplate: Record<string, OutputTemplateValue> = {};
  subFields.forEach((subField) => {
    rowTemplate[subField.key] = buildFieldOutputTemplate(subField);
  });

  return [rowTemplate];
}

function buildOutputTemplateFromModelFields(fields: FieldDefinition[]): Record<string, OutputTemplateValue> {
  const template: Record<string, OutputTemplateValue> = {};
  fields.forEach((field) => {
    template[field.key] = buildFieldOutputTemplate(field);
  });
  return template;
}

function getActivePromptVersion(profile: PromptProfile | null): PromptVersion | null {
  if (!profile?.active_version_id) return null;
  const version = profile.versions.find((item) => item.id === profile.active_version_id);
  return version || null;
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];
  if (trimmed.startsWith('```')) {
    const withoutFence = trimmed
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '');
    candidates.push(withoutFence.trim());
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch {
      // continue
    }
  }

  return null;
}

function buildFallbackPromptText(model: ExtractionModel): string {
  const lines: string[] = [];
  const outputTemplate = buildOutputTemplateFromModelFields(model.fields);

  lines.push('문서에서 모델 필드 기준으로 값을 추출하세요.');
  lines.push('문서에 명시된 값만 사용하고 추정하지 마세요.');
  lines.push('');
  lines.push('[추출 필드]');
  model.fields.forEach((field, index) => {
    const fieldRule = typeof field.rules === 'string' && field.rules.trim() ? ` / 규칙: ${field.rules.trim()}` : '';
    lines.push(`${index + 1}. ${field.label} (${field.key})${fieldRule}`);
    if (Array.isArray(field.sub_fields) && field.sub_fields.length > 0) {
      field.sub_fields.forEach((subField) => {
        const subRule = typeof subField.rules === 'string' && subField.rules.trim() ? ` / 규칙: ${subField.rules.trim()}` : '';
        lines.push(`  - ${subField.label} (${subField.key})${subRule}`);
      });
    }
  });
  if (typeof model.global_rules === 'string' && model.global_rules.trim()) {
    lines.push('');
    lines.push('[기존 전역 규칙]');
    lines.push(model.global_rules.trim());
  }
  lines.push('');
  lines.push('[출력 형식]');
  lines.push('아래 JSON 구조를 필드 키 그대로 사용하세요. 임의 키를 추가하지 마세요.');
  lines.push(JSON.stringify(outputTemplate, null, 2));
  return lines.join('\n');
}

async function deriveFieldRulesFromPromptText(options: {
  model: ExtractionModel;
  promptText: string;
  fallbackFieldRules: Record<string, string>;
}) {
  if (!options.promptText.trim()) {
    return options.fallbackFieldRules;
  }

  const envConfig = await getCurrentEnvConfig();
  const openaiService = new OpenAIService(envConfig);
  const fieldGuide = buildFieldGuideItems(options.model.fields);
  const allowedKeys = collectAllowedFieldKeys(options.model.fields);

  const messages = [
    {
      role: 'system' as const,
      content: [
        '당신은 extraction model 필드 규칙 분해기입니다.',
        '입력된 프롬프트 본문을 읽고, 각 모델 필드 key에 해당하는 규칙을 분해하세요.',
        '반드시 field key 기준으로만 응답하세요.',
        '응답은 JSON만 반환하세요.',
      ].join('\n'),
    },
    {
      role: 'user' as const,
      content: [
        '[모델 필드]',
        JSON.stringify(fieldGuide, null, 2),
        '',
        '[프롬프트 본문]',
        options.promptText,
        '',
        '[기존 분해 결과]',
        JSON.stringify(options.fallbackFieldRules, null, 2),
        '',
        '아래 JSON만 반환:',
        '{',
        '  "field_rules": {',
        '    "field_key": "rule"',
        '  }',
        '}',
        '',
        '규칙:',
        '- field_rules에는 모델 필드 key만 사용',
        '- table의 sub_fields도 key 단위로 매핑',
        '- 해당 필드와 직접 관련된 지침이 없으면 key를 생략',
        '- 설명(label)과 키를 함께 보고 매핑',
      ].join('\n'),
    },
  ];

  try {
    const response = await openaiService.getCompletion(messages, undefined, true, 2048);
    const content = response.choices[0]?.message?.content;
    if (!content) {
      return filterFieldRulesByAllowedKeys(options.fallbackFieldRules, allowedKeys);
    }
    const parsed = JSON.parse(content) as { field_rules?: unknown };
    const derived = sanitizeFieldRules(parsed.field_rules);
    const filteredDerived = filterFieldRulesByAllowedKeys(derived, allowedKeys);
    if (hasAnyFieldRule(filteredDerived)) {
      return filteredDerived;
    }
    return filterFieldRulesByAllowedKeys(options.fallbackFieldRules, allowedKeys);
  } catch {
    return filterFieldRulesByAllowedKeys(options.fallbackFieldRules, allowedKeys);
  }
}

async function buildMetaPrompt(options: {
  model: ExtractionModel;
  selections: PromptSelection[];
  snippets: PromptSelectionSnippet[];
  generationNote?: string;
  activePromptText?: string;
}) {
  const envConfig = await getCurrentEnvConfig();
  const openaiService = new OpenAIService(envConfig);
  const outputTemplate = buildOutputTemplateFromModelFields(options.model.fields);
  const fieldGuide = buildFieldGuideItems(options.model.fields).map((item) => ({
    key: item.key,
    label: item.label,
    type: item.type,
    rules: item.current_rule,
    parent_table_key: item.parent_table_key,
  }));
  const currentFieldRules = extractCurrentFieldRules(options.model.fields);
  const currentReferenceData = isRecord(options.model.reference_data) ? options.model.reference_data : {};

  const messages = [
    {
      role: 'system' as const,
      content: [
        '당신은 CU(Content Understanding) 전용 메타 프롬프트 설계 전문가입니다.',
        '목표는 여러 문서에서 재사용 가능한 추출 프롬프트를 만드는 것입니다.',
        '기존에 저장된 설정이 있다면 최대한 유지하고, 필요한 부분만 보완하세요.',
        '응답은 반드시 JSON으로 반환하세요.',
      ].join('\n'),
    },
    {
      role: 'user' as const,
      content: [
        '다음 정보를 기반으로 메타 프롬프트를 생성해 주세요.',
        '',
        '[모델 필드]',
        JSON.stringify(fieldGuide, null, 2),
        '',
        '[선택 영역]',
        JSON.stringify(options.selections, null, 2),
        '',
        '[선택 영역 OCR 스니펫]',
        JSON.stringify(options.snippets, null, 2),
        '',
        '[기존 모델 전역 규칙(global_rules)]',
        options.model.global_rules || '',
        '',
        '[기존 모델 필드별 규칙(field.rules)]',
        JSON.stringify(currentFieldRules, null, 2),
        '',
        '[기존 모델 참고데이터(reference_data)]',
        JSON.stringify(currentReferenceData, null, 2),
        '',
        '[기존 active 메타 프롬프트]',
        options.activePromptText || '',
        '',
        '[필수 출력 JSON 형식(모델 추출 필드와 동일)]',
        JSON.stringify(outputTemplate, null, 2),
        '',
        options.generationNote ? `[추가 지시]\n${options.generationNote}` : '[추가 지시]\n없음',
        '',
        '반드시 아래 JSON 스키마로 반환:',
        '{',
        '  "prompt_text": "string",',
        '  "design_summary": "string",',
        '  "global_rules": "string",',
        '  "field_rules": { "field_key": "rule string" },',
        '  "reference_data_patch": { "key": "value" }',
        '}',
        '',
        '중요 규칙:',
        '- [선택 영역]의 field_key가 있으면 해당 키를 우선 기준으로 해석',
        '- field_rules는 기존 필드 key에 대해서만 작성',
        '- reference_data_patch는 전체 교체가 아니라 추가/보정분만 작성',
        '- prompt_text 안의 출력 형식은 반드시 위 [필수 출력 JSON 형식]과 동일한 키 구조를 사용',
        '- 예시 JSON을 임의로 만들지 말고, 모델 필드 키 기준으로만 작성',
      ].join('\n'),
    },
  ];

  let parsed: {
    prompt_text?: unknown;
    design_summary?: unknown;
    field_rules?: unknown;
    reference_data_patch?: unknown;
  } | null = null;

  let lastErrorMessage = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await openaiService.getCompletion(messages, undefined, true, 4096);
      const content = response.choices[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        lastErrorMessage = `empty_content_attempt_${attempt}`;
        continue;
      }
      const jsonObject = tryParseJsonObject(content);
      if (!jsonObject) {
        lastErrorMessage = `invalid_json_attempt_${attempt}`;
        continue;
      }
      parsed = jsonObject as {
        prompt_text?: unknown;
        design_summary?: unknown;
        field_rules?: unknown;
        reference_data_patch?: unknown;
      };
      break;
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : `unknown_error_attempt_${attempt}`;
    }
  }

  const promptText =
    parsed && typeof parsed.prompt_text === 'string' && parsed.prompt_text.trim()
      ? parsed.prompt_text.trim()
      : buildFallbackPromptText(options.model);
  const fieldRules = parsed ? sanitizeFieldRules(parsed.field_rules) : {};
  const referenceDataPatch = parsed ? sanitizeReferenceDataPatch(parsed.reference_data_patch) : {};
  const resolvedFieldRules = await deriveFieldRulesFromPromptText({
    model: options.model,
    promptText,
    fallbackFieldRules: fieldRules,
  });
  const modelPatch = PromptModelPatch.parse({
    global_rules: promptText,
    field_rules: resolvedFieldRules,
    reference_data_patch: referenceDataPatch,
  });

  return {
    promptText,
    designSummary:
      parsed && typeof parsed.design_summary === 'string'
        ? parsed.design_summary.trim()
        : `auto_fallback:${lastErrorMessage || 'empty_response'}`,
    modelPatch,
  };
}

export async function generateMetaPromptDraft(input: GenerateMetaPromptDraftRequest) {
  const req = GenerateMetaPromptDraftRequest.parse(input);
  const envConfig = await getCurrentEnvConfig();
  const permissionService = new PermissionService(envConfig);
  const user = await permissionService.getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  await assertModelAccess(permissionService, req.model_id);

  const cosmosDBService = new CosmosDBService(envConfig);
  const blobStorageService = new BlobStorageService(envConfig);
  const docIntelService = new DocIntelligenceService(envConfig);

  const modelContainer = await cosmosDBService.getContainer('extraction_models');
  const { resource: modelRaw } = await modelContainer.item(req.model_id, 'model').read<ExtractionModel>();
  if (!modelRaw) throw new Error('Model not found');
  const model = ExtractionModel.parse(modelRaw);
  if (!Array.isArray(model.fields) || model.fields.length === 0) {
    throw new Error('추출 필드를 먼저 정의해 주세요. Draft 생성은 기존 필드 기준 매핑으로 동작합니다.');
  }
  const existingProfile = await getProfileByModelId(req.model_id);
  const activeVersion = getActivePromptVersion(existingProfile);

  const filesContainer = await cosmosDBService.getContainer('files');
  const { resource: fileRaw } = await filesContainer.item(req.file_id, SOURCE_TYPE).read<File>();
  if (!fileRaw) throw new Error('File not found');
  const file = File.parse(fileRaw);

  const actualBlobPath = `${envConfig.id}/${file.blob_path}`;
  const { sasUrl, cleanup } = await blobStorageService.generateTempSasUrl(
    actualBlobPath,
    BlobStorageService.SAS.READ(30)
  );

  try {
    const analyzeResult = await docIntelService.analyzeDocument(sasUrl, 'prebuilt-layout');
    const snippets = buildSelectionSnippetsFromAnalyzeResult(analyzeResult, req.selections);
    const generated = await buildMetaPrompt({
      model,
      selections: req.selections,
      snippets,
      generationNote: req.generation_note,
      activePromptText: activeVersion?.prompt_text,
    });

    const profileContainer = await cosmosDBService.getContainer('prompt_profiles');

    const nextVersionNumber = getNextVersionNumber(existingProfile?.versions || []);
    const draftVersion = PromptVersion.parse({
      id: crypto.randomUUID(),
      version: nextVersionNumber,
      status: 'draft',
      prompt_text: generated.promptText,
      source_file_id: file.id,
      source_filename: file.filename,
      selections: req.selections,
      snippets,
      generation_note: generated.designSummary || req.generation_note || '',
      model_patch: generated.modelPatch,
      created_by: {
        name: user.name,
        object_id: user.oid,
        upn: user.upn,
      },
    });

    if (!existingProfile) {
      const createdProfile = PromptProfile.parse({
        partition_key: 'prompt_profile',
        model_id: req.model_id,
        model_name: model.name,
        active_version_id: undefined,
        versions: [draftVersion],
        created_by: {
          name: user.name,
          object_id: user.oid,
          upn: user.upn,
        },
        modified_by: {
          name: user.name,
          object_id: user.oid,
          upn: user.upn,
        },
      });
      await profileContainer.items.create(createdProfile);
      return { profile: createdProfile, draftVersion };
    }

    const updatedProfile = PromptProfile.parse({
      ...existingProfile,
      versions: [...existingProfile.versions, draftVersion],
      modified_at: new Date().toISOString(),
      modified_by: {
        name: user.name,
        object_id: user.oid,
        upn: user.upn,
      },
    });

    await profileContainer.item(updatedProfile.id, 'prompt_profile').replace(updatedProfile);
    return { profile: updatedProfile, draftVersion };
  } finally {
    await cleanup().catch(() => undefined);
  }
}

export async function confirmMetaPromptDraft(input: ConfirmPromptDraftRequest) {
  const req = ConfirmPromptDraftRequest.parse(input);
  const envConfig = await getCurrentEnvConfig();
  const permissionService = new PermissionService(envConfig);
  const user = await permissionService.getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  await assertModelAccess(permissionService, req.model_id);

  const cosmosDBService = new CosmosDBService(envConfig);
  const profileContainer = await cosmosDBService.getContainer('prompt_profiles');
  const profile = await getProfileByModelId(req.model_id);
  if (!profile) throw new Error('Prompt profile not found');

  const draftTarget = profile.versions.find((version) => version.id === req.version_id);
  if (!draftTarget) throw new Error('Draft version not found');
  if (draftTarget.status !== 'draft') {
    throw new Error('선택한 버전은 draft 상태가 아닙니다.');
  }

  const modelContainer = await cosmosDBService.getContainer('extraction_models');
  const { resource: modelRaw } = await modelContainer.item(req.model_id, 'model').read<ExtractionModel>();
  if (!modelRaw) throw new Error('Model not found');
  const model = ExtractionModel.parse(modelRaw);

  const modelPatch = PromptModelPatch.parse({
    global_rules: draftTarget.prompt_text,
    field_rules: draftTarget.model_patch?.field_rules || {},
    reference_data_patch: draftTarget.model_patch?.reference_data_patch || {},
  });
  const mergedReferenceData = Object.keys(modelPatch.reference_data_patch).length > 0
    ? mergeReferenceData(
      isRecord(model.reference_data) ? model.reference_data : {},
      modelPatch.reference_data_patch
    )
    : model.reference_data;
  const now = new Date().toISOString();
  const syncedModel = ExtractionModel.parse({
    ...model,
    global_rules: draftTarget.prompt_text,
    fields: applyFieldRulesToFields(model.fields, modelPatch.field_rules),
    reference_data: mergedReferenceData,
    modified_at: now,
    modified_by: {
      name: user.name,
      object_id: user.oid,
      upn: user.upn,
    },
  });

  await modelContainer.item(syncedModel.id, 'model').replace(syncedModel);

  const normalizedVersions = profile.versions.map((version) => {
    if (version.id === req.version_id) {
      return PromptVersion.parse({
        ...version,
        status: 'active',
        confirmed_at: now,
        confirmed_by: {
          name: user.name,
          object_id: user.oid,
          upn: user.upn,
        },
      });
    }
    if (version.status === 'active') {
      return PromptVersion.parse({
        ...version,
        status: 'archived',
      });
    }
    return version;
  });

  const updatedProfile = PromptProfile.parse({
    ...profile,
    active_version_id: req.version_id,
    versions: normalizedVersions,
    modified_at: now,
    modified_by: {
      name: user.name,
      object_id: user.oid,
      upn: user.upn,
    },
  });

  await profileContainer.item(updatedProfile.id, 'prompt_profile').replace(updatedProfile);
  return { profile: updatedProfile };
}

export async function updateMetaPromptDraft(input: UpdatePromptDraftRequest) {
  const req = UpdatePromptDraftRequest.parse(input);
  const envConfig = await getCurrentEnvConfig();
  const permissionService = new PermissionService(envConfig);
  const user = await permissionService.getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  await assertModelAccess(permissionService, req.model_id);

  const cosmosDBService = new CosmosDBService(envConfig);
  const profileContainer = await cosmosDBService.getContainer('prompt_profiles');
  const profile = await getProfileByModelId(req.model_id);
  if (!profile) throw new Error('Prompt profile not found');

  const nextVersions = profile.versions.map((version) => {
    if (version.id !== req.version_id) return version;
    if (version.status !== 'draft') {
      throw new Error('draft 상태의 버전만 수정할 수 있습니다.');
    }
    return PromptVersion.parse({
      ...version,
      prompt_text: req.prompt_text,
      model_patch: {
        global_rules: req.prompt_text,
        field_rules: version.model_patch?.field_rules || {},
        reference_data_patch: version.model_patch?.reference_data_patch || {},
      },
    });
  });

  const updatedProfile = PromptProfile.parse({
    ...profile,
    versions: nextVersions,
    modified_at: new Date().toISOString(),
    modified_by: {
      name: user.name,
      object_id: user.oid,
      upn: user.upn,
    },
  });
  await profileContainer.item(updatedProfile.id, 'prompt_profile').replace(updatedProfile);
  return { profile: updatedProfile };
}
