import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:TaskMessageProcessor');

/**
 * Default template for combining instruction and result
 */
const DEFAULT_TEMPLATE = `[Task Result from {{agentName}}]

**Task Instruction:**
{{instruction}}

**Task Result:**
{{content}}`;

export interface TaskMessageConfig {
  /**
   * Custom template for formatting task messages
   * Available placeholders: {{agentName}}, {{instruction}}, {{content}}
   */
  template?: string;
}

/**
 * Task Message Processor
 *
 * Processes role='task' messages by combining the instruction (from metadata)
 * and the result content into a single assistant message format.
 *
 * This transformation helps LLMs understand the context of task execution results
 * in group agent conversations.
 */
export class TaskMessageProcessor extends BaseProcessor {
  readonly name = 'TaskMessageProcessor';

  constructor(
    private config: TaskMessageConfig = {},
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let processedCount = 0;
    const template = this.config.template || DEFAULT_TEMPLATE;

    for (let i = 0; i < clonedContext.messages.length; i++) {
      const message = clonedContext.messages[i];

      // Only process task messages
      if (message.role !== 'task') continue;

      const instruction = message.metadata?.instruction;
      const content = message.content || '';
      const agentName = message.agentName || message.meta?.avatar || 'Sub Agent';

      // If no instruction, just convert to assistant role with original content
      if (!instruction) {
        clonedContext.messages[i] = {
          ...message,
          content: content,
          role: 'assistant',
        };
        processedCount++;
        log(`Converted task message ${message.id} to assistant (no instruction)`);
        continue;
      }

      // Apply template
      const formattedContent = this.applyTemplate(template, {
        agentName: String(agentName),
        content: String(content),
        instruction: String(instruction),
      });

      // Convert to assistant message with formatted content
      clonedContext.messages[i] = {
        ...message,
        content: formattedContent,
        role: 'assistant',
      };

      processedCount++;
      log(`Processed task message ${message.id} with instruction`);
    }

    // Update metadata
    clonedContext.metadata.taskMessagesProcessed = processedCount;

    log(`Task message processing completed, processed ${processedCount} messages`);

    return this.markAsExecuted(clonedContext);
  }

  /**
   * Apply template with placeholders
   */
  private applyTemplate(
    template: string,
    values: { agentName: string; content: string; instruction: string },
  ): string {
    return template
      .replaceAll('{{agentName}}', values.agentName)
      .replaceAll('{{instruction}}', values.instruction)
      .replaceAll('{{content}}', values.content);
  }
}
