/* eslint-disable sort-keys-fix/sort-keys-fix */
import { type DocumentStore } from '../../store';
import { type EditorContentState } from './initialState';

// ===== Active Document Selectors =====

const activeDocumentId = (s: DocumentStore) => s.activeDocumentId;

const activeDocument = (s: DocumentStore): EditorContentState | undefined =>
  s.activeDocumentId ? s.documents[s.activeDocumentId] : undefined;

const isEditing = (s: DocumentStore) => !!s.activeDocumentId;

// ===== Document by ID Selectors =====

const documentById = (id: string) => (s: DocumentStore) => s.documents[id];

const isDirty = (id: string) => (s: DocumentStore) => s.documents[id]?.isDirty ?? false;

const saveStatus = (id: string) => (s: DocumentStore) => s.documents[id]?.saveStatus ?? 'idle';

const content = (id: string) => (s: DocumentStore) => s.documents[id]?.content ?? '';

const editorData = (id: string) => (s: DocumentStore) => s.documents[id]?.editorData;

const sourceType = (id: string) => (s: DocumentStore) => s.documents[id]?.sourceType;

const lastUpdatedTime = (id: string) => (s: DocumentStore) =>
  s.documents[id]?.lastUpdatedTime?.toISOString();

// ===== Active Document Convenience Selectors =====

const activeIsDirty = (s: DocumentStore) => {
  const doc = activeDocument(s);
  return doc?.isDirty ?? false;
};

const activeSaveStatus = (s: DocumentStore) => {
  const doc = activeDocument(s);
  return doc?.saveStatus ?? 'idle';
};

const activeContent = (s: DocumentStore) => {
  const doc = activeDocument(s);
  return doc?.content ?? '';
};

const activeEditorData = (s: DocumentStore) => {
  const doc = activeDocument(s);
  return doc?.editorData;
};

const activeSourceType = (s: DocumentStore) => {
  const doc = activeDocument(s);
  return doc?.sourceType;
};

const activeLastUpdatedTime = (s: DocumentStore) => {
  const doc = activeDocument(s);
  return doc?.lastUpdatedTime;
};

// ===== Editor State Selectors =====

const editor = (s: DocumentStore) => s.editor;

const editorState = (s: DocumentStore) => s.editorState;

const canSave = (s: DocumentStore) => {
  const doc = activeDocument(s);
  return doc?.isDirty && doc?.saveStatus !== 'saving';
};

// ===== Document List Selectors =====

const documentIds = (s: DocumentStore) => Object.keys(s.documents);

const documentCount = (s: DocumentStore) => Object.keys(s.documents).length;

const hasDocument = (id: string) => (s: DocumentStore) => id in s.documents;

/**
 * Check if a document is still loading (not yet in the store)
 */
const isDocumentLoading = (id: string | undefined) => (s: DocumentStore) => !id || !s.documents[id];

export const editorSelectors = {
  // Active document
  activeContent,
  activeDocument,
  activeDocumentId,
  activeEditorData,
  activeIsDirty,
  activeLastUpdatedTime,
  activeSaveStatus,
  activeSourceType,

  // By ID
  content,
  documentById,
  editorData,
  hasDocument,
  isDocumentLoading,
  isDirty,
  lastUpdatedTime,
  saveStatus,
  sourceType,

  // Editor
  canSave,
  editor,
  editorState,
  isEditing,

  // List
  documentCount,
  documentIds,
};
