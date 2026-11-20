import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    projectInstructionCount?: number;
  }
}

const log = debug('context-engine:provider:ProjectInstructionsInjector');

export interface ProjectInstructionFile {
  content: string;
  /**
   * Absolute path of the file, telling the model which directory the rules
   * cover when several levels of a repository contribute one.
   */
  path?: string;
  /** Where the file came from, e.g. `AGENTS.md` — surfaced to the model. */
  source: string;
}

export interface ProjectInstructionsInjectorConfig {
  enabled?: boolean;
  instructions?: ProjectInstructionFile[];
}

/**
 * Injects a project's instruction files (`AGENTS.md` / `CLAUDE.md`, from the
 * working directory up to the repository root) into the system message.
 *
 * Takes the files rather than a rendered block: wrapping them is presentation,
 * which belongs to the pipeline that owns the system message. The server used
 * to render and concatenate this onto `agentConfig.systemRole` several stages
 * before the engine ran, which made the final prompt's composition readable
 * only by following three files in execution order.
 *
 * Runs immediately after `SystemRoleInjector` so the text lands exactly where
 * it used to — directly after the agent's persona and ahead of every other
 * Phase 2 provider.
 */
export class ProjectInstructionsInjector extends BaseSystemRoleProvider {
  readonly name = 'ProjectInstructionsInjector';

  constructor(
    private config: ProjectInstructionsInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    const { enabled, instructions } = this.config;
    if (enabled === false || !instructions?.length) {
      log('No project instructions to inject, skipping');
      return null;
    }

    return instructions
      .map(
        ({ content, path, source }) =>
          `<project_instructions source="${source}"${path ? ` path="${path}"` : ''}>\n${content}\n</project_instructions>`,
      )
      .join('\n\n');
  }

  protected onInjected(context: PipelineContext): void {
    context.metadata.projectInstructionCount = this.config.instructions?.length ?? 0;
  }
}
