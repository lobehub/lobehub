import type { BotPlatformInfo } from '@lobechat/prompts';
import { formatBotPlatformContext } from '@lobechat/prompts';
import debug from 'debug';

import { BaseProvider } from '../base/BaseProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:BotPlatformContextInjector');

export interface BotPlatformContext {
  platformName: string;
  supportsMarkdown: boolean;
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
export class BotPlatformContextInjector extends BaseProvider {
  readonly name = 'BotPlatformContextInjector';

  constructor(
    private config: BotPlatformContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (!this.config.enabled || !this.config.context) {
      log('Disabled or no context, skipping injection');
      return this.markAsExecuted(context);
    }

    const info: BotPlatformInfo = this.config.context;
    const prompt = formatBotPlatformContext(info);

    if (!prompt) {
      log('Platform supports markdown, no injection needed');
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);
    const systemMsgIndex = clonedContext.messages.findIndex((m) => m.role === 'system');

    if (systemMsgIndex >= 0) {
      const original = clonedContext.messages[systemMsgIndex];
      clonedContext.messages[systemMsgIndex] = {
        ...original,
        content: [original.content, prompt].filter(Boolean).join('\n\n'),
      };
      log('Appended bot platform context to existing system message');
    } else {
      clonedContext.messages.unshift({
        content: prompt,
        createdAt: Date.now(),
        id: `bot-platform-context-${Date.now()}`,
        role: 'system' as const,
        updatedAt: Date.now(),
      });
      log('Created new system message with bot platform context');
    }

    return this.markAsExecuted(clonedContext);
  }
}
