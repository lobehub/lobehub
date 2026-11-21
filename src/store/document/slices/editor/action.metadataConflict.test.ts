import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { documentService } from '@/services/document';

import { useDocumentStore } from '../../store';

vi.mock('@/services/document', () => ({
  documentService: {
    acquireDocumentLock: vi.fn().mockResolvedValue({ holderId: null, lockedByOther: false }),
    getDocumentById: vi.fn(),
    releaseDocumentLock: vi.fn().mockResolvedValue(undefined),
    updateDocument: vi.fn(),
  },
}));

const loadedAt = new Date('2026-01-01T00:00:00.000Z');
// The room projected body edits since the page loaded: the row moved on while
// the editor still holds the load-time version.
const projectedAt = new Date('2026-01-01T00:05:00.000Z');

const versionConflict = () =>
  Object.assign(new Error('Document has been updated by another session'), {
    data: { code: 'CONFLICT' },
  });

const editor = { getDocument: vi.fn(() => null), setDocument: vi.fn() };

const seedRoomPage = () => {
  act(() => {
    useDocumentStore.getState().initDocumentWithEditor({
      content: '# Body',
      documentId: 'doc-1',
      editor: editor as any,
      sourceType: 'page',
      updatedAt: loadedAt,
    });
    useDocumentStore.getState().internal_dispatchDocument({
      id: 'doc-1',
      type: 'updateDocument',
      // A workspace room page holding its own edit lease.
      value: { collab: true as any, lockOwnerId: 'owner-1' },
    });
    useDocumentStore.setState({
      documentDetailMap: {
        'doc-1': {
          document: {
            content: '# Body',
            id: 'doc-1',
            metadata: { emoji: '⭐' },
            title: 'M11W1 本周事项',
            updatedAt: loadedAt,
          },
        } as any,
      },
    });
  });
};

const saveTitle = (title: string) =>
  useDocumentStore
    .getState()
    .performSave('doc-1', { emoji: '⭐', title }, { metadataOnly: true, saveSource: 'autosave' });

describe('DocumentStore - title / emoji save after the version moved (T-14156)', () => {
  beforeEach(() => {
    vi.mocked(documentService.updateDocument).mockReset();
    vi.mocked(documentService.getDocumentById).mockReset();
    vi.mocked(documentService.acquireDocumentLock).mockClear();
    act(() => {
      Object.keys(useDocumentStore.getState().documents).forEach((id) =>
        useDocumentStore.getState().closeDocument(id),
      );
      useDocumentStore.setState({ documentDetailMap: {}, editor: undefined });
    });
  });

  it('replays a rename against the latest version when only the body moved', async () => {
    seedRoomPage();
    vi.mocked(documentService.getDocumentById).mockResolvedValue({
      content: '# Body edited in the room',
      id: 'doc-1',
      metadata: { emoji: '⭐' },
      title: 'M11W1 本周事项',
      updatedAt: projectedAt,
    } as any);
    vi.mocked(documentService.updateDocument)
      .mockRejectedValueOnce(versionConflict())
      .mockResolvedValueOnce({
        historyAppended: false,
        id: 'doc-1',
        updatedAt: '2026-01-01T00:05:01.000Z',
      } as any);

    await act(async () => {
      await saveTitle('待办事项');
    });

    expect(documentService.updateDocument).toHaveBeenCalledTimes(2);
    expect(documentService.updateDocument).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ expectedUpdatedAt: projectedAt, title: '待办事项' }),
    );
    // A title never needs the body lease, so the replay must not reclaim it.
    expect(documentService.acquireDocumentLock).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().documents['doc-1'].saveStatus).toBe('saved');
    expect(useDocumentStore.getState().documentDetailMap['doc-1']?.document?.title).toBe(
      '待办事项',
    );
  });

  it('does not overwrite a title a collaborator changed meanwhile, and reports the failure', async () => {
    seedRoomPage();
    vi.mocked(documentService.getDocumentById).mockResolvedValue({
      content: '# Body',
      id: 'doc-1',
      metadata: { emoji: '⭐' },
      title: 'Renamed by a teammate',
      updatedAt: projectedAt,
    } as any);
    const conflict = versionConflict();
    vi.mocked(documentService.updateDocument).mockRejectedValueOnce(conflict);

    await act(async () => {
      await expect(saveTitle('待办事项')).rejects.toBe(conflict);
    });

    expect(documentService.updateDocument).toHaveBeenCalledTimes(1);
    // Not "Latest version loaded": the rename never reached the server.
    expect(useDocumentStore.getState().documents['doc-1'].saveStatus).toBe('failed');
    expect(useDocumentStore.getState().documents['doc-1'].saveBlockedByLock).toBeFalsy();
  });

  it('does not overwrite an emoji a collaborator changed meanwhile', async () => {
    seedRoomPage();
    vi.mocked(documentService.getDocumentById).mockResolvedValue({
      content: '# Body',
      id: 'doc-1',
      metadata: { emoji: '🔥' },
      title: 'M11W1 本周事项',
      updatedAt: projectedAt,
    } as any);
    const conflict = versionConflict();
    vi.mocked(documentService.updateDocument).mockRejectedValueOnce(conflict);

    await act(async () => {
      await expect(saveTitle('待办事项')).rejects.toBe(conflict);
    });

    expect(documentService.updateDocument).toHaveBeenCalledTimes(1);
  });

  it('keeps the conflict when no cached row can vouch for the meta', async () => {
    seedRoomPage();
    act(() => {
      useDocumentStore.setState({ documentDetailMap: {} });
    });
    vi.mocked(documentService.getDocumentById).mockResolvedValue({
      content: '# Body',
      id: 'doc-1',
      metadata: { emoji: '⭐' },
      title: 'M11W1 本周事项',
      updatedAt: projectedAt,
    } as any);
    const conflict = versionConflict();
    vi.mocked(documentService.updateDocument).mockRejectedValueOnce(conflict);

    await act(async () => {
      await expect(saveTitle('待办事项')).rejects.toBe(conflict);
    });

    expect(documentService.updateDocument).toHaveBeenCalledTimes(1);
    expect(useDocumentStore.getState().documents['doc-1'].saveStatus).toBe('failed');
  });
});
