import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    connectorOwnershipInjected?: boolean;
  }
}

const log = debug('context-engine:provider:ConnectorOwnershipInjector');

export interface ConnectorOwnershipInjectorConfig {
  enabled?: boolean;
  /**
   * The rendered note. Unlike project instructions this arrives pre-rendered,
   * because naming the authorizers needs a user lookup the engine has no way
   * to perform — the same split as `EvalContextSystemInjector` and its
   * `envPrompt`.
   */
  note?: string;
}

/**
 * Tells the model whose connected account each borrowed tool runs on, when the
 * run uses connectors other workspace members authorized.
 *
 * Was concatenated onto `agentConfig.systemRole` during tool discovery, several
 * stages before the engine ran, which is why that object had to stay mutable
 * all the way through the pipeline.
 */
export class ConnectorOwnershipInjector extends BaseSystemRoleProvider {
  readonly name = 'ConnectorOwnershipInjector';

  constructor(
    private config: ConnectorOwnershipInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    const { enabled, note } = this.config;
    if (enabled === false || !note) {
      log('No borrowed connectors to attribute, skipping');
      return null;
    }

    return note;
  }

  protected onInjected(context: PipelineContext): void {
    context.metadata.connectorOwnershipInjected = true;
  }
}
