import { CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';
import { FileSource } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentDocumentItem } from '../types';
import { useDocumentTreeOps } from './useDocumentTreeOps';

const toastError = vi.hoisted(() => vi.fn());
const importFileMock = vi.hoisted(() => vi.fn());
const removeUnreferencedFileMock = vi.hoisted(() => vi.fn());
const uploadWithProgressMock = vi.hoisted(() => vi.fn());
const dispatchDockFileListMock = vi.hoisted(() => vi.fn());
const createDocumentMock = vi.hoisted(() => vi.fn());
const createFolderByIdMock = vi.hoisted(() => vi.fn());
const moveDocumentsByIdMock = vi.hoisted(() => vi.fn());
const removeDocumentMock = vi.hoisted(() => vi.fn());
const confirmModalMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: confirmModalMock,
  toast: { error: toastError, success: vi.fn() },
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: {
    createDocument: createDocumentMock,
    createFolderById: createFolderByIdMock,
    importFile: importFileMock,
    moveDocumentsById: moveDocumentsByIdMock,
    removeDocument: removeDocumentMock,
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

vi.mock('@/services/file', () => ({
  fileService: { removeUnreferencedFile: removeUnreferencedFileMock },
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
    removeUnreferencedFileMock.mockReset().mockResolvedValue(undefined);
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
    /** @example The upload carries the source used for shared visibility and library exclusion. */
    expect(uploadWithProgressMock).toHaveBeenCalledWith(
      expect.objectContaining({ skipCheckFileType: true, source: FileSource.AgentDocument }),
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
    /** @example Only the failed import's upload is reclaimed. */
    expect(removeUnreferencedFileMock.mock.calls).toEqual([['file-1']]);
  });

  /** @example A failed list refresh after import must not delete the imported file. */
  it('keeps a successfully imported file when refreshing the tree fails', async () => {
    mutate.mockRejectedValueOnce(new Error('refresh failed'));
    const { result } = renderHook(() =>
      useDocumentTreeOps({ agentId: 'agent-1', data: [], mutate }),
    );
    await result.current.uploadFiles(null, [new File(['a'], 'a.md')]);
    /** @example The committed document retains its file despite the refresh error. */
    expect(removeUnreferencedFileMock).not.toHaveBeenCalled();
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

// Parents are addressed by id, so a plain document can hold children — paths
// could not reach anything nested under a document.
describe('useDocumentTreeOps id-based tree edits', () => {
  const mutate = vi.fn();
  const sop = createDoc({
    documentId: 'sop-doc',
    fileType: 'custom/document',
    filename: 'SOP',
    id: 'sop-row',
    isFolder: false,
    title: 'SOP',
  });
  const run = createDoc({
    documentId: 'run-doc',
    fileType: 'custom/document',
    filename: 'Run 1',
    id: 'run-row',
    isFolder: false,
    title: 'Run 1',
  });

  beforeEach(() => {
    toastError.mockReset();
    mutate.mockReset();
    createDocumentMock.mockReset().mockResolvedValue({ id: 'new-row' });
    createFolderByIdMock.mockReset().mockResolvedValue({ created: true, folder: { id: 'f-row' } });
    moveDocumentsByIdMock.mockReset().mockResolvedValue([{ id: 'run-row', status: 'moved' }]);
    removeDocumentMock.mockReset().mockResolvedValue({ deleted: true, id: 'sop-row' });
    confirmModalMock.mockReset();
  });

  const renderOps = (data: AgentDocumentItem[]) =>
    renderHook(() => useDocumentTreeOps({ agentId: 'agent-1', data, mutate })).result.current;

  it('creates a sub-document under a document parent', async () => {
    await renderOps([sop]).createDocument('sop-row');

    expect(createDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', parentId: 'sop-doc' }),
    );
  });

  it('creates a root document without a parent', async () => {
    await renderOps([sop]).createDocument(null);

    expect(createDocumentMock.mock.calls[0][0]).not.toHaveProperty('parentId');
  });

  it('creates a folder by parent id', async () => {
    await renderOps([sop]).createFolder('sop-row');

    expect(createFolderByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', parentId: 'sop-doc' }),
    );
  });

  it('moves rows under a document in one call and reports failures', async () => {
    moveDocumentsByIdMock.mockResolvedValue([
      {
        id: 'run-row',
        status: 'failed',
        error: '"Run 1" already exists in the destination folder.',
      },
    ]);

    await renderOps([sop, run]).moveDocument({
      sourceIds: ['run-row'],
      sourceNodes: [{ data: run }],
      targetId: 'sop-row',
    });

    expect(moveDocumentsByIdMock).toHaveBeenCalledWith({
      agentId: 'agent-1',
      ids: ['run-row'],
      parentId: 'sop-doc',
    });
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('already exists'));
  });

  it('deletes a parent document together with what is nested under it', async () => {
    const nested = { ...run, parentId: 'sop-doc' };
    renderOps([sop, nested]).deleteDocuments(['sop-row', 'run-row']);
    const [{ onOk }] = confirmModalMock.mock.calls[0];
    onOk();

    await vi.waitFor(() => expect(removeDocumentMock).toHaveBeenCalledTimes(1));
    expect(removeDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sop-row', withChildren: true }),
    );
  });
});
