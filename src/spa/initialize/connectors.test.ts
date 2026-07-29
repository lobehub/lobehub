import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchConnectors: vi.fn(async () => {}),
  isConnectorsInit: false,
  isSignedIn: false,
  toolSubscribe: vi.fn(),
  userSubscribe: vi.fn(),
}));

vi.mock('@/store/tool', () => ({
  getToolStoreState: () => ({
    fetchConnectors: mocks.fetchConnectors,
    isConnectorsInit: mocks.isConnectorsInit,
  }),
  useToolStore: {
    subscribe: mocks.toolSubscribe,
  },
}));

vi.mock('@/store/user', () => ({
  getUserStoreState: () => ({
    isSignedIn: mocks.isSignedIn,
  }),
  useUserStore: {
    subscribe: mocks.userSubscribe,
  },
}));

describe('startConnectorInitialization', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.fetchConnectors.mockResolvedValue(undefined);
    mocks.isConnectorsInit = false;
    mocks.isSignedIn = false;
  });

  it('fetches connectors when a signed-in user is present', async () => {
    mocks.isSignedIn = true;

    const { startConnectorInitialization } = await import('./connectors');
    startConnectorInitialization();

    expect(mocks.fetchConnectors).toHaveBeenCalledTimes(1);
  });

  it('waits for login before fetching connectors', async () => {
    const { startConnectorInitialization } = await import('./connectors');
    startConnectorInitialization();

    expect(mocks.fetchConnectors).not.toHaveBeenCalled();

    const userListener = mocks.userSubscribe.mock.calls[0]![0] as () => void;
    mocks.isSignedIn = true;
    userListener();

    expect(mocks.fetchConnectors).toHaveBeenCalledTimes(1);
  });
});
