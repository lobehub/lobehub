import debug from 'debug';
import type { NextRequest } from 'next/server';
import { after } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { Discord } from '@/server/services/bot/platforms/discord';

const log = debug('lobe-server:bot:gateway:cron:discord');

const GATEWAY_DURATION_MS = 600_000; // 10 minutes

export const maxDuration = 800;

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

  if (providers.length === 0) {
    return Response.json({ started: 0, total: 0 });
  }

  let started = 0;

  for (const provider of providers) {
    const { applicationId, credentials } = provider;

    try {
      const bot = new Discord({ ...credentials, applicationId });

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

  return Response.json({ started, total: providers.length });
}
