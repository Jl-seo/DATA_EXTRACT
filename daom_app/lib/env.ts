import 'server-only';

import { CosmosClient, FeedResponse } from '@azure/cosmos';
import { headers } from 'next/headers';
import { experimental_taintObjectReference, experimental_taintUniqueValue } from 'react';
import { mergeDeep } from 'remeda';
import { z } from 'zod';

import { DAOMEnvConfig, DAOMEnvConfigInput } from '@/scheme/env';

import { parsePfx } from '@/utils/cert';

import { readFileSync } from 'fs';
import { resetEnvCache } from './cache';
import { getRedisClient } from '@/utils/redis';

const TAINT_MESSAGE = 'Do not pass secure object/values directly to client.';

export async function getCurrentEnvConfig() {
  const id = await getRawEnvId();
  const config = await getConfigById(id);
  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLegacyEnvConfig(data: unknown): unknown {
  if (!isRecord(data)) return data;

  const normalized: Record<string, unknown> = { ...data };

  const normalizeArrayField = (key: string) => {
    const raw = normalized[key];
    if (raw === undefined || raw === null) return;
    if (Array.isArray(raw)) return;
    if (isRecord(raw)) {
      normalized[key] = [raw];
    }
  };

  normalizeArrayField('document_intelligence');
  normalizeArrayField('openai');

  const rawCU = normalized.content_understanding;
  if (Array.isArray(rawCU)) {
    normalized.content_understanding = rawCU[0];
  } else if (isRecord(rawCU)) {
    const resources = rawCU.resources;
    if (Array.isArray(resources)) {
      normalized.content_understanding = resources[0];
    }
  }

  const rawMetaPrompt = normalized['meta-prompt'];
  if (rawMetaPrompt !== undefined && normalized.meta_prompt === undefined) {
    normalized.meta_prompt = rawMetaPrompt;
  }

  return normalized;
}

function parseDAOMEnvConfig(data: unknown) {
  const normalized = normalizeLegacyEnvConfig(data);
  const inputResult = DAOMEnvConfigInput.safeParse(normalized);
  if (!inputResult.success) {
    console.error(
      'Failed to parse DAOMEnvConfigInput:',
      inputResult.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }))
    );
    throw inputResult.error;
  }
  const input = inputResult.data;

  if (!input.azure_ad.pem_key || !input.azure_ad.cert_thumbprint) {
    const pfx = parsePfx(input.azure_ad.certPfx);

    input.azure_ad.pem_key = `${pfx.certificatePem}\n${pfx.privateKey}`;
    input.azure_ad.cert_thumbprint = pfx.thumbprint;
  }

  if (!input.temp_blob_storage) {
    input.temp_blob_storage = input.blob_storage;
  }

  return DAOMEnvConfig.parse(input);
}

export type DAOMEnvConfigInput = z.input<typeof DAOMEnvConfig>;

let rootCosmosClient: CosmosClient | null = null;

export function getRootCosmosClient() {
  if (!rootCosmosClient) {
    rootCosmosClient = new CosmosClient({
      endpoint: process.env.COSMOS_DB_ENDPOINT as string,
      key: process.env.COSMOS_DB_KEY as string,
    });
  }

  return rootCosmosClient;
}

export async function resetCurrentEnvCache() {
  const id = await getCurrentEnvId();
  await resetEnvCache(id);
}

export async function getRootCosmosContainer(containerId: string) {
  const cosmosClient = getRootCosmosClient();

  const container = (
    await cosmosClient
      .database(process.env.COSMOS_DB_NAME ?? 'dadam_root_dev')
      .containers.createIfNotExists({
        id: containerId,
      })
  ).container;
  return container;
}

/**
 * Hostname 기반으로 Env ID 반환(내부용)
 * @returns string
 */
export async function getRawEnvId() {
  if (process.env.daom_FORCE_ENVCONFIG) {
    return process.env.daom_FORCE_ENVCONFIG;
  }

  const heads = await headers();
  const id = (heads.get('host') ?? '').split(':')[0];

  return id;
}

