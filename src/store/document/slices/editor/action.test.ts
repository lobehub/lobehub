import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDocumentStore } from '../../store';

// Mock services
vi.mock('@/services/document', () => ({
  documentService: {
    updateDocument: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@/services/notebook', () => ({
  notebookService: {
    updateDocument: vi.fn().mockResolvedValue({}),
  },
}));

// Create mock editor
const createMockEditor = () => ({
  getDocument: vi.fn((type: string) => {
    if (type === 'markdown') return '# Test';
    if (type === 'json') return { type: 'doc' };
    return null;
  }),
  setDocument: vi.fn(),
});

describe('DocumentStore - Editor Actions', () => {
  beforeEach(() => {
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

  describe('initDocumentWithEditor', () => {
    it('should store document state without loading into editor', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Hello World',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'notebook',
          topicId: 'topic-1',
        });
      });

      // Should store state
      expect(result.current.activeDocumentId).toBe('doc-1');
      expect(result.current.documents['doc-1']).toMatchObject({
        content: '# Hello World',
        isDirty: false,
        sourceType: 'notebook',
        topicId: 'topic-1',
      });
      // Should NOT call setDocument - that happens in onEditorInit
      expect(mockEditor.setDocument).not.toHaveBeenCalled();
    });

    it('should init a new page document', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: 'Page content',
          documentId: 'page-1',
          editor: mockEditor,
          sourceType: 'page',
        });
      });

      expect(result.current.activeDocumentId).toBe('page-1');
      expect(result.current.documents['page-1']).toMatchObject({
        content: 'Page content',
        sourceType: 'page',
      });
    });

    it('should update existing document when init with same ID', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: 'Original content',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'notebook',
          topicId: 'topic-1',
        });
      });

      act(() => {
        result.current.initDocumentWithEditor({
          content: 'Updated content',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'notebook',
          topicId: 'topic-1',
        });
      });

      expect(result.current.documents['doc-1'].content).toBe('Updated content');
    });

    it('should store editorData in state', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createMockEditor() as any;
      const editorData = { type: 'doc', content: [] };

      act(() => {
        result.current.initDocumentWithEditor({
          documentId: 'doc-1',
          editor: mockEditor,
          editorData,
          sourceType: 'page',
        });
      });

      expect(result.current.documents['doc-1'].editorData).toEqual(editorData);
      // Should NOT call setDocument - that happens in onEditorInit
      expect(mockEditor.setDocument).not.toHaveBeenCalled();
    });
  });

  describe('onEditorInit', () => {
    it('should load markdown content into editor', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createMockEditor() as any;

      // First init document with content
      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Hello World',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'notebook',
        });
      });

      // Then call onEditorInit
      act(() => {
        result.current.onEditorInit(mockEditor);
      });

      expect(mockEditor.setDocument).toHaveBeenCalledWith('markdown', '# Hello World');
    });

    it('should load editorData as json into editor', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createMockEditor() as any;
      const editorData = { type: 'doc', content: [] };

      act(() => {
        result.current.initDocumentWithEditor({
          documentId: 'doc-1',
          editor: mockEditor,
          editorData,
          sourceType: 'page',
        });
      });

      act(() => {
        result.current.onEditorInit(mockEditor);
      });

      expect(mockEditor.setDocument).toHaveBeenCalledWith('json', JSON.stringify(editorData));
    });

    it('should set empty placeholder when no content', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
      });

      act(() => {
        result.current.onEditorInit(mockEditor);
      });

      expect(mockEditor.setDocument).toHaveBeenCalledWith('markdown', ' ');
    });
  });

  describe('closeDocument', () => {
    it('should close a document and remove it from state', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'notebook',
          topicId: 'topic-1',
        });
      });

      expect(result.current.documents['doc-1']).toBeDefined();

      act(() => {
        result.current.closeDocument('doc-1');
      });

      expect(result.current.documents['doc-1']).toBeUndefined();
      expect(result.current.activeDocumentId).toBeUndefined();
    });

    it('should not affect other documents when closing one', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'notebook',
          topicId: 'topic-1',
        });
        result.current.initDocumentWithEditor({
          documentId: 'doc-2',
          editor: mockEditor,
          sourceType: 'notebook',
          topicId: 'topic-2',
        });
      });

      act(() => {
        result.current.closeDocument('doc-1');
      });

      expect(result.current.documents['doc-1']).toBeUndefined();
      expect(result.current.documents['doc-2']).toBeDefined();
    });
  });

  describe('markDirty', () => {
    it('should mark document as dirty', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'notebook',
          topicId: 'topic-1',
        });
      });

      expect(result.current.documents['doc-1'].isDirty).toBe(false);

      act(() => {
        result.current.markDirty('doc-1');
      });

      expect(result.current.documents['doc-1'].isDirty).toBe(true);
    });
  });

  describe('setEditorState', () => {
    it('should set editor state', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditorState = { isBold: true } as any;

      act(() => {
        result.current.setEditorState(mockEditorState);
      });

      expect(result.current.editorState).toBe(mockEditorState);
    });
  });

  describe('getEditorContent', () => {
    it('should return null when no editor', () => {
      const { result } = renderHook(() => useDocumentStore());

      const content = result.current.getEditorContent();

      expect(content).toBeNull();
    });

    it('should return content from editor', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = {
        getDocument: vi.fn((type: string) => {
          if (type === 'markdown') return '# Test';
          if (type === 'json') return { type: 'doc' };
          return null;
        }),
        setDocument: vi.fn(),
      } as any;

      act(() => {
        result.current.initDocumentWithEditor({
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
      });

      const content = result.current.getEditorContent();

      expect(content).toEqual({
        editorData: { type: 'doc' },
        markdown: '# Test',
      });
    });
  });

  describe('flushSave', () => {
    it('should not throw when no active document', () => {
      const { result } = renderHook(() => useDocumentStore());

      expect(() => {
        act(() => {
          result.current.flushSave();
        });
      }).not.toThrow();
    });
  });
});
