import { beforeEach, describe, expect, it, vi } from 'vitest';

import { archiveToolResultViaServer } from './toolResultArchive';

const { mutate, getChatConfigById } = vi.hoisted(() => ({
  getChatConfigById: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { aiChat: { archiveToolResult: { mutate } } },
}));

vi.mock('@/store/agent/selectors', () => ({
  chatConfigByIdSelectors: { getChatConfigById },
}));

vi.mock('@/store/agent/store', () => ({ getAgentStoreState: () => ({}) }));

describe('archiveToolResultViaServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutate.mockResolvedValue({ content: 'archived' });
  });

  it("sends the agent's configured tool-result limit", async () => {
    getChatConfigById.mockReturnValue(() => ({ toolResultMaxLength: 80_000 }));

    await archiveToolResultViaServer({
      agentId: 'agent-1',
      content: 'result',
      toolCallId: 'call-1',
      topicId: 'topic-1',
    });

    expect(getChatConfigById).toHaveBeenCalledWith('agent-1');
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ limit: 80_000 }));
  });

  it('prefers an explicit limit over the agent config', async () => {
    getChatConfigById.mockReturnValue(() => ({ toolResultMaxLength: 80_000 }));

    await archiveToolResultViaServer({
      agentId: 'agent-1',
      content: 'result',
      limit: 1000,
      toolCallId: 'call-1',
      topicId: 'topic-1',
    });

    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ limit: 1000 }));
  });

  it('applies the agent limit when truncating locally', async () => {
    getChatConfigById.mockReturnValue(() => ({ toolResultMaxLength: 1000 }));

    const result = await archiveToolResultViaServer({
      agentId: 'agent-1',
      content: 'x\n'.repeat(5000),
    });

    expect(mutate).not.toHaveBeenCalled();
    expect(result.length).toBeLessThan(2000);
  });
});
