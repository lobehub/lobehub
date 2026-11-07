import type { ChatContextContent } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { act, renderHook } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { UnreadableServerResponseError } from '@/libs/trpc/client/unreadableServerResponse';
import { fileService } from '@/services/file';
import { ragService } from '@/services/rag';
import { shareChatService } from '@/services/shareChat';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useFileStore as useStore } from '../../store';

const AGENT_ID = 'agent-1';
const CONTEXT_KEY = 'main_agent-1_new';
const uploadList = () => useStore.getState().chatUploadFileListByContext[CONTEXT_KEY] ?? [];

/** Force the conversation agent into chat / agent / heterogeneous mode for the by-id selectors. */
const mockAgentMode = ({
  enableAgentMode,
  heterogeneous,
}: {
  enableAgentMode: boolean;
  heterogeneous: boolean;
}) => {
  vi.spyOn(agentByIdSelectors, 'getAgentEnableModeById').mockReturnValue(() => enableAgentMode);
  vi.spyOn(agentByIdSelectors, 'isAgentHeterogeneousById').mockReturnValue(() => heterogeneous);
};

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
}));

vi.mock('@/services/rag', () => ({
  ragService: {
    parseFileContent: vi.fn().mockResolvedValue(undefined),
  },
}));

const { mockUploadShareVisitorFile } = vi.hoisted(() => ({
  mockUploadShareVisitorFile: vi.fn(),
}));
vi.mock('./shareVisitorUpload', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  uploadShareVisitorFile: mockUploadShareVisitorFile,
}));

