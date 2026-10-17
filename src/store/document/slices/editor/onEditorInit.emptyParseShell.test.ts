import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

const createMockEditor = () => ({
  getDocument: vi.fn((type: string) => (type === 'markdown' ? '' : null)),
  setDocument: vi.fn(),
});

describe('onEditorInit empty-parse shell tolerance (Lexical error #38)', () => {
  it('treats a childless-root Lexical shell as no editor data and routes to the markdown fallback', () => {
    const { result } = renderHook(() => useDocumentStore());
    const mockEditor = createMockEditor() as any;

    act(() => {
      result.current.initDocumentWithEditor({
        content: '# Body',
        documentId: 'doc-1',
        editor: mockEditor,
        editorData: { root: { children: [], type: 'root' } },
        sourceType: 'page',
      });
    });

    act(() => {
      result.current.onEditorInit(mockEditor);
    });

    // The empty-parse shell must not reach setDocument('json') — it would
    // throw Lexical error #38 on hydration — so the markdown fallback runs.
    expect(mockEditor.setDocument).not.toHaveBeenCalledWith(
      'json',
      JSON.stringify({ root: { children: [], type: 'root' } }),
      { keepId: true },
    );
    expect(mockEditor.setDocument).toHaveBeenCalledWith('markdown', '# Body');
  });

  it('preserves the legacy non-Lexical payload contract ({ type: doc, content })', () => {
    const { result } = renderHook(() => useDocumentStore());
    const mockEditor = createMockEditor() as any;
    const legacy = { type: 'doc', content: [] };

    act(() => {
      result.current.initDocumentWithEditor({
        content: '',
        documentId: 'doc-legacy',
        editor: mockEditor,
        editorData: legacy,
        sourceType: 'page',
      });
    });

    act(() => {
      result.current.onEditorInit(mockEditor);
    });

    expect(mockEditor.setDocument).toHaveBeenCalledWith('json', JSON.stringify(legacy), {
      keepId: true,
    });
  });
});
