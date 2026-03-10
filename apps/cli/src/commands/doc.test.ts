import fs from 'node:fs';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock TRPC client — use vi.hoisted so the variable is available in vi.mock factories
const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    document: {
      createDocument: { mutate: vi.fn() },
      createDocuments: { mutate: vi.fn() },
      deleteDocument: { mutate: vi.fn() },
      deleteDocuments: { mutate: vi.fn() },
      getDocumentById: { query: vi.fn() },
      parseDocument: { mutate: vi.fn() },
      parseFileContent: { mutate: vi.fn() },
      queryDocuments: { query: vi.fn() },
      updateDocument: { mutate: vi.fn() },
    },
    notebook: {
      createDocument: { mutate: vi.fn() },
      listDocuments: { query: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../api/client', () => ({
  getTrpcClient: mockGetTrpcClient,
}));

vi.mock('../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  setVerbose: vi.fn(),
}));

// eslint-disable-next-line import-x/first
import { log } from '../utils/logger';
// eslint-disable-next-line import-x/first
import { registerDocCommand } from './doc';

describe('doc command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  function resetMocks(obj: Record<string, any>) {
    for (const val of Object.values(obj)) {
      if (typeof val === 'object' && val !== null) {
        if (typeof val.mockReset === 'function') {
          val.mockReset();
        } else {
          resetMocks(val);
        }
      }
    }
  }

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    resetMocks(mockTrpcClient);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerDocCommand(program);
    return program;
  }

  // ── list ──────────────────────────────────────────────

  describe('list', () => {
    it('should display documents in table format', async () => {
      mockTrpcClient.document.queryDocuments.query.mockResolvedValue([
        {
          fileType: 'md',
          id: 'doc1',
          title: 'Meeting Notes',
          updatedAt: new Date().toISOString(),
        },
        { fileType: 'md', id: 'doc2', title: 'API Design', updatedAt: new Date().toISOString() },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'list']);

      expect(mockTrpcClient.document.queryDocuments.query).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 30 }),
      );
      // Header + 2 rows
      expect(consoleSpy).toHaveBeenCalledTimes(3);
      expect(consoleSpy.mock.calls[0][0]).toContain('ID');
      expect(consoleSpy.mock.calls[0][0]).toContain('TITLE');
    });

    it('should output JSON when --json flag is used', async () => {
      const docs = [{ fileType: 'md', id: 'doc1', title: 'Test' }];
      mockTrpcClient.document.queryDocuments.query.mockResolvedValue(docs);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'list', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(docs, null, 2));
    });

    it('should output JSON with selected fields', async () => {
      const docs = [{ fileType: 'md', id: 'doc1', title: 'Test' }];
      mockTrpcClient.document.queryDocuments.query.mockResolvedValue(docs);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'list', '--json', 'id,title']);

      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output).toEqual([{ id: 'doc1', title: 'Test' }]);
    });

    it('should filter by file type', async () => {
      mockTrpcClient.document.queryDocuments.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'list', '--file-type', 'md']);

      expect(mockTrpcClient.document.queryDocuments.query).toHaveBeenCalledWith(
        expect.objectContaining({ fileTypes: ['md'] }),
      );
    });

    it('should filter by source type', async () => {
      mockTrpcClient.document.queryDocuments.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'list', '--source-type', 'topic']);

      expect(mockTrpcClient.document.queryDocuments.query).toHaveBeenCalledWith(
        expect.objectContaining({ sourceTypes: ['topic'] }),
      );
    });

    it('should show message when no documents found', async () => {
      mockTrpcClient.document.queryDocuments.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'list']);

      expect(consoleSpy).toHaveBeenCalledWith('No documents found.');
    });

    it('should respect --limit flag', async () => {
      mockTrpcClient.document.queryDocuments.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'list', '-L', '10']);

      expect(mockTrpcClient.document.queryDocuments.query).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 10 }),
      );
    });
  });

  // ── view ──────────────────────────────────────────────

  describe('view', () => {
    it('should display document content', async () => {
      mockTrpcClient.document.getDocumentById.query.mockResolvedValue({
        content: '# Hello World',
        fileType: 'md',
        id: 'doc1',
        title: 'Test Doc',
        updatedAt: new Date().toISOString(),
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'view', 'doc1']);

      expect(mockTrpcClient.document.getDocumentById.query).toHaveBeenCalledWith({ id: 'doc1' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test Doc'));
      expect(consoleSpy).toHaveBeenCalledWith('# Hello World');
    });

    it('should show knowledge base ID in meta', async () => {
      mockTrpcClient.document.getDocumentById.query.mockResolvedValue({
        content: 'test',
        fileType: 'md',
        id: 'doc1',
        knowledgeBaseId: 'kb_123',
        title: 'KB Doc',
        updatedAt: new Date().toISOString(),
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'view', 'doc1']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('KB: kb_123'));
    });

    it('should output JSON when --json flag is used', async () => {
      const doc = { content: 'test', id: 'doc1', title: 'Test' };
      mockTrpcClient.document.getDocumentById.query.mockResolvedValue(doc);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'view', 'doc1', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(doc, null, 2));
    });

    it('should exit with error when document not found', async () => {
      mockTrpcClient.document.getDocumentById.query.mockResolvedValue(null);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'view', 'nonexistent']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ── create ────────────────────────────────────────────

  describe('create', () => {
    it('should create a document with title and body', async () => {
      mockTrpcClient.document.createDocument.mutate.mockResolvedValue({ id: 'new-doc' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'doc',
        'create',
        '--title',
        'My Doc',
        '--body',
        'Hello',
      ]);

      expect(mockTrpcClient.document.createDocument.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Hello',
          title: 'My Doc',
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('new-doc'));
    });

    it('should read content from file with --body-file', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('file content');
      mockTrpcClient.document.createDocument.mutate.mockResolvedValue({ id: 'new-doc' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'doc',
        'create',
        '--title',
        'From File',
        '--body-file',
        './test.md',
      ]);

      expect(mockTrpcClient.document.createDocument.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'file content',
          title: 'From File',
        }),
      );

      vi.restoreAllMocks();
    });

    it('should support --parent and --slug flags', async () => {
      mockTrpcClient.document.createDocument.mutate.mockResolvedValue({ id: 'new-doc' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'doc',
        'create',
        '--title',
        'Child Doc',
        '--parent',
        'parent-id',
        '--slug',
        'child-doc',
      ]);

      expect(mockTrpcClient.document.createDocument.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'parent-id',
          slug: 'child-doc',
          title: 'Child Doc',
        }),
      );
    });

    it('should support --kb flag for knowledge base association', async () => {
      mockTrpcClient.document.createDocument.mutate.mockResolvedValue({ id: 'new-doc' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'doc',
        'create',
        '--title',
        'KB Doc',
        '--kb',
        'kb_123',
      ]);

      expect(mockTrpcClient.document.createDocument.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          knowledgeBaseId: 'kb_123',
          title: 'KB Doc',
        }),
      );
    });

    it('should support --file-type flag', async () => {
      mockTrpcClient.document.createDocument.mutate.mockResolvedValue({ id: 'new-doc' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'doc',
        'create',
        '--title',
        'Folder',
        '--file-type',
        'custom/folder',
      ]);

      expect(mockTrpcClient.document.createDocument.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          fileType: 'custom/folder',
          title: 'Folder',
        }),
      );
    });
  });

  // ── batch-create ───────────────────────────────────────

  describe('batch-create', () => {
    it('should batch create documents from JSON file', async () => {
      const docs = [
        { content: 'content1', title: 'Doc 1' },
        { content: 'content2', title: 'Doc 2' },
      ];
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(docs));
      mockTrpcClient.document.createDocuments.mutate.mockResolvedValue([
        { id: 'doc1', title: 'Doc 1' },
        { id: 'doc2', title: 'Doc 2' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'batch-create', 'docs.json']);

      expect(mockTrpcClient.document.createDocuments.mutate).toHaveBeenCalledWith({
        documents: expect.arrayContaining([
          expect.objectContaining({ content: 'content1', title: 'Doc 1' }),
          expect.objectContaining({ content: 'content2', title: 'Doc 2' }),
        ]),
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Created 2'));

      vi.restoreAllMocks();
    });

    it('should error when file not found', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'batch-create', 'missing.json']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);

      vi.restoreAllMocks();
    });

    it('should error when JSON is not an array', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('{"not": "array"}');

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'batch-create', 'bad.json']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('non-empty array'));
      expect(exitSpy).toHaveBeenCalledWith(1);

      vi.restoreAllMocks();
    });
  });

  // ── edit ──────────────────────────────────────────────

  describe('edit', () => {
    it('should update document title', async () => {
      mockTrpcClient.document.updateDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'edit', 'doc1', '--title', 'New Title']);

      expect(mockTrpcClient.document.updateDocument.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'doc1',
          title: 'New Title',
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Updated'));
    });

    it('should update document body', async () => {
      mockTrpcClient.document.updateDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'edit', 'doc1', '--body', 'new content']);

      expect(mockTrpcClient.document.updateDocument.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'new content',
          id: 'doc1',
        }),
      );
    });

    it('should update file type', async () => {
      mockTrpcClient.document.updateDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'doc',
        'edit',
        'doc1',
        '--file-type',
        'custom/folder',
      ]);

      expect(mockTrpcClient.document.updateDocument.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          fileType: 'custom/folder',
          id: 'doc1',
        }),
      );
    });

    it('should exit with error when no changes specified', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'edit', 'doc1']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No changes specified'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ── delete ────────────────────────────────────────────

  describe('delete', () => {
    it('should delete a single document with --yes', async () => {
      mockTrpcClient.document.deleteDocument.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'delete', 'doc1', '--yes']);

      expect(mockTrpcClient.document.deleteDocument.mutate).toHaveBeenCalledWith({ id: 'doc1' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Deleted'));
    });

    it('should delete multiple documents with --yes', async () => {
      mockTrpcClient.document.deleteDocuments.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'delete', 'doc1', 'doc2', '--yes']);

      expect(mockTrpcClient.document.deleteDocuments.mutate).toHaveBeenCalledWith({
        ids: ['doc1', 'doc2'],
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Deleted 2'));
    });
  });

  // ── parse ─────────────────────────────────────────────

  describe('parse', () => {
    it('should parse a file without pages by default', async () => {
      mockTrpcClient.document.parseDocument.mutate.mockResolvedValue({
        content: 'Parsed content',
        title: 'Parsed Doc',
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'parse', 'file_123']);

      expect(mockTrpcClient.document.parseDocument.mutate).toHaveBeenCalledWith({
        id: 'file_123',
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Parsed file'));
    });

    it('should use parseFileContent with --with-pages', async () => {
      mockTrpcClient.document.parseFileContent.mutate.mockResolvedValue({
        content: 'Parsed with pages',
        title: 'Paged Doc',
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'parse', 'file_123', '--with-pages']);

      expect(mockTrpcClient.document.parseFileContent.mutate).toHaveBeenCalledWith({
        id: 'file_123',
      });
    });

    it('should output JSON with --json flag', async () => {
      const result = { content: 'test', title: 'Doc' };
      mockTrpcClient.document.parseDocument.mutate.mockResolvedValue(result);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'parse', 'file_123', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
    });
  });

  // ── link-topic ────────────────────────────────────────

  describe('link-topic', () => {
    it('should link a document to a topic', async () => {
      mockTrpcClient.document.getDocumentById.query.mockResolvedValue({
        content: 'doc content',
        description: 'desc',
        id: 'doc1',
        title: 'My Doc',
      });
      mockTrpcClient.notebook.createDocument.mutate.mockResolvedValue({ id: 'new-doc' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'link-topic', 'doc1', 'topic_123']);

      expect(mockTrpcClient.notebook.createDocument.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'doc content',
          title: 'My Doc',
          topicId: 'topic_123',
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Linked'));
    });

    it('should error when document not found', async () => {
      mockTrpcClient.document.getDocumentById.query.mockResolvedValue(null);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'link-topic', 'bad-id', 'topic_123']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ── topic-docs ────────────────────────────────────────

  describe('topic-docs', () => {
    it('should list documents for a topic', async () => {
      mockTrpcClient.notebook.listDocuments.query.mockResolvedValue({
        data: [
          {
            fileType: 'markdown',
            id: 'doc1',
            title: 'Note 1',
            updatedAt: new Date().toISOString(),
          },
          { fileType: 'article', id: 'doc2', title: 'Note 2', updatedAt: new Date().toISOString() },
        ],
        total: 2,
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'topic-docs', 'topic_123']);

      expect(mockTrpcClient.notebook.listDocuments.query).toHaveBeenCalledWith(
        expect.objectContaining({ topicId: 'topic_123' }),
      );
      // Header + 2 rows
      expect(consoleSpy).toHaveBeenCalledTimes(3);
    });

    it('should filter by --type', async () => {
      mockTrpcClient.notebook.listDocuments.query.mockResolvedValue({ data: [], total: 0 });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'doc',
        'topic-docs',
        'topic_123',
        '--type',
        'article',
      ]);

      expect(mockTrpcClient.notebook.listDocuments.query).toHaveBeenCalledWith(
        expect.objectContaining({ topicId: 'topic_123', type: 'article' }),
      );
    });

    it('should output JSON with --json flag', async () => {
      const docs = [{ id: 'doc1', title: 'Note' }];
      mockTrpcClient.notebook.listDocuments.query.mockResolvedValue({ data: docs, total: 1 });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'topic-docs', 'topic_123', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(docs, null, 2));
    });

    it('should show message when no documents found', async () => {
      mockTrpcClient.notebook.listDocuments.query.mockResolvedValue({ data: [], total: 0 });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'doc', 'topic-docs', 'topic_123']);

      expect(consoleSpy).toHaveBeenCalledWith('No documents found for this topic.');
    });
  });
});
