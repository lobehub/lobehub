import { createLarkAdapter } from '@lobechat/adapter-lark';
import debug from 'debug';

import type { PlatformBot, PlatformDescriptor } from '../../types';
import { LarkRestApi } from './restApi';

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

// --------------- Platform Descriptor ---------------

function extractChatId(platformThreadId: string): string {
  return platformThreadId.split(':')[1];
}

function createLarkDescriptorForPlatform(platform: 'lark' | 'feishu'): PlatformDescriptor {
  return {
    platform,
    charLimit: 4000,
    persistent: false,
    handleDirectMessages: true,
    requiredCredentials: ['appId', 'appSecret'],

    extractChatId,
    parseMessageId: (compositeId) => compositeId,

    createMessenger(credentials, platformThreadId) {
      const lark = new LarkRestApi(credentials.appId, credentials.appSecret, platform);
      const chatId = extractChatId(platformThreadId);
      return {
        createMessage: (content) => lark.sendMessage(chatId, content).then(() => {}),
        editMessage: (messageId, content) => lark.editMessage(messageId, content),
        removeReaction: () => Promise.resolve(),
        triggerTyping: () => Promise.resolve(),
      };
    },

    createAdapter(credentials) {
      return {
        [platform]: createLarkAdapter({
          appId: credentials.appId,
          appSecret: credentials.appSecret,
          encryptKey: credentials.encryptKey,
          platform,
          verificationToken: credentials.verificationToken,
        }),
      };
    },
  };
}

export const larkDescriptor = createLarkDescriptorForPlatform('lark');
export const feishuDescriptor = createLarkDescriptorForPlatform('feishu');
