import type { EmojiReaction } from '@lobechat/types';
import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:ReactionFeedbackProcessor');

export interface ReactionFeedbackConfig {
  /** Whether to enable reaction feedback injection */
  enabled?: boolean;
}

/**
 * Reaction Feedback Processor
 * Converts emoji reactions on assistant messages to feedback text
 * and injects into the next user message, where the model will actually attend to it.
 */
export class ReactionFeedbackProcessor extends BaseProcessor {
  readonly name = 'ReactionFeedbackProcessor';

  constructor(
    private config: ReactionFeedbackConfig = {},
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (!this.config.enabled) {
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);
    let processedCount = 0;

    // Collect emojis from assistant messages, then inject into the next user message
    let pendingEmojis: string[] = [];

    for (let i = 0; i < clonedContext.messages.length; i++) {
      const message = clonedContext.messages[i];

      // Collect reactions from assistant messages
      if (message.role === 'assistant' && message.metadata?.reactions) {
        const reactions = message.metadata.reactions as EmojiReaction[];
        const emojis = reactions.map((r) => r.emoji).filter(Boolean);

        if (emojis.length > 0) {
          pendingEmojis.push(...emojis);
          log(`Collected reaction emojis from message ${message.id}: ${emojis.join(' ')}`);
        }
      }

      // Inject accumulated feedback into the next user message
      if (message.role === 'user' && pendingEmojis.length > 0) {
        const originalContent = message.content;

        if (typeof originalContent === 'string') {
          const feedbackTag = `[User Feedback Emoji: ${pendingEmojis.join(' ')}]`;

          clonedContext.messages[i] = {
            ...message,
            content: `${feedbackTag}\n\n${originalContent}`,
          };
          processedCount += pendingEmojis.length;
        }

        pendingEmojis = [];
      }
    }

    clonedContext.metadata.reactionFeedbackProcessed = processedCount;
    log(`Reaction feedback processing completed, processed ${processedCount} messages`);

    return this.markAsExecuted(clonedContext);
  }
}
