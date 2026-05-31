import { z } from 'zod';
import { UserObject } from './common';
import dayjs from '@/lib/dayjs';

/**
 * <extraction_model 스키마>
 * id: uuid
 * name: 모델 이름
 * description: 모델 설명
 * fields: 추출할 필드 목록
 * global_rules: 전체 추출 규칙 (LLM 프롬프트용)
 * webhook_url: 추출 완료 후 전송할 URL
 * allowed_groups: 사용 가능한 그룹 ID 목록
 * is_active: 활성화 여부
 * created_at: 만든 날짜
 * created_by: 만든 사람
 * modified_at: 수정된 날짜
 * modified_by: 수정한 사람
 */

export const BaseFieldDefinition = z.object({
  key: z.string().min(1, 'Key is required'),
  label: z.string().min(1, 'Label is required'),
  description: z.string().optional().nullable(),
  rules: z.string().optional().nullable(), // 출력 보정/형태 정의
  type: z.enum(['text', 'number', 'date', 'table']).default('text'),
  is_required: z.boolean().default(false).optional(),
  dictionary_id: z.string().optional().nullable(),
  validation_regex: z.string().optional().nullable(),
});

export type FieldDefinition = z.infer<typeof BaseFieldDefinition> & {
  sub_fields?: FieldDefinition[] | null;
};

export const FieldDefinition: z.ZodType<FieldDefinition> = BaseFieldDefinition.extend({
  sub_fields: z.lazy(() => z.array(FieldDefinition)).optional().nullable(),
});

export const ExtractionModel = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional().nullable(),
  llm_model: z.string().optional().nullable(),
  global_rules: z.string().optional().nullable(),
  data_structure: z.enum(['data', 'table', 'report']).default('data').optional(),
  model_type: z.enum(['extraction', 'comparison']).default('extraction').optional(),
  azure_model_id: z.string().default('prebuilt-layout').optional(),
  webhook_url: z.union([z.string().url(), z.literal('')]).optional().nullable(),
  allowed_groups: z.array(z.string()).optional().nullable(),
  fields: z.array(FieldDefinition).default([]),
  partition_key: z.string().default('model'), //cosmos db partition key 명시적 지정
  is_active: z.boolean().default(true),
  show_in_gallery: z.boolean().default(true).optional(),

  is_super_model: z.boolean().default(false).optional(),
  sub_model_ids: z.array(z.string()).default([]).optional(),

  comparison_settings: z.record(z.string(), z.any()).optional().nullable(),
  excel_columns: z.array(z.record(z.string(), z.any())).optional().nullable(),
  reference_data: z.record(z.string(), z.any()).optional().nullable(),
  transformation_config: z.record(z.string(), z.any()).optional().nullable(),
  beta_features: z.record(z.string(), z.any()).optional().nullable(),

  created_at: z.string().default(() => dayjs().utc().toISOString()),
  created_by: UserObject,
  modified_at: z.string().optional(),
  modified_by: UserObject.optional(),
});

export type ExtractionModel = z.infer<typeof ExtractionModel>;

// --- Requests ---

export const ExtractionModelCreateRequest = ExtractionModel.pick({
  name: true,
  description: true,
  llm_model: true,
  fields: true,
  global_rules: true,
  webhook_url: true,
  allowed_groups: true,
  azure_model_id: true,
  model_type: true,
  data_structure: true,
  show_in_gallery: true,
  comparison_settings: true,
  excel_columns: true,
  reference_data: true,
  transformation_config: true,
  beta_features: true,
  is_super_model: true,
  sub_model_ids: true,
});

export type ExtractionModelCreateRequest = z.infer<typeof ExtractionModelCreateRequest>;

export const ExtractionModelUpdateRequest = ExtractionModel.pick({
  id: true,
}).and(ExtractionModelCreateRequest.partial()).and(z.object({
  is_active: z.boolean().optional(),
  show_in_gallery: z.boolean().optional(),
}));

export type ExtractionModelUpdateRequest = z.infer<typeof ExtractionModelUpdateRequest>;

export const ExtractionModelListRequest = z.object({
  offset: z.coerce.number().nullish().default(0),
  pageSize: z.coerce.number().nullish().default(10),
  keyword: z.string().nullish(), // name or description
  isActive: z.boolean().optional(),
  count: z.coerce.boolean().optional(),
});

export type ExtractionModelListRequest = z.infer<typeof ExtractionModelListRequest>;
