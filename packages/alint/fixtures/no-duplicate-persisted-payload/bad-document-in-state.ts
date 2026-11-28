// Fixture: the document is already the message body; the state stores it
// twice more, as markdown and as LiteXML, although the inspector chip only
// shows the title.
import type { AgentDocumentsDeps, BuiltinToolResult, ReadDocumentArgs } from './types';

export class AgentDocumentsExecutionRuntime {
  constructor(private deps: AgentDocumentsDeps) {}

  async readDocument({ id }: ReadDocumentArgs): Promise<BuiltinToolResult> {
    const doc = await this.deps.documentService.findById(id);
    if (!doc) return { content: `Document ${id} not found`, success: false };

    return {
      content: doc.content,
      // alint-expect
      state: { content: doc.content, id: doc.id, title: doc.title, xml: doc.litexml },
      success: true,
    };
  }
}
