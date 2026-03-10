import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:TasksFlattenProcessor');

/**
 * Tasks Flatten Processor
 * Responsible for flattening role=tasks and role=groupTasks messages into individual task messages
 *
 * - tasks: Multiple task messages with same agentId aggregated
 * - groupTasks: Multiple task messages with different agentIds aggregated
 *
 * This processor converts them back to individual task messages that can be processed by TaskMessageProcessor.
 */
export class TasksFlattenProcessor extends BaseProcessor {
  readonly name = 'TasksFlattenProcessor';

  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let processedCount = 0;
    let tasksMessagesFlattened = 0;
    let taskMessagesCreated = 0;

    const newMessages: any[] = [];

    // Process each message
    for (const message of clonedContext.messages) {
      // Check if this is a tasks or groupTasks message with tasks field
      if (['tasks', 'groupTasks'].includes(message.role) && message.tasks) {
        // If tasks array is empty, skip this message entirely (no content to flatten)
        if (message.tasks.length === 0) {
          continue;
        }

        processedCount++;
        tasksMessagesFlattened++;

        log(`Flattening ${message.role} message ${message.id} with ${message.tasks.length} tasks`);

        // Flatten each task
        for (const task of message.tasks) {
          // Create task message from child
          const taskMsg: any = {
            ...task,
            // Ensure role is 'task'
            role: 'task',
          };

          // Preserve parent message references if not already set
          if (!taskMsg.parentId && message.parentId) taskMsg.parentId = message.parentId;
          if (!taskMsg.threadId && message.threadId) taskMsg.threadId = message.threadId;
          if (!taskMsg.groupId && message.groupId) taskMsg.groupId = message.groupId;
          if (!taskMsg.topicId && message.topicId) taskMsg.topicId = message.topicId;

          newMessages.push(taskMsg);
          taskMessagesCreated++;

          log(`Created task message ${taskMsg.id} from tasks`);
        }
      } else {
        // Non-tasks message, keep as-is
        newMessages.push(message);
      }
    }

    clonedContext.messages = newMessages;

    // Update metadata
    clonedContext.metadata.tasksFlattenProcessed = processedCount;
    clonedContext.metadata.tasksMessagesFlattened = tasksMessagesFlattened;
    clonedContext.metadata.taskMessagesCreated = taskMessagesCreated;

    log(
      `Tasks message flatten processing completed: ${tasksMessagesFlattened} tasks groups flattened, ${taskMessagesCreated} task messages created`,
    );

    return this.markAsExecuted(clonedContext);
  }
}
