import { NextResponse } from 'next/server';

import { WebAppBroadcastMessage } from '@/scheme/webAppBroadcast';
import { getRawEnvId } from '@/lib/env';
import { getRedisClient } from '@/utils/redis';

export const dynamic = 'force-dynamic';

export async function GET() {
  const envId = await getRawEnvId();

  const redis = getRedisClient();

  console.log(`Dispatching reset-env-cache for ${envId}...`);

  await redis.del(`@daom_app/tenant_config_cache/${envId}`);

  await redis.publish(
    '@daom_app/webapp-broadcast',
    JSON.stringify({
      type: 'reset-env-cache',
      id: envId,
    } satisfies WebAppBroadcastMessage),
  );

  return NextResponse.json(true);
}
