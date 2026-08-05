import { toast } from '@lobehub/ui/base-ui';
import { act, renderHook } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { notification } from '@/components/AntdStaticMethods';
import { fileService } from '@/services/file';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useFileStore as useStore } from '../../store';

const AGENT_ID = 'agent-1';

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

vi.mock('zustand/traditional');

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: {
    error: vi.fn(),
  },
}));

// Mock necessary modules and functions
vi.mock('@/components/AntdStaticMethods', () => ({
  notification: {
    error: vi.fn(),
  },
}));

vi.mock('@/services/rag', () => ({
  ragService: {
    parseFileContent: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('i18next', () => ({
  t: (key: string, options?: { reason?: string }) => {
    if (key === 'upload.permissionDenied') {
      return 'You do not have permission to upload files in this workspace.';
    }

    if (key === 'upload.uploadFailed') return 'File upload failed.';

    if (key === 'upload.unknownError') return `Error reason: ${options?.reason}`;

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
  it('clearChatUploadFileList should clear the inputFilesList', () => {
    const { result } = renderHook(() => useStore());

    act(() => {
      useStore.setState({ chatUploadFileList: [{ id: 'abc' }] as any });
    });

    expect(result.current.chatUploadFileList).toEqual([{ id: 'abc' }]);

    act(() => {
      result.current.clearChatUploadFileList();
    });

    expect(result.current.chatUploadFileList).toEqual([]);
  });

  it('uploadChatFiles should reject unsupported files before upload in chat mode', async () => {
    // chat mode: agent mode disabled and not a heterogeneous agent
    mockAgentMode({ enableAgentMode: false, heterogeneous: false });

    const { result } = renderHook(() => useStore());
    const uploadWithProgress = vi.fn();

    act(() => {
      useStore.setState({
        chatUploadFileList: [],
        uploadWithProgress: uploadWithProgress as any,
      });
    });

    await act(async () => {
      await result.current.uploadChatFiles(
        [
          new File(['<svg />'], 'icon.svg', { type: 'image/svg+xml' }),
          new File(['zip'], 'archive.zip', { type: 'application/zip' }),
        ],
        AGENT_ID,
      );
    });

    expect(uploadWithProgress).not.toHaveBeenCalled();
    expect(result.current.chatUploadFileList).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(expect.any(String));
  });

  it('uploadChatFiles should allow any file type in agent mode', async () => {
    mockAgentMode({ enableAgentMode: true, heterogeneous: false });

    const { result } = renderHook(() => useStore());
    const uploadWithProgress = vi.fn().mockResolvedValue({ id: 'file-1', url: 'http://x/1' });

    act(() => {
      useStore.setState({
        chatUploadFileList: [],
        uploadWithProgress: uploadWithProgress as any,
      });
    });

    await act(async () => {
      await result.current.uploadChatFiles(
        [new File(['zip'], 'archive.zip', { type: 'application/zip' })],
        AGENT_ID,
      );
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(uploadWithProgress).toHaveBeenCalledTimes(1);
  });

  it('uploadChatFiles should allow any file type for heterogeneous agents', async () => {
    mockAgentMode({ enableAgentMode: false, heterogeneous: true });

    const { result } = renderHook(() => useStore());
    const uploadWithProgress = vi.fn().mockResolvedValue({ id: 'file-2', url: 'http://x/2' });

    act(() => {
      useStore.setState({
        chatUploadFileList: [],
        uploadWithProgress: uploadWithProgress as any,
      });
    });

    await act(async () => {
      await result.current.uploadChatFiles(
        [new File(['profile'], 'Communication_Notifications.provisionprofile')],
        AGENT_ID,
      );
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(uploadWithProgress).toHaveBeenCalledTimes(1);
  });

  it('shows a permission denied description when upload is rejected by RBAC', async () => {
    mockAgentMode({ enableAgentMode: false, heterogeneous: false });

    const { result } = renderHook(() => useStore());
    const file = new File(['test'], 'test.txt', { type: 'text/plain' });

    vi.spyOn(result.current, 'uploadWithProgress').mockRejectedValue({
      data: { code: 'FORBIDDEN' },
      message: 'Missing any of: file:upload:all, file:upload:owner',
    });

    await act(async () => {
      await result.current.uploadChatFiles([file], AGENT_ID);
    });

    expect(notification.error).toHaveBeenCalledWith({
      description: 'You do not have permission to upload files in this workspace.',
      message: 'File upload failed.',
    });
  });

  describe('removeChatUploadFile', () => {
    it('deletes the underlying file for a normal uploaded item', async () => {
      const removeFile = vi.spyOn(fileService, 'removeFile').mockResolvedValue(undefined);
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ chatUploadFileList: [{ id: 'file-1' }] as any });
      });

      await act(async () => {
        await result.current.removeChatUploadFile('file-1');
      });

      expect(result.current.chatUploadFileList).toEqual([]);
      expect(removeFile).toHaveBeenCalledWith('file-1');
    });

    it('skips file deletion for a restored item (skipRemoveFile)', async () => {
      const removeFile = vi.spyOn(fileService, 'removeFile').mockResolvedValue(undefined);
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({
          chatUploadFileList: [{ id: 'file-1', skipRemoveFile: true }] as any,
        });
      });

      await act(async () => {
        await result.current.removeChatUploadFile('file-1');
      });

      // draft entry is dropped, but the persisted file backing the original
      // message must NOT be deleted
      expect(result.current.chatUploadFileList).toEqual([]);
      expect(removeFile).not.toHaveBeenCalled();
    });
  });
});
