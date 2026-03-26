import debug from 'debug';

import { BaseFirstUserContentProvider } from '../../base/BaseFirstUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../../types';
import type { AgentContextDocument, AgentDocumentFilterContext } from './shared';
import { combineDocuments, getDocumentsForPositions } from './shared';

const log = debug('context-engine:provider:AgentDocumentContextInjector');

export interface AgentDocumentContextInjectorConfig extends AgentDocumentFilterContext {
  documents?: AgentContextDocument[];
  enabled?: boolean;
}

/**
 * Injects agent documents before the first user message.
 * Handles `before-first-user` position.
 *
 * Placed in Phase 3 (Context Injection).
 */
export class AgentDocumentContextInjector extends BaseFirstUserContentProvider {
  readonly name = 'AgentDocumentContextInjector';

  constructor(
    private config: AgentDocumentContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContent(_context: PipelineContext): string | null {
    if (this.config.enabled === false) return null;

    const docs = getDocumentsForPositions(
      this.config.documents || [],
      ['before-first-user'],
      this.config,
    );

    if (docs.length === 0) return null;

    log('Injecting %d agent documents before first user message', docs.length);
    return combineDocuments(docs, this.config);
  }
}
