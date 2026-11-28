// Fixture: index rows render from the facts the run first saw, so the prefix
// stays identical across steps; the live list only adds new documents.
import { freezeAgentDocumentIndexFacts } from './freeze';
import type { AgentContextDocument, ContextProvider, PipelineContext } from './types';

const renderIndexRow = (doc: AgentContextDocument) =>
  `- ${doc.title} (id=${doc.id}) SIZE=${doc.contentCharCount} UPDATED=${doc.updatedAt ?? 'unknown'}`;

export class AgentDocumentIndexInjector implements ContextProvider {
  constructor(private loadDocuments: () => Promise<AgentContextDocument[]>) {}

  async process(context: PipelineContext): Promise<PipelineContext> {
    const { documents, facts } = freezeAgentDocumentIndexFacts(
      await this.loadDocuments(),
      context.state.binding?.agentDocumentIndex,
    );
    if (facts) context.bindAgentDocumentIndex?.(facts);

    const index = `<agent_documents_index>\n${documents.map(renderIndexRow).join('\n')}\n</agent_documents_index>`;
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
