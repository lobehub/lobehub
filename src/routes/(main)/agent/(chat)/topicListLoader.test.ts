import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRE_PAINT_HYDRATE_TIMEOUT } from '@/libs/replica/prePaint';

import {
  agentChatTopicListLoader,
  preHydrateMessagesForRoute,
  preHydrateTopicListForRoute,
} from './topicListLoader';

const preHydrateTopicListMock = vi.hoisted(() => vi.fn(async () => true));
const getSidebarTopicListParamsMock = vi.hoisted(() => vi.fn());
const preHydrateMessagesMock = vi.hoisted(() => vi.fn(async () => true));
const builtinAgentIdMap = vi.hoisted(() => ({ inbox: 'agt_inbox' }) as Record<string, string>);
const preHydrateBuiltinAgentMock = vi.hoisted(() => vi.fn(async () => true));
const preHydrateDeviceListMock = vi.hoisted(() => vi.fn(async () => true));
const preHydrateVerifyRunsMock = vi.hoisted(() => vi.fn(async (_ids: string[]) => {}));
const chatState = vi.hoisted(() => ({ dbMessagesMap: {} as Record<string, unknown[]> }));

vi.mock('@lobechat/builtin-agents', () => ({
  BUILTIN_AGENT_SLUGS: { inbox: 'inbox' },
}));

vi.mock('@/hooks/chatTopicListQuery', () => ({
  getSidebarTopicListParams: getSidebarTopicListParamsMock,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: {
    getState: () => ({ builtinAgentIdMap, preHydrateBuiltinAgent: preHydrateBuiltinAgentMock }),
  },
}));

vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: {
    getBuiltinAgentId: (slug: string) => (state: { builtinAgentIdMap: Record<string, string> }) =>
      state.builtinAgentIdMap[slug],
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: () => ({
      dbMessagesMap: chatState.dbMessagesMap,
      preHydrateMessages: preHydrateMessagesMock,
      preHydrateTopicList: preHydrateTopicListMock,
    }),
  },
}));

vi.mock('@/store/device', () => ({
  useDeviceStore: { getState: () => ({ preHydrateDeviceList: preHydrateDeviceListMock }) },
}));

vi.mock('@/store/verify', () => ({
  useVerifyStore: { getState: () => ({ preHydrateVerifyRuns: preHydrateVerifyRunsMock }) },
}));

const loaderArgs = (aid?: string) => ({ params: aid ? { aid } : {} }) as never;

