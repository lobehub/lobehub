import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SwrModule from '@/libs/swr';
import { useClientDataSWRWithSync } from '@/libs/swr';
import { documentService } from '@/services/document';
import { usePageStore } from '@/store/page';

import { useDocumentStore } from '../../store';

vi.mock('@/services/document', () => ({
  documentService: {
    getDocumentById: vi.fn(),
    updateDocument: vi.fn().mockResolvedValue({
      historyAppended: false,
      id: 'doc-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  },
}));

vi.mock('@/libs/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof SwrModule>();
  return {
    ...actual,
    mutate: vi.fn().mockResolvedValue(undefined),
    useClientDataSWRWithSync: vi.fn(() => ({ data: undefined, isValidating: false })),
  };
});

vi.mock('@/store/page', () => ({
  usePageStore: { getState: vi.fn(() => ({ upsertDocument: vi.fn() })) },
}));

const createEditor = () => ({
  getDocument: vi.fn((type: string) => {
    if (type === 'markdown') return '# Draft';
    if (type === 'json') {
      return { root: { children: [{ children: [], type: 'paragraph' }], type: 'root' } };
    }
    return null;
  }),
  getLexicalEditor: vi.fn(),
  setDocument: vi.fn(),
});

const baseEditorData = {
  root: { children: [{ children: [], type: 'paragraph' }], type: 'root' },
};

const captureOnData = (
  documentId: string,
  editor: any,
  options: { sourceType?: 'notebook' | 'page'; topicId?: string } = {},
) => {
  renderHook(() =>
    useDocumentStore.getState().useFetchDocument(documentId, { editor, ...options }),
  );
  const swrCall = vi.mocked(useClientDataSWRWithSync).mock.calls.at(-1);
  return swrCall?.[2]?.onData as (data: unknown) => void;
};

describe('useFetchDocument onData', () => {
  beforeEach(() => {
    vi.mocked(useClientDataSWRWithSync).mockClear();
    const state = useDocumentStore.getState();
    Object.keys(state.documents).forEach((id) => state.closeDocument(id));
    useDocumentStore.setState({
      activeDocumentId: undefined,
      editor: undefined,
      lastActiveTopicDocumentIdByTopicId: {},
    });
  });

  it('initializes a document the store has not loaded yet', () => {
    const editor = createEditor();
    const onData = captureOnData('doc-1', editor, { sourceType: 'notebook', topicId: 'topic-1' });

    act(() => {
      onData({
        content: '# Server',
        editorData: baseEditorData,
        id: 'doc-1',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
    });

    expect(useDocumentStore.getState().documents['doc-1']).toMatchObject({
      content: '# Server',
      isDirty: false,
      lastUpdatedTime: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(useDocumentStore.getState().lastActiveTopicDocumentIdByTopicId).toEqual({
      'topic-1': 'doc-1',
    });
  });

  it('adopts a newer server body over a dirty draft', () => {
    const editor = createEditor();
    const onData = captureOnData('doc-1', editor, { sourceType: 'notebook', topicId: 'topic-1' });

    act(() => {
      useDocumentStore.getState().initDocumentWithEditor({
        content: '# Old',
        documentId: 'doc-1',
        editor: editor as any,
        editorData: baseEditorData,
        sourceType: 'notebook',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      useDocumentStore.getState().handleContentChange();
    });
    expect(useDocumentStore.getState().documents['doc-1'].isDirty).toBe(true);
    useDocumentStore.setState({ lastActiveTopicDocumentIdByTopicId: {} });

    act(() => {
      onData({
        content: '# Agent write',
        editorData: baseEditorData,
        id: 'doc-1',
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      });
    });

    expect(useDocumentStore.getState().documents['doc-1']).toMatchObject({
      content: '# Agent write',
      isDirty: false,
      lastSavedContent: '# Agent write',
      lastUpdatedTime: new Date('2026-01-02T00:00:00.000Z'),
      saveStatus: 'saved',
    });
    expect(useDocumentStore.getState().lastActiveTopicDocumentIdByTopicId).toEqual({
      'topic-1': 'doc-1',
    });
  });

  it('keeps the dirty draft when only the server version moved', () => {
    const editor = createEditor();
    const onData = captureOnData('doc-1', editor, { sourceType: 'notebook' });

    act(() => {
      useDocumentStore.getState().initDocumentWithEditor({
        content: '# Old',
        documentId: 'doc-1',
        editor: editor as any,
        editorData: baseEditorData,
        sourceType: 'notebook',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      useDocumentStore.getState().handleContentChange();
    });

    act(() => {
      onData({
        content: '# Old',
        editorData: structuredClone(baseEditorData),
        id: 'doc-1',
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      });
    });

    expect(useDocumentStore.getState().documents['doc-1']).toMatchObject({
      content: '# Draft',
      isDirty: true,
      lastSavedContent: '# Old',
      lastUpdatedTime: new Date('2026-01-02T00:00:00.000Z'),
    });
  });

  it('ignores a replayed cached row that is older than the version saved since', async () => {
    const editor = createEditor();
    const onData = captureOnData('doc-1', editor, { sourceType: 'notebook' });
    vi.mocked(documentService.updateDocument).mockResolvedValueOnce({
      historyAppended: false,
      id: 'doc-1',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    act(() => {
      useDocumentStore.getState().initDocumentWithEditor({
        content: '# Old',
        documentId: 'doc-1',
        editor: editor as any,
        editorData: baseEditorData,
        sourceType: 'notebook',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      useDocumentStore.getState().handleContentChange();
    });
    await act(async () => {
      await useDocumentStore.getState().performSave('doc-1');
    });
    expect(useDocumentStore.getState().documents['doc-1']).toMatchObject({
      content: '# Draft',
      isDirty: false,
      lastUpdatedTime: new Date('2026-01-02T00:00:00.000Z'),
    });

    act(() => {
      onData({
        content: '# Old',
        editorData: baseEditorData,
        id: 'doc-1',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
    });

    expect(useDocumentStore.getState().documents['doc-1']).toMatchObject({
      content: '# Draft',
      isDirty: false,
      lastSavedContent: '# Draft',
      lastUpdatedTime: new Date('2026-01-02T00:00:00.000Z'),
    });
  });

  it('mirrors page metadata into the page store on the reconcile path', () => {
    const upsertDocument = vi.fn();
    vi.mocked(usePageStore.getState).mockReturnValue({ upsertDocument } as any);
    const editor = createEditor();
    const onData = captureOnData('doc-1', editor, { sourceType: 'page' });
    const row = {
      content: '# Old',
      id: 'doc-1',
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };

    act(() => {
      useDocumentStore.getState().initDocumentWithEditor({
        content: '# Old',
        documentId: 'doc-1',
        editor: editor as any,
        sourceType: 'page',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
    });
    act(() => {
      onData(row);
    });

    expect(upsertDocument).toHaveBeenCalledWith(row);
    expect(documentService.getDocumentById).not.toHaveBeenCalled();
  });
});
