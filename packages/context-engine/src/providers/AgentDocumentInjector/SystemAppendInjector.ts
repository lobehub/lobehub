import debug from 'debug';

import { BaseSystemRoleProvider } from '../../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../../types';
import type { AgentContextDocument, AgentDocumentFilterContext } from './shared';
import { combineDocuments, getDocumentsForPositions } from './shared';

const log = debug('context-engine:provider:AgentDocumentSystemAppendInjector');

export interface AgentDocumentSystemAppendInjectorConfig extends AgentDocumentFilterContext {
  documents?: AgentContextDocument[];
  enabled?: boolean;
}

/**
 * Appends agent documents to the end of the system message.
 * Handles `system-append` position.
 *
 * Placed at the end of Phase 2, after all other system role providers.
 */
export class AgentDocumentSystemAppendInjector extends BaseSystemRoleProvider {
  readonly name = 'AgentDocumentSystemAppendInjector';

  constructor(
    private config: AgentDocumentSystemAppendInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    if (this.config.enabled === false) return null;

    const docs = getDocumentsForPositions(
      this.config.documents || [],
      ['system-append'],
      this.config,
    );

    if (docs.length === 0) return null;

    log('Appending %d agent documents to system message', docs.length);
    return combineDocuments(docs, this.config);
  }
}
