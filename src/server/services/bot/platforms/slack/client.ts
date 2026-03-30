import { createSlackAdapter } from '@chat-adapter/slack';
import debug from 'debug';

import {
  BOT_RUNTIME_STATUSES,
  getRuntimeStatusErrorMessage,
  updateBotRuntimeStatus,
} from '@/server/services/gateway/runtimeStatus';

import {
  type BotPlatformRuntimeContext,
  type BotProviderConfig,
  ClientFactory,
  type PlatformClient,
  type PlatformMessenger,
  type UsageStats,
  type ValidationResult,
} from '../types';
import { formatUsageStats } from '../utils';
import { SLACK_API_BASE, SlackApi } from './api';
import { markdownToSlackMrkdwn } from './markdownToMrkdwn';

const log = debug('bot-platform:slack:bot');

function extractChannelId(platformThreadId: string): string {
  // Slack thread IDs from Chat SDK: "slack:<channel>:<threadTs>"
  return platformThreadId.split(':')[1];
}

function extractThreadTs(platformThreadId: string): string | undefined {
  return platformThreadId.split(':')[2];
}

class SlackWebhookClient implements PlatformClient {
  readonly id = 'slack';
  readonly applicationId: string;

  private config: BotProviderConfig;
  private context: BotPlatformRuntimeContext;

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.context = context;
    this.applicationId = config.applicationId;
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    log('Starting SlackBot appId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.starting,
    });

    try {
      // Slack uses Events API with webhook — no explicit registration needed.
      // The webhook URL is configured manually in Slack App settings.
      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.connected,
      });
      log('SlackBot appId=%s started', this.applicationId);
    } catch (error) {
      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        errorMessage: getRuntimeStatusErrorMessage(error),
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.failed,
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    log('Stopping SlackBot appId=%s', this.applicationId);
    // No cleanup needed for webhook mode
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.disconnected,
    });
  }

  // --- Runtime Operations ---

  createAdapter(): Record<string, any> {
    return {
      slack: createSlackAdapter({
        botToken: this.config.credentials.botToken,
        signingSecret: this.config.credentials.signingSecret,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const slack = new SlackApi(this.config.credentials.botToken);
    const channelId = extractChannelId(platformThreadId);
    const threadTs = extractThreadTs(platformThreadId);

    return {
      createMessage: (content) =>
        threadTs
          ? slack.postMessageInThread(channelId, threadTs, content).then(() => {})
          : slack.postMessage(channelId, content).then(() => {}),
      editMessage: (messageId, content) => slack.updateMessage(channelId, messageId, content),
      removeReaction: (messageId, emoji) => slack.removeReaction(channelId, messageId, emoji),
      triggerTyping: () => Promise.resolve(), // Slack has no typing indicator API for bots
    };
  }

  extractChatId(platformThreadId: string): string {
    return extractChannelId(platformThreadId);
  }

  formatMarkdown(markdown: string): string {
    return markdownToSlackMrkdwn(markdown);
  }

  formatReply(body: string, stats?: UsageStats): string {
    if (!stats || !this.config.settings?.showUsageStats) return body;
    return `${body}\n\n${formatUsageStats(stats)}`;
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }

  sanitizeUserInput(text: string): string {
    // Remove bot mention artifacts like <@U12345>
    return text.replaceAll(/<@[A-Z\d]+>\s*/g, '').trim();
  }
}

export class SlackClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new SlackWebhookClient(config, context);
  }

  async validateCredentials(credentials: Record<string, string>): Promise<ValidationResult> {
    if (!credentials.botToken) {
      return { errors: [{ field: 'botToken', message: 'Bot Token is required' }], valid: false };
    }
    if (!credentials.signingSecret) {
      return {
        errors: [{ field: 'signingSecret', message: 'Signing Secret is required' }],
        valid: false,
      };
    }

    try {
      const res = await fetch(`${SLACK_API_BASE}/auth.test`, {
        headers: {
          'Authorization': `Bearer ${credentials.botToken}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as { ok: boolean; error?: string; bot_id?: string };
      if (!data.ok) throw new Error(data.error || 'auth.test failed');

      return { valid: true };
    } catch {
      return {
        errors: [{ field: 'botToken', message: 'Failed to authenticate with Slack API' }],
        valid: false,
      };
    }
  }
}
