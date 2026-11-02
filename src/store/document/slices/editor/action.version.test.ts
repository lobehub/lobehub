import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { documentService } from '@/services/document';

import { useDocumentStore } from '../../store';

vi.mock('@/services/document', () => ({
  documentService: {
    snapshotPageVersion: vi.fn().mockResolvedValue(true),
    updateDocument: vi.fn().mockResolvedValue({
      historyAppended: true,
      id: 'doc-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  },
}));

const editor = { getDocument: vi.fn(() => null), setDocument: vi.fn() };

const seed = (collab: boolean) => {
  act(() => {
    useDocumentStore.getState().initDocumentWithEditor({
      content: '# Page',
      documentId: 'doc-1',
      editor: editor as any,
      sourceType: 'page',
    });
    useDocumentStore.setState({ editor: editor as any });
    useDocumentStore
      .getState()
      .internal_dispatchDocument({ id: 'doc-1', type: 'updateDocument', value: { collab } });
  });
};

describe('DocumentStore versions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      Object.keys(useDocumentStore.getState().documents).forEach((id) =>
        useDocumentStore.getState().closeDocument(id),
      );
    });
  });

  it('records a room page version on the server', async () => {
    seed(true);
    const performSave = vi.spyOn(useDocumentStore.getState(), 'performSave');

    await useDocumentStore.getState().saveVersion('doc-1');

    expect(documentService.snapshotPageVersion).toHaveBeenCalledWith('doc-1', 'manual');
    expect(performSave).not.toHaveBeenCalled();
  });

  it('saves a stored page version as a manual save', async () => {
    seed(false);
    const performSave = vi
      .spyOn(useDocumentStore.getState(), 'performSave')
      .mockResolvedValue(undefined);

    await useDocumentStore.getState().saveVersion('doc-1');

    expect(performSave).toHaveBeenCalledWith('doc-1', undefined, { saveSource: 'manual' });
    expect(documentService.snapshotPageVersion).not.toHaveBeenCalled();
  });

  it('restores a room page on the server only, so the room gets it once', async () => {
    seed(true);

    await useDocumentStore
      .getState()
      .restoreVersion('doc-1', { editorData: { root: {} }, historyId: 'h1' });

    expect(documentService.updateDocument).toHaveBeenCalledWith({
      editorData: JSON.stringify({ root: {} }),
      id: 'doc-1',
      restoreFromHistoryId: 'h1',
      saveSource: 'restore',
    });
    expect(editor.setDocument).not.toHaveBeenCalled();
  });

  it('restores a stored page through the editor and saves it', async () => {
    seed(false);
    const performSave = vi
      .spyOn(useDocumentStore.getState(), 'performSave')
      .mockResolvedValue(undefined);

    await useDocumentStore
      .getState()
      .restoreVersion('doc-1', { editorData: { root: {} }, historyId: 'h1' });

    expect(editor.setDocument).toHaveBeenCalledWith('json', JSON.stringify({ root: {} }));
    expect(performSave).toHaveBeenCalledWith('doc-1', undefined, {
      restoreFromHistoryId: 'h1',
      saveSource: 'restore',
    });
  });
});
