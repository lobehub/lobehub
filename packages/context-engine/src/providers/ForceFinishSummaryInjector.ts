import debug from 'debug';

import { BaseProvider } from '../base/BaseProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:ForceFinishSummaryInjector');

export interface ForceFinishSummaryInjectorConfig {
  enabled: boolean;
}

/**
 * Force Finish Summary Injector
 *
 * When the agent reaches the maximum step limit (forceFinish mode),
 * this processor appends a system message instructing the LLM to
 * summarize progress and produce a final text response without using tools.
 *
 * Should run near the end of the pipeline (before MessageCleanup).
 */
export class ForceFinishSummaryInjector extends BaseProvider {
  readonly name = 'ForceFinishSummaryInjector';

  constructor(
    private config: ForceFinishSummaryInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (!this.config.enabled) {
      return this.markAsExecuted(context);
    }

    log('Injecting force-finish summary prompt');

    const clonedContext = this.cloneContext(context);

    clonedContext.messages.push({
      content:
        'You have reached the maximum step limit. Please summarize your progress and provide a final response. Do not attempt to use any tools.',
      role: 'system' as const,
    });

    clonedContext.metadata.forceFinishInjected = true;

    return this.markAsExecuted(clonedContext);
  }
}
