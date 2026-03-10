import debug from 'debug';

import { LarkRestApi } from '../larkRestApi';
import type { PlatformBot } from '../types';

const log = debug('lobe-server:bot:gateway:lark');

export interface LarkBotConfig {
  [key: string]: string | undefined;
  appId: string;
  appSecret: string;
  /** AES decrypt key for encrypted events (optional) */
  encryptKey?: string;
  /** 'lark' or 'feishu' — determines API base URL */
  platform?: string;
  /** Verification token for webhook event validation (optional) */
  verificationToken?: string;
}

/**
 * Lark/Feishu platform bot.
 *
 * Unlike Telegram, Lark does not support programmatic webhook registration.
 * The user must configure the webhook URL manually in the Lark Developer Console.
 * `start()` verifies credentials by fetching a tenant access token.
 */
export class Lark implements PlatformBot {
  readonly platform: string;
  readonly applicationId: string;

  private config: LarkBotConfig;

  constructor(config: LarkBotConfig) {
    this.config = config;
    this.applicationId = config.appId;
    this.platform = config.platform || 'lark';
  }

  async start(): Promise<void> {
    log('Starting LarkBot appId=%s platform=%s', this.applicationId, this.platform);

    // Verify credentials by fetching a tenant access token
    const api = new LarkRestApi(this.config.appId, this.config.appSecret, this.platform);
    await api.getTenantAccessToken();

    log('LarkBot appId=%s credentials verified', this.applicationId);
  }

  async stop(): Promise<void> {
    log('Stopping LarkBot appId=%s', this.applicationId);
    // No cleanup needed — webhook is managed in Lark Developer Console
  }
}
