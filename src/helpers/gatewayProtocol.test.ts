import { afterEach, describe, expect, it, vi } from 'vitest';

import * as serverConfigStore from '@/store/serverConfig';

import { canUseGatewayProtocolV2 } from './gatewayProtocol';

const mockConfig = (protocol?: number) =>
  vi.spyOn(serverConfigStore, 'getServerConfigStoreState').mockReturnValue({
    serverConfig: { agentGatewayProtocol: protocol },
  } as unknown as ReturnType<typeof serverConfigStore.getServerConfigStoreState>);

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { window?: unknown }).window;
});

describe('canUseGatewayProtocolV2', () => {
  it('follows the deployment capability', () => {
    mockConfig(2);
    expect(canUseGatewayProtocolV2()).toBe(true);

    // This deployment's gateway has no `/v2/ws` at all.
    mockConfig(1);
    expect(canUseGatewayProtocolV2()).toBe(false);
  });

  it('defaults to v1 when the server said nothing', () => {
    mockConfig(undefined);
    expect(canUseGatewayProtocolV2()).toBe(false);
  });

  it('prefers the global store the shell publishes before React mounts', () => {
    mockConfig(1);
    (globalThis as { window?: unknown }).window = {
      global_serverConfigStore: {
        getState: () => ({ serverConfig: { agentGatewayProtocol: 2 } }),
      },
    };

    expect(canUseGatewayProtocolV2()).toBe(true);
  });
});
