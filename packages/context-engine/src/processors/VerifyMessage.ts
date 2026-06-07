import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    verifyFeedbackSurfaced?: number;
    verifyMessagesRemoved?: number;
  }
}

const log = debug('context-engine:processor:VerifyMessageProcessor');

/**
 * Verify Message Processor
 *
 * `role='verify'` messages are the Agent Run delivery-checker cards. `verify` is
 * not a valid model role, so they never reach the model as-is. Two cases:
 *
 * - **UI-only card** (empty content): a plain pass/fail card — removed from the
 *   model context (still persisted + rendered in the conversation).
 * - **Repair feedback** (non-empty content): auto-repair persisted the failure
 *   feedback onto the card (see VerifyRepairService). Surface it as a `user`
 *   turn — wrapped in a `<delivery_check_feedback>` tag so the model reads it as
 *   the checker's instruction, not human input — so the repair run acts on it.
 */
export class VerifyMessageProcessor extends BaseProcessor {
  readonly name = 'VerifyMessageProcessor';

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    const before = clonedContext.messages.length;
    let surfaced = 0;

    clonedContext.messages = clonedContext.messages.flatMap((message) => {
      if (message.role !== 'verify') return [message];

      const content = typeof message.content === 'string' ? message.content.trim() : '';
      // UI-only card with no repair feedback — drop it from the model context.
      if (!content) return [];

      surfaced += 1;
      return [
        {
          ...message,
          content: `<delivery_check_feedback>\n${content}\n</delivery_check_feedback>`,
          role: 'user' as const,
        },
      ];
    });

    const removed = before - clonedContext.messages.length;
    clonedContext.metadata.verifyMessagesRemoved = removed;
    clonedContext.metadata.verifyFeedbackSurfaced = surfaced;
    if (removed > 0) log(`Removed ${removed} empty verify message(s) from model context`);
    if (surfaced > 0) log(`Surfaced ${surfaced} verify feedback message(s) as user turn(s)`);

    return this.markAsExecuted(clonedContext);
  }
}
