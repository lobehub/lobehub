import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
