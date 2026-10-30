import type { IEditor } from '@lobehub/editor';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { documentService } from '@/services/document';

import { useDocumentStore } from '../../store';

vi.mock('@/services/document', () => ({
  documentService: {
    updateDocument: vi.fn(),
  },
}));
vi.mock('@/services/notebook', () => ({ notebookService: {} }));

const body = (text: string) => ({
  root: { children: [{ children: [{ text, type: 'text' }], type: 'paragraph' }], type: 'root' },
});
const makeEditor = (text: string) => {
  const editor = {
    getDocument: vi.fn((format: string) => (format === 'json' ? body(text) : text)),
    setDocument: vi.fn(),
  };
  return { editor: editor as unknown as IEditor, spy: editor };
};
const seed = (id: string, text: string, editor: IEditor) => {
  useDocumentStore.getState().initDocumentWithEditor({
    autoSave: false,
    content: text,
    documentId: id,
    editor,
    editorData: body(text),
    sourceType: 'page',
    updatedAt: new Date('2026-10-18T00:00:00Z'),
  });
};

beforeEach(() => {
  useDocumentStore.setState({
    activeDocumentId: undefined,
    documents: {},
    documentDetailMap: {},
    editor: undefined,
  });
  vi.mocked(documentService.updateDocument).mockReset().mockResolvedValue({
    historyAppended: false,
    id: 'B',
    updatedAt: '2026-10-18T00:00:01Z',
  });
});

describe('document identity and metadata-only saves', () => {
  it('hydrates the requested cached document while the global active document still points elsewhere', async () => {
    const { editor, spy } = makeEditor('A body');
    seed('B', 'B body', editor);
    seed('A', 'A body', editor);

    await useDocumentStore.getState().onEditorInit(editor, 'B');

    expect(spy.setDocument).toHaveBeenCalledWith('json', JSON.stringify(body('B body')), {
      keepId: true,
    });
    expect(useDocumentStore.getState().documents.A.content).toBe('A body');
  });

  it('does not fall back to the active document when the requested document has not loaded', async () => {
    const { editor, spy } = makeEditor('A body');
    seed('A', 'A body', editor);
    await useDocumentStore.getState().onEditorInit(editor, 'missing');
    expect(spy.setDocument).not.toHaveBeenCalled();
  });

  it('renames B without reading or persisting an editor still showing A', async () => {
    const { editor, spy } = makeEditor('A body');
    seed('B', 'B body', editor);
    const before = useDocumentStore.getState().documents.B;

    await useDocumentStore.getState().performSave(
      'B',
      { title: 'B renamed' },
      {
        metadataOnly: true,
        saveSource: 'autosave',
      },
    );

    const request = vi.mocked(documentService.updateDocument).mock.calls[0][0];
    expect(request).toMatchObject({ id: 'B', title: 'B renamed' });
    expect(request).not.toHaveProperty('content');
    expect(request).not.toHaveProperty('editorData');
    expect(spy.getDocument).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().documents.B).toMatchObject({
      content: before.content,
      editorData: before.editorData,
      isDirty: false,
      lastSavedContent: before.lastSavedContent,
      lastSavedEditorData: before.lastSavedEditorData,
    });
  });

  it('preserves an unsaved body and its saved baseline when metadata finishes saving', async () => {
    const { editor } = makeEditor('B draft');
    seed('B', 'B saved', editor);
    useDocumentStore.getState().handleContentChange();
    const before = useDocumentStore.getState().documents.B;

    await useDocumentStore
      .getState()
      .performSave('B', { title: 'B renamed' }, { metadataOnly: true });

    expect(useDocumentStore.getState().documents.B).toMatchObject({
      content: 'B draft',
      editorData: before.editorData,
      isDirty: true,
      lastSavedContent: 'B saved',
      lastSavedEditorData: before.lastSavedEditorData,
    });
    await useDocumentStore.getState().performSave('B', undefined, { saveSource: 'manual' });
    expect(documentService.updateDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: 'B draft',
        expectedUpdatedAt: new Date('2026-10-18T00:00:01Z'),
        id: 'B',
      }),
    );
    expect(useDocumentStore.getState().documents.B.isDirty).toBe(false);
  });
  it('removes an explicitly cleared emoji while preserving unrelated saved metadata', async () => {
    const { editor } = makeEditor('B body');
    seed('B', 'B body', editor);
    useDocumentStore.setState({
      documentDetailMap: {
        B: { document: { id: 'B', metadata: { createdAt: 123, emoji: '📘' } } as any },
      },
    });

    await useDocumentStore
      .getState()
      .performSave('B', { emoji: undefined }, { metadataOnly: true });

    expect(documentService.updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'B', metadata: { createdAt: 123 } }),
    );
    expect(useDocumentStore.getState().documentDetailMap.B.document?.metadata).toEqual({
      createdAt: 123,
    });
  });

  it('does not write the previous editor body into the next document before its editor takes over', async () => {
    const previous = makeEditor('A body');
    seed('A', 'A body', previous.editor);
    await useDocumentStore.getState().onEditorInit(previous.editor, 'A');

    // The next canvas loads B into its own editor while the store still points at
    // the previous editor, which holds A's body.
    const next = makeEditor('');
    seed('B', '', previous.editor);
    await useDocumentStore.getState().onEditorInit(next.editor, 'B');
    useDocumentStore.getState().handleContentChange();
    await useDocumentStore.getState().performSave('B', undefined, { saveSource: 'manual' });

    expect(useDocumentStore.getState().documents.B.content).toBe('');
    expect(useDocumentStore.getState().documents.B.isDirty).toBeFalsy();
    expect(documentService.updateDocument).not.toHaveBeenCalled();
  });

  it('syncs editor changes once the editor holding the document is in the store', async () => {
    const { editor, spy } = makeEditor('');
    seed('B', '', editor);
    await useDocumentStore.getState().onEditorInit(editor, 'B');

    // The user types after the body loaded.
    spy.getDocument.mockImplementation((format: string) =>
      format === 'json' ? body('B typed') : 'B typed',
    );
    useDocumentStore.getState().handleContentChange();

    expect(useDocumentStore.getState().documents.B.content).toBe('B typed');
    expect(useDocumentStore.getState().documents.B.isDirty).toBe(true);
  });
});
