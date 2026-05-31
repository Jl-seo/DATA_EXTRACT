import { resetEnvCache } from "./lib/cache";
import { getRedisClient } from "./utils/redis";

let subscribed = false;

async function subscribeBroadcastEvent() {
  if (subscribed) {
    return;
  }

  const redis = getRedisClient(true);

  await redis.subscribe('@daom_app/webapp-broadcast', (err, cnt) => {
    if (!err) {
      console.log(`Subscribed to @daom_app/webapp-broadcast.`);
    }
  });

  redis.on('message', async (channel, rawMessage) => {
    const message = JSON.parse(rawMessage);

    console.log(`Raw message: ${rawMessage}`);

    if (channel !== '@daom_app/webapp-broadcast') {
      return;
    }

    switch (message.type) {
      case 'reset-env-cache':
        console.log(`Force reset cache for: ${message.id}`);
        await resetEnvCache(message.id);
        await redis.del(`@daom_app/tenant_config_cache/${message.id}`);
    }
  });

  subscribed = true;
}

subscribeBroadcastEvent();
