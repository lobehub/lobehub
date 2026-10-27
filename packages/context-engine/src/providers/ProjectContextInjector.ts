import debug from 'debug';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    projectContextInjected?: boolean;
  }
}

const log = debug('context-engine:provider:ProjectContextInjector');

export interface ProjectContextInjectorConfig {
  contextPrompt?: string;
  enabled?: boolean;
}

/**
 * Appends the live context of the project a run belongs to (members, linked
 * knowledge, open tasks) to the last user message.
 */
export class ProjectContextInjector extends BaseLastUserContentProvider {
  readonly name = 'ProjectContextInjector';

  constructor(
    private config: ProjectContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    log('doProcess: enabled=%s hasPrompt=%s', this.config.enabled, !!this.config.contextPrompt);

    const clonedContext = this.cloneContext(context);

    if (!this.config.enabled || !this.config.contextPrompt) {
      log('No project context, skipping injection');
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
      ? this.createContextBlock(this.config.contextPrompt, 'project_context')
      : this.wrapWithSystemContext(this.config.contextPrompt, 'project_context');

    this.appendToLastUserMessage(clonedContext, contentToAppend);

    clonedContext.metadata.projectContextInjected = true;

    log('Project context appended to last user message');

    return this.markAsExecuted(clonedContext);
  }
}
