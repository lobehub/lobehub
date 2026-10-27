import { renderHook } from '@testing-library/react';
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveGatewayModeEnabled', () => {
  it('is enabled when the gateway URL + enableGatewayMode are set', () => {
    mockServerConfig({ agentGatewayUrl: 'wss://gw', enableGatewayMode: true });

    expect(resolveGatewayModeEnabled()).toBe(true);
  });

  it('is disabled when the deployment has no gateway URL', () => {
    mockServerConfig(undefined);

    expect(resolveGatewayModeEnabled()).toBe(false);
  });

  it('is disabled when Gateway mode is off even with a gateway URL', () => {
    mockServerConfig({ agentGatewayUrl: 'wss://gw', enableGatewayMode: false });

    expect(resolveGatewayModeEnabled()).toBe(false);
  });

  // There is no in-browser runtime to fall back to, so a stored per-agent
  // `disableGatewayMode` (the removed toggle) no longer turns the gateway off.
  it('ignores a legacy per-agent disableGatewayMode', () => {
    mockServerConfig({ agentGatewayUrl: 'wss://gw', enableGatewayMode: true });
    useAgentStore.setState({
      activeAgentId: 'agent-1',
      agentMap: { 'agent-1': { chatConfig: { disableGatewayMode: true } } },
    } as unknown as Partial<AgentStoreState>);

    expect(resolveGatewayModeEnabled()).toBe(true);
    expect(renderHook(() => useIsGatewayModeEnabled()).result.current).toBe(true);
  });
});
