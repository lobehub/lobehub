/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SendButtonHandler } from '@/features/ChatInput/store/initialState';

import { useSend } from './useSend';

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

const sendMessageMock = vi.hoisted(() => vi.fn());
const clearContentMock = vi.hoisted(() => vi.fn());
const clearChatUploadFileListMock = vi.hoisted(() => vi.fn());
const clearChatContextSelectionsMock = vi.hoisted(() => vi.fn());

const chatState = vi.hoisted(() => ({
  inputMessage: 'hello',
  mainInputEditor: {
    clearContent: clearContentMock,
    getJSONState: vi.fn(() => ({ type: 'doc' })),
  },
  sendMessage: sendMessageMock,
}));

const fileState = vi.hoisted(() => ({
  chatContextSelections: [],
  chatUploadFileList: [],
  clearChatContextSelections: clearChatContextSelectionsMock,
  clearChatUploadFileList: clearChatUploadFileListMock,
}));

const homeState = vi.hoisted(() => ({
  agentGroups: [],
  homeInputLoading: false,
  inputActiveMode: null,
  isAgentListInit: true,
  pinnedAgents: [],
  sendAsAgent: vi.fn(),
  sendAsGroup: vi.fn(),
  sendAsResearch: vi.fn(),
  sendAsWrite: vi.fn(),
  ungroupedAgents: [],
}));

const agentState = vi.hoisted(() => ({
  agentMap: {
    agt_inbox: {},
  },
  inboxAgentId: 'agt_inbox',
  internal_dispatchAgentMap: vi.fn(),
}));

const globalState = vi.hoisted(() => ({
  systemStatus: {
    homeSelectedAgentId: undefined,
  },
  updateSystemStatus: vi.fn(),
}));

vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: () => routerMock,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: Object.assign(
    (selector: (state: typeof agentState) => unknown) => selector(agentState),
    {
      getState: () => agentState,
    },
  ),
}));

vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: {
    inboxAgentId: (state: typeof agentState) => state.inboxAgentId,
  },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: typeof globalState) => unknown) => selector(globalState),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    homeSelectedAgentId: (state: typeof globalState) => state.systemStatus.homeSelectedAgentId,
  },
}));

vi.mock('@/store/chat', () => {
  const useChatStore = (selector: (state: typeof chatState) => unknown) => selector(chatState);
  useChatStore.getState = () => chatState;

  return { useChatStore };
});

vi.mock('@/store/file', () => {
  const useFileStore = (selector: (state: typeof fileState) => unknown) => selector(fileState);
  useFileStore.getState = () => fileState;

  return {
    fileChatSelectors: {
      chatContextSelections: (state: typeof fileState) => state.chatContextSelections,
      chatUploadFileList: (state: typeof fileState) => state.chatUploadFileList,
    },
    useFileStore,
  };
});

vi.mock('@/store/home', () => {
  const useHomeStore = (selector: (state: typeof homeState) => unknown) => selector(homeState);
  useHomeStore.getState = () => homeState;

  return { useHomeStore };
});

describe('Home InputArea useSend', () => {
  beforeEach(() => {
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    sendMessageMock.mockReset();
    clearContentMock.mockReset();
    clearChatUploadFileListMock.mockReset();
    clearChatContextSelectionsMock.mockReset();
  });

  it('routes cold homepage sends to the created topic instead of relying on ChatHydration timing', async () => {
    const { result } = renderHook(() => useSend());
    const params: Parameters<SendButtonHandler>[0] = {
      clearContent: vi.fn(),
      editor: {} as Parameters<SendButtonHandler>[0]['editor'],
      getEditorData: () => undefined,
      getMarkdownContent: () => 'hello',
    };

    await act(async () => {
      await result.current.send(params);
    });

    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { agentId: 'agt_inbox', isolatedTopic: true },
        message: 'hello',
        onTopicCreated: expect.any(Function),
      }),
    );
    expect(routerMock.push).toHaveBeenCalledWith('/agent/agt_inbox');

    const sentPayload = sendMessageMock.mock.calls[0][0];

    await act(async () => {
      await sentPayload.onTopicCreated('tpc_created');
    });

    expect(routerMock.replace).toHaveBeenCalledWith('/agent/agt_inbox/tpc_created');
  });
});
