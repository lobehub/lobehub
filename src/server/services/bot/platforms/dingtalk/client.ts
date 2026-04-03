import type {
  BotPlatformRuntimeContext,
  BotProviderConfig,
  PlatformClient,
  PlatformMessenger,
  ValidationResult,
} from '../types';
import { ClientFactory } from '../types';

class DingTalkClient implements PlatformClient {
  readonly id = 'dingtalk';
  readonly applicationId: string;

  constructor(config: BotProviderConfig, _context: BotPlatformRuntimeContext) {
    this.applicationId = config.applicationId;
  }

  async start() {}
  async stop() {}

  createAdapter(): Record<string, any> {
    return { dingtalk: {} };
  }

  extractChatId(platformThreadId: string): string {
    return platformThreadId.split(':').slice(2).join(':');
  }

  getMessenger(): PlatformMessenger {
    return {
      createMessage: async () => {},
      editMessage: async () => {},
      removeReaction: async () => {},
      triggerTyping: async () => {},
    };
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }
}

export class DingTalkClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new DingTalkClient(config, context);
  }

  async validateCredentials(): Promise<ValidationResult> {
    return { valid: true };
  }
}
