import debug from 'debug';

import { BaseProvider } from '../base/BaseProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:SystemRoleInjector');

export interface SystemRoleInjectorConfig {
  /** System role content to inject */
  systemRole?: string;
}

/**
 * System Role Injector
 * Responsible for injecting system role messages at the beginning of the conversation
 */
export class SystemRoleInjector extends BaseProvider {
  readonly name = 'SystemRoleInjector';

  constructor(
    private config: SystemRoleInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    // Skip injection if no system role is configured
    if (!this.config.systemRole || this.config.systemRole.trim() === '') {
      log('No system role configured, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // Check if system role already exists at the beginning
    const hasExistingSystemRole =
      clonedContext.messages.length > 0 && clonedContext.messages[0].role === 'system';

    if (hasExistingSystemRole) {
      log('System role already exists, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // Inject system role at the beginning
    const systemMessage = {
      content: this.config.systemRole,
      createdAt: Date.now(),
      id: `system-${Date.now()}`,
      role: 'system' as const,
      updatedAt: Date.now(),
    };

    clonedContext.messages.unshift(systemMessage);

    // Update metadata
    clonedContext.metadata.systemRoleInjected = true;

    log(`System role injected: "${this.config.systemRole.slice(0, 50)}..."`);

    return this.markAsExecuted(clonedContext);
  }
}
