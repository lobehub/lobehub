import debug from 'debug';

import { BaseProcessor } from '../../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../../types';
import type { AgentContextDocument, AgentDocumentFilterContext } from './shared';
import { combineDocuments, getDocumentsForPositions } from './shared';

const log = debug('context-engine:provider:AgentDocumentSystemReplaceInjector');

export interface AgentDocumentSystemReplaceInjectorConfig extends AgentDocumentFilterContext {
  documents?: AgentContextDocument[];
  enabled?: boolean;
}

/**
 * Replaces the entire system message with agent document content.
 * Handles `system-replace` position.
 *
 * Placed at the end of Phase 2, after SystemAppendInjector.
 * When triggered, discards any previously assembled system message.
 */
export class AgentDocumentSystemReplaceInjector extends BaseProcessor {
  readonly name = 'AgentDocumentSystemReplaceInjector';

  constructor(
    private config: AgentDocumentSystemReplaceInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (this.config.enabled === false) return this.markAsExecuted(context);

    const docs = getDocumentsForPositions(
      this.config.documents || [],
      ['system-replace'],
      this.config,
    );

    if (docs.length === 0) return this.markAsExecuted(context);

    const clonedContext = this.cloneContext(context);
    const content = combineDocuments(docs, this.config);
    const now = Date.now();
    const message = {
      content,
      createdAt: now,
      id: `agent-doc-system-replace-${now}`,
      role: 'system' as const,
      updatedAt: now,
    };

    const systemIndex = clonedContext.messages.findIndex((m) => m.role === 'system');
    if (systemIndex >= 0) {
      clonedContext.messages[systemIndex] = message as any;
    } else {
      clonedContext.messages.unshift(message as any);
    }

    log('Replaced system message with %d agent documents', docs.length);
    return this.markAsExecuted(clonedContext);
  }
}
