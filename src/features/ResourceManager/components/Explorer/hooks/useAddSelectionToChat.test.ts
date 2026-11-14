import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { initialState } from '@/features/ResourceManager/store/initialState';
import { useAgentStore } from '@/store/agent';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { fileChatSelectors, useFileStore } from '@/store/file';
import type { ResourceItem } from '@/types/resource';

import { useAddSelectionToChat } from './useAddSelectionToChat';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  parseFileContent: vi.fn(async () => undefined),
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/services/rag', () => ({
  ragService: { parseFileContent: mocks.parseFileContent },
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: mocks.toast,
}));

const INBOX_AGENT_ID = 'agt_inbox';
const inboxInputKey = messageMapKey({ agentId: INBOX_AGENT_ID, topicId: null });

const row = (overrides: Partial<ResourceItem>): ResourceItem =>
  ({
    createdAt: new Date(),
    fileType: 'text/markdown',
    size: 10,
    sourceType: 'file',
    updatedAt: new Date(),
    url: 'https://s3.local/file',
    ...overrides,
  }) as ResourceItem;

const select = (rows: ResourceItem[]) => {
  useFileStore.setState({ resourceMap: new Map(rows.map((item) => [item.id, item])) });
  useResourceManagerStore.setState({
    selectAllState: 'loaded',
    selectedFileIds: rows.map((item) => item.id),
  });
};

describe('useAddSelectionToChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useResourceManagerStore.setState(initialState);
    useFileStore.setState({ chatUploadFileListByContext: {}, resourceMap: new Map() });
    useAgentStore.setState({ builtinAgentIdMap: { inbox: INBOX_AGENT_ID } });
  });

  it('stages the selected files in a new inbox chat and opens it', async () => {
    select([
      row({ fileId: 'file-1', id: 'file-1', name: 'report.md' }),
      row({ fileType: 'image/png', id: 'file-2', name: 'sketch.png' }),
      row({ fileType: 'custom/document', id: 'docs-1', name: 'Meeting notes' }),
    ]);

    const { result } = renderHook(() => useAddSelectionToChat());
    await act(async () => {
      await result.current.addSelectionToChat();
    });

    const staged = fileChatSelectors.chatUploadFileList(inboxInputKey)(useFileStore.getState());
    expect(staged.map((item) => [item.id, item.skipRemoveFile])).toEqual([
      ['file-1', true],
      ['file-2', true],
    ]);
    expect(mocks.navigate).toHaveBeenCalledWith(`/agent/${INBOX_AGENT_ID}`);
    // Images need no parse; the markdown file is parsed up front like a chat upload.
    expect(mocks.parseFileContent).toHaveBeenCalledTimes(1);
    expect(mocks.parseFileContent).toHaveBeenCalledWith('file-1');
    expect(mocks.toast.success).toHaveBeenCalledWith('FileManager.actions.addToChatPartial');
    expect(useResourceManagerStore.getState().selectedFileIds).toEqual([]);
  });

  it('stays on the library when nothing selected is a file', async () => {
    select([
      row({ fileType: 'custom/folder', id: 'folder-1', name: 'Archive' }),
      row({ fileId: null, fileType: 'custom/document', id: 'docs-1', sourceType: 'document' }),
    ]);

    const { result } = renderHook(() => useAddSelectionToChat());
    await act(async () => {
      await result.current.addSelectionToChat();
    });

    expect(mocks.toast.info).toHaveBeenCalledWith('FileManager.actions.addToChatNoFiles');
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(useFileStore.getState().chatUploadFileListByContext).toEqual({});
    // The selection is kept so the user can adjust it.
    expect(useResourceManagerStore.getState().selectedFileIds).toEqual(['folder-1', 'docs-1']);
  });

  it('does not add a file the new chat input already holds twice', async () => {
    useFileStore.setState({
      chatUploadFileListByContext: {
        [inboxInputKey]: [{ file: {} as File, id: 'file-1', status: 'success' }],
      },
    });
    select([row({ fileId: 'file-1', id: 'file-1', name: 'report.md' })]);

    const { result } = renderHook(() => useAddSelectionToChat());
    await act(async () => {
      await result.current.addSelectionToChat();
    });

    const staged = fileChatSelectors.chatUploadFileList(inboxInputKey)(useFileStore.getState());
    expect(staged.map((item) => item.id)).toEqual(['file-1']);
    expect(mocks.navigate).toHaveBeenCalledWith(`/agent/${INBOX_AGENT_ID}`);
    expect(mocks.toast.success).toHaveBeenCalledWith('FileManager.actions.addToChatSuccess');
  });
});
