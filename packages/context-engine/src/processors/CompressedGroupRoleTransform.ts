import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:CompressedGroupRoleTransformProcessor');

/**
 * Compressed Group Role Transform Processor
 *
 * Transforms messages with role='compressedGroup' to role='user' before
 * sending to the model. The 'compressedGroup' role is used for UI rendering
 * to display compressed/summarized conversation history, but models don't
 * understand this role.
 *
 * The compressed summary content is wrapped in a system context block to
 * provide historical context to the model.
 *
 * Flow:
 * 1. DB stores compression groups with role='compressedGroup'
 * 2. conversation-flow passes them through for UI rendering
 * 3. This processor transforms to role='user' with wrapped content before model API call
 *
 * @example
 * ```typescript
 * const processor = new CompressedGroupRoleTransformProcessor();
 * const result = await processor.process(context);
 * // All compressedGroup messages are now user messages with wrapped content
 * ```
 */
export class CompressedGroupRoleTransformProcessor extends BaseProcessor {
  readonly name = 'CompressedGroupRoleTransformProcessor';

  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let processedCount = 0;

    clonedContext.messages = clonedContext.messages.map((msg: Message) => {
      if (msg.role === 'compressedGroup') {
        processedCount++;
        log(`Transforming compressedGroup message to user role`);

        // Wrap the compressed summary content in a context block
        const wrappedContent = msg.content
          ? `<compressed_history_summary>\n${msg.content}\n</compressed_history_summary>`
          : '';

        return {
          ...msg,
          content: wrappedContent,
          role: 'user',
        };
      }

      return msg;
    });

    // Update metadata
    clonedContext.metadata.compressedGroupRoleTransformProcessed = processedCount;

    log(`Compressed group role transform completed: ${processedCount} messages processed`);

    return this.markAsExecuted(clonedContext);
  }
}
