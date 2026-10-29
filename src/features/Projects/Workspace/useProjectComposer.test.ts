/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDraft } from '@/features/ChatInput/draftStorage';
import type { ProjectDetail } from '@/store/project';

import {
  AttachmentsNotReadyError,
  toConversationTitle,
  useProjectComposer,
} from './useProjectComposer';

const mocks = vi.hoisted(() => ({
  agentMap: {} as Record<string, unknown>,
  clearChatUploadFileList: vi.fn(),
  createProjectTopic: vi.fn(),
  createTask: vi.fn(),
  fileList: [] as unknown[],
  getAgentConfigById: vi.fn(),
  internal_dispatchAgentMap: vi.fn(),
  activeAgentId: undefined as string | undefined,
  activeTopicId: undefined as string | undefined,
  mainInputEditor: null as unknown,
  navigate: vi.fn(),
  restoreChatUploadFileList: vi.fn(),
  sendMessage: vi.fn(),
  toastError: vi.fn(),
  workspaceSlug: null as string | null,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.workspaceSlug,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui', () => ({
  toast: { error: mocks.toastError },
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/store/projectWorkingDirectory', () => ({
  useProjectDirectoryStore: (selector: (state: unknown) => unknown) =>
    selector({
      createProjectTopic: mocks.createProjectTopic,
    }),
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (state: unknown) => unknown) =>
    selector({ createTask: mocks.createTask }),
}));

vi.mock('@/store/chat', () => {
  const state = () => ({
    activeAgentId: mocks.activeAgentId,
    activeTopicId: mocks.activeTopicId,
    mainInputEditor: mocks.mainInputEditor,
    sendMessage: mocks.sendMessage,
  });
  const useChatStore = Object.assign((selector: (s: unknown) => unknown) => selector(state()), {
    getState: state,
  });
  return { useChatStore };
});

/** A conversation page mounts its composer, which registers as the main editor. */
const mountConversationEditor = (topicId = 'tpc_1', agentId = 'coordinator') => {
  const editor = { setDocument: vi.fn(), setJSONState: vi.fn() };
  mocks.activeAgentId = agentId;
  mocks.activeTopicId = topicId;
  mocks.mainInputEditor = editor;
  return editor;
};

vi.mock('@/store/file', () => {
  const state = () => ({
    chatUploadFileList: mocks.fileList,
    clearChatUploadFileList: mocks.clearChatUploadFileList,
    restoreChatUploadFileList: mocks.restoreChatUploadFileList,
  });
  const useFileStore = Object.assign((selector: (s: unknown) => unknown) => selector(state()), {
    getState: state,
  });
  return {
    fileChatSelectors: {
      chatUploadFileList: (s: { chatUploadFileList: unknown[] }) => s.chatUploadFileList,
    },
    useFileStore,
  };
});

vi.mock('@/store/agent', () => ({
  useAgentStore: {
    getState: () => ({
      agentMap: mocks.agentMap,
      internal_dispatchAgentMap: mocks.internal_dispatchAgentMap,
    }),
  },
}));

vi.mock('@/services/agent', () => ({
  agentService: { getAgentConfigById: mocks.getAgentConfigById },
}));

const project = {
  coordinatorAgentId: 'coordinator',
  id: 'prj_1',
  slug: 'apollo',
} as ProjectDetail['project'];

const editorData = { root: { children: [] } };
const composer = (markdown: string) => ({
  clearContent: vi.fn(),
  editor: {} as never,
  getEditorData: () => editorData,
  getMarkdownContent: () => markdown,
});

const image = {
  file: { name: 'shot.png', size: 1, type: 'image/png' },
  fileUrl: 'https://cdn/shot.png',
  id: 'file_1',
  status: 'success',
};

