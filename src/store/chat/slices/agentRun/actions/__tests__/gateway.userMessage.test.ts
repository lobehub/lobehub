import type { ComposerUserMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService } from '@/services/aiAgent';

import { GatewayActionImpl } from '../transports/gateway/gateway';

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: { execAgentTask: vi.fn(), interruptTask: vi.fn() },
}));

const userMessage: ComposerUserMessage = {
  editorData: { root: { children: [], type: 'root' } },
  metadata: {
    contextSelections: [
      { content: 'Quoted reply', format: 'text', id: 'selection-1', source: 'text' },
    ],
    pageSelections: [{ content: 'Selected paragraph', id: 'page-selection-1', pageId: 'page-1' }],
  },
};

describe('executeGatewayAgent: the composer-authored user message', () => {
  beforeEach(() => {
    (globalThis as any).window = {
      global_serverConfigStore: {
        getState: () => ({ serverConfig: { agentGatewayUrl: 'https://gateway.test.com' } }),
      },
    };
    // Stop right after the start request; only its payload matters here.
    vi.mocked(aiAgentService.execAgentTask).mockRejectedValue(new Error('stop'));
  });

  afterEach(() => {
    delete (globalThis as any).window;
    vi.clearAllMocks();
  });

  // The server persists the user row on this path and replaces the optimistic
  // one with it, so whatever the start request leaves out vanishes from the
  // bubble and never reaches the agent.
  it('forwards the user message to the server start request', async () => {
    const action = new GatewayActionImpl(vi.fn(), () => ({ topicDataMap: {} }) as any, undefined);

    await expect(
      action.executeGatewayAgent({
        context: { agentId: 'agent-1', topicId: 'topic-1' },
        message: 'Explain this',
        userMessage,
      }),
    ).rejects.toThrow('stop');

    expect(aiAgentService.execAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({
        // Mirrored at the top level for servers that predate `userMessage`.
        contextSelections: userMessage.metadata!.contextSelections,
        pageSelections: userMessage.metadata!.pageSelections,
        userMessage,
      }),
    );
  });

  it('sends no selection fields for a plain-text send', async () => {
    const action = new GatewayActionImpl(vi.fn(), () => ({ topicDataMap: {} }) as any, undefined);

    await expect(
      action.executeGatewayAgent({
        context: { agentId: 'agent-1', topicId: 'topic-1' },
        message: 'Hello',
      }),
    ).rejects.toThrow('stop');

    const request = vi.mocked(aiAgentService.execAgentTask).mock.calls[0][0];
    expect(request.userMessage).toBeUndefined();
    expect(request.contextSelections).toBeUndefined();
    expect(request.pageSelections).toBeUndefined();
  });
});
