import debug from 'debug';

import { BaseProvider } from '../base/BaseProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:EvalContextSystemInjector');

export interface EvalContext {
  envPrompt?: string;
}

export interface EvalContextSystemInjectorConfig {
  enabled?: boolean;
  evalContext?: EvalContext;
}

/**
 * Eval Context Injector
 * Appends eval environment prompt to the existing system message,
 * or creates a new system message if none exists.
 * Should run after SystemRoleInjector in the pipeline.
 */
export class EvalContextSystemInjector extends BaseProvider {
  readonly name = 'EvalContextSystemInjector';

  constructor(
    private config: EvalContextSystemInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (!this.config.enabled || !this.config.evalContext?.envPrompt) {
      log('Disabled or no envPrompt configured, skipping injection');
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);
    const systemMsgIndex = clonedContext.messages.findIndex((m) => m.role === 'system');

    if (systemMsgIndex >= 0) {
      const original = clonedContext.messages[systemMsgIndex];
      clonedContext.messages[systemMsgIndex] = {
        ...original,
        content: [original.content, this.config.evalContext.envPrompt].filter(Boolean).join('\n\n'),
      };
      log('Appended envPrompt to existing system message');
    } else {
      clonedContext.messages.unshift({
        content: this.config.evalContext.envPrompt,
        createdAt: Date.now(),
        id: `eval-context-${Date.now()}`,
        role: 'system' as const,
        updatedAt: Date.now(),
      });
      log('Created new system message with envPrompt');
    }

    clonedContext.metadata.evalContextInjected = true;

    return this.markAsExecuted(clonedContext);
  }
}
