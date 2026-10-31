import type * as ConstModule from '@lobechat/const';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { refreshChannelListIfEnabled } from '@/store/channel/refreshIfEnabled';

import { useAgentStore } from '../../store';

const mocks = vi.hoisted(() => ({ isDesktop: false, resolveGatewayDeviceId: vi.fn() }));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof ConstModule>()),
  get isDesktop() {
    return mocks.isDesktop;
  },
}));

vi.mock('@/services/agent', () => ({
  AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT: 12,
  agentService: { createAgent: vi.fn() },
}));

vi.mock('@/store/channel/refreshIfEnabled', () => ({ refreshChannelListIfEnabled: vi.fn() }));

vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => ({ resolveGatewayDeviceId: mocks.resolveGatewayDeviceId }),
}));

const params = { config: { name: 'Ada', title: 'Math Tutor' } };

describe('createAgent direct Channel', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.isDesktop = false;
  });

  it("refetches Channels once the server created the Agent and its creator's direct Channel", async () => {
    vi.mocked(agentService.createAgent).mockImplementation(async () => {
      expect(refreshChannelListIfEnabled).not.toHaveBeenCalled();
      return { agentId: 'agent-new' };
    });
    const { result } = renderHook(() => useAgentStore());

    await act(async () => {
      await result.current.createAgent(params);
    });

    expect(refreshChannelListIfEnabled).toHaveBeenCalledTimes(1);
  });

  it('names this desktop so a local Agent can answer in its direct Channel here', async () => {
    mocks.isDesktop = true;
    mocks.resolveGatewayDeviceId.mockResolvedValue('desktop-device');
    vi.mocked(agentService.createAgent).mockResolvedValue({ agentId: 'agent-new' });
    const { result } = renderHook(() => useAgentStore());

    await act(async () => {
      await result.current.createAgent(params);
    });

    expect(vi.mocked(agentService.createAgent).mock.calls[0][0].localDeviceId).toBe(
      'desktop-device',
    );
  });

  it('sends no device from the web', async () => {
    vi.mocked(agentService.createAgent).mockResolvedValue({ agentId: 'agent-new' });
    const { result } = renderHook(() => useAgentStore());

    await act(async () => {
      await result.current.createAgent(params);
    });

    expect(mocks.resolveGatewayDeviceId).not.toHaveBeenCalled();
    expect(vi.mocked(agentService.createAgent).mock.calls[0][0].localDeviceId).toBeUndefined();
  });

  it('refetches nothing when the Agent was not created', async () => {
    vi.mocked(agentService.createAgent).mockRejectedValue(new Error('forbidden'));
    const { result } = renderHook(() => useAgentStore());

    await act(async () => {
      await expect(result.current.createAgent(params)).rejects.toThrow('forbidden');
    });

    expect(refreshChannelListIfEnabled).not.toHaveBeenCalled();
  });
});
