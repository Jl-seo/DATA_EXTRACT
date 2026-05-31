import 'server-only';

import {
  Container,
  CosmosClient,
  DeleteOperationInput,
  ItemDefinition,
} from '@azure/cosmos';
import BaseService from './BaseService';
import { getCurrentEnvConfig } from '@/lib/env';
import { getCachedService } from '@/lib/cache';

export default class CosmosDBService extends BaseService {
  async getCosmosClient() {
    if (!this.envConfig) {
      this.envConfig = await getCurrentEnvConfig();
    }

    const client = getCachedService(this.envConfig.id, 'cosmos-client', () => {
      return new CosmosClient({
        endpoint: this.envConfig.cosmos_db.endpoint,
        key: this.envConfig.cosmos_db.key,
      });
    });

    return client;
  }

  async getContainer(containerId: CONTAINER_ID) {
    const client = await this.getCosmosClient();

    const r = await client
      .database(this.envConfig.cosmos_db.database_id)
      .containers.createIfNotExists({
        id: containerId,
        partitionKey: '/partition_key',
      });
    return r.container;
  }
}

export type CONTAINER_ID =
  | 'permissions'
  | 'glossary_languages'
  | 'glossaries'
  | 'files'
  | 'translations'
  | 'refdata'
  | 'translation_logs'
  | 'extraction_models'
  | 'extraction_logs'
  | 'users'
  | 'groups'
  | 'menus'
  | 'normalization_dictionaries'
  | 'audit_logs'
  | 'prompt_profiles';

type DeleteAllProps = {
  container: Container;
  items: ItemDefinition[];
  chunkSize?: number;
};

export async function deleteAll({
  container,
  items,
  chunkSize = 100,
}: DeleteAllProps) {
  // console.log(items);
  const operations: DeleteOperationInput[] = items.map((item) => ({
    operationType: 'Delete',
    id: item.id ?? '',
    partitionKey: item.partitionKey ?? item.partition_key,
  }));

  // Bulk 요청을 나누어 처리
  for (let i = 0; i < operations.length; i += chunkSize) {
    const chunk = operations.slice(i, i + chunkSize);
    try {
      await container.items.bulk(chunk);
    } catch (error) {
      console.error(error);
    }
  }
  return {
    success: true,
  };
}
