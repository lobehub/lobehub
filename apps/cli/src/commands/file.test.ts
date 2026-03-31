import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerFileCommand } from './file';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    file: {
      checkFileHash: { mutate: vi.fn() },
      createFile: { mutate: vi.fn() },
      getFileItemById: { query: vi.fn() },
      getFiles: { query: vi.fn() },
      getKnowledgeItems: { query: vi.fn() },
      recentFiles: { query: vi.fn() },
      removeFile: { mutate: vi.fn() },
      removeFiles: { mutate: vi.fn() },
      updateFile: { mutate: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));

describe('file command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.file)) {
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
    registerFileCommand(program);
    return program;
  }

  describe('list', () => {
    it('should display files in table format', async () => {
      mockTrpcClient.file.getFiles.query.mockResolvedValue([
        {
          fileType: 'pdf',
          id: 'f1',
          name: 'doc.pdf',
          size: 2048,
          updatedAt: new Date().toISOString(),
        },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'file', 'list']);

      expect(consoleSpy).toHaveBeenCalledTimes(2); // header + 1 row
      expect(consoleSpy.mock.calls[0][0]).toContain('ID');
    });

    it('should output JSON when --json flag is used', async () => {
      const items = [{ id: 'f1', name: 'doc.pdf' }];
      mockTrpcClient.file.getFiles.query.mockResolvedValue(items);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'file', 'list', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(items, null, 2));
    });

    it('should show message when no files found', async () => {
      mockTrpcClient.file.getFiles.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'file', 'list']);

      expect(consoleSpy).toHaveBeenCalledWith('No files found.');
    });

    it('should filter by knowledge base ID', async () => {
      mockTrpcClient.file.getFiles.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'file', 'list', '--kb-id', 'kb1']);

      expect(mockTrpcClient.file.getFiles.query).toHaveBeenCalledWith(
        expect.objectContaining({ knowledgeBaseId: 'kb1' }),
      );
    });
  });

  describe('view', () => {
    it('should display file details', async () => {
      mockTrpcClient.file.getFileItemById.query.mockResolvedValue({
        fileType: 'pdf',
        id: 'f1',
        name: 'doc.pdf',
        size: 2048,
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'file', 'view', 'f1']);

      expect(mockTrpcClient.file.getFileItemById.query).toHaveBeenCalledWith({ id: 'f1' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('doc.pdf'));
    });

    it('should exit when not found', async () => {
      mockTrpcClient.file.getFileItemById.query.mockResolvedValue(null);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'file', 'view', 'nonexistent']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('delete', () => {
    it('should delete a single file with --yes', async () => {
      mockTrpcClient.file.removeFile.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'file', 'delete', 'f1', '--yes']);

      expect(mockTrpcClient.file.removeFile.mutate).toHaveBeenCalledWith({ id: 'f1' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Deleted'));
    });

    it('should delete multiple files with --yes', async () => {
      mockTrpcClient.file.removeFiles.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'file', 'delete', 'f1', 'f2', '--yes']);

      expect(mockTrpcClient.file.removeFiles.mutate).toHaveBeenCalledWith({ ids: ['f1', 'f2'] });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Deleted 2'));
    });
  });

  describe('upload', () => {
    it('should upload file by URL', async () => {
      mockTrpcClient.file.checkFileHash.mutate.mockResolvedValue({ isExist: false });
      mockTrpcClient.file.createFile.mutate.mockResolvedValue({
        id: 'f-new',
        url: 'https://cdn.example.com/f-new',
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'file',
        'upload',
        'https://example.com/doc.pdf',
        '--hash',
        'abc123',
        '--name',
        'doc.pdf',
      ]);

      expect(mockTrpcClient.file.checkFileHash.mutate).toHaveBeenCalledWith({ hash: 'abc123' });
      expect(mockTrpcClient.file.createFile.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://example.com/doc.pdf',
          name: 'doc.pdf',
          hash: 'abc123',
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('File created'));
    });

    it('should skip upload when hash exists', async () => {
      mockTrpcClient.file.checkFileHash.mutate.mockResolvedValue({ isExist: true });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'file',
        'upload',
        'https://example.com/doc.pdf',
        '--hash',
        'abc123',
      ]);

      expect(mockTrpcClient.file.createFile.mutate).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    });
  });

  describe('edit', () => {
    it('should update file parent', async () => {
      mockTrpcClient.file.updateFile.mutate.mockResolvedValue({ success: true });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'file', 'edit', 'f1', '--parent-id', 'folder1']);

      expect(mockTrpcClient.file.updateFile.mutate).toHaveBeenCalledWith({
        id: 'f1',
        parentId: 'folder1',
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Updated file'));
    });

    it('should error when no changes specified', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'file', 'edit', 'f1']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No changes'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('kb-items', () => {
    it('should list knowledge items for a file', async () => {
      mockTrpcClient.file.getKnowledgeItems.query.mockResolvedValue({
        items: [{ id: 'ki1', name: 'Item 1', type: 'chunk' }],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'file', 'kb-items', 'f1']);

      expect(mockTrpcClient.file.getKnowledgeItems.query).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: 'f1' }),
      );
      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    it('should show empty message', async () => {
      mockTrpcClient.file.getKnowledgeItems.query.mockResolvedValue({ items: [] });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'file', 'kb-items', 'f1']);

      expect(consoleSpy).toHaveBeenCalledWith('No knowledge items found.');
    });
  });

  describe('recent', () => {
    it('should list recent files', async () => {
      mockTrpcClient.file.recentFiles.query.mockResolvedValue([
        { fileType: 'pdf', id: 'f1', name: 'doc.pdf', updatedAt: new Date().toISOString() },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'file', 'recent']);

      expect(mockTrpcClient.file.recentFiles.query).toHaveBeenCalledWith({ limit: 10 });
      expect(consoleSpy).toHaveBeenCalledTimes(2); // header + 1 row
    });

    it('should show message when no recent files', async () => {
      mockTrpcClient.file.recentFiles.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'file', 'recent']);

      expect(consoleSpy).toHaveBeenCalledWith('No recent files.');
    });
  });
});
