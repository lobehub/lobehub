// Fixture: the status block goes in right after the last user message, but the
// assistant and tool messages of the current turn follow it, so every step
// that re-renders the time rewrites the cache for those messages too.
import type { ContextProvider, PipelineContext } from './types';

export class RunStatusInjector implements ContextProvider {
  async process(context: PipelineContext): Promise<PipelineContext> {
    const messages = [...context.messages];
    const lastUserIndex = messages.findLastIndex((message) => message.role === 'user');
    if (lastUserIndex === -1) return context;

    messages.splice(lastUserIndex + 1, 0, {
      // alint-expect
      content: `<run_status>checked at ${new Date().toISOString()}</run_status>`,
      role: 'user',
    });

    return { ...context, messages };
  }
}
