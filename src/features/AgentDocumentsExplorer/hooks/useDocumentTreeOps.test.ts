import { CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentDocumentItem } from '../types';
import { useDocumentTreeOps } from './useDocumentTreeOps';

const toastError = vi.hoisted(() => vi.fn());
const importFileMock = vi.hoisted(() => vi.fn());
const uploadWithProgressMock = vi.hoisted(() => vi.fn());
const dispatchDockFileListMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: vi.fn(),
  toast: { error: toastError, success: vi.fn() },
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: {
    importFile: importFileMock,
  },
}));

vi.mock('@/store/file', () => ({
  useFileStore: {
    getState: () => ({
      dispatchDockFileList: dispatchDockFileListMock,
      uploadWithProgress: uploadWithProgressMock,
    }),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const createDoc = (overrides: Partial<AgentDocumentItem> = {}): AgentDocumentItem =>
  ({
    category: 'document',
    description: null,
    documentId: 'folder-doc',
    filename: 'Notes',
    fileType: CUSTOM_FOLDER_FILE_TYPE,
    id: 'folder-row',
    isFolder: true,
    isSkillBundle: false,
    isSkillIndex: false,
    parentId: null,
    sourceType: 'agent',
    templateId: null,
    title: 'Notes',
    updatedAt: new Date(),
    ...overrides,
  }) as AgentDocumentItem;

describe('useDocumentTreeOps.uploadFiles', () => {
  const mutate = vi.fn();

  beforeEach(() => {
    toastError.mockReset();
    importFileMock.mockReset();
    uploadWithProgressMock.mockReset();
    dispatchDockFileListMock.mockReset();
    mutate.mockReset();
    importFileMock.mockResolvedValue({ id: 'ad-1' });
    uploadWithProgressMock.mockResolvedValue({ id: 'file-1' });
  });

  it('uploads then imports at the tree root', async () => {
    const { result } = renderHook(() =>
      useDocumentTreeOps({ agentId: 'agent-1', data: [], mutate }),
    );

    await result.current.uploadFiles(null, [
      new File(['hi'], 'notes.md', { type: 'text/markdown' }),
    ]);

    expect(dispatchDockFileListMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'addFiles' }),
    );
    expect(uploadWithProgressMock).toHaveBeenCalledWith(
      expect.objectContaining({ skipCheckFileType: true }),
    );
    expect(importFileMock).toHaveBeenCalledWith({
      agentId: 'agent-1',
      fileId: 'file-1',
      parentId: null,
    });
    expect(mutate).toHaveBeenCalled();
  });

  it('imports into the selected folder', async () => {
    const { result } = renderHook(() =>
      useDocumentTreeOps({ agentId: 'agent-1', data: [createDoc()], mutate }),
    );

    await result.current.uploadFiles('folder-row', [
      new File(['hi'], 'notes.md', { type: 'text/markdown' }),
    ]);

    expect(importFileMock).toHaveBeenCalledWith({
      agentId: 'agent-1',
      fileId: 'file-1',
      parentId: 'folder-doc',
    });
  });

  it('skips import when upload is cancelled', async () => {
    uploadWithProgressMock.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDocumentTreeOps({ agentId: 'agent-1', data: [], mutate }),
    );

    await result.current.uploadFiles(null, [
      new File(['hi'], 'notes.md', { type: 'text/markdown' }),
    ]);

    expect(importFileMock).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('toasts a per-file import failure and continues', async () => {
    uploadWithProgressMock
      .mockResolvedValueOnce({ id: 'file-1' })
      .mockResolvedValueOnce({ id: 'file-2' });
    importFileMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ id: 'ad-2' });

    const { result } = renderHook(() =>
      useDocumentTreeOps({ agentId: 'agent-1', data: [], mutate }),
    );

    await result.current.uploadFiles(null, [
      new File(['a'], 'a.md', { type: 'text/markdown' }),
      new File(['b'], 'b.md', { type: 'text/markdown' }),
    ]);

    expect(toastError).toHaveBeenCalled();
    expect(importFileMock).toHaveBeenCalledTimes(2);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('ignores blacklisted system files', async () => {
    const { result } = renderHook(() =>
      useDocumentTreeOps({ agentId: 'agent-1', data: [], mutate }),
    );

    await result.current.uploadFiles(null, [new File([''], '.DS_Store')]);

    expect(uploadWithProgressMock).not.toHaveBeenCalled();
    expect(importFileMock).not.toHaveBeenCalled();
  });
});
