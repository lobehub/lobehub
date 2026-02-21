import { describe, expect, it } from 'vitest';

import { type DocumentStore } from '../../store';
import { editorSelectors } from './selectors';

describe('DocumentStore - Editor Selectors', () => {
  const createMockState = (overrides?: Partial<DocumentStore>): DocumentStore =>
    ({
      activeDocumentId: undefined,
      documents: {},
      editor: undefined,
      editorState: undefined,
      ...overrides,
    }) as DocumentStore;

  describe('activeDocumentId', () => {
    it('should return undefined when no document is active', () => {
      const state = createMockState();
      expect(editorSelectors.activeDocumentId(state)).toBeUndefined();
    });

    it('should return the active document ID', () => {
      const state = createMockState({ activeDocumentId: 'doc-1' });
      expect(editorSelectors.activeDocumentId(state)).toBe('doc-1');
    });
  });

  describe('activeDocument', () => {
    it('should return undefined when no document is active', () => {
      const state = createMockState();
      expect(editorSelectors.activeDocument(state)).toBeUndefined();
    });

    it('should return the active document', () => {
      const doc = {
        content: 'Hello',
        editorData: null,
        isDirty: false,
        lastSavedContent: 'Hello',
        lastUpdatedTime: null,
        saveStatus: 'idle' as const,
        sourceType: 'notebook' as const,
      };
      const state = createMockState({
        activeDocumentId: 'doc-1',
        documents: { 'doc-1': doc },
      });
      expect(editorSelectors.activeDocument(state)).toEqual(doc);
    });
  });

  describe('isEditing', () => {
    it('should return false when no document is active', () => {
      const state = createMockState();
      expect(editorSelectors.isEditing(state)).toBe(false);
    });

    it('should return true when a document is active', () => {
      const state = createMockState({ activeDocumentId: 'doc-1' });
      expect(editorSelectors.isEditing(state)).toBe(true);
    });
  });

  describe('documentById', () => {
    it('should return undefined for non-existent document', () => {
      const state = createMockState();
      expect(editorSelectors.documentById('non-existent')(state)).toBeUndefined();
    });

    it('should return the document by ID', () => {
      const doc = {
        content: 'Test',
        editorData: null,
        isDirty: false,
        lastSavedContent: 'Test',
        lastUpdatedTime: null,
        saveStatus: 'idle' as const,
        sourceType: 'page' as const,
      };
      const state = createMockState({
        documents: { 'doc-1': doc },
      });
      expect(editorSelectors.documentById('doc-1')(state)).toEqual(doc);
    });
  });

  describe('isDirty', () => {
    it('should return false for non-existent document', () => {
      const state = createMockState();
      expect(editorSelectors.isDirty('non-existent')(state)).toBe(false);
    });

    it('should return isDirty status', () => {
      const state = createMockState({
        documents: {
          'doc-1': {
            content: '',
            editorData: null,
            isDirty: true,
            lastSavedContent: '',
            lastUpdatedTime: null,
            saveStatus: 'idle' as const,
            sourceType: 'notebook' as const,
          },
        },
      });
      expect(editorSelectors.isDirty('doc-1')(state)).toBe(true);
    });
  });

  describe('saveStatus', () => {
    it('should return idle for non-existent document', () => {
      const state = createMockState();
      expect(editorSelectors.saveStatus('non-existent')(state)).toBe('idle');
    });

    it('should return save status', () => {
      const state = createMockState({
        documents: {
          'doc-1': {
            content: '',
            editorData: null,
            isDirty: false,
            lastSavedContent: '',
            lastUpdatedTime: null,
            saveStatus: 'saving' as const,
            sourceType: 'notebook' as const,
          },
        },
      });
      expect(editorSelectors.saveStatus('doc-1')(state)).toBe('saving');
    });
  });

  describe('content', () => {
    it('should return empty string for non-existent document', () => {
      const state = createMockState();
      expect(editorSelectors.content('non-existent')(state)).toBe('');
    });

    it('should return content', () => {
      const state = createMockState({
        documents: {
          'doc-1': {
            content: '# Hello',
            editorData: null,
            isDirty: false,
            lastSavedContent: '',
            lastUpdatedTime: null,
            saveStatus: 'idle' as const,
            sourceType: 'notebook' as const,
          },
        },
      });
      expect(editorSelectors.content('doc-1')(state)).toBe('# Hello');
    });
  });

  describe('editorData', () => {
    it('should return undefined for non-existent document', () => {
      const state = createMockState();
      expect(editorSelectors.editorData('non-existent')(state)).toBeUndefined();
    });

    it('should return editorData', () => {
      const mockEditorData = { type: 'doc', content: [] };
      const state = createMockState({
        documents: {
          'doc-1': {
            content: '',
            editorData: mockEditorData,
            isDirty: false,
            lastSavedContent: '',
            lastUpdatedTime: null,
            saveStatus: 'idle' as const,
            sourceType: 'page' as const,
          },
        },
      });
      expect(editorSelectors.editorData('doc-1')(state)).toEqual(mockEditorData);
    });
  });

  describe('sourceType', () => {
    it('should return undefined for non-existent document', () => {
      const state = createMockState();
      expect(editorSelectors.sourceType('non-existent')(state)).toBeUndefined();
    });

    it('should return sourceType', () => {
      const state = createMockState({
        documents: {
          'doc-1': {
            content: '',
            editorData: null,
            isDirty: false,
            lastSavedContent: '',
            lastUpdatedTime: null,
            saveStatus: 'idle' as const,
            sourceType: 'page' as const,
          },
        },
      });
      expect(editorSelectors.sourceType('doc-1')(state)).toBe('page');
    });
  });

  describe('activeIsDirty', () => {
    it('should return false when no document is active', () => {
      const state = createMockState();
      expect(editorSelectors.activeIsDirty(state)).toBe(false);
    });

    it('should return isDirty of active document', () => {
      const state = createMockState({
        activeDocumentId: 'doc-1',
        documents: {
          'doc-1': {
            content: '',
            editorData: null,
            isDirty: true,
            lastSavedContent: '',
            lastUpdatedTime: null,
            saveStatus: 'idle' as const,
            sourceType: 'notebook' as const,
          },
        },
      });
      expect(editorSelectors.activeIsDirty(state)).toBe(true);
    });
  });

  describe('activeContent', () => {
    it('should return empty string when no document is active', () => {
      const state = createMockState();
      expect(editorSelectors.activeContent(state)).toBe('');
    });

    it('should return content of active document', () => {
      const state = createMockState({
        activeDocumentId: 'doc-1',
        documents: {
          'doc-1': {
            content: '# Active Doc',
            editorData: null,
            isDirty: false,
            lastSavedContent: '',
            lastUpdatedTime: null,
            saveStatus: 'idle' as const,
            sourceType: 'notebook' as const,
          },
        },
      });
      expect(editorSelectors.activeContent(state)).toBe('# Active Doc');
    });
  });

  describe('canSave', () => {
    it('should return false when no document is active', () => {
      const state = createMockState();
      expect(editorSelectors.canSave(state)).toBeFalsy();
    });

    it('should return false when document is not dirty', () => {
      const state = createMockState({
        activeDocumentId: 'doc-1',
        documents: {
          'doc-1': {
            content: '',
            editorData: null,
            isDirty: false,
            lastSavedContent: '',
            lastUpdatedTime: null,
            saveStatus: 'idle' as const,
            sourceType: 'notebook' as const,
          },
        },
      });
      expect(editorSelectors.canSave(state)).toBeFalsy();
    });

    it('should return false when document is saving', () => {
      const state = createMockState({
        activeDocumentId: 'doc-1',
        documents: {
          'doc-1': {
            content: '',
            editorData: null,
            isDirty: true,
            lastSavedContent: '',
            lastUpdatedTime: null,
            saveStatus: 'saving' as const,
            sourceType: 'notebook' as const,
          },
        },
      });
      expect(editorSelectors.canSave(state)).toBeFalsy();
    });

    it('should return true when document is dirty and not saving', () => {
      const state = createMockState({
        activeDocumentId: 'doc-1',
        documents: {
          'doc-1': {
            content: '',
            editorData: null,
            isDirty: true,
            lastSavedContent: '',
            lastUpdatedTime: null,
            saveStatus: 'idle' as const,
            sourceType: 'notebook' as const,
          },
        },
      });
      expect(editorSelectors.canSave(state)).toBe(true);
    });
  });

  describe('documentIds', () => {
    it('should return empty array when no documents', () => {
      const state = createMockState();
      expect(editorSelectors.documentIds(state)).toEqual([]);
    });

    it('should return all document IDs', () => {
      const state = createMockState({
        documents: {
          'doc-1': {} as any,
          'doc-2': {} as any,
        },
      });
      expect(editorSelectors.documentIds(state)).toEqual(['doc-1', 'doc-2']);
    });
  });

  describe('documentCount', () => {
    it('should return 0 when no documents', () => {
      const state = createMockState();
      expect(editorSelectors.documentCount(state)).toBe(0);
    });

    it('should return document count', () => {
      const state = createMockState({
        documents: {
          'doc-1': {} as any,
          'doc-2': {} as any,
          'doc-3': {} as any,
        },
      });
      expect(editorSelectors.documentCount(state)).toBe(3);
    });
  });

  describe('hasDocument', () => {
    it('should return false for non-existent document', () => {
      const state = createMockState();
      expect(editorSelectors.hasDocument('non-existent')(state)).toBe(false);
    });

    it('should return true for existing document', () => {
      const state = createMockState({
        documents: {
          'doc-1': {} as any,
        },
      });
      expect(editorSelectors.hasDocument('doc-1')(state)).toBe(true);
    });
  });

  describe('editor', () => {
    it('should return undefined when no editor', () => {
      const state = createMockState();
      expect(editorSelectors.editor(state)).toBeUndefined();
    });

    it('should return editor instance', () => {
      const mockEditor = { focus: () => {} } as any;
      const state = createMockState({ editor: mockEditor });
      expect(editorSelectors.editor(state)).toBe(mockEditor);
    });
  });

  describe('editorState', () => {
    it('should return undefined when no editorState', () => {
      const state = createMockState();
      expect(editorSelectors.editorState(state)).toBeUndefined();
    });

    it('should return editorState', () => {
      const mockEditorState = { isBold: true } as any;
      const state = createMockState({ editorState: mockEditorState });
      expect(editorSelectors.editorState(state)).toBe(mockEditorState);
    });
  });
});
