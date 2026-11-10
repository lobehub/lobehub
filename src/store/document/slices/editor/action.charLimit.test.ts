import { toast } from '@lobehub/ui';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { documentService } from '@/services/document';

import { useDocumentStore } from '../../store';

// Mock services
vi.mock('@/services/document', () => ({
  documentService: {
    acquireDocumentLock: vi.fn().mockResolvedValue({ holderId: null, lockedByOther: false }),
    releaseDocumentLock: vi.fn().mockResolvedValue(undefined),
    snapshotPageVersion: vi.fn().mockResolvedValue(true),
    getDocumentById: vi.fn().mockResolvedValue({
      content: '# Test',
      id: 'doc-1',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }),
    updateDocument: vi.fn().mockResolvedValue({
      historyAppended: false,
      id: 'doc-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  },
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/services/notebook', () => ({
  notebookService: {
    updateDocument: vi.fn().mockResolvedValue({}),
  },
}));

// Create mock editor
const createValidMockEditor = () => ({
  getDocument: vi.fn((type: string) => {
    if (type === 'markdown') return '# Test';
    if (type === 'json') {
      return { root: { children: [{ children: [], type: 'paragraph' }], type: 'root' } };
    }
    return null;
  }),
  setDocument: vi.fn(),
});

describe('DocumentStore - Editor Actions (plan character limit)', () => {
  const limitError = () =>
    Object.assign(new Error('Over the limit'), {
      data: {
        code: 'BAD_REQUEST',
        errorData: { actual: 120, code: 'DocumentCharLimitExceeded', limit: 100, plan: 'free' },
      },
    });

  const initDirtyDoc = (result: { current: ReturnType<typeof useDocumentStore.getState> }) => {
    act(() => {
      result.current.initDocumentWithEditor({
        content: '# Test',
        documentId: 'doc-1',
        editor: createValidMockEditor() as any,
        sourceType: 'page',
      });
      result.current.markDirty('doc-1');
    });
  };

  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.mocked(documentService.updateDocument).mockReset().mockResolvedValue({
      historyAppended: false,
      id: 'doc-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const { result } = renderHook(() => useDocumentStore());
    act(() => {
      Object.keys(result.current.documents).forEach((id) => result.current.closeDocument(id));
    });
  });

  it('fails the save, keeps the page dirty, stores the refusal and does not retry', async () => {
    const { result } = renderHook(() => useDocumentStore());
    initDirtyDoc(result);
    const debounced = vi.fn();
    useDocumentStore.setState({ triggerDebouncedSave: debounced });
    vi.mocked(documentService.updateDocument).mockRejectedValueOnce(limitError());

    await act(async () => {
      await result.current.performSave('doc-1');
    });

    const doc = result.current.documents['doc-1'];
    expect(documentService.updateDocument).toHaveBeenCalledTimes(1);
    expect(debounced).not.toHaveBeenCalled();
    expect(doc.saveStatus).toBe('failed');
    expect(doc.isDirty).toBe(true);
    expect(doc.charLimitError).toEqual({ actual: 120, limit: 100, plan: 'free' });
  });

  it('clears the refusal once a later save succeeds', async () => {
    const { result } = renderHook(() => useDocumentStore());
    initDirtyDoc(result);
    vi.mocked(documentService.updateDocument).mockRejectedValueOnce(limitError());
    await act(async () => {
      await result.current.performSave('doc-1');
    });
    expect(result.current.documents['doc-1'].charLimitError).toBeDefined();

    vi.mocked(documentService.updateDocument).mockResolvedValueOnce({
      id: 'doc-1',
      updatedAt: '2030-01-01T00:00:00.000Z',
    } as any);
    await act(async () => {
      await result.current.performSave('doc-1');
    });

    const doc = result.current.documents['doc-1'];
    expect(doc.saveStatus).toBe('saved');
    expect(doc.charLimitError).toBeUndefined();
    expect(doc.isDirty).toBe(false);
  });

  it('keeps the refusal when only the title is saved', async () => {
    const { result } = renderHook(() => useDocumentStore());
    initDirtyDoc(result);
    vi.mocked(documentService.updateDocument).mockRejectedValueOnce(limitError());
    await act(async () => {
      await result.current.performSave('doc-1');
    });

    vi.mocked(documentService.updateDocument).mockResolvedValueOnce({
      id: 'doc-1',
      updatedAt: '2030-01-01T00:00:00.000Z',
    } as any);
    await act(async () => {
      await result.current.performSave('doc-1', { title: 'Renamed' }, { metadataOnly: true });
    });

    const doc = result.current.documents['doc-1'];
    expect(doc.saveStatus).toBe('failed');
    expect(doc.charLimitError).toEqual({ actual: 120, limit: 100, plan: 'free' });
  });

  it('stays quiet on a refused autosave', async () => {
    const { result } = renderHook(() => useDocumentStore());
    initDirtyDoc(result);
    vi.mocked(documentService.updateDocument).mockRejectedValueOnce(limitError());

    await act(async () => {
      await result.current.performSave('doc-1', undefined, { saveSource: 'autosave' });
    });

    expect(toast.error).not.toHaveBeenCalled();
  });

  it('tells the user why a manual save did nothing', async () => {
    const { result } = renderHook(() => useDocumentStore());
    initDirtyDoc(result);
    vi.mocked(documentService.updateDocument).mockRejectedValueOnce(limitError());

    await act(async () => {
      await result.current.saveVersion('doc-1');
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(result.current.documents['doc-1'].charLimitError).toEqual({
      actual: 120,
      limit: 100,
      plan: 'free',
    });
  });

  // A room page's body never goes through performSave, so the room relays the
  // server's refusal and the page shows it the same way.
  describe('room pages', () => {
    const roomRefusal = { actual: 501_502, limit: 500_000, plan: 'plus' };

    const initRoomDoc = (result: { current: ReturnType<typeof useDocumentStore.getState> }) => {
      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: createValidMockEditor() as any,
          sourceType: 'page',
        });
        result.current.setDocumentCollab('doc-1', true);
      });
    };

    it('fails the save status and stores the refusal the room relayed', () => {
      const { result } = renderHook(() => useDocumentStore());
      initRoomDoc(result);

      act(() => result.current.setCharLimitRefusal('doc-1', roomRefusal));

      const doc = result.current.documents['doc-1'];
      expect(doc.saveStatus).toBe('failed');
      expect(doc.charLimitError).toEqual(roomRefusal);
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('clears the refusal once the page is back within the limit', () => {
      const { result } = renderHook(() => useDocumentStore());
      initRoomDoc(result);
      act(() => result.current.setCharLimitRefusal('doc-1', roomRefusal));

      act(() => result.current.handleContentChange());

      const doc = result.current.documents['doc-1'];
      expect(doc.charLimitError).toBeUndefined();
      expect(doc.saveStatus).toBe('idle');
    });

    it('keeps the refusal while the page is still over the limit', () => {
      const { result } = renderHook(() => useDocumentStore());
      initRoomDoc(result);
      act(() => result.current.setCharLimitRefusal('doc-1', { actual: 6, limit: 3 }));

      act(() => result.current.handleContentChange());

      expect(result.current.documents['doc-1'].saveStatus).toBe('failed');
    });

    // A page already over the limit is stored once it stops growing, while it
    // is still longer than the limit.
    it('clears the refusal when the server stores the still over-limit page', () => {
      const { result } = renderHook(() => useDocumentStore());
      initRoomDoc(result);
      act(() => result.current.setCharLimitRefusal('doc-1', { actual: 6, limit: 3 }));
      act(() => result.current.handleContentChange());

      act(() => result.current.clearCharLimitRefusal('doc-1'));

      const doc = result.current.documents['doc-1'];
      expect(doc.charLimitError).toBeUndefined();
      expect(doc.saveStatus).toBe('saved');
    });

    it('clears the refusal when a manual version of the over-limit page is stored', async () => {
      const { result } = renderHook(() => useDocumentStore());
      initRoomDoc(result);
      act(() => result.current.setCharLimitRefusal('doc-1', { actual: 6, limit: 3 }));
      vi.mocked(documentService.snapshotPageVersion).mockResolvedValueOnce(undefined as any);

      await act(async () => {
        await result.current.saveVersion('doc-1');
      });

      const doc = result.current.documents['doc-1'];
      expect(doc.charLimitError).toBeUndefined();
      expect(doc.saveStatus).toBe('saved');
    });

    it('tells the user why a manual save of the room did nothing', async () => {
      const { result } = renderHook(() => useDocumentStore());
      initRoomDoc(result);
      vi.mocked(documentService.snapshotPageVersion).mockRejectedValueOnce(limitError());

      await act(async () => {
        await result.current.saveVersion('doc-1');
      });

      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(result.current.documents['doc-1'].charLimitError).toEqual({
        actual: 120,
        limit: 100,
        plan: 'free',
      });
    });
  });
});