describe('useProjectComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentMap = { coordinator: {} };
    mocks.fileList = [];
    mocks.workspaceSlug = null;
    mocks.activeAgentId = undefined;
    mocks.activeTopicId = undefined;
    mocks.mainInputEditor = null;
    localStorage.clear();
    // The conversation takes the message, then the run goes on in the background.
    mocks.sendMessage.mockImplementation(({ onMessageAccepted }) => {
      onMessageAccepted?.();
      return new Promise(() => {});
    });
  });

  /**
   * @example Project home: a sent message opened "topic not found" — the
   * `?message=` auto-send fired before the page bound the project topic, so it
   * created a second topic outside the project and lost the attachments.
   */
  it('sends the message and its attachments into the project conversation it creates', async () => {
    mocks.createProjectTopic.mockResolvedValue({ id: 'tpc_1' });
    mocks.fileList = [image];
    const { result } = renderHook(() => useProjectComposer(project, 'chat', 'coordinator'));
    const input = composer('  Plan the next milestone\nwith details  ');

    await act(async () => {
      await result.current.send(input);
    });

    expect(mocks.createProjectTopic).toHaveBeenCalledWith({
      agentId: 'coordinator',
      projectId: 'prj_1',
      title: 'Plan the next milestone',
    });
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      context: { agentId: 'coordinator', topicId: 'tpc_1' },
      editorData,
      files: [image],
      inputEditor: expect.objectContaining({ setJSONState: expect.any(Function) }),
      message: 'Plan the next milestone\nwith details',
      onMessageAccepted: expect.any(Function),
      onPreflightFailure: expect.any(Function),
    });
    expect(mocks.navigate).toHaveBeenCalledWith('/project/apollo/topic/tpc_1');
    expect(input.clearContent).toHaveBeenCalled();
    expect(mocks.clearChatUploadFileList).toHaveBeenCalled();
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('sends to the project agent the user picked instead of the main agent', async () => {
    mocks.createProjectTopic.mockResolvedValue({ id: 'tpc_1' });
    mocks.agentMap = { reviewer: {} };
    const { result } = renderHook(() => useProjectComposer(project, 'chat', 'reviewer'));

    await act(async () => {
      await result.current.send(composer('Review the release notes'));
    });

    expect(mocks.createProjectTopic).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'reviewer', projectId: 'prj_1' }),
    );
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ context: { agentId: 'reviewer', topicId: 'tpc_1' } }),
    );
  });

  it('assigns a task to the picked project agent', async () => {
    mocks.createTask.mockResolvedValue({ id: 'task_1', identifier: 'T-1', name: 'Ship it' });
    const { result } = renderHook(() => useProjectComposer(project, 'task', 'reviewer'));

    await act(async () => {
      await result.current.send(composer('Ship it'));
    });

    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeAgentId: 'reviewer', projectId: 'prj_1' }),
    );
  });

  /**
   * @example Project home: sending kept the text and a spinner in the home
   * composer until the server accepted the message — no optimistic message.
   */
  it('opens the conversation before the server has accepted the message', async () => {
    mocks.createProjectTopic.mockResolvedValue({ id: 'tpc_1' });
    mocks.sendMessage.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useProjectComposer(project, 'chat', 'coordinator'));
    const input = composer('Hello');

    await act(async () => {
      await result.current.send(input);
    });

    expect(mocks.sendMessage).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/project/apollo/topic/tpc_1');
    expect(input.clearContent).toHaveBeenCalled();
    expect(result.current.sending).toBe(false);
  });

  /**
   * @example Codex review: a preflight rejection was fire-and-forget while the
   * composer cleared itself and navigated, so the draft and attachments were lost.
   */
  it('puts a draft the send refused back into the mounted conversation composer', async () => {
    mocks.createProjectTopic.mockResolvedValue({ id: 'tpc_1' });
    mocks.fileList = [image];
    const editor = mountConversationEditor();
    mocks.sendMessage.mockRejectedValue(new Error('device offline'));
    const { result } = renderHook(() => useProjectComposer(project, 'chat', 'coordinator'));

    await act(async () => {
      await result.current.send(composer('Hello'));
    });

    expect(editor.setJSONState).toHaveBeenCalledWith(editorData);
    expect(mocks.restoreChatUploadFileList).toHaveBeenCalledWith([image]);
    expect(mocks.toastError).toHaveBeenCalledWith('overview.messageNotSent');
  });

  /**
   * @example Acceptance: a send refused before the conversation page had
   * rendered its composer brought the attachment back but not the text — the
   * composer settles its document after it registers and wiped what was
   * written into it.
   */
  it('keeps a draft refused before the conversation composer mounts in that conversation', async () => {
    mocks.createProjectTopic.mockResolvedValue({ id: 'tpc_1' });
    mocks.sendMessage.mockRejectedValue(new Error('device offline'));
    const { result } = renderHook(() => useProjectComposer(project, 'chat', 'coordinator'));

    await act(async () => {
      await result.current.send(composer('Hello'));
    });

    expect(getDraft('main_coordinator_tpc_1')).toEqual(editorData);
  });

  it('leaves the restore to the send when it recovered the draft itself', async () => {
    mocks.createProjectTopic.mockResolvedValue({ id: 'tpc_1' });
    mocks.fileList = [image];
    const editor = mountConversationEditor();
    // The send's own recovery: text into the composer it names, then the files.
    mocks.sendMessage.mockImplementation(async ({ inputEditor, onPreflightFailure }) => {
      inputEditor.setJSONState(editorData);
      onPreflightFailure();
      throw new Error('refused');
    });
    const { result } = renderHook(() => useProjectComposer(project, 'chat', 'coordinator'));

    await act(async () => {
      await result.current.send(composer('Hello'));
    });

    expect(editor.setJSONState).toHaveBeenCalledTimes(1);
    expect(mocks.restoreChatUploadFileList).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  /**
   * @example Codex review: a skill or local file that cannot be read makes the
   * send hand back only the attachments before rejecting, and the text was lost.
   */
  it('puts the text back when the refusal only returned the attachments', async () => {
    mocks.createProjectTopic.mockResolvedValue({ id: 'tpc_1' });
    mocks.fileList = [image];
    const editor = mountConversationEditor();
    mocks.sendMessage.mockImplementation(async ({ onPreflightFailure }) => {
      onPreflightFailure();
      throw new Error('skill unavailable');
    });
    const { result } = renderHook(() => useProjectComposer(project, 'chat', 'coordinator'));

    await act(async () => {
      await result.current.send(composer('Hello'));
    });

    expect(editor.setJSONState).toHaveBeenCalledWith(editorData);
    expect(mocks.restoreChatUploadFileList).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith('overview.messageNotSent');
  });

  /**
   * @example Codex review: the user opened another conversation while the send
   * was pending, and the refused draft overwrote that conversation's composer.
   */
  it('keeps a refused draft out of another conversation the user has opened', async () => {
    mocks.createProjectTopic.mockResolvedValue({ id: 'tpc_1' });
    const other = mountConversationEditor('tpc_other');
    mocks.sendMessage.mockRejectedValue(new Error('device offline'));
    const { result } = renderHook(() => useProjectComposer(project, 'chat', 'coordinator'));

    await act(async () => {
      await result.current.send(composer('Hello'));
    });

    expect(other.setJSONState).not.toHaveBeenCalled();
    expect(getDraft('main_coordinator_tpc_1')).toEqual(editorData);
  });

  it('leaves a stopped send to the stop flow', async () => {
    mocks.createProjectTopic.mockResolvedValue({ id: 'tpc_1' });
    const editor = mountConversationEditor();
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    mocks.sendMessage.mockRejectedValue(abort);
    const { result } = renderHook(() => useProjectComposer(project, 'chat', 'coordinator'));

    await act(async () => {
      await result.current.send(composer('Hello'));
    });

    expect(editor.setJSONState).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  /** @example Codex review: desktop notifications from these sends linked outside the workspace. */
  it('sends with the active workspace so its links stay inside it', async () => {
    mocks.workspaceSlug = 'acme';
    mocks.createProjectTopic.mockResolvedValue({ id: 'tpc_1' });
    const { result } = renderHook(() => useProjectComposer(project, 'chat', 'coordinator'));

    await act(async () => {
      await result.current.send(composer('Hello'));
    });

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { agentId: 'coordinator', topicId: 'tpc_1', workspaceSlug: 'acme' },
      }),
    );
  });

  it('loads the main agent config before sending to it', async () => {
    mocks.agentMap = {};
    mocks.getAgentConfigById.mockResolvedValue({ model: 'm' });
    mocks.createProjectTopic.mockResolvedValue({ id: 'tpc_1' });
    const { result } = renderHook(() => useProjectComposer(project, 'chat', 'coordinator'));

    await act(async () => {
      await result.current.send(composer('Hello'));
    });

    expect(mocks.internal_dispatchAgentMap).toHaveBeenCalledWith('coordinator', { model: 'm' });
    expect(mocks.sendMessage).toHaveBeenCalled();
  });

  it('records a project task with its attachments in task mode', async () => {
    mocks.createTask.mockResolvedValue({ id: 'task_1', identifier: 'T-1', name: 'Ship it' });
    mocks.fileList = [image];
    const { result } = renderHook(() => useProjectComposer(project, 'task', 'coordinator'));

    await act(async () => {
      await result.current.send(composer('Ship it\nwith the changelog'));
    });

    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeAgentId: 'coordinator',
        instruction: 'Ship it\nwith the changelog',
        name: 'Ship it',
        projectId: 'prj_1',
      }),
    );
    expect(mocks.clearChatUploadFileList).toHaveBeenCalledWith(['file_1']);
    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-1/ship-it');
    expect(mocks.createProjectTopic).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('ignores an empty composer and keeps a failed send in it', async () => {
    mocks.createProjectTopic.mockRejectedValue(new Error('denied'));
    const { result } = renderHook(() => useProjectComposer(project, 'chat', 'coordinator'));

    await act(async () => {
      await result.current.send(composer('   '));
    });
    expect(mocks.createProjectTopic).not.toHaveBeenCalled();

    const input = composer('Hello');
    await act(async () => {
      await expect(result.current.send(input)).rejects.toThrow('denied');
    });

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(input.clearContent).not.toHaveBeenCalled();
    expect(result.current.sending).toBe(false);
  });

  it('refuses to send while an attachment is still uploading', async () => {
    mocks.fileList = [{ ...image, fileUrl: undefined, status: 'uploading' }];
    const { result } = renderHook(() => useProjectComposer(project, 'chat', 'coordinator'));

    await act(async () => {
      await expect(result.current.send(composer('Hello'))).rejects.toBeInstanceOf(
        AttachmentsNotReadyError,
      );
    });

    expect(mocks.createProjectTopic).not.toHaveBeenCalled();
  });

  it('titles a conversation by its first line', () => {
    expect(toConversationTitle('a'.repeat(60))).toBe(`${'a'.repeat(50)}…`);
    expect(toConversationTitle('\n  Short  \nrest')).toBe('Short');
  });
});
