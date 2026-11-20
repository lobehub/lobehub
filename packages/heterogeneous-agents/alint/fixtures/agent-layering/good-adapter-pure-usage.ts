// Fixture: adapters/kimiCode.ts — the adapter turns usage it is handed into an event.
import type { AgentEventAdapter, HeterogeneousAgentEvent, PostRunUsage } from '../types';

export class KimiCodeAdapter implements AgentEventAdapter {
  sessionId?: string;
  private stepIndex = 0;

  adapt(raw: any): HeterogeneousAgentEvent[] {
    if (typeof raw.session_id === 'string') this.sessionId = raw.session_id;
    return [];
  }

  buildPostRunUsageEvents(result: PostRunUsage): HeterogeneousAgentEvent[] {
    return [
      {
        data: { phase: 'turn_metadata', provider: 'kimi-code', usage: result.usage },
        stepIndex: this.stepIndex,
        timestamp: Date.now(),
        type: 'step_complete',
      } as HeterogeneousAgentEvent,
    ];
  }

  flush(): HeterogeneousAgentEvent[] {
    return [];
  }
}
