import { describe, expect, it, vi } from 'vitest';

import { KnowledgeBaseExecutionRuntime } from './index';

const kbDoc = {
  fileType: 'custom/document',
  id: 'docs_a',
  knowledgeBaseId: 'kb_1',
  title: 'Roadmap',
};

const setup = (
  documents: Record<
    string,
    Partial<typeof kbDoc> & { knowledgeBaseId?: string | null; parentId?: string | null }
  > = {
    docs_a: kbDoc,
  },
  knowledgeBases: string[] = ['kb_1'],
) => {
  const documentService = {
    createDocument: vi.fn(),
    getDocumentById: vi.fn(async (id: string) => documents[id] as any),
    updateDocument: vi.fn(async ({ id }: { id: string }) => ({ id })),
  };
  const knowledgeBaseService = {
    addFilesToKnowledgeBase: vi.fn(),
    createKnowledgeBase: vi.fn(),
    getKnowledgeBaseById: vi.fn(async (id: string) =>
      knowledgeBases.includes(id)
        ? { avatar: null, id, name: id, updatedAt: new Date() }
        : undefined,
    ),
    getKnowledgeBases: vi.fn(),
    getKnowledgeItems: vi.fn(),
    removeFilesFromKnowledgeBase: vi.fn(),
    removeKnowledgeBase: vi.fn(),
  };
  const ragService = { getFileContents: vi.fn(), semanticSearchForChat: vi.fn() };
  const runtime = new KnowledgeBaseExecutionRuntime(
    ragService,
    knowledgeBaseService,
    documentService,
  );
  return { documentService, knowledgeBaseService, runtime };
};

