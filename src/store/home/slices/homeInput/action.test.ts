import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HomeStore } from '@/store/home/store';
import type { StoreSetter } from '@/store/types';

import { HomeInputActionImpl } from './action';

const navigateMock = vi.hoisted(() => vi.fn());
const createAgentMock = vi.hoisted(() => vi.fn());
const updateAgentConfigByIdMock = vi.hoisted(() => vi.fn());
const refreshBuiltinAgentMock = vi.hoisted(() => vi.fn());
const sendMessageMock = vi.hoisted(() => vi.fn());
const refreshAgentListMock = vi.hoisted(() => vi.fn());
const toggleAgentBuilderPanelMock = vi.hoisted(() => vi.fn());
const toggleRightPanelMock = vi.hoisted(() => vi.fn());
const setChatPanelExpandedMock = vi.hoisted(() => vi.fn());
const createGroupMock = vi.hoisted(() => vi.fn());
const loadGroupsMock = vi.hoisted(() => vi.fn());

const agentState = vi.hoisted(() => ({
  agentConfigMap: {
    inbox: {
      model: 'gpt-4o-mini',
      provider: 'openai',
    },
  },
  agentMap: {
    agentBuilder: {},
    groupAgentBuilder: {},
  },
  builtinAgentIdMap: {
    'agent-builder': 'agentBuilder',
    'group-agent-builder': 'groupAgentBuilder',
  },
  createAgent: createAgentMock,
  inboxAgentId: 'inbox',
  refreshBuiltinAgent: refreshBuiltinAgentMock,
  updateAgentConfigById: updateAgentConfigByIdMock,
}));

vi.mock('@lobechat/builtin-agents', () => ({
  BUILTIN_AGENT_SLUGS: {
    agentBuilder: 'agent-builder',
    groupAgentBuilder: 'group-agent-builder',
  },
}));

vi.mock('@/services/chatGroup', () => ({
  chatGroupService: {
    createGroup: createGroupMock,
  },
}));

vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => agentState,
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    getAgentConfigById:
      (id: string) =>
      (state: typeof agentState): { model: string; provider: string } | undefined =>
        state.agentConfigMap[id as keyof typeof state.agentConfigMap],
  },
  builtinAgentSelectors: {
    inboxAgentId: (state: typeof agentState) => state.inboxAgentId,
  },
}));

vi.mock('@/store/agentGroup', () => ({
  getChatGroupStoreState: () => ({
    loadGroups: loadGroupsMock,
  }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: () => ({
      sendMessage: sendMessageMock,
    }),
  },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: {
    getState: () => ({
      toggleAgentBuilderPanel: toggleAgentBuilderPanelMock,
      toggleRightPanel: toggleRightPanelMock,
    }),
  },
}));

vi.mock('@/store/groupProfile', () => ({
  useGroupProfileStore: {
    getState: () => ({
      setChatPanelExpanded: setChatPanelExpandedMock,
    }),
  },
}));

vi.mock('@/utils/stableNavigate', () => ({
  getStableNavigate: () => navigateMock,
}));

const createAction = () => {
  const homeState: Partial<HomeStore> = {
    refreshAgentList: refreshAgentListMock,
  };

  const setState: StoreSetter<HomeStore> = ((partial) => {
    if (typeof partial === 'function') {
      Object.assign(homeState, partial(homeState as HomeStore));
      return;
    }
    Object.assign(homeState, partial);
  }) as StoreSetter<HomeStore>;

  return new HomeInputActionImpl(setState, () => homeState as HomeStore);
};

describe('HomeInputActionImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAgentMock.mockResolvedValue({ agentId: 'agent-new' });
    createGroupMock.mockResolvedValue({
      group: {
        id: 'group-new',
      },
    });
  });

  describe('sendAsAgent', () => {
    it('opens the agent builder panel without touching the generic right panel', async () => {
      const action = createAction();

      await action.sendAsAgent({ message: 'build a support agent' });

      expect(toggleAgentBuilderPanelMock).toHaveBeenCalledWith(true);
      expect(toggleRightPanelMock).not.toHaveBeenCalled();
      expect(navigateMock).toHaveBeenCalledWith('/agent/agent-new/profile');
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          context: { agentId: 'agentBuilder', scope: 'agent_builder' },
          message: 'build a support agent',
        }),
      );
    });
  });

  describe('sendAsGroup', () => {
    it('opens the existing group agent builder panel for prompt-based group creation', async () => {
      const action = createAction();

      await action.sendAsGroup({ message: 'build a research group' });

      expect(setChatPanelExpandedMock).toHaveBeenCalledWith(true);
      expect(navigateMock).toHaveBeenCalledWith('/group/group-new/profile');
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          context: { agentId: 'groupAgentBuilder', scope: 'group_agent_builder' },
          message: 'build a research group',
        }),
      );
    });
  });
});
