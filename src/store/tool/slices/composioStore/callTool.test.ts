// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useToolStore } from '../../store';

const mocks = vi.hoisted(() => ({ executeAction: vi.fn() }));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {},
  toolsClient: { composio: { executeAction: { mutate: mocks.executeAction } } },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('callComposioTool', () => {
  it('names the conversation the call belongs to', async () => {
    mocks.executeAction.mockResolvedValue({ content: 'ok', success: true });

    const result = await useToolStore.getState().callComposioTool({
      agentId: 'agt_private',
      identifier: 'gmail',
      toolArgs: { to: 'a@b.c' },
      toolSlug: 'GMAIL_SEND_EMAIL',
      topicId: 'tpc_direct',
    });

    expect(result).toEqual({ data: { content: 'ok', success: true }, success: true });
    // The server resolves the connection this agent loads in that topic.
    expect(mocks.executeAction).toHaveBeenCalledWith({
      agentId: 'agt_private',
      identifier: 'gmail',
      toolArgs: { to: 'a@b.c' },
      toolSlug: 'GMAIL_SEND_EMAIL',
      topicId: 'tpc_direct',
    });
  });

  it('leaves the conversation out when the call names none', async () => {
    mocks.executeAction.mockResolvedValue({ content: 'ok', success: true });

    await useToolStore.getState().callComposioTool({
      identifier: 'gmail',
      toolSlug: 'GMAIL_SEND_EMAIL',
    });

    // Nothing is borrowed from global state: the server resolves shared rows only.
    expect(mocks.executeAction).toHaveBeenCalledWith({
      identifier: 'gmail',
      toolSlug: 'GMAIL_SEND_EMAIL',
    });
  });
});
