import type { HeterogeneousAgentEvent } from '../types';
import { TraeAcpAdapter } from './traeAcp';

/**
 * GitHub Copilot CLI (`copilot --acp --stdio`) emits standard ACP `session/update`
 * notifications (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`,
 * `tool_call_update`, `usage_update`, `plan`), plus synthetic lifecycle events
 * (`copilot_session`, `copilot_prompt_completed`, `copilot_error`) injected by
 * `CopilotAcpSession`.
 *
 * When Copilot CLI runs a shell command (`kind: 'execute'`), `title` holds the
 * human-readable command description while `name` is omitted; normalizing
 * `name: 'execute'` routes shell tool calls to the built-in command renderer
 * and git side-effect tracker.
 */
export class CopilotAcpAdapter extends TraeAcpAdapter {
  constructor() {
    super({ eventPrefix: 'copilot', provider: 'copilot' });
  }

  override adapt(value: unknown): HeterogeneousAgentEvent[] {
    if (
      value &&
      typeof value === 'object' &&
      ((value as Record<string, unknown>).sessionUpdate === 'tool_call' ||
        (value as Record<string, unknown>).sessionUpdate === 'tool_call_update') &&
      (value as Record<string, unknown>).kind === 'execute' &&
      typeof (value as Record<string, unknown>).name !== 'string'
    ) {
      return super.adapt({
        ...(value as Record<string, unknown>),
        name: 'execute',
      });
    }

    return super.adapt(value);
  }
}
