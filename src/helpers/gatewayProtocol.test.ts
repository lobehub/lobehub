import { afterEach, describe, expect, it, vi } from 'vitest';

import * as serverConfigStore from '@/store/serverConfig';

import { canUseGatewayProtocolV2 } from './gatewayProtocol';

const mockConfig = (protocol?: number, rollout?: boolean) =>
  vi.spyOn(serverConfigStore, 'getServerConfigStoreState').mockReturnValue({
    featureFlags: { enableGatewayMux: rollout },
    serverConfig: { agentGatewayProtocol: protocol },
  } as unknown as ReturnType<typeof serverConfigStore.getServerConfigStoreState>);

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { window?: unknown }).window;
});

describe('canUseGatewayProtocolV2', () => {
  it('needs both the deployment capability and the rollout', () => {
    mockConfig(2, true);
    expect(canUseGatewayProtocolV2()).toBe(true);

    // In the rollout, but this deployment's gateway has no `/v2/ws` at all.
    mockConfig(1, true);
    expect(canUseGatewayProtocolV2()).toBe(false);

    // The gateway has it; this user is not in the rollout yet.
    mockConfig(2, false);
    expect(canUseGatewayProtocolV2()).toBe(false);
  });

  it('defaults to v1 when the server said nothing', () => {
    mockConfig(undefined, undefined);
    expect(canUseGatewayProtocolV2()).toBe(false);
  });

  it('prefers the global store the shell publishes before React mounts', () => {
    mockConfig(1, false);
    (globalThis as { window?: unknown }).window = {
      global_serverConfigStore: {
        getState: () => ({
          featureFlags: { enableGatewayMux: true },
          serverConfig: { agentGatewayProtocol: 2 },
        }),
      },
    };

    expect(canUseGatewayProtocolV2()).toBe(true);
  });
});
