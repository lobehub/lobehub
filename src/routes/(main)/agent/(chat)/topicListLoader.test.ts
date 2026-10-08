import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  agentChatTopicListLoader,
  PRE_PAINT_HYDRATE_TIMEOUT,
  preHydrateTopicListForRoute,
} from './topicListLoader';

const preHydrateTopicListMock = vi.hoisted(() => vi.fn(async () => true));
const getSidebarTopicListParamsMock = vi.hoisted(() => vi.fn());
const builtinAgentIdMap = vi.hoisted(() => ({ inbox: 'agt_inbox' }) as Record<string, string>);

vi.mock('@lobechat/builtin-agents', () => ({
  BUILTIN_AGENT_SLUGS: { inbox: 'inbox' },
}));

vi.mock('@/hooks/chatTopicListQuery', () => ({
  getSidebarTopicListParams: getSidebarTopicListParamsMock,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: { getState: () => ({ builtinAgentIdMap }) },
}));

vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: {
    getBuiltinAgentId: (slug: string) => (state: { builtinAgentIdMap: Record<string, string> }) =>
      state.builtinAgentIdMap[slug],
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: { getState: () => ({ preHydrateTopicList: preHydrateTopicListMock }) },
}));

const loaderArgs = (aid?: string) => ({ params: aid ? { aid } : {} }) as never;

describe('agent chat topic list loader', () => {
  beforeEach(() => {
    preHydrateTopicListMock.mockClear();
    preHydrateTopicListMock.mockResolvedValue(true);
    getSidebarTopicListParamsMock.mockReset();
    getSidebarTopicListParamsMock.mockReturnValue({ agentId: 'agt_1', pageSize: 20 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('seeds the persisted page for the route agent before the route commits', async () => {
    getSidebarTopicListParamsMock.mockReturnValue({ agentId: 'agt_1', pageSize: 20 });

    await expect(agentChatTopicListLoader(loaderArgs('agt_1'))).resolves.toBeNull();

    expect(getSidebarTopicListParamsMock).toHaveBeenCalledWith({ agentId: 'agt_1' });
    expect(preHydrateTopicListMock).toHaveBeenCalledWith({ agentId: 'agt_1', pageSize: 20 });
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
