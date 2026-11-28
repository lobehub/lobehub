// Fixture: Date.now() only stamps the created system message's id and
// timestamps; the rendered content is the agent's fixed system role.
import type { ContextProvider, PipelineContext } from './types';

export class SystemRoleInjector implements ContextProvider {
  constructor(private systemRole: string) {}

  async process(context: PipelineContext): Promise<PipelineContext> {
    const now = Date.now();
    const message = {
      content: this.systemRole,
      createdAt: now,
      id: `system_${now}`,
      role: 'system' as const,
      updatedAt: now,
    };
    return { ...context, messages: [message, ...context.messages] };
  }
}
