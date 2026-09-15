import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_EDITOR_STATE } from '@/libs/editor/constants';
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
    updateDocument: vi.fn().mockResolvedValue({ historyAppended: false, id: 'doc-1' }),
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

describe('DocumentStore - Editor Actions', () => {
  beforeEach(() => {
    vi.mocked(documentService.updateDocument).mockReset().mockResolvedValue({
      historyAppended: false,
      id: 'doc-1',
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
      expect(result.current.lastActiveTopicDocumentIdByTopicId).toEqual({
        'topic-1': 'doc-1',
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

    it('should initialize document with editor data', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createMockEditor() as any;
      const editorData = { blocks: [{ type: 'paragraph' }] };

      act(() => {
        result.current.initDocumentWithEditor({
          documentId: 'doc-1',
          editor: mockEditor,
          editorData,
          sourceType: 'page',
        });
      });

      expect(result.current.documents['doc-1'].editorData).toEqual(editorData);
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

    it('should load only the editable body for SKILL.md frontmatter documents', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createMockEditor() as any;
      const skillContent = `---
description: >-
  Retrieves comments from YouTube videos.
name: youtube-comment-retrieval-workflow
---

# YouTube Comment Retrieval Workflow`;

      act(() => {
        result.current.initDocumentWithEditor({
          content: skillContent,
          contentFormat: 'skillMarkdown',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'notebook',
        });
      });

      act(() => {
        result.current.onEditorInit(mockEditor);
      });

      expect(mockEditor.setDocument).toHaveBeenCalledWith(
        'markdown',
        '# YouTube Comment Retrieval Workflow',
      );
      expect(result.current.documents['doc-1'].skillFrontmatter).toContain(
        'youtube-comment-retrieval-workflow',
      );
    });

    it('should preserve existing editorData for SKILL.md documents', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createMockEditor() as any;
      const editorData = {
        root: {
          children: [
            {
              children: [
                { children: [{ text: 'origin', type: 'text' }], type: 'paragraph' },
                { children: [{ text: 'modified', type: 'text' }], type: 'paragraph' },
              ],
              diffType: 'modify',
              type: 'diff',
            },
          ],
          type: 'root',
        },
      };

      act(() => {
        result.current.initDocumentWithEditor({
          content: `---
description: Skill metadata
name: skill-name
---

# Body`,
          contentFormat: 'skillMarkdown',
          documentId: 'doc-1',
          editor: mockEditor,
          editorData,
          sourceType: 'notebook',
        });
      });

      act(() => {
        result.current.onEditorInit(mockEditor);
      });

      expect(mockEditor.setDocument).toHaveBeenCalledTimes(1);
      expect(mockEditor.setDocument).toHaveBeenCalledWith('json', JSON.stringify(editorData));
    });

    it('should fall back to editable body when SKILL.md editorData cannot be loaded', () => {
      const { result } = renderHook(() => useDocumentStore());
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const editorData = {
        root: { children: [{ children: [], type: 'paragraph' }], type: 'root' },
      };
      const mockEditor = {
        getDocument: vi.fn(),
        setDocument: vi.fn((type: string) => {
          if (type === 'json') {
            throw new Error('editorData unavailable');
          }
        }),
      } as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: `---
description: Skill metadata
name: skill-name
---

# Body`,
          contentFormat: 'skillMarkdown',
          documentId: 'doc-1',
          editor: mockEditor,
          editorData,
          sourceType: 'notebook',
        });
      });

      act(() => {
        result.current.onEditorInit(mockEditor);
      });

      expect(consoleWarn).toHaveBeenCalledWith(
        '[DocumentStore] Failed to load SKILL.md editorData, falling back to markdown',
      );
      expect(mockEditor.setDocument).toHaveBeenNthCalledWith(1, 'json', JSON.stringify(editorData));
      expect(mockEditor.setDocument).toHaveBeenNthCalledWith(2, 'markdown', '# Body');

      consoleWarn.mockRestore();
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

    it('should reset editor content when target document is empty', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Previous Content',
          documentId: 'doc-previous',
          editor: mockEditor,
          sourceType: 'page',
        });
      });

      act(() => {
        result.current.onEditorInit(mockEditor);
      });

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

      expect(mockEditor.setDocument).toHaveBeenLastCalledWith(
        'json',
        JSON.stringify(EMPTY_EDITOR_STATE),
      );
    });

    it('should fail safely when SKILL.md body cannot be loaded into the editor', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockEditor = {
        getDocument: vi.fn(),
        setDocument: vi.fn(() => {
          throw new Error('editor unavailable');
        }),
      } as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: `---
description: Skill metadata
name: skill-name
---

# Body`,
          contentFormat: 'skillMarkdown',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'notebook',
        });
      });

      await act(async () => {
        await result.current.onEditorInit(mockEditor);
      });

      expect(consoleError).toHaveBeenCalledWith(
        '[DocumentStore] Failed to load SKILL.md content:',
        expect.any(Error),
      );

      consoleError.mockRestore();
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

  describe('handleContentChange', () => {
    it('should mark document dirty when editorData changes even if markdown is unchanged', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = {
        getDocument: vi.fn((type: string) => {
          if (type === 'markdown') return '# Test';
          if (type === 'json') return { type: 'doc', updated: true };
          return null;
        }),
        setDocument: vi.fn(),
      } as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          editorData: { type: 'doc' },
          sourceType: 'page',
        });
      });

      expect(result.current.documents['doc-1'].isDirty).toBe(false);

      act(() => {
        result.current.handleContentChange();
      });

      expect(result.current.documents['doc-1']).toMatchObject({
        content: '# Test',
        editorData: { type: 'doc', updated: true },
        isDirty: true,
      });
    });

    it('should preserve SKILL.md frontmatter when syncing editor body changes', () => {
      const { result } = renderHook(() => useDocumentStore());
      const editorData = {
        root: { children: [{ children: [], type: 'paragraph' }], type: 'root' },
      };
      const mockEditor = {
        getDocument: vi.fn((type: string) => {
          if (type === 'markdown') return '# Updated Skill';
          if (type === 'json') return editorData;
          return null;
        }),
        setDocument: vi.fn(),
      } as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: `---
description: Skill metadata
name: skill-name
---

# Original Skill`,
          contentFormat: 'skillMarkdown',
          documentId: 'doc-1',
          editor: mockEditor,
          editorData,
          sourceType: 'notebook',
        });
      });

      act(() => {
        result.current.handleContentChange();
      });

      expect(result.current.documents['doc-1']).toMatchObject({
        content: `---
description: Skill metadata
name: skill-name
---

# Updated Skill`,
        isDirty: true,
      });
    });

    it('should update SKILL.md frontmatter while preserving the editor body', () => {
      const { result } = renderHook(() => useDocumentStore());
      const editorData = {
        root: { children: [{ children: [], type: 'paragraph' }], type: 'root' },
      };
      const mockEditor = {
        getDocument: vi.fn((type: string) => {
          if (type === 'markdown') return '# Current Body';
          if (type === 'json') return editorData;
          return null;
        }),
        setDocument: vi.fn(),
      } as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: `---
description: Old metadata
name: old-skill
---

# Original Body`,
          contentFormat: 'skillMarkdown',
          documentId: 'doc-1',
          editor: mockEditor,
          editorData,
          sourceType: 'notebook',
        });
      });

      act(() => {
        result.current.updateSkillFrontmatter(
          'doc-1',
          `description: New metadata
name: new-skill`,
        );
      });

      expect(result.current.documents['doc-1']).toMatchObject({
        content: `---
description: New metadata
name: new-skill
---

# Current Body`,
        isDirty: true,
        skillFrontmatter: `description: New metadata
name: new-skill`,
      });
    });

    it('should update an inactive SKILL.md document from stored content', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createMockEditor() as any;
      const editorData = {
        root: { children: [{ children: [], type: 'paragraph' }], type: 'root' },
      };

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Active',
          documentId: 'doc-active',
          editor: mockEditor,
          sourceType: 'notebook',
        });
        result.current.initDocumentWithEditor({
          content: `---
description: Old metadata
name: old-skill
---

# Stored Body`,
          contentFormat: 'skillMarkdown',
          documentId: 'doc-inactive',
          editor: mockEditor,
          editorData,
          sourceType: 'notebook',
        });
        result.current.initDocumentWithEditor({
          content: '# Active',
          documentId: 'doc-active',
          editor: mockEditor,
          sourceType: 'notebook',
        });
      });

      act(() => {
        result.current.updateSkillFrontmatter(
          'doc-inactive',
          `description: New metadata
name: new-skill`,
        );
      });

      expect(result.current.documents['doc-inactive']).toMatchObject({
        content: `---
description: New metadata
name: new-skill
---

# Stored Body`,
        editorData,
        isDirty: true,
      });
    });

    it('should reject frontmatter updates for missing or non-SKILL documents', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Markdown',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'notebook',
        });
      });

      expect(result.current.updateSkillFrontmatter('missing', 'name: skill')).toBe(false);
      expect(result.current.updateSkillFrontmatter('doc-1', 'name: skill')).toBe(false);
    });

    it('should fail safely when active SKILL.md frontmatter update cannot read editor content', () => {
      const { result } = renderHook(() => useDocumentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockEditor = {
        getDocument: vi.fn(() => {
          throw new Error('editor unavailable');
        }),
        setDocument: vi.fn(),
      } as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: `---
description: Skill metadata
name: skill-name
---

# Body`,
          contentFormat: 'skillMarkdown',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'notebook',
        });
      });

      expect(result.current.updateSkillFrontmatter('doc-1', 'name: skill-name')).toBe(false);
      expect(consoleError).toHaveBeenCalledWith(
        '[DocumentStore] Failed to update SKILL.md frontmatter:',
        expect.any(Error),
      );

      consoleError.mockRestore();
    });
  });

  describe('commitEditorMutation', () => {
    it('syncs current editor content and immediately saves through the document manager', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const editorData = {
        root: { children: [{ children: [], type: 'paragraph' }], type: 'root' },
      };
      const mockEditor = {
        getDocument: vi.fn((type: string) => {
          if (type === 'markdown') return '# Updated';
          if (type === 'json') return editorData;
          return null;
        }),
        setDocument: vi.fn(),
      } as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Initial',
          documentId: 'doc-1',
          editor: mockEditor,
          editorData: {
            root: { children: [{ children: [], type: 'paragraph' }], type: 'root' },
          },
          sourceType: 'page',
        });
      });

      await act(async () => {
        await result.current.commitEditorMutation('doc-1', { saveSource: 'llm_call' });
      });

      expect(documentService.updateDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '# Updated',
          editorData: JSON.stringify(editorData),
          id: 'doc-1',
          saveSource: 'llm_call',
        }),
      );
      expect(result.current.documents['doc-1']).toMatchObject({
        content: '# Updated',
        editorData,
        isDirty: false,
        lastSavedContent: '# Updated',
        lastSavedEditorData: editorData,
      });
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

  describe('performSave', () => {
    it('should reject saving when editorData is an empty object', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = {
        getDocument: vi.fn((type: string) => {
          if (type === 'markdown') return '# Test';
          if (type === 'json') return {};
          return null;
        }),
        setDocument: vi.fn(),
      } as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
        result.current.markDirty('doc-1');
      });
      vi.mocked(documentService.updateDocument).mockClear();

      await act(async () => {
        await result.current.performSave('doc-1');
      });

      expect(documentService.updateDocument).not.toHaveBeenCalled();
      expect(result.current.documents['doc-1'].isDirty).toBe(true);
      expect(result.current.documents['doc-1'].saveStatus).toBe('idle');
    });

    it('marks the document lock-blocked (keeping unsaved content) when another editor holds the lock', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createValidMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
        result.current.markDirty('doc-1');
      });

      const lockError = Object.assign(new Error('Document is being edited by another user'), {
        data: { code: 'CONFLICT' },
      });
      vi.mocked(documentService.updateDocument).mockRejectedValueOnce(lockError);

      await act(async () => {
        await result.current.performSave('doc-1');
      });

      expect(result.current.documents['doc-1'].saveBlockedByLock).toBe(true);
      // Unsaved content is preserved, not silently dropped.
      expect(result.current.documents['doc-1'].isDirty).toBe(true);
      expect(result.current.documents['doc-1'].saveStatus).toBe('idle');
    });

    it('passes the document lock owner id when saving', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createValidMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
        result.current.internal_dispatchDocument({
          id: 'doc-1',
          type: 'updateDocument',
          value: { lockOwnerId: 'owner-1' },
        });
        result.current.markDirty('doc-1');
      });

      await act(async () => {
        await result.current.performSave('doc-1');
      });

      expect(documentService.updateDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'doc-1', lockOwnerId: 'owner-1' }),
      );
    });

    it('reclaims the lock and retries once when a CONFLICT save is a self conflict', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createValidMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
        result.current.internal_dispatchDocument({
          id: 'doc-1',
          type: 'updateDocument',
          value: { lockOwnerId: 'owner-1' },
        });
        result.current.markDirty('doc-1');
      });

      // First save races the lazy lock acquire (or hits a ghost lease) → CONFLICT.
      const lockError = Object.assign(new Error('Document is being edited by another user'), {
        data: { code: 'CONFLICT' },
      });
      vi.mocked(documentService.updateDocument)
        .mockRejectedValueOnce(lockError)
        .mockResolvedValueOnce({ historyAppended: false, id: 'doc-1' });

      await act(async () => {
        await result.current.performSave('doc-1');
      });

      expect(documentService.acquireDocumentLock).toHaveBeenCalledWith('doc-1', 'owner-1');
      expect(documentService.updateDocument).toHaveBeenCalledTimes(2);
      // The retry pins the save to the verified server version so an
      // interleaved collaborator write fails the CAS instead of being lost.
      expect(documentService.updateDocument).toHaveBeenLastCalledWith(
        expect.objectContaining({ expectedUpdatedAt: new Date('2026-01-01T00:00:00.000Z') }),
      );
      expect(result.current.documents['doc-1'].isDirty).toBe(false);
      expect(result.current.documents['doc-1'].saveBlockedByLock).toBe(false);
      expect(result.current.documents['doc-1'].saveStatus).toBe('saved');
    });

    it('does not retry when the server holds a newer version (collaborator saved then released)', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createValidMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
        result.current.internal_dispatchDocument({
          id: 'doc-1',
          type: 'updateDocument',
          value: { lockOwnerId: 'owner-1' },
        });
        result.current.markDirty('doc-1');
      });

      const lockError = Object.assign(new Error('Document is being edited by another user'), {
        data: { code: 'CONFLICT' },
      });
      vi.mocked(documentService.updateDocument).mockRejectedValueOnce(lockError);
      // Another member saved a newer version and released the lease before the
      // recovery ran — the blind retry must NOT clobber it.
      vi.mocked(documentService.getDocumentById).mockResolvedValueOnce({
        content: '# Collaborator version',
        id: 'doc-1',
      } as any);

      await act(async () => {
        await result.current.performSave('doc-1');
      });

      expect(documentService.acquireDocumentLock).not.toHaveBeenCalled();
      expect(documentService.updateDocument).toHaveBeenCalledTimes(1);
      expect(result.current.documents['doc-1'].saveBlockedByLock).toBe(true);
      expect(result.current.documents['doc-1'].isDirty).toBe(true);
    });

    it('does not retry a save that carries metadata (title/emoji cannot be version-checked)', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createValidMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
        result.current.internal_dispatchDocument({
          id: 'doc-1',
          type: 'updateDocument',
          value: { lockOwnerId: 'owner-1' },
        });
        result.current.markDirty('doc-1');
      });

      const lockError = Object.assign(new Error('Document is being edited by another user'), {
        data: { code: 'CONFLICT' },
      });
      vi.mocked(documentService.updateDocument).mockRejectedValueOnce(lockError);

      await act(async () => {
        await result.current.performSave('doc-1', { title: 'Renamed while conflicted' });
      });

      // A collaborator may have changed only the title/emoji — the recovery's
      // content comparison cannot vouch for those fields, so no self-heal.
      expect(documentService.acquireDocumentLock).not.toHaveBeenCalled();
      expect(documentService.updateDocument).toHaveBeenCalledTimes(1);
      expect(result.current.documents['doc-1'].saveBlockedByLock).toBe(true);
    });

    it('does not retry when a newer save from this tab landed while the failed save was in flight', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createValidMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
        result.current.internal_dispatchDocument({
          id: 'doc-1',
          type: 'updateDocument',
          value: { lockOwnerId: 'owner-1' },
        });
        result.current.markDirty('doc-1');
      });

      const lockError = Object.assign(new Error('Document is being edited by another user'), {
        data: { code: 'CONFLICT' },
      });
      // While this save is in flight, an overlapping newer save from the same
      // tab completes and advances lastSaved* — then this save conflicts.
      vi.mocked(documentService.updateDocument).mockImplementationOnce(async () => {
        useDocumentStore.getState().internal_dispatchDocument({
          id: 'doc-1',
          type: 'updateDocument',
          value: { lastSavedContent: '# Newer save' },
        });
        throw lockError;
      });
      vi.mocked(documentService.getDocumentById).mockResolvedValueOnce({
        content: '# Newer save',
        id: 'doc-1',
        updatedAt: new Date('2026-01-01T00:00:20.000Z'),
      } as any);

      await act(async () => {
        await result.current.performSave('doc-1');
      });

      // The recovery compares against the version THIS request was based on
      // ('# Test'), not the live store — replaying the older payload over the
      // newer save must be refused.
      expect(documentService.acquireDocumentLock).not.toHaveBeenCalled();
      expect(documentService.updateDocument).toHaveBeenCalledTimes(1);
    });

    it('releases the reclaimed lease when the CAS-guarded retry itself fails', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createValidMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
        result.current.internal_dispatchDocument({
          id: 'doc-1',
          type: 'updateDocument',
          value: { lockOwnerId: 'owner-1' },
        });
        result.current.markDirty('doc-1');
      });

      const lockError = Object.assign(new Error('Document is being edited by another user'), {
        data: { code: 'CONFLICT' },
      });
      const casError = Object.assign(new Error('Document has been updated by another session'), {
        data: { code: 'CONFLICT' },
      });
      // First save conflicts; the retry's server-side version predicate then
      // rejects an interleaved collaborator save.
      vi.mocked(documentService.updateDocument)
        .mockRejectedValueOnce(lockError)
        .mockRejectedValueOnce(casError);

      await act(async () => {
        await result.current.performSave('doc-1');
      });

      expect(documentService.updateDocument).toHaveBeenCalledTimes(2);
      // The lease stolen for the failed retry is handed back so the lock
      // recovery cannot treat this tab as the legitimate holder and reopen
      // the stale editor.
      expect(documentService.releaseDocumentLock).toHaveBeenCalledWith('doc-1', 'owner-1');
      expect(result.current.documents['doc-1'].saveBlockedByLock).toBe(true);
      expect(result.current.documents['doc-1'].isDirty).toBe(true);
    });

    it('does not retry when only the server editorData differs (editor-data-only collaborator change)', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createValidMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          editorData: { blocks: [{ type: 'paragraph' }] },
          sourceType: 'page',
        });
        result.current.internal_dispatchDocument({
          id: 'doc-1',
          type: 'updateDocument',
          value: { lockOwnerId: 'owner-1' },
        });
        result.current.markDirty('doc-1');
      });

      const lockError = Object.assign(new Error('Document is being edited by another user'), {
        data: { code: 'CONFLICT' },
      });
      vi.mocked(documentService.updateDocument).mockRejectedValueOnce(lockError);
      // Same markdown, different editorData — still a collaborator's version.
      vi.mocked(documentService.getDocumentById).mockResolvedValueOnce({
        content: '# Test',
        editorData: { blocks: [{ type: 'heading' }] },
        id: 'doc-1',
        updatedAt: new Date('2026-01-01T00:00:10.000Z'),
      } as any);

      await act(async () => {
        await result.current.performSave('doc-1');
      });

      expect(documentService.acquireDocumentLock).not.toHaveBeenCalled();
      expect(documentService.updateDocument).toHaveBeenCalledTimes(1);
      expect(result.current.documents['doc-1'].saveBlockedByLock).toBe(true);
    });

    it('keeps the save lock-blocked without retrying when another member holds the lease', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createValidMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
        result.current.internal_dispatchDocument({
          id: 'doc-1',
          type: 'updateDocument',
          value: { lockOwnerId: 'owner-1' },
        });
        result.current.markDirty('doc-1');
      });

      const lockError = Object.assign(new Error('Document is being edited by another user'), {
        data: { code: 'CONFLICT' },
      });
      vi.mocked(documentService.updateDocument).mockRejectedValueOnce(lockError);
      vi.mocked(documentService.acquireDocumentLock).mockResolvedValueOnce({
        holderId: 'user-2',
        lockedByOther: true,
      } as any);

      await act(async () => {
        await result.current.performSave('doc-1');
      });

      expect(documentService.updateDocument).toHaveBeenCalledTimes(1);
      expect(result.current.documents['doc-1'].saveBlockedByLock).toBe(true);
      expect(result.current.documents['doc-1'].isDirty).toBe(true);
    });

    it('keeps the CONFLICT lock-block when the reclaim attempt itself fails', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createValidMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
        result.current.internal_dispatchDocument({
          id: 'doc-1',
          type: 'updateDocument',
          value: { lockOwnerId: 'owner-1' },
        });
        result.current.markDirty('doc-1');
      });

      const lockError = Object.assign(new Error('Document is being edited by another user'), {
        data: { code: 'CONFLICT' },
      });
      vi.mocked(documentService.updateDocument).mockRejectedValueOnce(lockError);
      vi.mocked(documentService.acquireDocumentLock).mockRejectedValueOnce(
        new Error('network down'),
      );

      await act(async () => {
        await result.current.performSave('doc-1');
      });

      expect(documentService.updateDocument).toHaveBeenCalledTimes(1);
      expect(result.current.documents['doc-1'].saveBlockedByLock).toBe(true);
      expect(result.current.documents['doc-1'].isDirty).toBe(true);
    });

    it('does not attempt a lock reclaim when the document has no lock owner id', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createValidMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
        result.current.markDirty('doc-1');
      });

      const lockError = Object.assign(new Error('Document is being edited by another user'), {
        data: { code: 'CONFLICT' },
      });
      vi.mocked(documentService.updateDocument).mockRejectedValueOnce(lockError);

      await act(async () => {
        await result.current.performSave('doc-1');
      });

      expect(documentService.acquireDocumentLock).not.toHaveBeenCalled();
      expect(result.current.documents['doc-1'].saveBlockedByLock).toBe(true);
    });

    it('clears the lock-blocked flag after the next successful save', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createValidMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
        result.current.markDirty('doc-1');
      });

      const lockError = Object.assign(new Error('locked'), { data: { code: 'CONFLICT' } });
      vi.mocked(documentService.updateDocument).mockRejectedValueOnce(lockError);
      await act(async () => {
        await result.current.performSave('doc-1');
      });
      expect(result.current.documents['doc-1'].saveBlockedByLock).toBe(true);

      vi.mocked(documentService.updateDocument).mockResolvedValue({
        historyAppended: false,
        id: 'doc-1',
      });
      act(() => {
        result.current.markDirty('doc-1');
      });
      await act(async () => {
        await result.current.performSave('doc-1');
      });

      expect(result.current.documents['doc-1'].saveBlockedByLock).toBe(false);
      expect(result.current.documents['doc-1'].isDirty).toBe(false);
    });

    it('clearSaveBlockedByLock drops a stale lock-block without needing a save (lock recovery)', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createValidMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
        result.current.markDirty('doc-1');
      });

      const lockError = Object.assign(new Error('locked'), { data: { code: 'CONFLICT' } });
      vi.mocked(documentService.updateDocument).mockRejectedValueOnce(lockError);
      await act(async () => {
        await result.current.performSave('doc-1');
      });
      expect(result.current.documents['doc-1'].saveBlockedByLock).toBe(true);

      // The lock driver clears it once the page is no longer locked by another —
      // the read-only editor would otherwise never reach a successful save.
      act(() => {
        result.current.clearSaveBlockedByLock('doc-1');
      });

      expect(result.current.documents['doc-1'].saveBlockedByLock).toBe(false);
    });

    it('clearSaveBlockedByLock is a no-op when the document is not lock-blocked', () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createValidMockEditor() as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
      });

      act(() => {
        result.current.clearSaveBlockedByLock('doc-1');
      });

      expect(result.current.documents['doc-1'].saveBlockedByLock).toBeFalsy();
    });

    it('should save metadata-only updates when history is not appended', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createValidMockEditor() as any;

      vi.mocked(documentService.updateDocument).mockResolvedValue({
        historyAppended: false,
        id: 'doc-1',
      });

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
      });

      await act(async () => {
        await result.current.performSave(
          'doc-1',
          { title: 'Updated Title' },
          { saveSource: 'autosave' },
        );
      });

      expect(documentService.updateDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'doc-1',
          saveSource: 'autosave',
          title: 'Updated Title',
        }),
      );
      expect(result.current.documents['doc-1'].isDirty).toBe(false);
    });

    it('should save and persist raw editorData with diff nodes (pending human review)', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const editorData = {
        root: {
          children: [
            {
              children: [
                { children: [{ text: 'origin', type: 'text' }], type: 'paragraph' },
                { children: [{ text: 'modified', type: 'text' }], type: 'paragraph' },
              ],
              diffType: 'modify',
              type: 'diff',
            },
            {
              children: [{ children: [{ text: 'added', type: 'text' }], type: 'paragraph' }],
              diffType: 'add',
              type: 'diff',
            },
          ],
          type: 'root',
        },
      };
      const mockEditor = {
        getDocument: vi.fn((type: string) => {
          if (type === 'markdown') return '# Test';
          if (type === 'json') return editorData;
          return null;
        }),
        setDocument: vi.fn(),
      } as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
        result.current.markDirty('doc-1');
      });

      await act(async () => {
        await result.current.performSave('doc-1');
      });

      // Autosave preserves diff nodes; DiffAllToolbar surfaces Accept/Reject
      // on the next render and only then does the editor normalize the state.
      expect(documentService.updateDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          editorData: JSON.stringify(editorData),
          id: 'doc-1',
        }),
      );
      expect(result.current.documents['doc-1'].editorData).toEqual(editorData);
      expect(result.current.documents['doc-1'].lastSavedEditorData).toEqual(editorData);
    });

    it('should pass restore metadata through updateDocument', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const mockEditor = createValidMockEditor() as any;

      vi.mocked(documentService.updateDocument).mockResolvedValue({
        historyAppended: true,
        id: 'doc-1',
        savedAt: '2026-04-15T10:00:00.000Z',
      });

      act(() => {
        result.current.initDocumentWithEditor({
          content: '# Test',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'page',
        });
        result.current.markDirty('doc-1');
      });

      await act(async () => {
        await result.current.performSave('doc-1', undefined, {
          restoreFromHistoryId: 'hist-2',
          saveSource: 'restore',
        });
      });

      expect(documentService.updateDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '# Test',
          id: 'doc-1',
          restoreFromHistoryId: 'hist-2',
          saveSource: 'restore',
        }),
      );
      expect(result.current.documents['doc-1'].isDirty).toBe(false);
    });

    it('should save SKILL.md with its original frontmatter restored', async () => {
      const { result } = renderHook(() => useDocumentStore());
      const editorData = {
        root: { children: [{ children: [], type: 'paragraph' }], type: 'root' },
      };
      const mockEditor = {
        getDocument: vi.fn((type: string) => {
          if (type === 'markdown') return '# Updated Skill';
          if (type === 'json') return editorData;
          return null;
        }),
        setDocument: vi.fn(),
      } as any;

      act(() => {
        result.current.initDocumentWithEditor({
          content: `---
description: Skill metadata
name: skill-name
---

# Original Skill`,
          contentFormat: 'skillMarkdown',
          documentId: 'doc-1',
          editor: mockEditor,
          sourceType: 'notebook',
        });
        result.current.markDirty('doc-1');
      });

      await act(async () => {
        await result.current.performSave('doc-1');
      });

      const expectedContent = `---
description: Skill metadata
name: skill-name
---

# Updated Skill`;

      expect(documentService.updateDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expectedContent,
          editorData: JSON.stringify(editorData),
          id: 'doc-1',
        }),
      );
      expect(result.current.documents['doc-1']).toMatchObject({
        content: expectedContent,
        isDirty: false,
        lastSavedContent: expectedContent,
      });
    });
  });
});