describe('KnowledgeBaseExecutionRuntime.updateDocument', () => {
  it('replaces the content in place and keeps the document id', async () => {
    const { documentService, runtime } = setup();

    const result = await runtime.updateDocument({ content: '# v2\nbody', documentId: 'docs_a' });

    expect(result.success).toBe(true);
    expect(result.state).toEqual({ id: 'docs_a' });
    expect(result.content).toContain('content replaced (9 characters)');
    expect(documentService.updateDocument).toHaveBeenCalledWith({
      content: '# v2\nbody',
      id: 'docs_a',
      parentId: undefined,
      title: undefined,
    });
  });

  it('renames without sending content, so the body is not overwritten', async () => {
    const { documentService, runtime } = setup();

    const result = await runtime.updateDocument({ documentId: 'docs_a', title: 'Roadmap 2027' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('renamed to "Roadmap 2027"');
    const params = documentService.updateDocument.mock.calls[0][0];
    expect(params.content).toBeUndefined();
    expect(params.title).toBe('Roadmap 2027');
  });

  it('treats empty strings as unchanged fields', async () => {
    const { documentService, runtime } = setup();

    const result = await runtime.updateDocument({
      content: '',
      documentId: 'docs_a',
      parentId: '',
      title: 'New',
    });

    expect(result.success).toBe(true);
    expect(documentService.updateDocument).toHaveBeenCalledWith({
      content: undefined,
      id: 'docs_a',
      parentId: undefined,
      title: 'New',
    });
  });

  it('fails when no field to change is given', async () => {
    const { documentService, runtime } = setup();

    const result = await runtime.updateDocument({ content: '', documentId: 'docs_a', title: ' ' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('at least one of title, content or parentId');
    expect(documentService.updateDocument).not.toHaveBeenCalled();
  });

  it('fails when documentId is missing', async () => {
    const { runtime } = setup();

    const result = await runtime.updateDocument({ documentId: ' ', title: 'x' });

    expect(result.success).toBe(false);
    expect(result.content).toBe('Error: documentId is required.');
  });

  it('fails when the document is not found or not accessible', async () => {
    const { documentService, runtime } = setup();

    const result = await runtime.updateDocument({ documentId: 'docs_missing', title: 'x' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('not found, or you do not have access to it');
    expect(documentService.updateDocument).not.toHaveBeenCalled();
  });

  it('refuses file-backed documents such as parsed PDFs', async () => {
    const { documentService, runtime } = setup({
      docs_pdf: { fileType: 'application/pdf', id: 'docs_pdf', knowledgeBaseId: 'kb_1' },
    });

    const result = await runtime.updateDocument({ content: 'x', documentId: 'docs_pdf' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('is an uploaded file or imported web page, not a note');
    expect(documentService.updateDocument).not.toHaveBeenCalled();
  });

  // Regression: parseFile stores parsed uploads as custom/document with
  // sourceType 'file', so a fileType-only guard let the tool overwrite them.
  it.each(['file', 'web'])(
    'refuses %s-sourced documents even when stored as custom/document',
    async (sourceType) => {
      const { documentService, runtime } = setup({
        docs_parsed: {
          fileType: 'custom/document',
          id: 'docs_parsed',
          knowledgeBaseId: 'kb_1',
          sourceType,
        } as any,
      });

      const result = await runtime.updateDocument({ content: 'x', documentId: 'docs_parsed' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('is an uploaded file or imported web page, not a note');
      expect(documentService.updateDocument).not.toHaveBeenCalled();
    },
  );

  it('refuses documents outside any knowledge base', async () => {
    const { documentService, runtime } = setup({
      docs_page: { fileType: 'custom/document', id: 'docs_page', knowledgeBaseId: null },
    });

    const result = await runtime.updateDocument({ content: 'x', documentId: 'docs_page' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('is not in a knowledge base');
    expect(documentService.updateDocument).not.toHaveBeenCalled();
  });

  it('refuses documents whose knowledge base the caller cannot access', async () => {
    const { documentService, runtime } = setup(
      { docs_a: { ...kbDoc, knowledgeBaseId: 'kb_private' } },
      ['kb_1'],
    );

    const result = await runtime.updateDocument({ content: 'x', documentId: 'docs_a' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('knowledge base you do not have access to');
    expect(documentService.updateDocument).not.toHaveBeenCalled();
  });

  it('moves under a parent in the same knowledge base', async () => {
    const { documentService, runtime } = setup({
      docs_a: kbDoc,
      docs_folder: { fileType: 'custom/folder', id: 'docs_folder', knowledgeBaseId: 'kb_1' },
    });

    const result = await runtime.updateDocument({ documentId: 'docs_a', parentId: 'docs_folder' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('moved under `docs_folder`');
    expect(documentService.updateDocument).toHaveBeenCalledWith({
      content: undefined,
      id: 'docs_a',
      parentId: 'docs_folder',
      title: undefined,
    });
  });

  it('refuses a parent from another knowledge base or the document itself', async () => {
    const { documentService, runtime } = setup({
      docs_a: kbDoc,
      docs_other: { fileType: 'custom/folder', id: 'docs_other', knowledgeBaseId: 'kb_2' },
    });

    const crossKb = await runtime.updateDocument({ documentId: 'docs_a', parentId: 'docs_other' });
    const self = await runtime.updateDocument({ documentId: 'docs_a', parentId: 'docs_a' });

    expect(crossKb.success).toBe(false);
    expect(crossKb.content).toContain('must be a folder or document in the same knowledge base');
    expect(self.success).toBe(false);
    expect(documentService.updateDocument).not.toHaveBeenCalled();
  });

  it('refuses a parent nested inside the document being moved', async () => {
    // docs_a > docs_section > docs_leaf: moving docs_a under docs_leaf would close a loop.
    const { documentService, runtime } = setup({
      docs_a: kbDoc,
      docs_leaf: {
        fileType: 'custom/document',
        id: 'docs_leaf',
        knowledgeBaseId: 'kb_1',
        parentId: 'docs_section',
      },
      docs_section: {
        fileType: 'custom/folder',
        id: 'docs_section',
        knowledgeBaseId: 'kb_1',
        parentId: 'docs_a',
      },
    });

    const result = await runtime.updateDocument({ documentId: 'docs_a', parentId: 'docs_leaf' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('is inside document "docs_a"');
    expect(documentService.updateDocument).not.toHaveBeenCalled();
  });

  it('moves under a nested folder whose ancestors do not include the document', async () => {
    const { documentService, runtime } = setup({
      docs_a: kbDoc,
      docs_child: {
        fileType: 'custom/folder',
        id: 'docs_child',
        knowledgeBaseId: 'kb_1',
        parentId: 'docs_top',
      },
      docs_top: { fileType: 'custom/folder', id: 'docs_top', knowledgeBaseId: 'kb_1' },
    });

    const result = await runtime.updateDocument({ documentId: 'docs_a', parentId: 'docs_child' });

    expect(result.success).toBe(true);
    expect(documentService.updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'docs_a', parentId: 'docs_child' }),
    );
  });

  it('refuses the move when the ancestor chain already loops', async () => {
    const { documentService, runtime } = setup({
      docs_a: kbDoc,
      docs_x: {
        fileType: 'custom/folder',
        id: 'docs_x',
        knowledgeBaseId: 'kb_1',
        parentId: 'docs_y',
      },
      docs_y: {
        fileType: 'custom/folder',
        id: 'docs_y',
        knowledgeBaseId: 'kb_1',
        parentId: 'docs_x',
      },
    });

    const result = await runtime.updateDocument({ documentId: 'docs_a', parentId: 'docs_x' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('nesting is too deep');
    expect(documentService.updateDocument).not.toHaveBeenCalled();
  });

  it('reports a missing document service', async () => {
    const runtime = new KnowledgeBaseExecutionRuntime({
      getFileContents: vi.fn(),
      semanticSearchForChat: vi.fn(),
    });

    const result = await runtime.updateDocument({ documentId: 'docs_a', title: 'x' });

    expect(result).toEqual({ content: 'Document service is not available.', success: false });
  });

  it('surfaces errors thrown by the write', async () => {
    const { documentService, runtime } = setup();
    documentService.updateDocument.mockRejectedValueOnce(
      new Error('Document is being edited by another user'),
    );

    const result = await runtime.updateDocument({ content: 'x', documentId: 'docs_a' });

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      'Error updating document: Document is being edited by another user',
    );
  });
});
