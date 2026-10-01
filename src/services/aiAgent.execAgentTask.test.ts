import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService } from './aiAgent';

const mocks = vi.hoisted(() => ({ execAgent: vi.fn() }));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { aiAgent: { execAgent: { mutate: mocks.execAgent } } },
}));

describe('aiAgentService.execAgentTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The server renames a mirrored group member terminal to `member_runtime_end`
  // only for a client that declares it handles the new event.
  it('declares that this client handles member_runtime_end', async () => {
    mocks.execAgent.mockResolvedValueOnce({ success: true });
    const signal = new AbortController().signal;

    await aiAgentService.execAgentTask({ agentId: 'agt-1', prompt: 'hi' }, { signal });

    expect(mocks.execAgent).toHaveBeenCalledWith(
      { agentId: 'agt-1', prompt: 'hi', streamFeatures: ['member_runtime_end'] },
      { signal },
    );
  });
});
