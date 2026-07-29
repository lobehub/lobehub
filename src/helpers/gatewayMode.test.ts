import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { type AgentStoreState } from '@/store/agent/initialState';
import * as serverConfigStore from '@/store/serverConfig';

import { resolveGatewayModeEnabled, useIsGatewayModeEnabled } from './gatewayMode';

const mockServerConfig = (serverConfig?: {
  agentGatewayUrl?: string;
  enableGatewayMode?: boolean;
}) =>
  vi
    .spyOn(serverConfigStore, 'getServerConfigStoreState')
    .mockReturnValue({ serverConfig } as ReturnType<
      typeof serverConfigStore.getServerConfigStoreState
    >);

const stateWith = (disableGatewayMode?: boolean): AgentStoreState =>
  ({
    activeAgentId: 'agent-1',
    agentMap: { 'agent-1': { chatConfig: { disableGatewayMode } } },
  }) as unknown as AgentStoreState;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveGatewayModeEnabled', () => {
  it('is enabled when the gateway URL + enableGatewayMode are set and the agent has not opted out', () => {
    mockServerConfig({ agentGatewayUrl: 'wss://gw', enableGatewayMode: true });

    expect(resolveGatewayModeEnabled(stateWith(false), 'agent-1')).toBe(true);
    // `disableGatewayMode: undefined` counts as enabled.
    expect(resolveGatewayModeEnabled(stateWith(undefined), 'agent-1')).toBe(true);
  });

  it('is disabled when the deployment has no gateway URL', () => {
    mockServerConfig(undefined);

    expect(resolveGatewayModeEnabled(stateWith(false), 'agent-1')).toBe(false);
  });

  it('is disabled when Gateway mode is off even with a gateway URL', () => {
    mockServerConfig({ agentGatewayUrl: 'wss://gw', enableGatewayMode: false });

    expect(resolveGatewayModeEnabled(stateWith(false), 'agent-1')).toBe(false);
  });

  it('is disabled when the agent opts out via disableGatewayMode', () => {
    mockServerConfig({ agentGatewayUrl: 'wss://gw', enableGatewayMode: true });

    expect(resolveGatewayModeEnabled(stateWith(true), 'agent-1')).toBe(false);
  });
});

describe('useIsGatewayModeEnabled', () => {
  it('re-computes when the agent toggles disableGatewayMode (reactivity, LOBE-11473)', () => {
    mockServerConfig({ agentGatewayUrl: 'wss://gw', enableGatewayMode: true });
    useAgentStore.setState(stateWith(false));

    const { result } = renderHook(() => useIsGatewayModeEnabled('agent-1'));
    expect(result.current).toBe(true);

    // Toggling Gateway Mode from the chat ActionBar mutates chatConfig only; the
    // hook must still re-render off its own subscription (the display sites
    // subscribe to agencyConfig, a sibling slice, so they would otherwise stay
    // stale after sends fall back to sandbox).
    act(() => {
      useAgentStore.setState({
        agentMap: { 'agent-1': { chatConfig: { disableGatewayMode: true } } },
      } as Partial<AgentStoreState>);
    });
    expect(result.current).toBe(false);
  });
});
