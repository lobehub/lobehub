// Fixture: a retained function fed a deprecated field that stored user configs still carry.
import { renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';
import * as serverConfigStore from '@/store/serverConfig';

import { resolveGatewayModeEnabled, useIsGatewayModeEnabled } from './gatewayMode';

afterEach(() => vi.restoreAllMocks());

// The per-agent toggle was removed, but stored agent configs still carry the deprecated
// `disableGatewayMode` field.
it('ignores a legacy per-agent disableGatewayMode', () => {
  vi.spyOn(serverConfigStore, 'getServerConfigStoreState').mockReturnValue({
    serverConfig: { agentGatewayUrl: 'wss://gw', enableGatewayMode: true },
  } as any);
  useAgentStore.setState({
    activeAgentId: 'agent-1',
    agentMap: { 'agent-1': { chatConfig: { disableGatewayMode: true } } },
  } as any);

  expect(resolveGatewayModeEnabled()).toBe(true);
  expect(renderHook(() => useIsGatewayModeEnabled()).result.current).toBe(true);
});
