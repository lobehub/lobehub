import debug from 'debug';
import type { NextRequest } from 'next/server';
import { after } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import type {
  BotPlatformRuntimeContext,
  BotProviderConfig,
  PlatformDefinition,
} from '@/server/services/bot/platforms';
import { platformRegistry } from '@/server/services/bot/platforms';
import { BotConnectQueue } from '@/server/services/gateway/botConnectQueue';

const log = debug('lobe-server:bot:gateway:cron');

// A single gateway invocation keeps persistent bots alive for one
// serverless cron window. Keep this aligned with BotConnectQueue.EXPIRE_MS
// so connect requests queued during the same window can still be consumed.
const GATEWAY_DURATION_MS = 600_000; // 10 minutes
const POLL_INTERVAL_MS = 30_000; // 30 seconds

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitUntil = (task: Promise<unknown>) => {
  after(() => task);
};

function getGatewayPlatforms(): PlatformDefinition[] {
  return platformRegistry
    .listPlatforms()
    .filter((platform) => (platform.connectionMode ?? 'webhook') === 'persistent');
}

function createRuntimeContext(): BotPlatformRuntimeContext {
  return {
    appUrl: process.env.APP_URL,
    redisClient: getAgentRuntimeRedisClient() as any,
  };
}

function createGatewayBot(
  platform: string,
  applicationId: string,
  credentials: Record<string, string>,
) {
  const config: BotProviderConfig = {
    applicationId,
    credentials,
    platform,
    settings: {},
  };

  return platformRegistry.createClient(platform, config, createRuntimeContext());
}

async function processConnectQueue(
  remainingMs: number,
  gatewayPlatformIds: Set<string>,
): Promise<number> {
  const queue = new BotConnectQueue();
  const items = await queue.popAll();

  if (items.length === 0) return 0;

  log('Processing %d queued connect requests', items.length);

  const serverDB = await getServerDB();
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  let processed = 0;

  for (const item of items) {
    try {
      if (!gatewayPlatformIds.has(item.platform)) {
        log('Skipping queued non-gateway platform=%s appId=%s', item.platform, item.applicationId);
        await queue.remove(item.platform, item.applicationId);
        continue;
      }

      const model = new AgentBotProviderModel(serverDB, item.userId, gateKeeper);
      const provider = await model.findEnabledByApplicationId(item.platform, item.applicationId);

      if (!provider) {
        log('No enabled provider found for queued %s appId=%s', item.platform, item.applicationId);
        await queue.remove(item.platform, item.applicationId);
        continue;
      }

      const bot = createGatewayBot(item.platform, provider.applicationId, provider.credentials);

      await bot.start({
        durationMs: remainingMs,
        waitUntil,
      });

      processed++;
      log('Started queued bot platform=%s appId=%s', item.platform, item.applicationId);
    } catch (err) {
      log(
        'Failed to start queued bot platform=%s appId=%s: %O',
        item.platform,
        item.applicationId,
        err,
      );
    }

    await queue.remove(item.platform, item.applicationId);
  }

  return processed;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const platforms = getGatewayPlatforms();
  const gatewayPlatformIds = new Set(platforms.map((platform) => platform.id));

  const serverDB = await getServerDB();
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

  let started = 0;
  let total = 0;
  const stats: Array<{ platform: string; started: number; total: number }> = [];

  for (const platform of platforms) {
    const providers = await AgentBotProviderModel.findEnabledByPlatform(
      serverDB,
      platform.id,
      gateKeeper,
    );

    log('Found %d enabled %s providers', providers.length, platform.name);

    let platformStarted = 0;
    total += providers.length;

    for (const provider of providers) {
      const { applicationId, credentials } = provider;

      try {
        const bot = createGatewayBot(platform.id, applicationId, credentials);

        await bot.start({
          durationMs: GATEWAY_DURATION_MS,
          waitUntil,
        });

        platformStarted++;
        started++;
        log('Started gateway listener for platform=%s appId=%s', platform.id, applicationId);
      } catch (err) {
        log(
          'Failed to start gateway listener for platform=%s appId=%s: %O',
          platform.id,
          applicationId,
          err,
        );
      }
    }

    stats.push({ platform: platform.id, started: platformStarted, total: providers.length });
  }

  const queued = await processConnectQueue(GATEWAY_DURATION_MS, gatewayPlatformIds);

  after(async () => {
    const pollEnd = Date.now() + GATEWAY_DURATION_MS;

    while (Date.now() < pollEnd) {
      await sleep(POLL_INTERVAL_MS);
      if (Date.now() >= pollEnd) break;

      const remainingMs = pollEnd - Date.now();
      await processConnectQueue(remainingMs, gatewayPlatformIds);
    }
  });

  return Response.json({ platforms: stats, queued, started, total });
}
