import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    systemRoleInjected?: boolean;
  }
}

const log = debug('context-engine:provider:SystemRoleInjector');

export interface SystemRoleInjectorConfig {
  /** System role content to inject */
  systemRole?: string;
}

/**
 * System Role Injector
 *
 * Injects the agent's system role into the system message. If a system message
 * already exists (e.g. created by AgentDocumentBeforeSystemInjector), the
 * system role is appended to it via the BaseSystemRoleProvider join logic;
 * otherwise a new system message is created.
 */
export class SystemRoleInjector extends BaseSystemRoleProvider {
  readonly name = 'SystemRoleInjector';

  constructor(
    private config: SystemRoleInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    const systemRole = this.config.systemRole;
    if (!systemRole || typeof systemRole !== 'string' || systemRole.trim() === '') {
      log('No system role configured, skipping injection');
      return null;
    }

    return systemRole;
  }

  protected onInjected(context: PipelineContext, content: string): void {
    context.metadata.systemRoleInjected = true;
    log(`System role injected: "${content.slice(0, 50)}..."`);
  }
}
