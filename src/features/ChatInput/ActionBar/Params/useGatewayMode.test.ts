import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGatewayMode } from './useGatewayMode';

const mocks = vi.hoisted(() => ({
  agentId: 'agent-1',
  canConfigureResource: true,
  defaultDisabled: undefined as boolean | undefined,
  disabledByAgent: {} as Record<string, boolean | undefined>,
  serverEnabled: true,
  updateAgentChatConfig: vi.fn(),
}));

vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => mocks.agentId }));
vi.mock('../../hooks/useChatInputResourceAccess', () => ({
  useChatInputResourceAccess: () => ({ canConfigureResource: mocks.canConfigureResource }),
}));
vi.mock('../../hooks/useUpdateAgentConfig', () => ({
  useUpdateAgentConfig: () => ({ updateAgentChatConfig: mocks.updateAgentChatConfig }),
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  chatConfigByIdSelectors: {
    getChatConfigById: (agentId: string) => () => ({
      disableGatewayMode: mocks.disabledByAgent[agentId],
    }),
  },
}));
vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: { enableGatewayMode: () => mocks.serverEnabled },
  useServerConfigStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({
  settingsSelectors: {
    defaultAgentConfig: () => ({ chatConfig: { disableGatewayMode: mocks.defaultDisabled } }),
  },
}));

describe('advanced parameters gateway mode', () => {
  beforeEach(() => {
    mocks.agentId = 'agent-1';
    mocks.canConfigureResource = true;
    mocks.defaultDisabled = undefined;
    mocks.disabledByAgent = {};
    mocks.serverEnabled = true;
    mocks.updateAgentChatConfig.mockReset().mockResolvedValue(undefined);
  });

  it.each([
    [undefined, undefined, true],
    [undefined, true, false],
    [undefined, false, true],
    [false, true, true],
    [true, false, false],
  ])('preserves agent=%s / default=%s as enabled=%s', (agent, defaults, enabled) => {
    mocks.disabledByAgent['agent-1'] = agent;
    mocks.defaultDisabled = defaults;
    const { result } = renderHook(() => useGatewayMode());

    expect(result.current.enabled).toBe(enabled);
    expect(result.current.available).toBe(true);
    expect(mocks.updateAgentChatConfig).not.toHaveBeenCalled();
  });

  it('follows the composer agent rather than another agent configuration', () => {
    mocks.disabledByAgent = { 'agent-1': true, 'agent-2': false };
    const { result, rerender } = renderHook(() => useGatewayMode());
    expect(result.current.enabled).toBe(false);

    mocks.agentId = 'agent-2';
    rerender();
    expect(result.current.enabled).toBe(true);
  });

  it.each([true, false])(
    'saves enabled=%s using the existing inverted config field',
    async (enabled) => {
      const { result } = renderHook(() => useGatewayMode());

      await act(async () => result.current.onChange(enabled));

      expect(mocks.updateAgentChatConfig).toHaveBeenCalledWith({ disableGatewayMode: !enabled });
      expect(result.current.loading).toBe(false);
    },
  );

  it.each(['server', 'permission', 'agent'] as const)(
    'hides the control and prevents writes when %s is unavailable',
    async (gate) => {
      if (gate === 'server') mocks.serverEnabled = false;
      if (gate === 'permission') mocks.canConfigureResource = false;
      if (gate === 'agent') mocks.agentId = '';
      const { result } = renderHook(() => useGatewayMode());

      expect(result.current.available).toBe(false);
      await act(async () => result.current.onChange(false));
      expect(mocks.updateAgentChatConfig).not.toHaveBeenCalled();
    },
  );

  it('clears saving feedback after a failed write without changing the stored selection', async () => {
    mocks.updateAgentChatConfig.mockRejectedValueOnce(new Error('Save failed'));
    const { result } = renderHook(() => useGatewayMode());

    await act(async () => {
      await expect(result.current.onChange(false)).rejects.toThrow('Save failed');
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.enabled).toBe(true);
  });
});
