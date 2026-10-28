import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { documentService } from '@/services/document';

import { useDocumentStore } from '../../store';

vi.mock('@/services/document', () => ({
  documentService: {
    acquireDocumentLock: vi.fn().mockResolvedValue({ holderId: null, lockedByOther: false }),
    releaseDocumentLock: vi.fn().mockResolvedValue(undefined),
    getDocumentById: vi.fn().mockResolvedValue(null),
    updateDocument: vi.fn().mockResolvedValue({
      historyAppended: false,
      id: 'doc-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  },
}));

vi.mock('@/services/notebook', () => ({
  notebookService: { updateDocument: vi.fn().mockResolvedValue({}) },
}));

/** The tree the editor builds from markdown: fresh node ids, its own markdown export. */
const PARSED_TREE = {
  root: {
    children: [{ children: [{ text: 'Title', type: 'text' }], id: 'n-1', type: 'heading' }],
    type: 'root',
  },
};

/**
 * A Lexical-like editor: `setDocument` swaps the body and fires the update
 * listener synchronously, the way `InternalEditor` reports the load as a change.
 */
const createLoadingEditor = (onLoad: () => void) => {
  let loaded = false;
  return {
    getDocument: vi.fn((type: string) => {
      if (!loaded) return type === 'markdown' ? '' : null;
      return type === 'markdown' ? '# Title\n' : PARSED_TREE;
    }),
    setDocument: vi.fn(() => {
      loaded = true;
      onLoad();
    }),
  };
};

describe('onEditorInit — the loaded body is the clean baseline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(documentService.updateDocument).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not mark a markdown-only page dirty or autosave it just for opening it', async () => {
    const { result } = renderHook(() => useDocumentStore());
    const editor = createLoadingEditor(() => useDocumentStore.getState().handleContentChange());

    act(() => {
      // A page written by an agent or the CLI: markdown, no editorData.
      result.current.initDocumentWithEditor({
        content: '# Title',
        documentId: 'doc-1',
        editor: editor as any,
        editorData: null,
        sourceType: 'page',
      });
      useDocumentStore.setState({ activeDocumentId: 'doc-1', editor: editor as any });
    });

    await act(async () => {
      await result.current.onEditorInit(editor as any, 'doc-1');
    });

    expect(useDocumentStore.getState().documents['doc-1'].isDirty).toBe(false);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(documentService.updateDocument).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().documents['doc-1'].saveStatus).not.toBe('saving');
  });

  it('still saves an edit made after the page loaded', async () => {
    const { result } = renderHook(() => useDocumentStore());
    const editor = createLoadingEditor(() => useDocumentStore.getState().handleContentChange());

    act(() => {
      result.current.initDocumentWithEditor({
        content: '# Title',
        documentId: 'doc-1',
        editor: editor as any,
        editorData: null,
        sourceType: 'page',
      });
      useDocumentStore.setState({ activeDocumentId: 'doc-1', editor: editor as any });
    });

    await act(async () => {
      await result.current.onEditorInit(editor as any, 'doc-1');
    });

    editor.getDocument.mockImplementation((type: string) =>
      type === 'markdown'
        ? '# Title\n\nNew line\n'
        : {
            root: {
              ...PARSED_TREE.root,
              children: [
                ...PARSED_TREE.root.children,
                { children: [{ text: 'New line', type: 'text' }], id: 'n-2', type: 'paragraph' },
              ],
            },
          },
    );

    act(() => {
      useDocumentStore.getState().handleContentChange();
    });

    expect(useDocumentStore.getState().documents['doc-1'].isDirty).toBe(true);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(documentService.updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({ content: '# Title\n\nNew line\n', id: 'doc-1' }),
    );
  });

  it('keeps local edits when a newer remote row carries the same server body', async () => {
    const { result } = renderHook(() => useDocumentStore());
    const editor = createLoadingEditor(() => useDocumentStore.getState().handleContentChange());

    act(() => {
      result.current.initDocumentWithEditor({
        content: '# Title',
        documentId: 'doc-1',
        editor: editor as any,
        editorData: null,
        sourceType: 'page',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      useDocumentStore.setState({ activeDocumentId: 'doc-1', editor: editor as any });
    });

    await act(async () => {
      await result.current.onEditorInit(editor as any, 'doc-1');
    });

    editor.getDocument.mockImplementation((type: string) =>
      type === 'markdown' ? '# Title\n\nLocal edit\n' : { root: { children: [], type: 'root' } },
    );
    act(() => {
      useDocumentStore.getState().handleContentChange();
    });

    // Another session renamed the page: newer row, unchanged markdown-only body.
    let outcome: string | undefined;
    act(() => {
      outcome = useDocumentStore.getState().reconcileRemote('doc-1', {
        content: '# Title',
        editorData: null,
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      } as any);
    });

    expect(outcome).toBe('rebased');
    const doc = useDocumentStore.getState().documents['doc-1'];
    expect(doc.isDirty).toBe(true);
    expect(doc.content).toBe('# Title\n\nLocal edit\n');
  });
});