vi.mock('@/services/shareChat', () => ({
  shareChatService: {
    removeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('i18next', () => ({
  t: (
    key: string,
    options?: { message?: string; reason?: string; requestId?: string; status?: number },
  ) => {
    if (key === 'upload.permissionDenied') {
      return 'You do not have permission to upload files in this workspace.';
    }

    if (key === 'upload.uploadFailed') return 'File upload failed.';

    if (key === 'upload.unknownError') return `Error reason: ${options?.reason}`;

    if (key === 'upload.serviceUnavailable') return 'The upload service is unavailable.';

    if (key === 'response.withRequestDetail') {
      return `${options?.message} (HTTP ${options?.status} · Request ID: ${options?.requestId})`;
    }

    return key;
  },
}));

beforeAll(() => {
  Object.defineProperty(File.prototype, 'arrayBuffer', {
    writable: true,
    value: function () {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(reader.result);
        };
        reader.readAsArrayBuffer(this);
      });
    },
  });
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('useFileStore:chat', () => {
  it('isolates context selections by conversation key', () => {
    const { result } = renderHook(() => useStore());
    const sharedIdSelectionA: ChatContextContent = {
      content: 'selection A',
      id: 'shared-selection',
      type: 'text',
    };
    const sharedIdSelectionB: ChatContextContent = {
      content: 'selection B',
      id: 'shared-selection',
      type: 'text',
    };

    act(() => {
      useStore.setState({ chatContextSelectionsByContext: {} });
      result.current.addChatContextSelection({
        contextKey: 'topic-a',
        selection: sharedIdSelectionA,
      });
      result.current.addChatContextSelection({
        contextKey: 'topic-b',
        selection: sharedIdSelectionB,
      });
    });

    expect(result.current.chatContextSelectionsByContext).toEqual({
      'topic-a': [sharedIdSelectionA],
      'topic-b': [sharedIdSelectionB],
    });

    act(() => {
      result.current.removeChatContextSelection({
        contextKey: 'topic-a',
        id: sharedIdSelectionA.id,
      });
    });

    expect(result.current.chatContextSelectionsByContext).toEqual({
      'topic-b': [sharedIdSelectionB],
    });

    act(() => {
      result.current.clearChatContextSelections('topic-b');
    });

    expect(result.current.chatContextSelectionsByContext).toEqual({});
  });

  it('moves context selections to a new conversation key without overwriting the target', () => {
    const { result } = renderHook(() => useStore());
    const sourceSelection: ChatContextContent = {
      content: 'source selection',
      id: 'shared-selection',
      type: 'text',
    };
    const targetSelection: ChatContextContent = {
      content: 'stale target selection',
      id: 'shared-selection',
      type: 'text',
    };
    const targetOnlySelection: ChatContextContent = {
      content: 'target only',
      id: 'target-only',
      type: 'text',
    };

    act(() => {
      useStore.setState({
        chatContextSelectionsByContext: {
          'topic-new': [sourceSelection],
          'topic-real': [targetSelection, targetOnlySelection],
        },
      });
      result.current.moveChatContextSelections('topic-new', 'topic-real');
    });

    expect(result.current.chatContextSelectionsByContext).toEqual({
      'topic-real': [sourceSelection, targetOnlySelection],
    });
  });

  it('restores submitted selections without overwriting context added while sending', () => {
    const { result } = renderHook(() => useStore());
    const submittedSelection: ChatContextContent = {
      content: 'submitted selection',
      id: 'submitted',
      type: 'text',
    };
    const newerSelection: ChatContextContent = {
      content: 'newer selection',
      id: 'newer',
      type: 'text',
    };

    act(() => {
      useStore.setState({
        chatContextSelectionsByContext: { topic: [newerSelection] },
      });
      result.current.restoreChatContextSelections('topic', [submittedSelection]);
    });

    expect(result.current.chatContextSelectionsByContext).toEqual({
      topic: [submittedSelection, newerSelection],
    });
  });

  it('clearChatUploadFileList should clear the inputFilesList', () => {
    const { result } = renderHook(() => useStore());

    act(() => {
      useStore.setState({ chatUploadFileListByContext: { [CONTEXT_KEY]: [{ id: 'abc' }] } as any });
    });

    expect(uploadList()).toEqual([{ id: 'abc' }]);

    act(() => {
      result.current.clearChatUploadFileList(CONTEXT_KEY);
    });

    expect(uploadList()).toEqual([]);
  });

  it('clears only submitted uploads while retaining newer files and their status', () => {
    const { result } = renderHook(() => useStore());
    const newerFile = { id: 'new', status: 'uploading' };
    act(() => {
      useStore.setState({
        chatUploadFileListByContext: { [CONTEXT_KEY]: [{ id: 'submitted' }, newerFile] } as any,
      });
      result.current.clearChatUploadFileList(CONTEXT_KEY, ['submitted']);
    });
    expect(uploadList()).toEqual([newerFile]);
    act(() => {
      result.current.clearChatUploadFileList(CONTEXT_KEY, []);
    });
    expect(uploadList()).toEqual([newerFile]);
  });

  it('restoreChatUploadFileList puts cleared uploads back without duplicating newer drafts', () => {
    const { result } = renderHook(() => useStore());
    const submittedFile = { id: 'submitted', status: 'success' };
    const newerFile = { id: 'new', status: 'uploading' };

    // The composer cleared everything on send; a fresh draft arrived while the
    // rejected send was still unwinding.
    act(() => {
      useStore.setState({ chatUploadFileListByContext: { [CONTEXT_KEY]: [newerFile] } as any });
      result.current.restoreChatUploadFileList(CONTEXT_KEY, [submittedFile, newerFile] as any);
    });

    expect(uploadList()).toEqual([newerFile, submittedFile]);

    act(() => {
      result.current.restoreChatUploadFileList(CONTEXT_KEY, []);
    });
    expect(uploadList()).toEqual([newerFile, submittedFile]);
  });

  // Regression: one global upload list showed a conversation's attachments in
  // every other conversation, while its text draft stayed behind.
  it('keeps the uploads of each conversation to itself', () => {
    const { result } = renderHook(() => useStore());
    const fileA = { id: 'a', status: 'success' };
    const fileB = { id: 'b', status: 'success' };

    act(() => {
      useStore.setState({ chatUploadFileListByContext: {} });
      result.current.dispatchChatUploadFileList('topic-a', {
        files: [fileA] as any,
        type: 'addFiles',
      });
      result.current.dispatchChatUploadFileList('topic-b', {
        files: [fileB] as any,
        type: 'addFiles',
      });
    });

    expect(result.current.chatUploadFileListByContext).toEqual({
      'topic-a': [fileA],
      'topic-b': [fileB],
    });

    act(() => {
      result.current.clearChatUploadFileList('topic-a');
    });

    // Back on topic-b its upload is untouched; the emptied topic-a bucket is gone.
    expect(result.current.chatUploadFileListByContext).toEqual({ 'topic-b': [fileB] });
  });

  it('moves staged uploads and context selections together to the new key', () => {
    const { result } = renderHook(() => useStore());
    const staged = { id: 'staged', status: 'success' };
    const existing = { id: 'existing', status: 'success' };
    const selection: ChatContextContent = { content: 'quote', id: 'sel', type: 'text' };

    act(() => {
      useStore.setState({
        chatContextSelectionsByContext: { blank: [selection] },
        chatUploadFileListByContext: { blank: [staged], topic: [existing] } as any,
      });
      result.current.moveChatComposerAttachments('blank', 'topic');
    });

    expect(result.current.chatUploadFileListByContext).toEqual({ topic: [existing, staged] });
    expect(result.current.chatContextSelectionsByContext).toEqual({ topic: [selection] });
  });

  // Regression: a moved in-flight upload was found by its pending id (the file
  // name), so a same-named upload staged later under the old key took its result.
  it('reports a moved in-flight upload to its own chip, not a same-named later one', async () => {
    mockAgentMode({ enableAgentMode: true, heterogeneous: false });
    const { result } = renderHook(() => useStore());
    const finishes: (() => void)[] = [];
    vi.spyOn(result.current, 'uploadWithProgress').mockImplementation(
      ({ file, onStatusUpdate }) =>
        new Promise((resolve) => {
          const n = finishes.length + 1;
          finishes.push(() => {
            onStatusUpdate?.({
              id: file.name,
              type: 'updateFile',
              value: { fileUrl: `url-${n}`, id: `server-${n}`, status: 'success' },
            });
            resolve({ id: `server-${n}`, url: `url-${n}` } as any);
          });
        }),
    );
    useStore.setState({ chatUploadFileListByContext: {} });

    let firstUpload!: Promise<void>;
    let secondUpload!: Promise<void>;
    await act(async () => {
      firstUpload = result.current.uploadChatFiles(
        'blank',
        [new File(['a'], 'notes.txt', { type: 'text/plain' })],
        AGENT_ID,
      );
      await vi.waitFor(() => expect(finishes).toHaveLength(1));
    });

    // The blank conversation becomes a topic mid-upload; the user then stages a
    // same-named file in the next blank conversation.
    await act(async () => {
      result.current.moveChatUploadFileList('blank', 'topic');
      secondUpload = result.current.uploadChatFiles(
        'blank',
        [new File(['b'], 'notes.txt', { type: 'text/plain' })],
        AGENT_ID,
      );
      await vi.waitFor(() => expect(finishes).toHaveLength(2));
    });

    await act(async () => {
      finishes[0]();
      await firstUpload;
    });

    const lists = useStore.getState().chatUploadFileListByContext;
    expect(lists.topic).toEqual([
      expect.objectContaining({ fileUrl: 'url-1', id: 'server-1', status: 'success' }),
    ]);
    expect(lists.blank).toEqual([expect.objectContaining({ id: 'notes.txt', status: 'pending' })]);

    await act(async () => {
      finishes[1]();
      await secondUpload;
    });
  });

  it('uploadChatFiles should reject unsupported files before upload in chat mode', async () => {
    // chat mode: agent mode disabled and not a heterogeneous agent
    mockAgentMode({ enableAgentMode: false, heterogeneous: false });

    const { result } = renderHook(() => useStore());
    const uploadWithProgress = vi.fn();

    act(() => {
      useStore.setState({
        chatUploadFileListByContext: {},
        uploadWithProgress: uploadWithProgress as any,
      });
    });

    await act(async () => {
      await result.current.uploadChatFiles(
        CONTEXT_KEY,
        [
          new File(['<svg />'], 'icon.svg', { type: 'image/svg+xml' }),
          new File(['zip'], 'archive.zip', { type: 'application/zip' }),
        ],
        AGENT_ID,
      );
    });

    expect(uploadWithProgress).not.toHaveBeenCalled();
    expect(uploadList()).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(expect.any(String));
  });

  it('uploadChatFiles should allow any file type in agent mode', async () => {
    mockAgentMode({ enableAgentMode: true, heterogeneous: false });

    const { result } = renderHook(() => useStore());
    const uploadWithProgress = vi.fn().mockResolvedValue({ id: 'file-1', url: 'http://x/1' });

    act(() => {
      useStore.setState({
        chatUploadFileListByContext: {},
        uploadWithProgress: uploadWithProgress as any,
      });
    });

    await act(async () => {
      await result.current.uploadChatFiles(
        CONTEXT_KEY,
        [new File(['zip'], 'archive.zip', { type: 'application/zip' })],
        AGENT_ID,
      );
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(uploadWithProgress).toHaveBeenCalledTimes(1);
    expect(uploadWithProgress).toHaveBeenCalledWith(
      expect.objectContaining({ conversationAgentId: AGENT_ID }),
    );
  });

  it('uploadChatFiles should allow any file type for heterogeneous agents', async () => {
    mockAgentMode({ enableAgentMode: false, heterogeneous: true });

    const { result } = renderHook(() => useStore());
    const uploadWithProgress = vi.fn().mockResolvedValue({ id: 'file-2', url: 'http://x/2' });

    act(() => {
      useStore.setState({
        chatUploadFileListByContext: {},
        uploadWithProgress: uploadWithProgress as any,
      });
    });

    await act(async () => {
      await result.current.uploadChatFiles(
        CONTEXT_KEY,
        [new File(['profile'], 'Communication_Notifications.provisionprofile')],
        AGENT_ID,
      );
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(uploadWithProgress).toHaveBeenCalledTimes(1);
  });

  it('keeps a permission-denied upload in place with a retryable error', async () => {
    mockAgentMode({ enableAgentMode: false, heterogeneous: false });

    const { result } = renderHook(() => useStore());
    const file = new File(['test'], 'test.txt', { type: 'text/plain' });

    vi.spyOn(result.current, 'uploadWithProgress').mockRejectedValue({
      data: { code: 'FORBIDDEN' },
      message: 'Missing any of: file:upload:all, file:upload:owner',
    });

    await act(async () => {
      await result.current.uploadChatFiles(CONTEXT_KEY, [file], AGENT_ID);
    });

    expect(uploadList()).toEqual([
      expect.objectContaining({
        agentId: AGENT_ID,
        error: 'You do not have permission to upload files in this workspace.',
        id: 'test.txt',
        status: 'error',
      }),
    ]);
  });

  // Regression: a gateway HTML error page answered the upload API and the card
  // showed `Error reason: Unexpected token '<', "<!doctype "... is not valid JSON`.
  it('shows the upload-unavailable copy with the request id of an HTML error page', async () => {
    mockAgentMode({ enableAgentMode: true, heterogeneous: false });

    const { result } = renderHook(() => useStore());
    const file = new File(['docx'], 'report.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    // tRPC wraps an error thrown by the link's fetch as the client error's cause.
    vi.spyOn(result.current, 'uploadWithProgress').mockRejectedValue(
      new Error('wrapped', {
        cause: new UnreadableServerResponseError({ requestId: 'a4f7-SJC', status: 502 }),
      }),
    );

    await act(async () => {
      await result.current.uploadChatFiles(CONTEXT_KEY, [file], AGENT_ID);
    });

    expect(uploadList()).toEqual([
      expect.objectContaining({
        error: 'The upload service is unavailable. (HTTP 502 · Request ID: a4f7-SJC)',
        id: 'report.docx',
        status: 'error',
      }),
    ]);
  });

  describe('uploadChatFiles as an agent-share visitor', () => {
    const SHARE_ID = 'share-1';

    it('routes the upload through the share path, tags the draft with shareId, and skips the visitor-side parse', async () => {
      // The visitor's agent store never holds the creator's agent, so the
      // mode selectors would say "agent mode" here only by accident.
      mockAgentMode({ enableAgentMode: true, heterogeneous: false });
      mockUploadShareVisitorFile.mockResolvedValue({ id: 'file-share', url: 'https://s3/doc' });
      const { result } = renderHook(() => useStore());
      const uploadWithProgress = vi.spyOn(result.current, 'uploadWithProgress');
      const file = new File(['test'], 'notes.pdf', { type: 'application/pdf' });

      await act(async () => {
        await result.current.uploadChatFiles(CONTEXT_KEY, [file], AGENT_ID, { shareId: SHARE_ID });
      });

      expect(mockUploadShareVisitorFile).toHaveBeenCalledWith(
        expect.objectContaining({ file, shareId: SHARE_ID }),
      );
      expect(uploadWithProgress).not.toHaveBeenCalled();
      // Creator-owned row: the visitor's `document.parseFileContent` could not
      // reach it; the run parses it on the creator's account instead.
      expect(ragService.parseFileContent).not.toHaveBeenCalled();
      expect(uploadList()).toEqual([
        expect.objectContaining({ agentId: AGENT_ID, id: 'notes.pdf', shareId: SHARE_ID }),
      ]);
    });

    it('always enforces the chat file-type whitelist on the share path', async () => {
      mockAgentMode({ enableAgentMode: true, heterogeneous: true });
      const { result } = renderHook(() => useStore());
      const file = new File(['x'], 'tool.exe', { type: 'application/octet-stream' });

      await act(async () => {
        await result.current.uploadChatFiles(CONTEXT_KEY, [file], AGENT_ID, { shareId: SHARE_ID });
      });

      expect(mockUploadShareVisitorFile).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalled();
      expect(uploadList()).toEqual([]);
    });

    it('rejects a file over SHARE_VISITOR_MAX_FILE_SIZE before any request', async () => {
      mockAgentMode({ enableAgentMode: false, heterogeneous: false });
      const { result } = renderHook(() => useStore());
      const big = new File([''], 'big.pdf', { type: 'application/pdf' });
      Object.defineProperty(big, 'size', { value: 33 * 1024 * 1024 });

      await act(async () => {
        await result.current.uploadChatFiles(CONTEXT_KEY, [big], AGENT_ID, { shareId: SHARE_ID });
      });

      expect(mockUploadShareVisitorFile).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('share.visitor.upload.fileTooLarge');
      expect(uploadList()).toEqual([]);
    });

    it("surfaces the creator's storage block as share copy, not the visitor's own plan", async () => {
      mockAgentMode({ enableAgentMode: false, heterogeneous: false });
      mockUploadShareVisitorFile.mockRejectedValue(new Error('storage_block:upgrade_required'));
      const { result } = renderHook(() => useStore());
      const file = new File(['test'], 'notes.pdf', { type: 'application/pdf' });

      await act(async () => {
        await result.current.uploadChatFiles(CONTEXT_KEY, [file], AGENT_ID, { shareId: SHARE_ID });
      });

      expect(uploadList()).toEqual([
        expect.objectContaining({
          error: 'share.visitor.upload.creatorStorageBlocked',
          id: 'notes.pdf',
          status: 'error',
        }),
      ]);
    });
  });

  describe('removeChatUploadFile', () => {
    it('removes a share-uploaded draft through the share endpoint, not the visitor file API', async () => {
      const removeFile = vi.spyOn(fileService, 'removeFile').mockResolvedValue(undefined);
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({
          chatUploadFileListByContext: {
            [CONTEXT_KEY]: [{ id: 'file-1', shareId: 'share-1', status: 'success' }],
          } as any,
        });
      });

      await act(async () => {
        await result.current.removeChatUploadFile(CONTEXT_KEY, 'file-1');
      });

      expect(uploadList()).toEqual([]);
      expect(shareChatService.removeFile).toHaveBeenCalledWith('share-1', 'file-1');
      expect(removeFile).not.toHaveBeenCalled();
    });

    it('drops an unsettled share draft locally without calling the share endpoint', async () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        // Still keyed by file name: nothing exists server-side to delete.
        useStore.setState({
          chatUploadFileListByContext: {
            [CONTEXT_KEY]: [{ id: 'cat.png', shareId: 'share-1', status: 'error' }],
          } as any,
        });
      });

      await act(async () => {
        await result.current.removeChatUploadFile(CONTEXT_KEY, 'cat.png');
      });

      expect(uploadList()).toEqual([]);
      expect(shareChatService.removeFile).not.toHaveBeenCalled();
    });

    it('deletes the underlying file for a normal uploaded item', async () => {
      const removeFile = vi.spyOn(fileService, 'removeFile').mockResolvedValue(undefined);
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({
          chatUploadFileListByContext: { [CONTEXT_KEY]: [{ id: 'file-1' }] } as any,
        });
      });

      await act(async () => {
        await result.current.removeChatUploadFile(CONTEXT_KEY, 'file-1');
      });

      expect(uploadList()).toEqual([]);
      expect(removeFile).toHaveBeenCalledWith('file-1');
    });

    it('skips file deletion for a restored item (skipRemoveFile)', async () => {
      const removeFile = vi.spyOn(fileService, 'removeFile').mockResolvedValue(undefined);
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({
          chatUploadFileListByContext: {
            [CONTEXT_KEY]: [{ id: 'file-1', skipRemoveFile: true }],
          } as any,
        });
      });

      await act(async () => {
        await result.current.removeChatUploadFile(CONTEXT_KEY, 'file-1');
      });

      // draft entry is dropped, but the persisted file backing the original
      // message must NOT be deleted
      expect(uploadList()).toEqual([]);
      expect(removeFile).not.toHaveBeenCalled();
    });
  });
});
