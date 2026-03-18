import { createLarkAdapter, LarkApiClient } from '@lobechat/chat-adapter-feishu';
import debug from 'debug';

import {
  type BotPlatformRuntimeContext,
  type BotProviderConfig,
  ClientFactory,
  type PlatformClient,
  type PlatformMessenger,
  type ValidationResult,
} from '../types';

const log = debug('bot-platform:feishu:client');

function extractChatId(platformThreadId: string): string {
  return platformThreadId.split(':')[1];
}

/** Resolve the Lark/Feishu domain from settings, defaulting to 'feishu'. */
function resolveDomain(settings: Record<string, unknown>): 'lark' | 'feishu' {
  const domain = settings.domain;
  return domain === 'lark' ? 'lark' : 'feishu';
}

class FeishuWebhookClient implements PlatformClient {
  readonly id = 'feishu';
  readonly applicationId: string;

  private config: BotProviderConfig;
  private domain: 'lark' | 'feishu';

  constructor(config: BotProviderConfig, _context: BotPlatformRuntimeContext) {
    this.config = config;
    this.applicationId = config.applicationId;
    this.domain = resolveDomain(config.settings);
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    log('Starting FeishuClient appId=%s domain=%s', this.applicationId, this.domain);

    const api = new LarkApiClient(
      this.config.credentials.appId,
      this.config.credentials.appSecret,
      this.domain,
    );
    await api.getTenantAccessToken();

    log('FeishuClient appId=%s credentials verified', this.applicationId);
  }

  async stop(): Promise<void> {
    log('Stopping FeishuClient appId=%s', this.applicationId);
  }

  // --- Runtime Operations ---

  createAdapter(): Record<string, any> {
    return {
      feishu: createLarkAdapter({
        appId: this.config.credentials.appId,
        appSecret: this.config.credentials.appSecret,
        encryptKey: this.config.credentials.encryptKey,
        platform: this.domain,
        verificationToken: this.config.credentials.verificationToken,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const api = new LarkApiClient(
      this.config.credentials.appId,
      this.config.credentials.appSecret,
      this.domain,
    );
    const chatId = extractChatId(platformThreadId);
    return {
      createMessage: (content) => api.sendMessage(chatId, content).then(() => {}),
      editMessage: (messageId, content) => api.editMessage(messageId, content).then(() => {}),
      removeReaction: () => Promise.resolve(),
      triggerTyping: () => Promise.resolve(),
    };
  }

  extractChatId(platformThreadId: string): string {
    return extractChatId(platformThreadId);
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }
}

export class FeishuClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new FeishuWebhookClient(config, context);
  }

  async validateCredentials(credentials: Record<string, string>): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string }> = [];

    if (!credentials.appId) errors.push({ field: 'appId', message: 'App ID is required' });
    if (!credentials.appSecret)
      errors.push({ field: 'appSecret', message: 'App Secret is required' });

    if (errors.length > 0) return { errors, valid: false };

    try {
      const domain = 'feishu'; // default domain for validation
      const api = new LarkApiClient(credentials.appId, credentials.appSecret, domain);
      await api.getTenantAccessToken();
      return { valid: true };
    } catch {
      return {
        errors: [{ field: 'credentials', message: 'Failed to authenticate with Feishu API' }],
        valid: false,
      };
    }
  }
}
