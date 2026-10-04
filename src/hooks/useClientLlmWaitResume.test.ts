import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CLIENT_LLM_WAIT_POLL_MAX_MS,
  CLIENT_LLM_WAIT_POLL_MIN_MS,
  clientLlmWaitPollInterval,
  useClientLlmWaitResume,
} from './useClientLlmWaitResume';

const listClientLlmWaits = vi.fn();
const continueClientLlmWait = vi.fn();

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: { listClientLlmWaits: () => listClientLlmWaits() },
}));
vi.mock('@/services/llmRelay', () => ({
  getLlmExecutorDeclarationFor: (provider: string) =>
    provider === 'lmstudio' ? { clientId: 'tab-a', providers: ['lmstudio'] } : undefined,
}));
vi.mock('@/store/chat', () => ({
  useChatStore: { getState: () => ({ continueClientLlmWait }) },
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: any) => selector({ isSignedIn: true, isUserStateInit: true }),
}));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: any) =>
    selector({
      featureFlags: { enableLlmRelay: true },
      serverConfig: { agentGatewayUrl: 'wss://gateway' },
    }),
}));
vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: any) => selector({ enabledAiProviders: [{ id: 'lmstudio' }] }),
}));

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('useClientLlmWaitResume', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listClientLlmWaits.mockReset();
    continueClientLlmWait.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('picks up a run that parks after this client opened the app', async () => {
    const parked = { operationId: 'op-1', provider: 'lmstudio', topicId: 'tpc-1' };
    listClientLlmWaits.mockResolvedValueOnce([]).mockResolvedValue([parked]);

    renderHook(() => useClientLlmWaitResume(), { wrapper });
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(listClientLlmWaits).toHaveBeenCalledTimes(1);
    expect(continueClientLlmWait).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(CLIENT_LLM_WAIT_POLL_MIN_MS);
    await flush();

    expect(listClientLlmWaits).toHaveBeenCalledTimes(2);
    expect(continueClientLlmWait).toHaveBeenCalledWith(parked);
  });

  it('leaves runs for providers this client cannot reach', async () => {
    listClientLlmWaits.mockResolvedValue([
      { operationId: 'op-2', provider: 'ollama', topicId: 'tpc-2' },
    ]);

    renderHook(() => useClientLlmWaitResume(), { wrapper });
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    expect(continueClientLlmWait).not.toHaveBeenCalled();
  });
});

describe('clientLlmWaitPollInterval', () => {
  it('backs off while nothing waits, capped well inside the wait window', () => {
    expect(clientLlmWaitPollInterval(0)).toBe(CLIENT_LLM_WAIT_POLL_MIN_MS);
    expect(clientLlmWaitPollInterval(1)).toBe(CLIENT_LLM_WAIT_POLL_MIN_MS * 2);
    expect(clientLlmWaitPollInterval(10)).toBe(CLIENT_LLM_WAIT_POLL_MAX_MS);
    expect(clientLlmWaitPollInterval(-1)).toBe(CLIENT_LLM_WAIT_POLL_MIN_MS);
  });
});
