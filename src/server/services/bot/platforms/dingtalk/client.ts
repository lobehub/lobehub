import type {
  BotPlatformRuntimeContext,
  BotProviderConfig,
  PlatformClient,
  PlatformMessenger,
  UsageStats,
  ValidationResult,
} from '../types';
import { ClientFactory } from '../types';
import { formatUsageStats } from '../utils';
import { stripMarkdown } from '../stripMarkdown';

const NOT_IMPLEMENTED_MESSAGE = 'DingTalk webhook runtime is not implemented yet';

class DingTalkClient implements PlatformClient {
  readonly id = 'dingtalk';
  readonly applicationId: string;

  private readonly config: BotProviderConfig;

  constructor(config: BotProviderConfig, _context: BotPlatformRuntimeContext) {
    this.config = config;
    this.applicationId = config.applicationId;
  }

  private get messageType(): 'markdown' | 'text' {
    return this.config.settings?.messageType === 'text' ? 'text' : 'markdown';
  }

  private get showUsageStats(): boolean {
    return Boolean(this.config.settings?.showUsageStats);
  }

  private buildNotImplementedError(): Error {
    return new Error(NOT_IMPLEMENTED_MESSAGE);
  }

  private rejectNotImplemented<T = never>(): Promise<T> {
    return Promise.reject(this.buildNotImplementedError());
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    throw this.buildNotImplementedError();
  }

  async stop(): Promise<void> {
    throw this.buildNotImplementedError();
  }

  // --- Runtime Operations ---

  createAdapter(): Record<string, any> {
    throw this.buildNotImplementedError();
  }

  getMessenger(): PlatformMessenger {
    const reject = () => this.rejectNotImplemented();
    return {
      createMessage: () => reject(),
      editMessage: () => reject(),
      removeReaction: () => reject(),
      triggerTyping: () => reject(),
    };
  }

  extractChatId(platformThreadId: string): string {
    return platformThreadId.split(':').slice(2).join(':');
  }

  formatMarkdown(markdown: string): string {
    return this.messageType === 'text' ? stripMarkdown(markdown) : markdown;
  }

  formatReply(body: string, stats?: UsageStats): string {
    if (!stats || !this.showUsageStats) return body;
    return `${body}\n\n${formatUsageStats(stats)}`;
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }
}

export class DingTalkClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new DingTalkClient(config, context);
  }

  async validateCredentials(
    credentials: Record<string, string>,
    _settings?: Record<string, unknown>,
    applicationId?: string,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string }> = [];

    if (!applicationId) {
      errors.push({ field: 'applicationId', message: 'Application ID is required' });
    }
    if (!credentials.clientSecret) {
      errors.push({ field: 'clientSecret', message: 'Client Secret is required' });
    }
    if (!credentials.verificationToken) {
      errors.push({ field: 'verificationToken', message: 'Verification Token is required' });
    }
    if (!credentials.aesKey) {
      errors.push({ field: 'aesKey', message: 'AES Key is required' });
    }

    if (errors.length) {
      return { errors, valid: false };
    }

    return { valid: true };
  }
}
