import debug from 'debug';

import { BaseProcessor } from '../../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../../types';
import type { AgentContextDocument, AgentDocumentFilterContext } from './shared';
import { combineDocuments, getDocumentsForPositions } from './shared';

const log = debug('context-engine:provider:AgentDocumentBeforeSystemInjector');

export interface AgentDocumentBeforeSystemInjectorConfig extends AgentDocumentFilterContext {
  documents?: AgentContextDocument[];
  enabled?: boolean;
}

/**
 * Injects agent documents BEFORE the system message (prepend).
 * Handles `before-system` position.
 *
 * Placed at the very beginning of Phase 2, before SystemRoleInjector.
 */
export class AgentDocumentBeforeSystemInjector extends BaseProcessor {
  readonly name = 'AgentDocumentBeforeSystemInjector';

  constructor(
    private config: AgentDocumentBeforeSystemInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (this.config.enabled === false) return this.markAsExecuted(context);

    const docs = getDocumentsForPositions(
      this.config.documents || [],
      ['before-system'],
      this.config,
    );

    if (docs.length === 0) return this.markAsExecuted(context);

    const clonedContext = this.cloneContext(context);
    const content = combineDocuments(docs, this.config);
    const now = Date.now();

    clonedContext.messages.unshift({
      content,
      createdAt: now,
      id: `agent-doc-before-system-${now}`,
      role: 'system' as const,
      updatedAt: now,
    } as any);

    log('Prepended %d agent documents before system message', docs.length);
    return this.markAsExecuted(clonedContext);
  }
}
