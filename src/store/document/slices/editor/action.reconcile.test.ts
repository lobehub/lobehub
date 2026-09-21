import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { documentService } from '@/services/document';

import { useDocumentStore } from '../../store';

// Mock services
vi.mock('@/services/document', () => ({
  documentService: {
    acquireDocumentLock: vi.fn().mockResolvedValue({ holderId: null, lockedByOther: false }),
    releaseDocumentLock: vi.fn().mockResolvedValue(undefined),
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

describe('DocumentStore - Editor Actions (reconcile)', () => {
  beforeEach(() => {
    vi.mocked(documentService.updateDocument).mockReset().mockResolvedValue({
      historyAppended: false,
      id: 'doc-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(documentService.acquireDocumentLock)
      .mockReset()
      .mockResolvedValue({ holderId: null, lockedByOther: false } as any);
    vi.mocked(documentService.getDocumentById)
      .mockReset()
      .mockResolvedValue({
        content: '# Test',
        id: 'doc-1',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      } as any);
    vi.mocked(documentService.releaseDocumentLock)
      .mockReset()
      .mockResolvedValue(undefined as any);

    // Reset store state before each test
    const { result } = renderHook(() => useDocumentStore());
    act(() => {
      // Clear all documents and reset editor
      const state = result.current;
      Object.keys(state.documents).forEach((id) => {
        state.closeDocument(id);
      });
      state.setEditorState(undefined);
    });
    // Reset editor separately (store internal state)
    useDocumentStore.setState({ editor: undefined });
  });

  describe('reconcileRemote', () => {
    const baseEditorData = {
      root: { children: [{ children: [], type: 'paragraph' }], type: 'root' },
    };
    const initDirtyDoc = (result: { current: ReturnType<typeof useDocumentStore.getState> }) => {
      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Old',
          documentId: 'doc-1',
          editor: createValidMockEditor() as any,
          editorData: baseEditorData,
          sourceType: 'page',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        });
        result.current.markDirty('doc-1');
        result.current.triggerDebouncedSave('doc-1');
      });
      vi.mocked(documentService.updateDocument).mockClear();
    };

    it('is a no-op when the row version matches the known version', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useDocumentStore());
      initDirtyDoc(result);

      let outcome: string | undefined;
      act(() => {
        outcome = result.current.reconcileRemote('doc-1', {
          content: '# Something else',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        });
      });

      expect(outcome).toBe('unchanged');
      expect(result.current.documents['doc-1']).toMatchObject({ content: '# Old', isDirty: true });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(documentService.updateDocument).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('rebases the version and keeps the draft + pending autosave when only metadata moved', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useDocumentStore());
      initDirtyDoc(result);

      let outcome: string | undefined;
      act(() => {
        outcome = result.current.reconcileRemote('doc-1', {
          content: '# Old',
          editorData: structuredClone(baseEditorData),
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        });
      });

      expect(outcome).toBe('rebased');
      expect(result.current.documents['doc-1']).toMatchObject({
        content: '# Old',
        isDirty: true,
        lastUpdatedTime: new Date('2026-01-02T00:00:00.000Z'),
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(documentService.updateDocument).toHaveBeenCalledTimes(1);
      expect(documentService.updateDocument).toHaveBeenCalledWith(
        expect.objectContaining({ expectedUpdatedAt: new Date('2026-01-02T00:00:00.000Z') }),
      );
      vi.useRealTimers();
    });

    it('drops malformed remote editorData instead of adopting it', () => {
      const { result } = renderHook(() => useDocumentStore());
      initDirtyDoc(result);

      act(() => {
        result.current.reconcileRemote('doc-1', {
          content: '# Agent write',
          editorData: { root: { children: [], type: 'root' } },
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        });
      });

      expect(result.current.documents['doc-1']).toMatchObject({
        content: '# Agent write',
        editorData: null,
        lastSavedEditorData: null,
      });
    });

    it('treats null and undefined editorData as the same body', () => {
      const { result } = renderHook(() => useDocumentStore());
      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Old',
          documentId: 'doc-1',
          editor: createValidMockEditor() as any,
          sourceType: 'page',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        });
      });

      let outcome: string | undefined;
      act(() => {
        outcome = result.current.reconcileRemote('doc-1', {
          content: '# Old',
          editorData: null,
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        });
      });

      expect(outcome).toBe('rebased');
    });

    it('adopts the remote body, clears dirty and cancels the pending autosave', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useDocumentStore());
      initDirtyDoc(result);
      const remoteEditorData = {
        root: { children: [{ children: [{ text: 'Agent' }], type: 'paragraph' }], type: 'root' },
      };

      let outcome: string | undefined;
      act(() => {
        outcome = result.current.reconcileRemote('doc-1', {
          content: '# Agent write',
          editorData: remoteEditorData,
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(outcome).toBe('adopted');
      expect(documentService.updateDocument).not.toHaveBeenCalled();
      expect(result.current.documents['doc-1']).toMatchObject({
        content: '# Agent write',
        editorData: remoteEditorData,
        isDirty: false,
        lastSavedContent: '# Agent write',
        lastSavedEditorData: remoteEditorData,
        lastUpdatedTime: new Date('2026-01-02T00:00:00.000Z'),
        saveBlockedByLock: false,
        saveStatus: 'saved',
      });
      vi.useRealTimers();
    });
  });

  describe('performSave versioning', () => {
    it('sends the last known updatedAt as expectedUpdatedAt', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const updatedAt = new Date('2026-01-01T00:00:00.000Z');

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: createValidMockEditor() as any,
          sourceType: 'page',
          updatedAt,
        });
        result.current.markDirty('doc-1');
      });

      await act(async () => {
        await result.current.performSave('doc-1');
      });

      expect(documentService.updateDocument).toHaveBeenCalledWith(
        expect.objectContaining({ expectedUpdatedAt: updatedAt, id: 'doc-1' }),
      );
    });

    it('omits expectedUpdatedAt when no version is known and adopts the server version', async () => {
      const { result } = renderHook(() => useDocumentStore());
      vi.mocked(documentService.updateDocument).mockResolvedValueOnce({
        historyAppended: false,
        id: 'doc-1',
        updatedAt: '2026-03-03T00:00:00.000Z',
      });

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: createValidMockEditor() as any,
          sourceType: 'page',
        });
        result.current.markDirty('doc-1');
      });
      expect(result.current.documents['doc-1'].lastUpdatedTime).toBeNull();

      await act(async () => {
        await result.current.performSave('doc-1');
      });

      const params = vi.mocked(documentService.updateDocument).mock.calls[0][0];
      expect('expectedUpdatedAt' in params).toBe(false);
      expect(result.current.documents['doc-1'].lastUpdatedTime).toEqual(
        new Date('2026-03-03T00:00:00.000Z'),
      );
    });

    it('does not roll the store back when the save result is older than the current version', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const remoteEditorData = {
        root: { children: [{ children: [{ text: 'Agent' }], type: 'paragraph' }], type: 'root' },
      };

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: createValidMockEditor() as any,
          sourceType: 'page',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        });
        result.current.markDirty('doc-1');
      });

      vi.mocked(documentService.updateDocument).mockImplementationOnce(async () => {
        useDocumentStore.getState().reconcileRemote('doc-1', {
          content: '# Agent write',
          editorData: remoteEditorData,
          updatedAt: new Date('2026-01-03T00:00:00.000Z'),
        });
        return { historyAppended: false, id: 'doc-1', updatedAt: '2026-01-02T00:00:00.000Z' };
      });

      await act(async () => {
        await result.current.performSave('doc-1');
      });

      expect(result.current.documents['doc-1']).toMatchObject({
        content: '# Agent write',
        isDirty: false,
        lastSavedContent: '# Agent write',
        lastUpdatedTime: new Date('2026-01-03T00:00:00.000Z'),
        saveStatus: 'saved',
      });
    });
  });
  describe('reconcileRemote ordering', () => {
    it('ignores a row older than the version the store already holds', () => {
      const { result } = renderHook(() => useDocumentStore());
      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Saved',
          documentId: 'doc-1',
          editor: createValidMockEditor() as any,
          sourceType: 'page',
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        });
      });

      let outcome: string | undefined;
      act(() => {
        outcome = result.current.reconcileRemote('doc-1', {
          content: '# Stale cache',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        });
      });

      expect(outcome).toBe('unchanged');
      expect(result.current.documents['doc-1']).toMatchObject({
        content: '# Saved',
        lastUpdatedTime: new Date('2026-01-02T00:00:00.000Z'),
      });
    });
  });

  describe('performSave overlap', () => {
    const createMovingEditor = () => {
      const state = { markdown: '# First' };
      const editor = {
        getDocument: vi.fn((type: string) => {
          if (type === 'markdown') return state.markdown;
          if (type === 'json') {
            return { root: { children: [{ children: [], type: 'paragraph' }], type: 'root' } };
          }
          return null;
        }),
        setDocument: vi.fn(),
      } as any;
      return { editor, state };
    };

    const hangFirstSave = () => {
      type SaveResult = Awaited<ReturnType<typeof documentService.updateDocument>>;
      let resolveFirst!: (value: SaveResult) => void;
      const firstResult = new Promise<SaveResult>((resolve) => {
        resolveFirst = resolve;
      });
      vi.mocked(documentService.updateDocument)
        .mockImplementationOnce(() => firstResult)
        .mockResolvedValueOnce({
          historyAppended: false,
          id: 'doc-1',
          updatedAt: '2026-01-01T00:00:02.000Z',
        });
      return () =>
        resolveFirst({
          historyAppended: false,
          id: 'doc-1',
          updatedAt: '2026-01-01T00:00:01.000Z',
        });
    };

    it('waits for the in-flight save, then sends the later request with its own metadata and the committed version', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useDocumentStore());
      const { editor, state } = createMovingEditor();
      const resolveFirst = hangFirstSave();

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Base',
          documentId: 'doc-1',
          editor,
          sourceType: 'page',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        });
        result.current.markDirty('doc-1');
      });

      let first!: Promise<void>;
      let second!: Promise<void>;
      act(() => {
        first = result.current.performSave('doc-1', undefined, { saveSource: 'autosave' });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      state.markdown = '# Second';
      act(() => {
        result.current.handleContentChange();
        second = result.current.performSave(
          'doc-1',
          { title: 'Renamed' },
          { saveSource: 'manual' },
        );
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(documentService.updateDocument).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveFirst();
        await Promise.all([first, second]);
      });

      expect(documentService.updateDocument).toHaveBeenCalledTimes(2);
      expect(documentService.updateDocument).toHaveBeenLastCalledWith(
        expect.objectContaining({
          content: '# Second',
          expectedUpdatedAt: new Date('2026-01-01T00:00:01.000Z'),
          saveSource: 'manual',
          title: 'Renamed',
        }),
      );
      expect(result.current.documents['doc-1']).toMatchObject({
        isDirty: false,
        lastSavedContent: '# Second',
        lastUpdatedTime: new Date('2026-01-01T00:00:02.000Z'),
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(documentService.updateDocument).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('closeDocument flushes the pending autosave after the in-flight save and keeps the newer content', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useDocumentStore());
      const { editor, state } = createMovingEditor();
      const resolveFirst = hangFirstSave();

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Base',
          documentId: 'doc-1',
          editor,
          sourceType: 'page',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        });
        result.current.markDirty('doc-1');
      });

      let first!: Promise<void>;
      act(() => {
        first = result.current.performSave('doc-1', undefined, { saveSource: 'autosave' });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      state.markdown = '# Second';
      act(() => {
        result.current.handleContentChange();
        result.current.closeDocument('doc-1');
      });
      expect(result.current.activeDocumentId).toBeUndefined();
      expect(result.current.documents['doc-1']).toBeDefined();

      await act(async () => {
        resolveFirst();
        await first;
        await result.current.getPendingSave('doc-1');
        await Promise.resolve();
      });

      expect(documentService.updateDocument).toHaveBeenCalledTimes(2);
      expect(documentService.updateDocument).toHaveBeenLastCalledWith(
        expect.objectContaining({
          content: '# Second',
          expectedUpdatedAt: new Date('2026-01-01T00:00:01.000Z'),
        }),
      );
      expect(result.current.documents['doc-1']).toBeUndefined();
      vi.useRealTimers();
    });

    it('does not replay an autosave for a document with autoSave disabled', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useDocumentStore());
      const { editor, state } = createMovingEditor();
      const resolveFirst = hangFirstSave();

      act(() => {
        result.current.initDocumentWithEditor({
          autoSave: false,
          content: '# Base',
          documentId: 'doc-1',
          editor,
          sourceType: 'page',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        });
        result.current.markDirty('doc-1');
      });

      let first!: Promise<void>;
      act(() => {
        first = result.current.performSave('doc-1', undefined, { saveSource: 'manual' });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      state.markdown = '# Second';
      await act(async () => {
        resolveFirst();
        await first;
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(documentService.updateDocument).toHaveBeenCalledTimes(1);
      expect(result.current.documents['doc-1']).toMatchObject({
        isDirty: true,
        lastSavedContent: '# First',
      });
      vi.useRealTimers();
    });

    it('re-arms the autosave when a CONFLICT leaves the draft unsaved on a personal doc', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useDocumentStore());
      const conflict = Object.assign(new Error('conflict'), { data: { code: 'CONFLICT' } });
      vi.mocked(documentService.updateDocument)
        .mockRejectedValueOnce(conflict)
        .mockRejectedValueOnce(conflict)
        .mockResolvedValueOnce({
          historyAppended: false,
          id: 'doc-1',
          updatedAt: '2026-01-03T00:00:00.000Z',
        });

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: createValidMockEditor() as any,
          sourceType: 'page',
          updatedAt: new Date('2025-12-31T00:00:00.000Z'),
        });
        result.current.markDirty('doc-1');
      });

      await act(async () => {
        await result.current.performSave('doc-1', undefined, { saveSource: 'manual' });
      });
      expect(documentService.updateDocument).toHaveBeenCalledTimes(2);
      expect(result.current.documents['doc-1']).toMatchObject({
        isDirty: true,
        saveStatus: 'idle',
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(documentService.updateDocument).toHaveBeenCalledTimes(3);
      expect(result.current.documents['doc-1']).toMatchObject({
        isDirty: false,
        saveStatus: 'saved',
      });
      vi.useRealTimers();
    });
  });
});
