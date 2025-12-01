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
 * Converts emoji reactions to feedback text and injects into assistant messages
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

    for (let i = 0; i < clonedContext.messages.length; i++) {
      const message = clonedContext.messages[i];

      // Only process assistant messages with reactions
      if (message.role === 'assistant' && message.metadata?.reactions) {
        const reactions = message.metadata.reactions as Record<string, EmojiReaction>;
        const feedbackText = this.convertReactionsToFeedback(reactions);

        if (feedbackText) {
          const originalContent = message.content;

          // Only append feedback to string content
          if (typeof originalContent === 'string') {
            clonedContext.messages[i] = {
              ...message,
              content: `${originalContent}\n\n[User Feedback: ${feedbackText}]`,
            };
            processedCount++;
            log(`Injected feedback for message ${message.id}: ${feedbackText}`);
          }
        }
      }
    }

    clonedContext.metadata.reactionFeedbackProcessed = processedCount;
    log(`Reaction feedback processing completed, processed ${processedCount} messages`);

    return this.markAsExecuted(clonedContext);
  }

  /**
   * Convert reactions object to human-readable feedback text
   */
  private convertReactionsToFeedback(reactions: Record<string, EmojiReaction>): string {
    const feedbackParts: string[] = [];

    for (const [emoji] of Object.entries(reactions)) {
      const sentiment = this.getEmojiSentiment(emoji);
      if (sentiment) {
        feedbackParts.push(sentiment);
      }
    }

    return feedbackParts.join(', ');
  }

  /**
   * Map emoji to sentiment description
   */
  private getEmojiSentiment(emoji: string): string | null {
    const sentimentMap: Record<string, string> = {
      '❤️': 'loved this response',
      '🎉': 'user found this excellent',
      '👀': 'user wants to look into this more',
      '👍': 'positive - user found this helpful',
      '👎': 'negative - user found this unhelpful',
      '😄': 'user found this amusing',
      '😢': 'user found this sad or disappointing',
      '🚀': 'user found this impressive',
      '🤔': 'user wants more clarification',
    };

    return sentimentMap[emoji] || `reacted with ${emoji}`;
  }
}
