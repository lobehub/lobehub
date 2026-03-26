import debug from 'debug';

import { BaseSystemRoleProvider } from '../../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../../types';
import type { AgentContextDocument, AgentDocumentFilterContext } from './shared';
import { combineDocuments, getDocumentsForPositions } from './shared';

const log = debug('context-engine:provider:AgentDocumentSystemInjector');

export interface AgentDocumentSystemInjectorConfig extends AgentDocumentFilterContext {
  documents?: AgentContextDocument[];
  enabled?: boolean;
}

/**
 * Injects agent documents into the system message.
 * Handles `before-system`, `system-append`, and `system-replace` positions.
 *
 * Placed in Phase 2 (System Message Assembly).
 */
export class AgentDocumentSystemInjector extends BaseSystemRoleProvider {
  readonly name = 'AgentDocumentSystemInjector';

  constructor(
    private config: AgentDocumentSystemInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    if (this.config.enabled === false) return null;

    const docs = getDocumentsForPositions(
      this.config.documents || [],
      ['before-system', 'system-append', 'system-replace'],
      this.config,
    );

    if (docs.length === 0) return null;

    log('Injecting %d agent documents into system message', docs.length);
    return combineDocuments(docs, this.config);
  }
}
