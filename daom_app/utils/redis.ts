import Redis from 'ioredis';
import type { Cluster } from 'ioredis';
import parseUrl from 'parse-url';
import { Redlock } from "@sesamecare-oss/redlock";

// Global extension for development HMR
declare global {
  var redisClient: Redis | null | Cluster;
  var redlock: Redlock | null;
}

export function getRedisClient(forceNewInstance = false) {
  if (global.redisClient && !forceNewInstance) {
    return global.redisClient;
  }

  const url = process.env.REDIS_URL ?? '';
  const clusterMode = process.env.REDIS_CLUSTER_MODE === 'true';

  let client: Redis | Cluster;

  if (clusterMode) {
    const redisUrl = parseUrl(url);
    const redisPort = redisUrl.port ? parseInt(redisUrl.port, 10) : 6379;

    client = new Redis.Cluster(
      [{ port: redisPort, host: redisUrl.resource }],
      { slotsRefreshTimeout: 2000 }
    );
  } else {
    client = new Redis(url);
  }

  if (!forceNewInstance) {
    global.redisClient = client;
  }

  return client;
}

export function getRedlock() {
  if (global.redlock) {
    return global.redlock;
  }

  const redlock = new Redlock(
    // You should have one client for each independent redis node
    // or cluster.
    [getRedisClient()],
    {
      // The expected clock drift; for more details see:
      // http://redis.io/topics/distlock
      driftFactor: 0.01, // multiplied by lock ttl to determine drift time

      // The max number of times Redlock will attempt to lock a resource
      // before erroring.
      retryCount: 10,

      // the time in ms between attempts
      retryDelay: 200, // time in ms

      // the max time in ms randomly added to retries
      // to improve performance under high contention
      // see https://www.awsarchitectureblog.com/2015/03/backoff.html
      retryJitter: 200, // time in ms

      // The minimum remaining time on a lock before an extension is automatically
      // attempted with the `using` API.
      automaticExtensionThreshold: 500, // time in ms
    }
  );

  global.redlock = redlock;

  return redlock;
}
