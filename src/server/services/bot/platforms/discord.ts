import type { DiscordAdapter } from '@chat-adapter/discord';
import { createDiscordAdapter } from '@chat-adapter/discord';
import { createIoRedisState } from '@chat-adapter/state-ioredis';
import { Chat, ConsoleLogger } from 'chat';
import debug from 'debug';

import { appEnv } from '@/envs/app';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import type { PlatformBot } from '../types';

const log = debug('lobe-server:bot:gateway:discord');

const DEFAULT_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

export interface DiscordBotConfig {
  [key: string]: string;
  applicationId: string;
  botToken: string;
  publicKey: string;
}

export interface GatewayListenerOptions {
  durationMs?: number;
  waitUntil?: (task: Promise<any>) => void;
}

export class Discord implements PlatformBot {
  readonly platform = 'discord';
  readonly applicationId: string;

  private abort = new AbortController();
  private config: DiscordBotConfig;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(config: DiscordBotConfig) {
    this.config = config;
    this.applicationId = config.applicationId;
  }

  async start(options?: GatewayListenerOptions): Promise<void> {
    log('Starting DiscordBot appId=%s', this.applicationId);

    this.stopped = false;
    this.abort = new AbortController();

    const adapter = createDiscordAdapter({
      applicationId: this.config.applicationId,
      botToken: this.config.botToken,
      publicKey: this.config.publicKey,
    });

    const chatConfig: any = {
      adapters: { discord: adapter },
      userName: `lobehub-gateway-${this.applicationId}`,
    };

    const redisClient = getAgentRuntimeRedisClient();
    if (redisClient) {
      chatConfig.state = createIoRedisState({ client: redisClient, logger: new ConsoleLogger() });
    }

    const bot = new Chat(chatConfig);

    await bot.initialize();

    const discordAdapter = (bot as any).adapters.get('discord') as DiscordAdapter;
    const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
    const waitUntil = options?.waitUntil ?? ((task: Promise<any>) => task.catch(() => {}));

    const webhookUrl = `${appEnv.APP_URL}/api/agent/webhooks/discord`;

    await discordAdapter.startGatewayListener(
      { waitUntil },
      durationMs,
      this.abort.signal,
      webhookUrl,
    );

    // Only schedule refresh timer in long-running mode (no custom options)
    if (!options) {
      this.refreshTimer = setTimeout(() => {
        if (this.abort.signal.aborted || this.stopped) return;

        log(
          'DiscordBot appId=%s duration elapsed (%dh), refreshing...',
          this.applicationId,
          durationMs / 3_600_000,
        );
        this.abort.abort();
        this.start().catch((err) => {
          log('Failed to refresh DiscordBot appId=%s: %O', this.applicationId, err);
        });
      }, durationMs);
    }

    log('DiscordBot appId=%s started, webhookUrl=%s', this.applicationId, webhookUrl);
  }

  async stop(): Promise<void> {
    log('Stopping DiscordBot appId=%s', this.applicationId);
    this.stopped = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.abort.abort();
  }
}
