import debug from 'debug';

import { BaseProcessor } from '../../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../../types';
import type { AgentContextDocument, AgentDocumentFilterContext } from './shared';
import { combineDocuments, getDocumentsForPositions } from './shared';

const log = debug('context-engine:provider:AgentDocumentMessageInjector');

export interface AgentDocumentMessageInjectorConfig extends AgentDocumentFilterContext {
  documents?: AgentContextDocument[];
  enabled?: boolean;
}

/**
 * Injects agent documents at specific message positions.
 * Handles `after-first-user` and `context-end` positions.
 *
 * Placed in Phase 4 (User Message Augmentation).
 */
export class AgentDocumentMessageInjector extends BaseProcessor {
  readonly name = 'AgentDocumentMessageInjector';

  constructor(
    private config: AgentDocumentMessageInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (this.config.enabled === false) return this.markAsExecuted(context);

    const allDocs = this.config.documents || [];
    if (allDocs.length === 0) return this.markAsExecuted(context);

    const afterFirstUserDocs = getDocumentsForPositions(allDocs, ['after-first-user'], this.config);
    const contextEndDocs = getDocumentsForPositions(allDocs, ['context-end'], this.config);

    if (afterFirstUserDocs.length === 0 && contextEndDocs.length === 0) {
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);

    // Inject after first user message
    if (afterFirstUserDocs.length > 0) {
      const firstUserIndex = clonedContext.messages.findIndex((m) => m.role === 'user');
      if (firstUserIndex !== -1) {
        const content = combineDocuments(afterFirstUserDocs, this.config);
        const now = Date.now();
        clonedContext.messages.splice(firstUserIndex + 1, 0, {
          content,
          createdAt: now,
          id: `agent-doc-after-user-${now}`,
          role: 'system' as const,
          updatedAt: now,
        } as any);
        log('Injected %d agent documents after first user message', afterFirstUserDocs.length);
      }
    }

    // Inject at context end
    if (contextEndDocs.length > 0) {
      const content = combineDocuments(contextEndDocs, this.config);
      const now = Date.now();
      clonedContext.messages.push({
        content,
        createdAt: now,
        id: `agent-doc-context-end-${now}`,
        role: 'system' as const,
        updatedAt: now,
      } as any);
      log('Injected %d agent documents at context end', contextEndDocs.length);
    }

    return this.markAsExecuted(clonedContext);
  }
}
