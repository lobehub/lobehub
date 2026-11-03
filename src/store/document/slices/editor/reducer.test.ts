import { describe, expect, it } from 'vitest';

import { type EditorContentState } from './initialState';
import { type DocumentDispatch } from './reducer';
import { documentReducer } from './reducer';

describe('documentReducer', () => {
  let state: Record<string, EditorContentState>;

  beforeEach(() => {
    state = {};
  });

  describe('addDocument', () => {
    it('should add a new document to state', () => {
      const payload: DocumentDispatch = {
        id: 'doc-1',
        type: 'addDocument',
        value: { sourceType: 'page' },
      };

      const newState = documentReducer(state, payload);

      expect(newState['doc-1']).toBeDefined();
      expect(newState['doc-1'].sourceType).toBe('page');
      expect(newState['doc-1'].isDirty).toBe(false);
      expect(newState['doc-1'].saveStatus).toBe('idle');
    });

    it('should add document with all provided values', () => {
      const payload: DocumentDispatch = {
        id: 'doc-1',
        type: 'addDocument',
        value: {
          autoSave: false,
          content: '# Test content',
          editorData: { type: 'doc' },
          lastSavedContent: '# Test content',
          sourceType: 'notebook',
          topicId: 'topic-1',
        },
      };

      const newState = documentReducer(state, payload);

      expect(newState['doc-1']).toMatchObject({
        autoSave: false,
        content: '# Test content',
        editorData: { type: 'doc' },
        isDirty: false,
        lastSavedContent: '# Test content',
        sourceType: 'notebook',
        topicId: 'topic-1',
      });
    });

    it('should merge with existing document when ID exists', () => {
      // First add a document
      const initialPayload: DocumentDispatch = {
        id: 'doc-1',
        type: 'addDocument',
        value: { content: 'Original', sourceType: 'page' },
      };
      state = documentReducer(state, initialPayload);

      // Then add again with same ID
      const updatePayload: DocumentDispatch = {
        id: 'doc-1',
        type: 'addDocument',
        value: { content: 'Updated', sourceType: 'page' },
      };
      const newState = documentReducer(state, updatePayload);

      expect(newState['doc-1'].content).toBe('Updated');
    });
  });

  describe('updateDocument', () => {
    it('should update an existing document', () => {
      // First add a document
      const addPayload: DocumentDispatch = {
        id: 'doc-1',
        type: 'addDocument',
        value: { content: 'Original', sourceType: 'page' },
      };
      state = documentReducer(state, addPayload);

      // Then update it
      const updatePayload: DocumentDispatch = {
        id: 'doc-1',
        type: 'updateDocument',
        value: { content: 'Updated', isDirty: true },
      };
      const newState = documentReducer(state, updatePayload);

      expect(newState['doc-1'].content).toBe('Updated');
      expect(newState['doc-1'].isDirty).toBe(true);
    });

    it('should not modify state if document does not exist', () => {
      const payload: DocumentDispatch = {
        id: 'non-existent',
        type: 'updateDocument',
        value: { content: 'Test' },
      };

      const newState = documentReducer(state, payload);

      expect(newState['non-existent']).toBeUndefined();
      expect(newState).toBe(state);
    });

    it('should not create new state reference if values are equal', () => {
      // First add a document
      const addPayload: DocumentDispatch = {
        id: 'doc-1',
        type: 'addDocument',
        value: { content: 'Test', sourceType: 'page' },
      };
      state = documentReducer(state, addPayload);

      // Update with same value
      const updatePayload: DocumentDispatch = {
        id: 'doc-1',
        type: 'updateDocument',
        value: { content: 'Test' },
      };
      const newState = documentReducer(state, updatePayload);

      // Should be the same reference since nothing changed
      expect(newState).toBe(state);
    });
  });

  describe('deleteDocument', () => {
    it('should delete an existing document', () => {
      // First add a document
      const addPayload: DocumentDispatch = {
        id: 'doc-1',
        type: 'addDocument',
        value: { sourceType: 'page' },
      };
      state = documentReducer(state, addPayload);
      expect(state['doc-1']).toBeDefined();

      // Then delete it
      const deletePayload: DocumentDispatch = {
        id: 'doc-1',
        type: 'deleteDocument',
      };
      const newState = documentReducer(state, deletePayload);

      expect(newState['doc-1']).toBeUndefined();
    });

    it('should not affect other documents when deleting one', () => {
      // Add two documents
      state = documentReducer(state, {
        id: 'doc-1',
        type: 'addDocument',
        value: { sourceType: 'page' },
      });
      state = documentReducer(state, {
        id: 'doc-2',
        type: 'addDocument',
        value: { sourceType: 'notebook' },
      });

      // Delete one
      const newState = documentReducer(state, {
        id: 'doc-1',
        type: 'deleteDocument',
      });

      expect(newState['doc-1']).toBeUndefined();
      expect(newState['doc-2']).toBeDefined();
    });
  });

  describe('default', () => {
    it('should return the original state for unknown action type', () => {
      const payload = {
        id: 'doc-1',
        type: 'unknown',
      } as unknown as DocumentDispatch;

      const newState = documentReducer(state, payload);

      expect(newState).toBe(state);
    });
  });

  describe('immutability', () => {
    it('should generate immutable state object', () => {
      const payload: DocumentDispatch = {
        id: 'doc-1',
        type: 'addDocument',
        value: { sourceType: 'page' },
      };

      const newState = documentReducer(state, payload);

      expect(newState).not.toBe(state);
    });

    it('should not modify the original state object', () => {
      const payload: DocumentDispatch = {
        id: 'doc-1',
        type: 'addDocument',
        value: { sourceType: 'page' },
      };

      documentReducer(state, payload);

      expect(state).toEqual({});
    });
  });
});
