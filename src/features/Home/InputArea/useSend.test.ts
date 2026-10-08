/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
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
const restoreChatContextSelectionsMock = vi.hoisted(() => vi.fn());
const createTaskMock = vi.hoisted(() => vi.fn());
const runTaskMock = vi.hoisted(() => vi.fn());
const toggleTaskAgentPanelMock = vi.hoisted(() => vi.fn());
const messageErrorMock = vi.hoisted(() => vi.fn());
const messageSuccessMock = vi.hoisted(() => vi.fn());

const chatState = vi.hoisted(() => ({
  inputMessage: 'hello',
  mainInputEditor: {
    clearContent: clearContentMock,
    getJSONState: vi.fn(() => ({ type: 'doc' })),
  },
  sendMessage: sendMessageMock,
}));

const fileState = vi.hoisted(() => ({
  chatContextSelectionsByContext: {} as Record<string, any[]>,
  chatUploadFileList: [],
  clearChatContextSelections: clearChatContextSelectionsMock,
  clearChatUploadFileList: clearChatUploadFileListMock,
  restoreChatContextSelections: restoreChatContextSelectionsMock,
}));

const homeState = vi.hoisted(() => ({
  agentGroups: [],
  homeInputLoading: false,
  inputActiveMode: null as any,
  isAgentListInit: true,
  pinnedAgents: [],
  privateAgentGroups: [],
  privatePinnedAgents: [],
  privateUngroupedAgents: [],
  sendAsAgent: vi.fn(),
  sendAsGroup: vi.fn(),
  sendAsResearch: vi.fn(),
  sendAsWrite: vi.fn(),
  ungroupedAgents: [] as any[],
}));

const agentState = vi.hoisted(() => ({
  agentMap: {
    agt_inbox: {},
  } as Record<string, any>,
  inboxAgentId: 'agt_inbox',
  internal_dispatchAgentMap: vi.fn(),
}));

const globalState = vi.hoisted(() => ({
  systemStatus: {
    homeSelectedAgentId: undefined as string | undefined,
  },
  toggleTaskAgentPanel: toggleTaskAgentPanelMock,
  updateSystemStatus: vi.fn(),
}));

const taskState = vi.hoisted(() => ({
  createTask: createTaskMock,
  runTask: runTaskMock,
}));

const homeDailyBriefState = vi.hoisted(() => ({
  advance: vi.fn(),
  currentIndex: 0,
  currentPair: undefined as { hint: string; welcome: string } | undefined,
  pairs: [] as { hint: string; welcome: string }[],
}));

const activeWorkspaceSlugMock = vi.hoisted(() => ({
  value: null as string | null,
}));
const activeWorkspaceIdMock = vi.hoisted(() => ({
  value: null as string | null,
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: messageErrorMock, success: messageSuccessMock },
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true, reason: '' }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => activeWorkspaceIdMock.value,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => activeWorkspaceSlugMock.value,
}));

vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: () => routerMock,
}));

vi.mock('@/hooks/useHomeDailyBrief', () => ({
  useHomeDailyBrief: () => homeDailyBriefState,
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
      chatContextSelections: (contextKey: string) => (state: typeof fileState) =>
        state.chatContextSelectionsByContext[contextKey] ?? [],
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

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (state: typeof taskState) => unknown) => selector(taskState),
}));

