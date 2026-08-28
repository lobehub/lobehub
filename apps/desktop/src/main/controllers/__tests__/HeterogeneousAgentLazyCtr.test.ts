import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import type { RemoteServerAuth } from '@/modules/heterogeneousAgent/fileStorePort';

import HeterogeneousAgentCtr from '../HeterogeneousAgentCtr';

const implementationMocks = vi.hoisted(() => ({
  afterAppReady: vi.fn(),
  constructor: vi.fn(),
  startSession: vi.fn(async (..._args: unknown[]) => ({ sessionId: 'session-1' })),
}));

vi.mock('../HeterogeneousAgentImpl', () => ({
  default: class MockHeterogeneousAgentImplementation {
    constructor(app: App, remoteServerAuth?: RemoteServerAuth) {
      implementationMocks.constructor(app, remoteServerAuth);
    }

    afterAppReady() {
      implementationMocks.afterAppReady();
    }

    startSession(...args: unknown[]) {
      return implementationMocks.startSession(...args);
    }
  },
}));

describe('HeterogeneousAgentCtr lazy implementation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defers the heavy implementation and initializes it exactly once on first use', async () => {
    const app = {} as App;
    const controller = new HeterogeneousAgentCtr(app);

    expect(implementationMocks.constructor).not.toHaveBeenCalled();
    expect(implementationMocks.afterAppReady).not.toHaveBeenCalled();

    await expect((controller as any).startSession({ prompt: 'first' })).resolves.toEqual({
      sessionId: 'session-1',
    });
    await (controller as any).startSession({ prompt: 'second' });

    expect(implementationMocks.constructor).toHaveBeenCalledOnce();
    expect(implementationMocks.constructor).toHaveBeenCalledWith(app, expect.any(Object));
    expect(implementationMocks.afterAppReady).toHaveBeenCalledOnce();
    expect(implementationMocks.startSession).toHaveBeenCalledTimes(2);
  });

  it('injects remote-server auth resolved on the eager side of the lazy boundary', async () => {
    const remoteServerConfigCtr = {
      getAccessToken: vi.fn(async () => 'token-1'),
      getRemoteServerUrl: vi.fn(async () => 'https://cloud.lobehub.com'),
    };
    const getController = vi.fn(() => remoteServerConfigCtr as any);
    const app = { getController } as unknown as App;

    const controller = new HeterogeneousAgentCtr(app);
    await (controller as any).startSession({ prompt: 'first' });

    const auth = implementationMocks.constructor.mock.calls[0][1] as RemoteServerAuth;

    await expect(auth.getServerUrl()).resolves.toBe('https://cloud.lobehub.com');
    await expect(auth.getAccessToken()).resolves.toBe('token-1');

    // A registry lookup that comes back empty must degrade to "no authed remote
    // server" — never a throw, which would escape as a fatal unhandled rejection.
    getController.mockReturnValue(undefined as any);

    await expect(auth.getServerUrl()).resolves.toBeNull();
    await expect(auth.getAccessToken()).resolves.toBeNull();
  });
});
