import type { UserMemoryData } from '@lobechat/prompts';
import { promptUserMemory } from '@lobechat/prompts';
import debug from 'debug';

import { BaseFirstUserContentProvider } from '../base/BaseFirstUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:UserMemoryInjector');

export interface UserMemoryInjectorConfig {
  /** User memories data */
  memories?: UserMemoryData;
}

/**
 * User Memory Injector
 * Responsible for injecting user memories into context before the first user message
 */
export class UserMemoryInjector extends BaseFirstUserContentProvider {
  readonly name = 'UserMemoryInjector';

  constructor(
    private config: UserMemoryInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContent(_context: PipelineContext): string | null {
    const { memories } = this.config;
    if (!memories) return null;

    const content = promptUserMemory({ memories });

    if (!content) {
      log('No user memories to inject');
      return null;
    }

    const identitiesCount = memories.identities?.length || 0;
    const contextsCount = memories.contexts?.length || 0;
    const experiencesCount = memories.experiences?.length || 0;
    const preferencesCount = memories.preferences?.length || 0;

    log(
      `User memories prepared: ${identitiesCount} identity(ies), ${contextsCount} context(s), ${experiencesCount} experience(s), ${preferencesCount} preference(s)`,
    );

    return content;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const result = await super.doProcess(context);

    // Update metadata
    if (this.config.memories) {
      result.metadata.userMemoryInjected = true;
    }

    return result;
  }
}
