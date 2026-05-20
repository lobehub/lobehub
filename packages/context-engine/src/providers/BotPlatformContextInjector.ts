import type { BotPlatformInfo } from '@lobechat/prompts';
import { formatBotPlatformContext } from '@lobechat/prompts';
import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:BotPlatformContextInjector');

export interface BotPlatformContext {
  platformName: string;
  supportsMarkdown: boolean;
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
