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

  // A scope switch commits tool-store state synchronously (the connector slice
  // clears its views through `ensureScope`) and the fetch runs inside that same
  // commit. If the guard were only set once the fetch returned, the commit would
  // re-enter this subscriber while it is still unset and launch a duplicate
  // list request for one switch.
  it('claims the in-flight slot before entering the fetch', async () => {
    mocks.isSignedIn = true;

    const { startConnectorInitialization } = await import('./connectors');
    startConnectorInitialization();
    expect(mocks.fetchConnectors).toHaveBeenCalledTimes(1);

    // Let the first fetch settle so its in-flight slot is released.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const toolListener = mocks.toolSubscribe.mock.calls[0]![0] as () => void;

    // The switch re-arms the init gate, and the fetch re-enters the subscriber
    // once — the guard must already be up.
    mocks.isConnectorsInit = false;
    let reentered = false;
    mocks.fetchConnectors.mockImplementation(async () => {
      if (reentered) return;
      reentered = true;
      toolListener();
    });

    toolListener();

    expect(mocks.fetchConnectors).toHaveBeenCalledTimes(2);
  });
});
