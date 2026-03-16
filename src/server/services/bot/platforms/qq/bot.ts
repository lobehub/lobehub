import { createQQAdapter } from '@lobechat/adapter-qq';
import debug from 'debug';

import type { PlatformBot, PlatformDescriptor } from '../../types';
import { QQRestApi } from './restApi';

const log = debug('lobe-server:bot:gateway:qq');

export interface QQBotConfig {
  [key: string]: string | undefined;
  appId: string;
  appSecret: string;
}

export class QQ implements PlatformBot {
  readonly platform = 'qq';
  readonly applicationId: string;

  private config: QQBotConfig;

  constructor(config: QQBotConfig) {
    this.config = config;
    this.applicationId = config.appId;
  }

  async start(): Promise<void> {
    log('Starting QQBot appId=%s', this.applicationId);

    // Verify credentials by fetching an access token
    const api = new QQRestApi(this.config.appId, this.config.appSecret!);
    await api.getAccessToken();

    log('QQBot appId=%s credentials verified', this.applicationId);
  }

  async stop(): Promise<void> {
    log('Stopping QQBot appId=%s', this.applicationId);
    // No cleanup needed — webhook is configured in QQ Open Platform
  }
}

// --------------- Platform Descriptor ---------------

/**
 * Extract the target ID from a QQ platformThreadId.
 *
 * QQ thread ID format: "qq:<type>:<id>" or "qq:<type>:<id>:<guildId>"
 * Returns the <id> portion used for sending messages.
 */
function extractChatId(platformThreadId: string): string {
  return platformThreadId.split(':')[2];
}

/**
 * Extract the thread type (group, guild, c2c, dms) from a QQ platformThreadId.
 */
function extractThreadType(platformThreadId: string): string {
  return platformThreadId.split(':')[1] || 'group';
}

export const qqDescriptor: PlatformDescriptor = {
  platform: 'qq',
  charLimit: 2000,
  persistent: false,
  handleDirectMessages: true,
  requiredCredentials: ['appId', 'appSecret'],

  extractChatId,
  parseMessageId: (compositeId) => compositeId,

  createMessenger(credentials, platformThreadId) {
    const api = new QQRestApi(credentials.appId, credentials.appSecret);
    const targetId = extractChatId(platformThreadId);
    const threadType = extractThreadType(platformThreadId);

    return {
      createMessage: (content) => api.sendMessage(threadType, targetId, content).then(() => {}),
      editMessage: (_messageId, content) =>
        // QQ does not support editing — send a new message as fallback
        api.sendAsEdit(threadType, targetId, content).then(() => {}),
      // QQ Bot API doesn't support reactions or typing
      removeReaction: () => Promise.resolve(),
      triggerTyping: () => Promise.resolve(),
    };
  },

  createAdapter(credentials) {
    return {
      qq: createQQAdapter({
        appId: credentials.appId,
        clientSecret: credentials.appSecret,
      }),
    };
  },
};
