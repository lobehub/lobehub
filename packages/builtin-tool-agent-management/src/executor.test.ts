import { describe, expect, it, vi } from 'vitest';

import { agentManagementExecutor } from './executor';

// The executor module pulls in renderer aliases that don't resolve in this
// package's vitest env — stub them. `callAgent` touches none of them.
vi.mock('@/services/agent', () => ({ agentService: {} }));
vi.mock('@/services/discover', () => ({ discoverService: {} }));
vi.mock('@lobechat/agent-manager-runtime', () => ({
  AgentManagerRuntime: class {},
}));

describe('agentManagementExecutor.callAgent', () => {
  // `callAgent` only runs in server-side agent runs; the browser executor has no
  // runtime to hand the call to, so it must report failure instead of pretending.
  it('returns success:false with a server-only message', async () => {
    const result = await agentManagementExecutor.callAgent({
      agentId: 'agt_1',
      instruction: 'summarize the thread',
    });

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      'Calling agent "agt_1" is only supported in server-side agent runs.',
    );
    expect(result.state).toEqual({
      agentId: 'agt_1',
      instruction: 'summarize the thread',
      mode: 'speak',
      skipCallSupervisor: false,
    });
  });

  it('carries skipCallSupervisor through to the state', async () => {
    const result = await agentManagementExecutor.callAgent({
      agentId: 'agt_2',
      instruction: 'go',
      skipCallSupervisor: true,
    });

    expect(result.success).toBe(false);
    expect(result.state).toMatchObject({ skipCallSupervisor: true });
  });
});
