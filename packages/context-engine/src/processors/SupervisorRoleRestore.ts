import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:SupervisorRoleRestoreProcessor');

/**
 * Supervisor Role Restore Processor
 *
 * Restores messages with role='supervisor' back to role='assistant' before
 * sending to the model. The 'supervisor' role is used for UI rendering in
 * group orchestration scenarios, but models don't understand this role.
 *
 * Flow:
 * 1. DB stores assistant messages with metadata.isSupervisor=true
 * 2. conversation-flow transforms them to role='supervisor' for UI
 * 3. This processor restores role='assistant' before model API call
 *
 * @example
 * ```typescript
 * const processor = new SupervisorRoleRestoreProcessor();
 * const result = await processor.process(context);
 * // All supervisor messages are now assistant messages
 * ```
 */
export class SupervisorRoleRestoreProcessor extends BaseProcessor {
  readonly name = 'SupervisorRoleRestoreProcessor';

  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let processedCount = 0;

    clonedContext.messages = clonedContext.messages.map((msg: Message) => {
      if (msg.role === 'supervisor') {
        processedCount++;
        log(`Restoring supervisor message to assistant role`);

        return {
          ...msg,
          role: 'assistant',
        };
      }

      return msg;
    });

    // Update metadata
    clonedContext.metadata.supervisorRoleRestoreProcessed = processedCount;

    log(`Supervisor role restore completed: ${processedCount} messages processed`);

    return this.markAsExecuted(clonedContext);
  }
}
