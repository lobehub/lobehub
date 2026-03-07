import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerKbCommand } from './kb';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    knowledgeBase: {
      addFilesToKnowledgeBase: { mutate: vi.fn() },
      createKnowledgeBase: { mutate: vi.fn() },
      getKnowledgeBaseById: { query: vi.fn() },
      getKnowledgeBases: { query: vi.fn() },
      removeFilesFromKnowledgeBase: { mutate: vi.fn() },
      removeKnowledgeBase: { mutate: vi.fn() },
      updateKnowledgeBase: { mutate: vi.fn() },
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

describe('kb command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    // Reset all mocks
    for (const router of Object.values(mockTrpcClient)) {
      for (const method of Object.values(router)) {
        for (const fn of Object.values(method)) {
          (fn as ReturnType<typeof vi.fn>).mockReset();
        }
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
    registerKbCommand(program);
    return program;
  }

  describe('list', () => {
    it('should display knowledge bases in table format', async () => {
      mockTrpcClient.knowledgeBase.getKnowledgeBases.query.mockResolvedValue([
        { description: 'My KB', id: 'kb1', name: 'Test KB', updatedAt: new Date().toISOString() },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'kb', 'list']);

      expect(consoleSpy).toHaveBeenCalledTimes(2); // header + 1 row
      expect(consoleSpy.mock.calls[0][0]).toContain('ID');
    });

    it('should output JSON when --json flag is used', async () => {
      const items = [{ id: 'kb1', name: 'Test' }];
      mockTrpcClient.knowledgeBase.getKnowledgeBases.query.mockResolvedValue(items);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'kb', 'list', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(items, null, 2));
    });

    it('should show message when no knowledge bases found', async () => {
      mockTrpcClient.knowledgeBase.getKnowledgeBases.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'kb', 'list']);

      expect(consoleSpy).toHaveBeenCalledWith('No knowledge bases found.');
    });
  });

  describe('view', () => {
    it('should display knowledge base details', async () => {
      mockTrpcClient.knowledgeBase.getKnowledgeBaseById.query.mockResolvedValue({
        description: 'A test KB',
        id: 'kb1',
        name: 'Test KB',
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'kb', 'view', 'kb1']);

      expect(mockTrpcClient.knowledgeBase.getKnowledgeBaseById.query).toHaveBeenCalledWith({
        id: 'kb1',
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test KB'));
    });

    it('should exit when not found', async () => {
      mockTrpcClient.knowledgeBase.getKnowledgeBaseById.query.mockResolvedValue(null);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'kb', 'view', 'nonexistent']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('create', () => {
    it('should create a knowledge base', async () => {
      mockTrpcClient.knowledgeBase.createKnowledgeBase.mutate.mockResolvedValue({ id: 'kb-new' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'kb',
        'create',
        '--name',
        'New KB',
        '--description',
        'Test desc',
      ]);

      expect(mockTrpcClient.knowledgeBase.createKnowledgeBase.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Test desc', name: 'New KB' }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('kb-new'));
    });
  });

  describe('edit', () => {
    it('should update knowledge base', async () => {
      mockTrpcClient.knowledgeBase.updateKnowledgeBase.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'kb', 'edit', 'kb1', '--name', 'Updated']);

      expect(mockTrpcClient.knowledgeBase.updateKnowledgeBase.mutate).toHaveBeenCalledWith({
        id: 'kb1',
        value: { name: 'Updated' },
      });
    });

    it('should exit when no changes specified', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'kb', 'edit', 'kb1']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No changes'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('delete', () => {
    it('should delete with --yes', async () => {
      mockTrpcClient.knowledgeBase.removeKnowledgeBase.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'kb', 'delete', 'kb1', '--yes']);

      expect(mockTrpcClient.knowledgeBase.removeKnowledgeBase.mutate).toHaveBeenCalledWith({
        id: 'kb1',
        removeFiles: undefined,
      });
    });

    it('should pass --remove-files flag', async () => {
      mockTrpcClient.knowledgeBase.removeKnowledgeBase.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'kb', 'delete', 'kb1', '--yes', '--remove-files']);

      expect(mockTrpcClient.knowledgeBase.removeKnowledgeBase.mutate).toHaveBeenCalledWith({
        id: 'kb1',
        removeFiles: true,
      });
    });
  });

  describe('add-files', () => {
    it('should add files to knowledge base', async () => {
      mockTrpcClient.knowledgeBase.addFilesToKnowledgeBase.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'kb', 'add-files', 'kb1', '--ids', 'f1', 'f2']);

      expect(mockTrpcClient.knowledgeBase.addFilesToKnowledgeBase.mutate).toHaveBeenCalledWith({
        ids: ['f1', 'f2'],
        knowledgeBaseId: 'kb1',
      });
    });
  });
});
