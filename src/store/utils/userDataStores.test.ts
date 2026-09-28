import { beforeEach, describe, expect, it, vi } from 'vitest';

const resetGatewayMuxRegistry = vi.hoisted(() => vi.fn());
const storeResets = vi.hoisted(() => [] as Array<() => void>);
const fakeStore = vi.hoisted(() => () => ({
  getState: () => {
    const reset = vi.fn();
    storeResets.push(reset);
    return { reset };
  },
}));

vi.mock('react-dom', () => ({ unstable_batchedUpdates: (fn: () => void) => fn() }));
vi.mock('@/store/chat/slices/agentRun/actions/transports/gateway/muxRegistry', () => ({
  resetGatewayMuxRegistry,
}));
vi.mock('@/store/agent', () => ({ useAgentStore: fakeStore() }));
vi.mock('@/store/agentGroup', () => ({ useAgentGroupStore: fakeStore() }));
vi.mock('@/store/chat', () => ({ useChatStore: fakeStore() }));
vi.mock('@/store/discover', () => ({ useDiscoverStore: fakeStore() }));
vi.mock('@/store/document', () => ({ useDocumentStore: fakeStore() }));
vi.mock('@/store/eval', () => ({ useEvalStore: fakeStore() }));
vi.mock('@/store/file', () => ({ useFileStore: fakeStore() }));
vi.mock('@/store/home', () => ({ useHomeStore: fakeStore() }));
vi.mock('@/store/image', () => ({ useImageStore: fakeStore() }));
vi.mock('@/store/library', () => ({ useKnowledgeBaseStore: fakeStore() }));
vi.mock('@/store/mention', () => ({ useMentionStore: fakeStore() }));
vi.mock('@/store/notebook', () => ({ useNotebookStore: fakeStore() }));
vi.mock('@/store/page', () => ({ usePageStore: fakeStore() }));
vi.mock('@/store/session', () => ({ useSessionStore: fakeStore() }));
vi.mock('@/store/task', () => ({ useTaskStore: fakeStore() }));
vi.mock('@/store/tool', () => ({ useToolStore: fakeStore() }));
vi.mock('@/store/user', () => ({ useUserStore: fakeStore() }));
vi.mock('@/store/userMemory', () => ({ useUserMemoryStore: fakeStore() }));
vi.mock('@/store/video', () => ({ useVideoStore: fakeStore() }));

describe('stores.reset', () => {
  beforeEach(() => {
    resetGatewayMuxRegistry.mockClear();
    storeResets.length = 0;
  });

  it('tears down the gateway mux registry before wiping the user-data stores', async () => {
    const { stores } = await import('./userDataStores');
    const order: string[] = [];
    resetGatewayMuxRegistry.mockImplementation(() => order.push('mux'));

    stores.reset();

    expect(resetGatewayMuxRegistry).toHaveBeenCalledTimes(1);
    expect(storeResets).toHaveLength(19);
    for (const reset of storeResets) expect(reset).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe('mux');
  });
});
