// Fixture: the current time and the list of changed documents go into the
// latest user message, after the cached history.
import type { ContextProvider, PipelineContext } from './types';

export class CurrentTimeAndChangesInjector implements ContextProvider {
  async process(context: PipelineContext): Promise<PipelineContext> {
    const messages = [...context.messages];
    const last = messages.at(-1);
    if (!last || last.role !== 'user') return context;

    const changes = context.changedDocuments.map((doc) => `- ${doc.title} edited`).join('\n');
    messages[messages.length - 1] = {
      ...last,
      content: `${last.content}\n\n<current_time>${new Date().toISOString()}</current_time>\n<agent_documents_changes>\n${changes}\n</agent_documents_changes>`,
    };

    return { ...context, messages };
  }
}
