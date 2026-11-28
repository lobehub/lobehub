// Fixture: state carries only what the inspector reads; the body lives once
// in the message content.
import type { AgentDocumentsDeps, BuiltinToolResult, ReadDocumentArgs } from './types';

export class AgentDocumentsExecutionRuntime {
  constructor(private deps: AgentDocumentsDeps) {}

  async readDocument({ id }: ReadDocumentArgs): Promise<BuiltinToolResult> {
    const doc = await this.deps.documentService.findById(id);
    if (!doc) return { content: `Document ${id} not found`, success: false };

    return {
      content: doc.content,
      state: { id: doc.id, title: doc.title },
      success: true,
    };
  }
}
