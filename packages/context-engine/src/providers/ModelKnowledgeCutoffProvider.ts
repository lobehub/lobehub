import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    modelKnowledgeCutoffInjected?: boolean;
  }
}

const log = debug('context-engine:provider:ModelKnowledgeCutoffProvider');

export interface ModelKnowledgeCutoffProviderConfig {
  enabled?: boolean;
  knowledgeCutoff?: string;
}

export class ModelKnowledgeCutoffProvider extends BaseSystemRoleProvider {
  readonly name = 'ModelKnowledgeCutoffProvider';

  constructor(
    private config: ModelKnowledgeCutoffProviderConfig = {},
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    if (this.config.enabled === false) {
      log('Model knowledge cutoff injection disabled, skipping');
      return null;
    }

    const knowledgeCutoff = this.config.knowledgeCutoff?.trim();

    if (!knowledgeCutoff) {
      log('No model knowledge cutoff configured, skipping injection');
      return null;
    }

    return `Model knowledge cutoff: ${knowledgeCutoff}`;
  }

  protected onInjected(context: PipelineContext): void {
    context.metadata.modelKnowledgeCutoffInjected = true;
  }
}
