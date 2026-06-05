import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    verifyMessagesRemoved?: number;
  }
}

const log = debug('context-engine:processor:VerifyMessageProcessor');

/**
 * Verify Message Processor
 *
 * `role='verify'` messages are UI-only cards (the Agent Run delivery checker) —
 * they carry no prompt content and `verify` is not a valid model role, so they
 * are removed from the context before the model call. They remain persisted and
 * rendered in the conversation; this only affects what the LLM sees.
 */
export class VerifyMessageProcessor extends BaseProcessor {
  readonly name = 'VerifyMessageProcessor';

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    const before = clonedContext.messages.length;
    clonedContext.messages = clonedContext.messages.filter((message) => message.role !== 'verify');
    const removed = before - clonedContext.messages.length;

    clonedContext.metadata.verifyMessagesRemoved = removed;
    if (removed > 0) log(`Removed ${removed} verify message(s) from model context`);

    return this.markAsExecuted(clonedContext);
  }
}
