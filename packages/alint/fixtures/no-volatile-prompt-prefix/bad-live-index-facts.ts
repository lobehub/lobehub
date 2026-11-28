// Fixture: the document index sits at the front of the prompt and is rebuilt
// every step from live rows, so one edit rewrites the whole cached history.
import type { AgentContextDocument, ContextProvider, PipelineContext } from './types';

const renderIndexRow = (doc: AgentContextDocument) =>
  // alint-expect
  `- ${doc.title} (id=${doc.id}) SIZE=${doc.content.length} UPDATED=${doc.updatedAt.toISOString()}`;

export class AgentDocumentIndexInjector implements ContextProvider {
  constructor(private loadDocuments: () => Promise<AgentContextDocument[]>) {}

  /** Runs before every LLM step; injects the index right after the system role. */
  async process(context: PipelineContext): Promise<PipelineContext> {
    const docs = await this.loadDocuments();
    const index = `<agent_documents_index>\n${docs.map(renderIndexRow).join('\n')}\n</agent_documents_index>`;

    return {
      ...context,
      messages: [
        context.messages[0],
        { content: index, role: 'system' },
        ...context.messages.slice(1),
      ],
    };
  }
}
