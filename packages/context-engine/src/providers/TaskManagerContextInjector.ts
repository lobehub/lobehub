import debug from 'debug';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    taskManagerContextInjected?: boolean;
  }
}

const log = debug('context-engine:provider:TaskManagerContextInjector');

export interface TaskManagerContextInjectorConfig {
  contextPrompt?: string;
  enabled?: boolean;
}

/**
 * Appends Task Manager page context (list or detail) to the last user message.
 */
export class TaskManagerContextInjector extends BaseLastUserContentProvider {
  readonly name = 'TaskManagerContextInjector';

  constructor(
    private config: TaskManagerContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    log('doProcess: enabled=%s hasPrompt=%s', this.config.enabled, !!this.config.contextPrompt);

    const clonedContext = this.cloneContext(context);

    if (!this.config.enabled || !this.config.contextPrompt) {
      log('No Task Manager context, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const lastUserIndex = this.findLastUserMessageIndex(clonedContext.messages);

    log('Last user message index:', lastUserIndex);

    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const hasExistingWrapper = this.hasExistingSystemContext(clonedContext);
    const contentToAppend = hasExistingWrapper
      ? this.createContextBlock(this.config.contextPrompt, 'task_manager_context')
      : this.wrapWithSystemContext(this.config.contextPrompt, 'task_manager_context');

    this.appendToLastUserMessage(clonedContext, contentToAppend);

    clonedContext.metadata.taskManagerContextInjected = true;

    log('Task Manager context appended to last user message');

    return this.markAsExecuted(clonedContext);
  }
}
