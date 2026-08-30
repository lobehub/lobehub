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
const createDocumentMock = vi.hoisted(() => vi.fn());

const enabledModels = vi.hoisted(() => ({
  isInit: true,
  list: [{ id: 'deepseek-v4-pro', provider: 'lobehub' }],
}));

const agentState = vi.hoisted(() => ({
  agentConfigMap: {
    agentBuilder: { model: 'deepseek-v4-pro', provider: 'lobehub' },
    groupAgentBuilder: { model: 'deepseek-v4-pro', provider: 'lobehub' },
    inbox: {
      model: 'gpt-4o-mini',
      provider: 'openai',
    },
    pageAgent: { model: 'deepseek-v4-pro', provider: 'lobehub' },
  },
  agentMap: {
    // Personal-mode rows by default; a test flips `workspaceId` on to assert the
    // workspace-shared behaviour.
    agentBuilder: {} as { workspaceId?: string },
    groupAgentBuilder: {} as { workspaceId?: string },
    pageAgent: {} as { workspaceId?: string },
  },
  builtinAgentIdMap: {
    'agent-builder': 'agentBuilder',
    'group-agent-builder': 'groupAgentBuilder',
    'page-agent': 'pageAgent',
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
    pageAgent: 'page-agent',
  },
}));

vi.mock('@/services/document', () => ({
  documentService: {
    createDocument: createDocumentMock,
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

vi.mock('@/projection/modules/agent/read', () => ({
  getAgentProjectionById: (id: string) => ({
    id,
    ...agentState.agentConfigMap[id as keyof typeof agentState.agentConfigMap],
    ...agentState.agentMap[id as keyof typeof agentState.agentMap],
  }),
}));

vi.mock('@/store/aiInfra', () => ({
  getAiInfraStoreState: () => enabledModels,
}));

vi.mock('@/store/aiInfra/selectors', () => ({
  aiModelSelectors: {
    getEnabledModelById: (id: string, provider: string) => (s: typeof enabledModels) =>
      s.list.find((m) => m.id === id && m.provider === provider),
  },
  aiProviderSelectors: {
    isInitAiProviderRuntimeState: (s: typeof enabledModels) => s.isInit,
  },
}));

vi.mock('@/store/agent/selectors', () => ({
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
    setState: vi.fn(),
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
    createDocumentMock.mockResolvedValue({ id: 'doc-new' });
    for (const key of ['agentBuilder', 'groupAgentBuilder', 'pageAgent'] as const) {
      delete agentState.agentMap[key].workspaceId;
      agentState.agentConfigMap[key] = { model: 'deepseek-v4-pro', provider: 'lobehub' };
    }
    enabledModels.list = [{ id: 'deepseek-v4-pro', provider: 'lobehub' }];
    enabledModels.isInit = true;
  });

  describe('sendAsAgent', () => {
    // Regression: the Private sidebar create entries pass `visibility: 'private'`;
    // dropping it here published the new agent to the whole workspace.
    it('forwards visibility to the agent creation request', async () => {
      const action = createAction();

      await action.sendAsAgent({ message: 'build a support agent', visibility: 'private' });

      expect(createAgentMock).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'private' }),
      );
    });

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

    it('forwards context selections to the agent builder message', async () => {
      const action = createAction();
      const contextSelections = [
        {
          content: 'const selected = true;',
          filePath: 'src/example.ts',
          id: 'code-selection',
          lineRange: { endLine: 12, startLine: 10 },
          source: 'code' as const,
        },
      ];

      await action.sendAsAgent({ contextSelections, message: 'use this selected code' });

      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          contextSelections,
          message: 'use this selected code',
        }),
      );
    });

    it('passes the workspace slug to the agent builder message context', async () => {
      const action = createAction();

      await action.sendAsAgent({ message: 'build a support agent', workspaceSlug: 'team' });

      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          context: { agentId: 'agentBuilder', scope: 'agent_builder', workspaceSlug: 'team' },
        }),
      );
    });

    // a personal builtin is the user's own row, so it keeps following
    // the inbox model; the workspace-scoped row of the same slug is shared by
    // every member and must never be repointed.
    it('keeps syncing model/provider onto a personal agent builder', async () => {
      const action = createAction();

      await action.sendAsAgent({ message: 'build a support agent' });

      expect(updateAgentConfigByIdMock).toHaveBeenCalledWith('agentBuilder', {
        model: 'gpt-4o-mini',
        provider: 'openai',
      });
      // the newly created Agent still inherits the inbox model/provider
      expect(createAgentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ systemRole: 'build a support agent' }),
        }),
      );
    });

    it('never writes model/provider onto a workspace-shared agent builder', async () => {
      agentState.agentMap.agentBuilder.workspaceId = 'ws-1';
      const action = createAction();

      await action.sendAsAgent({ message: 'build a support agent' });

      expect(updateAgentConfigByIdMock).not.toHaveBeenCalled();
    });

    // A shared row pointing at a model this deployment cannot invoke would fail
    // the builder request outright, so it is repaired once rather than left broken.
    // A pre-hydration model catalog makes every model look unusable; repairing then
    // would overwrite the workspace's model on a race. Unknown must not mean invalid.
    it('leaves a workspace-shared builder alone before the model catalog hydrates', async () => {
      agentState.agentMap.agentBuilder.workspaceId = 'ws-1';
      enabledModels.isInit = false;
      enabledModels.list = [];
      const action = createAction();

      await action.sendAsAgent({ message: 'build a support agent' });

      expect(updateAgentConfigByIdMock).not.toHaveBeenCalled();
    });

    it('repairs a workspace-shared builder whose own model is not invocable', async () => {
      agentState.agentMap.agentBuilder.workspaceId = 'ws-1';
      enabledModels.list = [{ id: 'gpt-4o-mini', provider: 'openai' }];
      const action = createAction();

      await action.sendAsAgent({ message: 'build a support agent' });

      expect(updateAgentConfigByIdMock).toHaveBeenCalledWith('agentBuilder', {
        model: 'gpt-4o-mini',
        provider: 'openai',
      });
    });
  });

  describe('sendAsGroup', () => {
    // Regression: the Private sidebar create entries pass `visibility: 'private'`;
    // dropping it here published the new group to the whole workspace.
    it('forwards visibility to the group creation request', async () => {
      const action = createAction();

      await action.sendAsGroup({ message: 'build a research group', visibility: 'private' });

      expect(createGroupMock).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'private' }),
      );
    });

    it('opens the existing group agent builder panel for prompt-based group creation', async () => {
      const action = createAction();

      await action.sendAsGroup({ message: 'build a research group' });

      expect(setChatPanelExpandedMock).toHaveBeenCalledWith(true);
      expect(navigateMock).toHaveBeenCalledWith('/group/group-new/profile');
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          context: {
            agentId: 'groupAgentBuilder',
            // Names the freshly created group so the builder topic is stamped
            // with it, instead of relying on the not-yet-mounted group route to
            // have set `chatStore.activeGroupId`.
            editingGroupId: 'group-new',
            scope: 'group_agent_builder',
          },
          message: 'build a research group',
        }),
      );
    });

    it('passes the workspace slug to the group builder message context', async () => {
      const action = createAction();

      await action.sendAsGroup({ message: 'build a research group', workspaceSlug: 'team' });

      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          context: {
            agentId: 'groupAgentBuilder',
            editingGroupId: 'group-new',
            scope: 'group_agent_builder',
            workspaceSlug: 'team',
          },
        }),
      );
    });

    it('keeps syncing model/provider onto a personal group agent builder', async () => {
      const action = createAction();

      await action.sendAsGroup({ message: 'build a research group' });

      expect(updateAgentConfigByIdMock).toHaveBeenCalledWith('groupAgentBuilder', {
        model: 'gpt-4o-mini',
        provider: 'openai',
      });
    });

    it('never writes model/provider onto a workspace-shared group agent builder', async () => {
      agentState.agentMap.groupAgentBuilder.workspaceId = 'ws-1';
      const action = createAction();

      await action.sendAsGroup({ message: 'build a research group' });

      expect(updateAgentConfigByIdMock).not.toHaveBeenCalled();
    });
  });

  describe('sendAsWrite', () => {
    it('passes the freshly created document id through the page context', async () => {
      const action = createAction();

      await action.sendAsWrite({ message: 'write me a doc' });

      expect(createDocumentMock).toHaveBeenCalled();
      expect(navigateMock).toHaveBeenCalledWith('/page/doc-new');
      // The new editor has not mounted yet, so the doc id must travel in context
      // explicitly rather than relying on the page editor runtime singleton.
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          context: { agentId: 'pageAgent', documentId: 'doc-new', scope: 'page' },
          message: 'write me a doc',
        }),
      );
    });

    it('keeps syncing model/provider onto a personal page agent', async () => {
      const action = createAction();

      await action.sendAsWrite({ message: 'write me a doc' });

      expect(updateAgentConfigByIdMock).toHaveBeenCalledWith('pageAgent', {
        model: 'gpt-4o-mini',
        provider: 'openai',
      });
    });

    it('never writes model/provider onto a workspace-shared page agent', async () => {
      agentState.agentMap.pageAgent.workspaceId = 'ws-1';
      const action = createAction();

      await action.sendAsWrite({ message: 'write me a doc' });

      expect(updateAgentConfigByIdMock).not.toHaveBeenCalled();
    });

    it('passes the workspace slug to the page agent message context', async () => {
      const action = createAction();

      await action.sendAsWrite({ message: 'write me a doc', workspaceSlug: 'team' });

      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          context: {
            agentId: 'pageAgent',
            documentId: 'doc-new',
            scope: 'page',
            workspaceSlug: 'team',
          },
        }),
      );
    });
  });
});
