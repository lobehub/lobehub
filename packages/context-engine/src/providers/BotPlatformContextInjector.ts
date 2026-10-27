import type { BotPlatformInfo } from '@lobechat/prompts';
import { formatBotPlatformContext } from '@lobechat/prompts';
import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:BotPlatformContextInjector');

export interface BotPlatformContext {
  /** Whether the platform can read chat history at runtime (`readMessages`). */
  canReadHistory?: boolean;
  /** Identifiers of the conversation this run replies in (`lobe-message` args). */
  currentChannel?: BotPlatformInfo['currentChannel'];
  /** The bot woke only because its name is in the text (see `formatBotPlatformContext`). */
  named?: boolean;
  platformName: string;
  /** The bot woke on its own to offer its owner help (see `formatBotPlatformContext`). */
  proactive?: boolean;
  /** Pre-injected recent same-channel history for platforms without history-read. */
  recentChannelHistory?: BotPlatformInfo['recentChannelHistory'];
  supportsMarkdown: boolean;
  /** `followup` tells the agent it may stay silent (see `formatBotPlatformContext`). */
  wakeKind?: BotPlatformInfo['wakeKind'];
  warnings?: string[];
}

export interface BotPlatformContextInjectorConfig {
  context?: BotPlatformContext;
  enabled?: boolean;
}

/**
 * Bot Platform Context Injector
 *
 * Appends platform-specific formatting instructions to the system message.
 * For platforms that don't support Markdown (e.g. WeChat, QQ), instructs
 * the AI to respond in plain text only.
 *
 * Should run after SystemRoleInjector in the pipeline.
 */
export class BotPlatformContextInjector extends BaseSystemRoleProvider {
  readonly name = 'BotPlatformContextInjector';

  constructor(
    private config: BotPlatformContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    if (!this.config.enabled || !this.config.context) {
      log('Disabled or no context, skipping injection');
      return null;
    }

    const info: BotPlatformInfo = this.config.context;
    return formatBotPlatformContext(info) || null;
  }
}
