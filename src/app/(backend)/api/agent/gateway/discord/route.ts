import debug from 'debug';
import type { NextRequest } from 'next/server';
import { after } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { Discord, type DiscordBotConfig } from '@/server/services/bot/platforms/discord';
import { BotConnectQueue } from '@/server/services/gateway/botConnectQueue';

const log = debug('lobe-server:bot:gateway:cron:discord');

const GATEWAY_DURATION_MS = 600_000; // 10 minutes
const POLL_INTERVAL_MS = 30_000; // 30 seconds

export const maxDuration = 800;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function processConnectQueue(remainingMs: number): Promise<number> {
  const queue = new BotConnectQueue();
  const items = await queue.popAll();
  const discordItems = items.filter((item) => item.platform === 'discord');

  if (discordItems.length === 0) return 0;

  log('Processing %d queued discord connect requests', discordItems.length);

  const serverDB = await getServerDB();
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  let processed = 0;

  for (const item of discordItems) {
    try {
      const model = new AgentBotProviderModel(serverDB, item.userId, gateKeeper);
      const provider = await model.findEnabledByApplicationId('discord', item.applicationId);

      if (!provider) {
        log('No enabled provider found for queued appId=%s', item.applicationId);
        await queue.remove('discord', item.applicationId);
        continue;
      }

      const bot = new Discord({
        ...provider.credentials,
        applicationId: provider.applicationId,
      } as DiscordBotConfig);

      await bot.start({
        durationMs: remainingMs,
        waitUntil: (task) => {
          after(() => task);
        },
      });

      processed++;
      log('Started queued bot appId=%s', item.applicationId);
    } catch (err) {
      log('Failed to start queued bot appId=%s: %O', item.applicationId, err);
    }

    await queue.remove('discord', item.applicationId);
  }

  return processed;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const serverDB = await getServerDB();
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const providers = await AgentBotProviderModel.findEnabledByPlatform(
    serverDB,
    'discord',
    gateKeeper,
  );

  log('Found %d enabled Discord providers', providers.length);

  let started = 0;

  for (const provider of providers) {
    const { applicationId, credentials } = provider;

    try {
      const bot = new Discord({ ...credentials, applicationId } as DiscordBotConfig);

      await bot.start({
        durationMs: GATEWAY_DURATION_MS,
        waitUntil: (task) => {
          after(() => task);
        },
      });

      started++;
      log('Started gateway listener for appId=%s', applicationId);
    } catch (err) {
      log('Failed to start gateway listener for appId=%s: %O', applicationId, err);
    }
  }

  // Process any queued connect requests immediately
  const queued = await processConnectQueue(GATEWAY_DURATION_MS);

  // Poll for new connect requests in background
  after(async () => {
    const pollEnd = Date.now() + GATEWAY_DURATION_MS;

    while (Date.now() < pollEnd) {
      await sleep(POLL_INTERVAL_MS);
      if (Date.now() >= pollEnd) break;

      const remaining = pollEnd - Date.now();
      await processConnectQueue(remaining);
    }
  });

  return Response.json({ queued, started, total: providers.length });
}
