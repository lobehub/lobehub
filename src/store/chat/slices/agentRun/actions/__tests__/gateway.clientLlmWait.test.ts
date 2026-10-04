import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService } from '@/services/aiAgent';
import { getLlmExecutorDeclarationFor } from '@/services/llmRelay';

import { GatewayActionImpl } from '../transports/gateway/gateway';

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: { resumeClientLlmWait: vi.fn() },
}));

vi.mock('@/services/llmRelay', () => ({
  getLlmExecutorDeclarationFor: vi.fn(),
  getLlmRelayClientId: () => 'tab-b',
}));

const declaration = { capabilities: ['llm_relay@1'], clientId: 'tab-b', providers: ['lmstudio'] };

const params = {
  agentId: 'agt-1',
  assistantMessageId: 'msg-assistant',
  operationId: 'op-1',
  provider: 'lmstudio',
  topicId: 'tpc-1',
};

const createAction = (status?: string) => {
  const state: any = { gatewayConnections: status ? { 'op-1': { status } } : {} };
  const action = new GatewayActionImpl(vi.fn(), () => state);
  const reconnect = vi.fn(async () => {
    state.gatewayConnections['op-1'] = { status: 'connected' };
  });
  (action as any).reconnectToGatewayOperation = reconnect;
  return { action, reconnect };
};

describe('continueClientLlmWait', () => {
  beforeEach(() => {
    vi.mocked(aiAgentService.resumeClientLlmWait).mockClear();
    vi.mocked(getLlmExecutorDeclarationFor).mockReturnValue(declaration);
    vi.mocked(aiAgentService.resumeClientLlmWait).mockResolvedValue({ resumed: true });
  });

  it('subscribes to the run first, then resumes it with this client as the executor', async () => {
    const { action, reconnect } = createAction();

    await expect(action.continueClientLlmWait(params)).resolves.toBe(true);

    expect(reconnect).toHaveBeenCalledWith(
      expect.objectContaining({ assistantMessageId: 'msg-assistant', operationId: 'op-1' }),
    );
    expect(aiAgentService.resumeClientLlmWait).toHaveBeenCalledWith({
      llmExecutor: declaration,
      operationId: 'op-1',
    });
    expect(reconnect.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(aiAgentService.resumeClientLlmWait).mock.invocationCallOrder[0],
    );
  });

  it('reuses a stream this tab is already subscribed to', async () => {
    const { action, reconnect } = createAction('connected');

    await action.continueClientLlmWait(params);

    expect(reconnect).not.toHaveBeenCalled();
    expect(aiAgentService.resumeClientLlmWait).toHaveBeenCalled();
  });

  it('does not claim the wait while the gateway socket never connects', async () => {
    vi.useFakeTimers();
    try {
      // The socket stays handshaking and never reaches `connected`.
      const { action } = createAction('connecting');

      const pending = action.continueClientLlmWait(params);
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(pending).resolves.toBe(false);
      expect(aiAgentService.resumeClientLlmWait).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the run alone when this client cannot reach the provider', async () => {
    vi.mocked(getLlmExecutorDeclarationFor).mockReturnValue(undefined);
    const { action, reconnect } = createAction();

    await expect(action.continueClientLlmWait(params)).resolves.toBe(false);

    expect(reconnect).not.toHaveBeenCalled();
    expect(aiAgentService.resumeClientLlmWait).not.toHaveBeenCalled();
  });
});
