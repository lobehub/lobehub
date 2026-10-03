import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService } from './aiAgent';

const mocks = vi.hoisted(() => ({ execAgent: vi.fn(), llmExecutor: vi.fn() }));

vi.mock('@/services/llmRelay', () => ({ buildLlmExecutorDeclaration: mocks.llmExecutor }));

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

  // Inside the `agent_llm_relay` rollout the tab offers to execute relayed LLM
  // calls; the server only relays to a run that carries this declaration.
  it('declares this tab as an LLM relay executor when the rollout includes it', async () => {
    const llmExecutor = { capabilities: ['llm_relay@1'], clientId: 'tab-1', providers: ['ollama'] };
    mocks.llmExecutor.mockReturnValueOnce(llmExecutor);
    mocks.execAgent.mockResolvedValueOnce({ success: true });

    await aiAgentService.execAgentTask({ agentId: 'agt-1', prompt: 'hi' });

    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({ llmExecutor }),
      undefined,
    );
  });
});