describe('agent chat topic list loader', () => {
  beforeEach(() => {
    preHydrateTopicListMock.mockClear();
    preHydrateTopicListMock.mockResolvedValue(true);
    preHydrateBuiltinAgentMock.mockClear();
    preHydrateBuiltinAgentMock.mockResolvedValue(true);
    preHydrateDeviceListMock.mockClear();
    preHydrateDeviceListMock.mockResolvedValue(true);
    getSidebarTopicListParamsMock.mockReset();
    getSidebarTopicListParamsMock.mockReturnValue({ agentId: 'agt_1', pageSize: 20 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Without it the input bar's device chip read "Unknown device" until the
  // mount-time hydrate (or the network) answered.
  it('seeds the persisted device list before the route commits', async () => {
    await agentChatTopicListLoader(loaderArgs('agt_1'));

    expect(preHydrateDeviceListMock).toHaveBeenCalledTimes(1);
  });

  it('does not let a stalled device-list read block the route', async () => {
    vi.useFakeTimers();
    preHydrateDeviceListMock.mockImplementation(() => new Promise(() => {}));

    const settled = vi.fn();
    void agentChatTopicListLoader(loaderArgs('agt_1')).then(settled);

    await vi.advanceTimersByTimeAsync(PRE_PAINT_HYDRATE_TIMEOUT);
    expect(settled).toHaveBeenCalled();
  });

  it('seeds the persisted page for the route agent before the route commits', async () => {
    getSidebarTopicListParamsMock.mockReturnValue({ agentId: 'agt_1', pageSize: 20 });

    await expect(agentChatTopicListLoader(loaderArgs('agt_1'))).resolves.toBeNull();

    expect(getSidebarTopicListParamsMock).toHaveBeenCalledWith({ agentId: 'agt_1' });
    expect(preHydrateTopicListMock).toHaveBeenCalledWith({ agentId: 'agt_1', pageSize: 20 });
  });

  it('pre-hydrates the persisted builtin before resolving a builtin slug', async () => {
    await expect(agentChatTopicListLoader(loaderArgs('inbox'))).resolves.toBeNull();

    expect(preHydrateBuiltinAgentMock).toHaveBeenCalledWith('inbox');
    expect(getSidebarTopicListParamsMock).toHaveBeenCalledWith({ agentId: 'agt_inbox' });
  });

  it('does not pre-hydrate a builtin for a concrete agent id', async () => {
    await agentChatTopicListLoader(loaderArgs('agt_1'));

    expect(preHydrateBuiltinAgentMock).not.toHaveBeenCalled();
  });

  it('resolves a builtin slug to its agent id', async () => {
    await preHydrateTopicListForRoute('inbox');

    expect(getSidebarTopicListParamsMock).toHaveBeenCalledWith({ agentId: 'agt_inbox' });
  });

  it('skips entirely when the route names no agent', async () => {
    await expect(agentChatTopicListLoader(loaderArgs())).resolves.toBeNull();

    expect(getSidebarTopicListParamsMock).not.toHaveBeenCalled();
    expect(preHydrateTopicListMock).not.toHaveBeenCalled();
  });

  it('does not block the route when the hydrate never resolves', async () => {
    vi.useFakeTimers();
    preHydrateTopicListMock.mockImplementation(() => new Promise(() => {}));

    const pending = agentChatTopicListLoader(loaderArgs('agt_1'));
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(PRE_PAINT_HYDRATE_TIMEOUT - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeNull();
  });

  it('never rejects the route when the hydrate fails', async () => {
    preHydrateTopicListMock.mockRejectedValue(new Error('storage exploded'));

    await expect(agentChatTopicListLoader(loaderArgs('agt_1'))).resolves.toBeNull();
  });
});

describe('agent chat transcript pre-hydrate', () => {
  beforeEach(() => {
    chatState.dbMessagesMap = {};
    preHydrateMessagesMock.mockReset();
    preHydrateMessagesMock.mockResolvedValue(true);
    preHydrateVerifyRunsMock.mockReset();
  });

  it("seeds the topic's persisted transcript into the chat store before the route commits", async () => {
    await agentChatTopicListLoader({ params: { aid: 'agt_1', topicId: 'tpc_1' } } as never);

    expect(preHydrateMessagesMock).toHaveBeenCalledWith({
      agentId: 'agt_1',
      scope: 'main',
      topicId: 'tpc_1',
    });
  });

  it('seeds the verify cards of the seeded transcript before the route commits', async () => {
    const order: string[] = [];
    preHydrateMessagesMock.mockImplementation(async () => {
      order.push('messages');
      chatState.dbMessagesMap = {
        main_agt_1_tpc_1: [
          { content: 'hi', id: 'msg_1', role: 'user' },
          { id: 'msg_2', metadata: { verifyOperationId: 'op_1' }, role: 'verify' },
          { id: 'msg_3', metadata: {}, role: 'verify' },
        ],
      };
      return true;
    });
    preHydrateVerifyRunsMock.mockImplementation(async () => {
      order.push('verify');
    });

    await preHydrateMessagesForRoute('agt_1', 'tpc_1');

    expect(preHydrateVerifyRunsMock).toHaveBeenCalledWith(['op_1']);
    expect(order).toEqual(['messages', 'verify']);
  });

  it('never rejects the route when the verify cards cannot be read', async () => {
    preHydrateVerifyRunsMock.mockRejectedValueOnce(new Error('storage exploded'));

    await expect(preHydrateMessagesForRoute('agt_1', 'tpc_1')).resolves.toBeUndefined();
    expect(preHydrateMessagesMock).toHaveBeenCalled();
  });

  it('skips a route without a topic', async () => {
    await preHydrateMessagesForRoute('agt_1');

    expect(preHydrateMessagesMock).not.toHaveBeenCalled();
  });

  it('never rejects the route when the transcript hydrate fails', async () => {
    preHydrateMessagesMock.mockRejectedValueOnce(new Error('storage exploded'));

    await expect(preHydrateMessagesForRoute('agt_1', 'tpc_1')).resolves.toBeUndefined();
  });
});
