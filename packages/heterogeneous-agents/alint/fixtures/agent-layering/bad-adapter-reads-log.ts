// Fixture: adapters/grokBuild.ts — an adapter reading its CLI's usage log from disk.
// alint-expect
import { readFile } from 'node:fs/promises';

import type { AgentEventAdapter, HeterogeneousAgentEvent } from '../types';

export class GrokBuildAdapter implements AgentEventAdapter {
  sessionId?: string;

  adapt(raw: any): HeterogeneousAgentEvent[] {
    if (typeof raw.session_id === 'string') this.sessionId = raw.session_id;
    return [];
  }

  async collectUsage(logPath: string) {
    return JSON.parse(await readFile(logPath, 'utf8'));
  }

  flush(): HeterogeneousAgentEvent[] {
    return [];
  }
}
