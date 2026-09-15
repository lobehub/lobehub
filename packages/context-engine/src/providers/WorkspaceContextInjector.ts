import { type WorkspaceContextInfo, workspaceContextPrompt } from '@lobechat/prompts';
import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    workspaceContextInjected?: boolean;
  }
}

const log = debug('context-engine:provider:WorkspaceContextInjector');

export type WorkspaceContext = WorkspaceContextInfo;

export interface WorkspaceContextInjectorConfig {
  /** App origin + current workspace (or personal space) the run belongs to */
  context?: WorkspaceContext;
  /** Whether workspace context injection is enabled */
  enabled?: boolean;
}

/**
 * Workspace Context Injector
 *
 * Appends where the conversation lives — app origin and, inside a team
 * workspace, the workspace slug — to the system message, together with
 * the rule that in-app links must carry the `/{slug}` prefix. Without it the
 * model has no idea it is in a workspace and composes personal-space (or
 * training-data) URLs that open the wrong place.
 *
 * Should run after SystemRoleInjector in the pipeline.
 */
export class WorkspaceContextInjector extends BaseSystemRoleProvider {
  readonly name = 'WorkspaceContextInjector';

  constructor(
    private config: WorkspaceContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    if (this.config.enabled === false || !this.config.context) {
      log('Disabled or no context, skipping injection');
      return null;
    }

    return workspaceContextPrompt(this.config.context) || null;
  }

  protected onInjected(context: PipelineContext, content: string): void {
    context.metadata.workspaceContextInjected = true;
    log(`Workspace context injected: "${content.slice(0, 80)}..."`);
  }
}