/**
 * 현재 Env Config 기준으로 Env ID 반환
 * @returns string
 */
export async function getCurrentEnvId() {
  const config = await getCurrentEnvConfig();
  return config.id;
}

async function getLocalConfig() {
  let config = {
    id: process.env.ID ?? 'localhost',
  };

  try {
    config = {
      ...config,
      ...JSON.parse(readFileSync('env.development.json').toString()),
    };
  } catch (err) {
    /* empty */
  }

  try {
    config = {
      ...config,
      ...JSON.parse(readFileSync('env.local.json').toString()),
    };
  } catch (err) {
    /* empty */
  }

  try {
    const result = parseDAOMEnvConfig(config);
    deepTaintConfig(result);
    return result;
  } catch (err) {
    console.error('Failed to parse local config');
    console.error(err);
    throw err;
  }
}

async function getConfigById(id: string) {
  if (process.env.APP_FORCE_LOCALCONFIG) {
    return getLocalConfig();
  }

  const envCacheKey = `@daom_app/tenant_config_cache/${id}`;

  const redis = getRedisClient();

  // const redlock = getRedlock();

  const envCache = await redis.get(envCacheKey);

  if (envCache) {
    try {
      return parseDAOMEnvConfig(JSON.parse(envCache));
    } catch (err) {
      // Invalid cache
    }
  }

  const container = await getRootCosmosContainer('env_config');

  let r = (await container.items
    .query({
      query: `SELECT * FROM c WHERE c.id = @id`,
      parameters: [
        {
          name: '@id',
          value: id,
        },
      ],
    })
    .fetchNext()) as FeedResponse<DAOMEnvConfigInput>;

  let aliasInput: DAOMEnvConfigInput | undefined;
  let configInput: DAOMEnvConfigInput = r.resources[0];

  if (!r.resources[0]) {
    throw new Error(`env not found for ${id}`);
  }

  if (r.resources[0].type === 'env-alias') {
    aliasInput = r.resources[0];

    if (!aliasInput.alias_for) {
      throw new Error('alias_for field is required.');
    }

    r = (await container.items
      .query({
        query: `SELECT * FROM c WHERE c.id = @id`,
        parameters: [
          {
            name: '@id',
            value: aliasInput.alias_for,
          },
        ],
      })
      .fetchNext()) as FeedResponse<DAOMEnvConfigInput>;

    configInput = r.resources[0];

    if (aliasInput.alias_overrides) {
      configInput = mergeDeep(configInput, aliasInput.alias_overrides);
    }
  }

  try {
    const config = parseDAOMEnvConfig(
      DAOMEnvConfigInput.parse({
        ...configInput,
      })
    );

    await redis.set(envCacheKey, JSON.stringify(config), 'EX', 60 * 60 * 24);

    deepTaintConfig(config);

    return config;
  } catch (err) {
    console.error(`Failed to parse DADAMEnvConfig for id: ${id}`);
    throw err;
  }
}

function deepTaintConfig(config: DAOMEnvConfig) {
  const values = [
    config.azure_ad.certPfx,
    config.cosmos_db.endpoint,
    config.cosmos_db.key,
    config.blob_storage.account_key,
  ];

  for (const value of values) {
    if (value) {
      experimental_taintUniqueValue(TAINT_MESSAGE, config, value);
    }
  }
}

const processEnvTaintKeys = [
  'NEXTAUTH_SECRET',
  'COSMOS_DB_KEY',
  'COSMOS_DB_ENDPOINT',
];

for (const value of processEnvTaintKeys) {
  if (process.env[value]) {
    experimental_taintUniqueValue(
      TAINT_MESSAGE,
      process.env,
      process.env[value] as string,
    );
  }
}

experimental_taintObjectReference(TAINT_MESSAGE, process.env);
