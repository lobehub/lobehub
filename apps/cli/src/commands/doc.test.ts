import fs from 'node:fs';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock TRPC client — use vi.hoisted so the variable is available in vi.mock factories
const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    document: {
      createDocument: { mutate: vi.fn() },
      deleteDocument: { mutate: vi.fn() },
      deleteDocuments: { mutate: vi.fn() },
      getDocumentById: { query: vi.fn() },
      queryDocuments: { query: vi.fn() },
      updateDocument: { mutate: vi.fn() },
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

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    // Reset all document mock return values
    for (const method of Object.values(mockTrpcClient.document)) {
      for (const fn of Object.values(method)) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
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

      expect(mockTrpcClient.document.queryDocuments.query).toHaveBeenCalledWith({
        fileTypes: undefined,
        pageSize: 30,
      });
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

      expect(mockTrpcClient.document.queryDocuments.query).toHaveBeenCalledWith({
        fileTypes: ['md'],
        pageSize: 30,
      });
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

      expect(mockTrpcClient.document.queryDocuments.query).toHaveBeenCalledWith({
        fileTypes: undefined,
        pageSize: 10,
      });
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
      // Title, meta, blank line, content = 4 calls
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test Doc'));
      expect(consoleSpy).toHaveBeenCalledWith('# Hello World');
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
});