describe('Home InputArea useSend', () => {
  beforeEach(() => {
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    sendMessageMock.mockReset();
    clearContentMock.mockReset();
    clearChatUploadFileListMock.mockReset();
    clearChatContextSelectionsMock.mockReset();
    restoreChatContextSelectionsMock.mockReset();
    createTaskMock.mockReset();
    runTaskMock.mockReset();
    toggleTaskAgentPanelMock.mockReset();
    messageErrorMock.mockReset();
    messageSuccessMock.mockReset();
    homeDailyBriefState.advance.mockReset();
    homeDailyBriefState.currentPair = undefined;
    chatState.inputMessage = 'hello';
    fileState.chatContextSelectionsByContext = {};
    fileState.chatUploadFileList = [];
    homeState.inputActiveMode = null;
    homeState.ungroupedAgents = [];
    globalState.systemStatus.homeSelectedAgentId = undefined;
    delete agentState.agentMap.agt_custom;
    activeWorkspaceSlugMock.value = null;
    activeWorkspaceIdMock.value = null;
  });

  it('creates a private workspace task without starting it', async () => {
    activeWorkspaceIdMock.value = 'workspace-1';
    globalState.systemStatus.homeSelectedAgentId = 'agt_custom';
    homeState.ungroupedAgents = [{ id: 'agt_custom', type: 'agent' }];
    agentState.agentMap.agt_custom = {};
    createTaskMock.mockResolvedValue({
      assigneeAgentId: 'agt_custom',
      identifier: 'T-26',
    });
    const { result } = renderHook(() => useSend('task'));
    const params: Parameters<SendButtonHandler>[0] = {
      clearContent: vi.fn(),
      editor: {} as Parameters<SendButtonHandler>[0]['editor'],
      getEditorData: () => ({ type: 'doc' }),
      getMarkdownContent: () => 'Prepare the weekly report',
    };

    await act(async () => {
      await result.current.send(params);
    });

    expect(createTaskMock).toHaveBeenCalledWith({
      assigneeAgentId: 'agt_custom',
      editorData: { type: 'doc' },
      instruction: 'Prepare the weekly report',
      name: 'Prepare the weekly report',
      visibility: 'private',
    });
    // Task mode records the task; it must not launch a run, open the task
    // panel, or navigate away from Home.
    expect(runTaskMock).not.toHaveBeenCalled();
    expect(toggleTaskAgentPanelMock).not.toHaveBeenCalled();
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(messageSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'dashboard.task.created' }),
    );
    // The toast is the only handle on the task once the composer is cleared, so
    // its action must open that task rather than just dismiss the toast.
    const [{ actions }] = messageSuccessMock.mock.calls.at(-1) as [
      { actions: { label: string; onClick: () => void }[] },
    ];
    expect(actions).toHaveLength(1);
    expect(actions[0].label).toBe('taskIntent.openCreated');
    actions[0].onClick();
    expect(routerMock.push).toHaveBeenCalledWith(
      taskDetailPath('T-26', 'agt_custom', 'Prepare the weekly report'),
    );
    expect(clearContentMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the complete draft when the task row could not be created', async () => {
    createTaskMock.mockResolvedValue(null);
    const { result } = renderHook(() => useSend('task'));
    const params: Parameters<SendButtonHandler>[0] = {
      clearContent: vi.fn(),
      editor: {} as Parameters<SendButtonHandler>[0]['editor'],
      getEditorData: () => undefined,
      getMarkdownContent: () => 'Prepare the weekly report',
    };

    await act(async () => {
      await result.current.send(params);
    });

    expect(runTaskMock).not.toHaveBeenCalled();
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(clearContentMock).not.toHaveBeenCalled();
    expect(clearChatUploadFileListMock).not.toHaveBeenCalled();
    expect(clearChatContextSelectionsMock).not.toHaveBeenCalled();
    expect(messageErrorMock).toHaveBeenCalledWith('dashboard.submitFailed');
  });

  it('keeps the draft and stays on Home when task creation throws', async () => {
    fileState.chatUploadFileList = [
      {
        id: 'file-1',
        file: new File(['report'], 'report.pdf'),
        fileUrl: 'https://example.com/f/file-1',
        status: 'success',
      },
    ] as any;
    createTaskMock.mockRejectedValue(new Error('create failed'));
    const { result } = renderHook(() => useSend('task'));
    const params: Parameters<SendButtonHandler>[0] = {
      clearContent: vi.fn(),
      editor: {} as Parameters<SendButtonHandler>[0]['editor'],
      getEditorData: () => ({ type: 'doc' }),
      getMarkdownContent: () => 'Prepare the weekly report',
    };

    await act(async () => {
      await result.current.send(params);
    });

    expect(runTaskMock).not.toHaveBeenCalled();
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(clearContentMock).not.toHaveBeenCalled();
    expect(clearChatUploadFileListMock).not.toHaveBeenCalled();
    expect(messageSuccessMock).not.toHaveBeenCalled();
    expect(messageErrorMock).toHaveBeenCalledWith('dashboard.submitFailed');
  });

  it('persists uploaded attachments when creating a task', async () => {
    fileState.chatUploadFileList = [
      {
        id: 'file-1',
        file: new File(['report'], 'report.pdf', { type: 'application/pdf' }),
        fileUrl: 'https://example.com/f/file-1',
        status: 'success',
      },
    ] as any;
    createTaskMock.mockResolvedValue({ identifier: 'T-27' });
    const { result } = renderHook(() => useSend('task'));
    const params: Parameters<SendButtonHandler>[0] = {
      clearContent: vi.fn(),
      editor: {} as Parameters<SendButtonHandler>[0]['editor'],
      getEditorData: () => ({ type: 'doc' }),
      getMarkdownContent: () => 'Prepare the weekly report',
    };

    await act(async () => {
      await result.current.send(params);
    });

    expect(createTaskMock).toHaveBeenCalledTimes(1);
    const created = createTaskMock.mock.calls[0][0];
    expect(created.editorData.root.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          children: [
            expect.objectContaining({
              type: 'file',
              fileUrl: 'https://example.com/f/file-1',
              name: 'report.pdf',
              status: 'uploaded',
            }),
          ],
        }),
      ]),
    );
    expect(clearChatUploadFileListMock).toHaveBeenCalledTimes(1);
    expect(messageErrorMock).not.toHaveBeenCalled();
  });

  it('creates a task from an attachment-only submission', async () => {
    chatState.inputMessage = '';
    fileState.chatUploadFileList = [
      {
        id: 'file-1',
        file: new File(['report'], 'report.pdf', { type: 'application/pdf' }),
        fileUrl: 'https://example.com/f/file-1',
        status: 'success',
      },
    ] as any;
    createTaskMock.mockResolvedValue({ identifier: 'T-27' });
    const { result } = renderHook(() => useSend('task'));
    const params: Parameters<SendButtonHandler>[0] = {
      clearContent: vi.fn(),
      editor: {} as Parameters<SendButtonHandler>[0]['editor'],
      getEditorData: () => ({ type: 'doc' }),
      getMarkdownContent: () => '',
    };

    await act(async () => {
      await result.current.send(params);
    });

    expect(createTaskMock).toHaveBeenCalledTimes(1);
    const created = createTaskMock.mock.calls[0][0];
    expect(created.instruction).toBe('report.pdf');
    expect(created.name).toBe('report.pdf');
    expect(created.editorData.root.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          children: [
            expect.objectContaining({
              type: 'file',
              fileUrl: 'https://example.com/f/file-1',
              name: 'report.pdf',
              status: 'uploaded',
            }),
          ],
        }),
      ]),
    );
    expect(clearChatUploadFileListMock).toHaveBeenCalledTimes(1);
    expect(messageErrorMock).not.toHaveBeenCalled();
  });

  it.each(['pending', 'uploading', 'error'])(
    'retains the attachment draft when upload is %s',
    async (status) => {
      fileState.chatUploadFileList = [
        { id: 'file-1', file: new File(['report'], 'report.pdf'), status },
      ] as any;
      const { result } = renderHook(() => useSend('task'));
      await act(async () => {
        await result.current.send({
          clearContent: vi.fn(),
          editor: {} as Parameters<SendButtonHandler>[0]['editor'],
          getMarkdownContent: () => 'Report',
        });
      });
      expect(createTaskMock).not.toHaveBeenCalled();
      expect(clearContentMock).not.toHaveBeenCalled();
      expect(clearChatUploadFileListMock).not.toHaveBeenCalled();
      expect(messageErrorMock).toHaveBeenCalledWith('dashboard.task.attachmentsNotReady');
    },
  );

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

    sentPayload.onPreflightFailure();
    expect(restoreChatContextSelectionsMock).toHaveBeenCalledWith('home:chat:agt_inbox', []);

    await act(async () => {
      await sentPayload.onTopicCreated('tpc_created');
    });

    expect(routerMock.replace).toHaveBeenCalledWith('/agent/agt_inbox/tpc_created');
  });

  it('sends chat-mode messages to the Agent selected on Home', async () => {
    globalState.systemStatus.homeSelectedAgentId = 'agt_custom';
    homeState.ungroupedAgents = [{ id: 'agt_custom', type: 'agent' }];
    agentState.agentMap.agt_custom = {};

    const { result } = renderHook(() => useSend('chat'));
    const params: Parameters<SendButtonHandler>[0] = {
      clearContent: vi.fn(),
      editor: {} as Parameters<SendButtonHandler>[0]['editor'],
      getEditorData: () => undefined,
      getMarkdownContent: () => 'hello custom agent',
    };

    await act(async () => {
      await result.current.send(params);
    });

    expect(result.current.agentId).toBe('agt_custom');
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { agentId: 'agt_custom', isolatedTopic: true },
        message: 'hello custom agent',
      }),
    );
    expect(routerMock.push).toHaveBeenCalledWith('/agent/agt_custom');
  });

  it('captures the active workspace slug in default homepage sends', async () => {
    activeWorkspaceSlugMock.value = 'team';
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
        context: { agentId: 'agt_inbox', isolatedTopic: true, workspaceSlug: 'team' },
      }),
    );
  });

  it('sends the fixed placeholder hint without advancing the Home greeting', async () => {
    homeDailyBriefState.currentPair = {
      hint: '看下 Bug #14153 + #14112 Agent 手机端不同步/不显示...',
      welcome: 'welcome',
    };
    chatState.inputMessage = '';

    const { result } = renderHook(() => useSend());
    const params: Parameters<SendButtonHandler>[0] = {
      clearContent: vi.fn(),
      editor: {} as Parameters<SendButtonHandler>[0]['editor'],
      // Empty editor still returns a non-null JSON state; this would
      // previously be forwarded as editorData and blank the rendered
      // user bubble.
      getEditorData: () => ({ type: 'doc' }),
      getMarkdownContent: () => '',
    };

    await act(async () => {
      await result.current.send(params);
    });

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const sentPayload = sendMessageMock.mock.calls[0][0];
    expect(sentPayload.message).toBe('看下 Bug #14153 + #14112 Agent 手机端不同步/不显示');
    expect(sentPayload.editorData).toBeUndefined();
    expect(homeDailyBriefState.advance).not.toHaveBeenCalled();
  });

  it('passes context selections through starter agent mode sends', async () => {
    homeState.inputActiveMode = 'agent';
    activeWorkspaceSlugMock.value = 'team';
    fileState.chatContextSelectionsByContext = {
      'home:chat:agt_inbox': [
        {
          content: 'const selected = true;',
          filePath: 'src/example.ts',
          id: 'code-selection',
          lineRange: { endLine: 12, startLine: 10 },
          preview: 'src/example.ts:10-12',
          source: 'code',
          title: 'src/example.ts:10-12',
          workingDirectory: '/repo',
        },
      ],
    };

    const { result } = renderHook(() => useSend());
    const params: Parameters<SendButtonHandler>[0] = {
      clearContent: vi.fn(),
      editor: {} as Parameters<SendButtonHandler>[0]['editor'],
      getEditorData: () => ({ type: 'doc' }),
      getMarkdownContent: () => 'use this selection',
    };

    await act(async () => {
      await result.current.send(params);
    });

    expect(homeState.sendAsAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        contextSelections: [
          expect.objectContaining({
            content: 'const selected = true;',
            filePath: 'src/example.ts',
            lineRange: { endLine: 12, startLine: 10 },
            source: 'code',
          }),
        ],
        message: 'use this selection',
        workspaceSlug: 'team',
      }),
    );
    expect(clearChatContextSelectionsMock).toHaveBeenCalledWith('home:chat:agt_inbox');
  });
});
