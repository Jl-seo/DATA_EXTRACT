import { z } from 'zod';
import { ContentUnderstandingResource, DocIntelResource, OpenAIResource } from './docIntel';


export const BlobStorageSchema = z.object({
  account_name: z.string(),
  account_key: z.string(),
  container: z.string().optional(),
  custom_public_host: z.string().default(''),
});

const ContentUnderstandingConfigSchema = z
  .union([ContentUnderstandingResource, z.array(ContentUnderstandingResource)])
  .optional()
  .transform((value) => {
    if (!value) return undefined;
    if (Array.isArray(value)) return value[0];
    return value;
  });

const BooleanLikeSchema = z
  .union([z.boolean(), z.literal('true'), z.literal('false')])
  .transform((value) => value === true || value === 'true');

export const DAOMEnvConfig = z.object({
  id: z.string(),
  type: z.enum(['env', 'env-alias']).default('env'),
  alias_for: z.string().optional(),
  alias_overrides: z.any().optional(),

  document_intelligence: z
    .array(DocIntelResource)
    .default([]),
  openai: z
    .array(OpenAIResource)
    .default([]),
  content_understanding: ContentUnderstandingConfigSchema,
  azure_ad: z.object({
    tenant_id: z.string(),
    client_id: z.string(),
    pem_key: z.string(),
    cert_thumbprint: z.string(),
    certPfx: z.string(),
  }),
  cosmos_db: z.object({
    endpoint: z.string(),
    key: z.string(),
    database_id: z.string().default('daom'),
  }),
  blob_storage: BlobStorageSchema,
  temp_blob_storage: BlobStorageSchema,

  diagpt: z.object({
    api_server: z.string().optional(),
    api_key: z.string().optional(),
    admin_api_key: z.string().optional(),
    enabled_mip: z.boolean().default(false),
  }),

  multifile_upload: BooleanLikeSchema.default(false),
  meta_prompt: BooleanLikeSchema.default(false),

  webhook_secret: z.string().optional(),
  connector_api_key: z.string().optional(),
  iframe_allowed_domains: z.array(z.string()).default([]),
});

export type DAOMEnvConfig = z.infer<typeof DAOMEnvConfig>;

export const DAOMEnvConfigInput = DAOMEnvConfig.extend({
  azure_ad: DAOMEnvConfig.shape.azure_ad.extend({
    pem_key: z.string().optional(),
    cert_thumbprint: z.string().optional(),
  }),
  temp_blob_storage: BlobStorageSchema.optional(),
});
