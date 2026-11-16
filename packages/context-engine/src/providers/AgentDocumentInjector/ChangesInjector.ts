import debug from 'debug';

import { BaseEveryUserContentProvider } from '../../base/BaseEveryUserContentProvider';
import type { Message, ProcessorOptions } from '../../types';
import type { AgentDocumentChangesByMessage } from './indexSnapshot';
import { formatAgentDocumentChanges } from './indexSnapshot';

const log = debug('context-engine:provider:AgentDocumentChangesInjector');

export interface AgentDocumentChangesInjectorConfig {
  /** Change notes keyed by the user message each was attached to. */
  changes?: AgentDocumentChangesByMessage;
  enabled?: boolean;
}

/**
 * Attaches each agent-document change note to the user message it belongs to.
 *
 * The `<agent_documents_index>` block renders a snapshot that stays fixed while
 * the prompt cache is warm (see `resolveAgentDocumentIndex`); these notes tell
 * the model what changed since. Every note stays on its own message and renders
 * the same on every later request, so earlier turns keep their cached bytes.
 */
export class AgentDocumentChangesInjector extends BaseEveryUserContentProvider {
  readonly name = 'AgentDocumentChangesInjector';

  constructor(
    private config: AgentDocumentChangesInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContentForMessage(
    message: Message,
  ): { content: string; contextType: string } | null {
    if (this.config.enabled === false || !message.id) return null;

    const changes = this.config.changes?.[message.id];
    if (!changes || changes.length === 0) return null;

    log('Attaching %d agent-document changes to message %s', changes.length, message.id);
    return { content: formatAgentDocumentChanges(changes), contextType: 'agent_documents_changes' };
  }
}
