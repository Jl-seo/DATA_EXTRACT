import { z } from 'zod';
import dayjs from '@/lib/dayjs';
import { UserObject } from './common';

export const PROMPT_PROFILE_PARTITION_KEY = 'prompt_profile' as const;

export const SelectionBBox = z.object({
  x: z.number().min(0).max(1000),
  y: z.number().min(0).max(1000),
  width: z.number().min(0).max(1000),
  height: z.number().min(0).max(1000),
});

export type SelectionBBox = z.infer<typeof SelectionBBox>;

export const PromptSelection = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  page_number: z.number().int().min(1),
  bbox: SelectionBBox,
  field_key: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).default('영역'),
  note: z.string().trim().optional(),
  order: z.number().int().min(0).default(0),
});

export type PromptSelection = z.infer<typeof PromptSelection>;

export const PromptSelectionSnippet = z.object({
  selection_id: z.string(),
  page_number: z.number().int().min(1),
  text: z.string(),
  word_count: z.number().int().min(0),
});

export type PromptSelectionSnippet = z.infer<typeof PromptSelectionSnippet>;

export const PromptVersionStatus = z.enum(['draft', 'active', 'archived']);
export type PromptVersionStatus = z.infer<typeof PromptVersionStatus>;

export const PromptModelPatch = z.object({
  global_rules: z.string().optional(),
  field_rules: z.record(z.string(), z.string()).default({}),
  reference_data_patch: z.record(z.string(), z.unknown()).default({}),
});

export type PromptModelPatch = z.infer<typeof PromptModelPatch>;

export const PromptVersion = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  version: z.number().int().min(1),
  status: PromptVersionStatus,
  prompt_text: z.string(),
  source_file_id: z.string(),
  source_filename: z.string(),
  selections: z.array(PromptSelection).default([]),
  snippets: z.array(PromptSelectionSnippet).default([]),
  generation_note: z.string().optional(),
  model_patch: PromptModelPatch.optional(),
  created_at: z.string().default(() => dayjs().utc().toISOString()),
  created_by: UserObject,
  confirmed_at: z.string().optional(),
  confirmed_by: UserObject.optional(),
});

export type PromptVersion = z.infer<typeof PromptVersion>;

export const PromptProfile = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  partition_key: z.literal(PROMPT_PROFILE_PARTITION_KEY).default(PROMPT_PROFILE_PARTITION_KEY),
  model_id: z.string(),
  model_name: z.string().optional(),
  active_version_id: z.string().optional(),
  versions: z.array(PromptVersion).default([]),
  created_at: z.string().default(() => dayjs().utc().toISOString()),
  created_by: UserObject,
  modified_at: z.string().default(() => dayjs().utc().toISOString()),
  modified_by: UserObject,
});

export type PromptProfile = z.infer<typeof PromptProfile>;

export const GenerateMetaPromptDraftRequest = z.object({
  model_id: z.string().trim().min(1),
  file_id: z.string().trim().min(1),
  selections: z.array(PromptSelection).min(1),
  generation_note: z.string().trim().optional(),
});

export type GenerateMetaPromptDraftRequest = z.infer<typeof GenerateMetaPromptDraftRequest>;

export const ConfirmPromptDraftRequest = z.object({
  model_id: z.string().trim().min(1),
  version_id: z.string().trim().min(1),
});

export type ConfirmPromptDraftRequest = z.infer<typeof ConfirmPromptDraftRequest>;

export const UpdatePromptDraftRequest = z.object({
  model_id: z.string().trim().min(1),
  version_id: z.string().trim().min(1),
  prompt_text: z.string().trim().min(1),
});

export type UpdatePromptDraftRequest = z.infer<typeof UpdatePromptDraftRequest>;
