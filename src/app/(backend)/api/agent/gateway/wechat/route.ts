import debug from 'debug';
import type { NextRequest } from 'next/server';
import { after } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { type BotProviderConfig, wechat } from '@/server/services/bot/platforms';
import { BotConnectQueue } from '@/server/services/gateway/botConnectQueue';

const log = debug('lobe-server:bot:gateway:cron:wechat');

const GATEWAY_DURATION_MS = 600_000; // 10 minutes
const POLL_INTERVAL_MS = 30_000; // 30 seconds

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createWechatBot(applicationId: string, credentials: Record<string, string>) {
  const config: BotProviderConfig = {
    applicationId,
    credentials,
    platform: 'wechat',
    settings: {},
  };
  return wechat.clientFactory.createClient(config, { appUrl: process.env.APP_URL });
}

async function processConnectQueue(remainingMs: number): Promise<number> {
  const queue = new BotConnectQueue();
  const items = await queue.popAll();
  const wechatItems = items.filter((item) => item.platform === 'wechat');

  if (wechatItems.length === 0) return 0;

  log('Processing %d queued wechat connect requests', wechatItems.length);

  const serverDB = await getServerDB();
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  let processed = 0;

  for (const item of wechatItems) {
    try {
      const model = new AgentBotProviderModel(serverDB, item.userId, gateKeeper);
      const provider = await model.findEnabledByApplicationId('wechat', item.applicationId);

      if (!provider) {
        log('No enabled provider found for queued appId=%s', item.applicationId);
        await queue.remove('wechat', item.applicationId);
        continue;
      }

      const bot = createWechatBot(provider.applicationId, provider.credentials);

      await bot.start({
        durationMs: remainingMs,
        waitUntil: (task: Promise<any>) => {
          after(() => task);
        },
      });

      processed++;
      log('Started queued bot appId=%s', item.applicationId);
    } catch (err) {
      log('Failed to start queued bot appId=%s: %O', item.applicationId, err);
    }

    await queue.remove('wechat', item.applicationId);
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
    'wechat',
    gateKeeper,
  );

  log('Found %d enabled WeChat providers', providers.length);

  let started = 0;

  for (const provider of providers) {
    const { applicationId, credentials } = provider;

    try {
      const bot = createWechatBot(applicationId, credentials);

      await bot.start({
        durationMs: GATEWAY_DURATION_MS,
        waitUntil: (task: Promise<any>) => {
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
