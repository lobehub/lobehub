import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchConnectors: vi.fn(async () => {}),
  isConnectorsInit: false,
  isSignedIn: false,
  scope: 'user_a:personal',
  toolSubscribe: vi.fn(),
  userSubscribe: vi.fn(),
}));

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => mocks.scope,
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
    mocks.scope = 'user_a:personal';
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

  // The other half of the same guard: a scope switch while the request is in
  // flight re-arms the gate, but the subscriber's re-entrant call is swallowed
  // by the in-flight slot — and the response being awaited belongs to the old
  // scope, so it will be discarded. The new scope must get its own request once
  // the slot frees up, instead of waiting for an unrelated store update.
  it('re-runs the fetch when the scope changed while one was in flight', async () => {
    mocks.isSignedIn = true;

    const { startConnectorInitialization } = await import('./connectors');

    let resolveInFlight!: () => void;
    mocks.fetchConnectors.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveInFlight = resolve)),
    );

    startConnectorInitialization();
    expect(mocks.fetchConnectors).toHaveBeenCalledTimes(1);

    const toolListener = mocks.toolSubscribe.mock.calls[0]![0] as () => void;

    // The workspace slug resolves while the personal request is still pending.
    mocks.scope = 'user_a:ws-1';
    mocks.isConnectorsInit = false;
    toolListener();

    // Swallowed by the in-flight slot — not a second request.
    expect(mocks.fetchConnectors).toHaveBeenCalledTimes(1);

    resolveInFlight();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.fetchConnectors).toHaveBeenCalledTimes(2);
  });
});
