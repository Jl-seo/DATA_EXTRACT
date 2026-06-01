import { createCache } from 'cache-manager';

const SERVICE_CACHE_TYPES = ['cosmos-client'] as const;
type SERVICE_CACHE_TYPES = typeof SERVICE_CACHE_TYPES[number];

const cache = createCache({
  ttl: 60 * 1000,
});

export async function getCachedService<T>(envId: string, serviceType: SERVICE_CACHE_TYPES, constructor: () => T): Promise<T> {
  const cacheKey = `${envId}-${serviceType}`;

  let result = await cache.get(cacheKey);

  if (!result) {
    result = constructor();
    await cache.set(cacheKey, result);
  }

  return result as T
}

export async function resetEnvCache(envId: string) {
  for (const cacheType of SERVICE_CACHE_TYPES) {
    await cache.del(`${envId}-${cacheType}`);
  }

}
