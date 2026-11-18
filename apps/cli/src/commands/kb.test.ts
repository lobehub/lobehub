import { LobeHubAPIError } from '@lobehub/sdk';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerKbCommand } from './kb';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    file: {
      getFiles: { query: vi.fn() },
      getKnowledgeItems: { query: vi.fn() },
    },
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

const { mockSdk } = vi.hoisted(() => ({
  mockSdk: {
    knowledgeBases: {
      addFiles: vi.fn(),
      create: vi.fn(),
      removeFiles: vi.fn(),
      update: vi.fn(),
    },
  },
}));

/** The success envelope every REST answer arrives in, as the SDK returns it. */
const envelope = (data: unknown) => ({ data: { data, success: true } });

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../api/sdk', () => ({ getSdkClient: vi.fn(async () => mockSdk) }));
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
    for (const fn of Object.values(mockSdk.knowledgeBases)) fn.mockReset();
    // Default: file queries return empty
    mockTrpcClient.file.getFiles.query.mockResolvedValue([]);
    mockTrpcClient.file.getKnowledgeItems.query.mockResolvedValue({ hasMore: false, items: [] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
      vi.stubEnv('LOBEHUB_SERVER', 'https://app.lobehub.com');
      vi.stubEnv('LOBEHUB_WORKSPACE_ID', '');
      const items = [{ id: 'kb1', name: 'Test' }];
      mockTrpcClient.knowledgeBase.getKnowledgeBases.query.mockResolvedValue(items);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'kb', 'list', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(
        JSON.stringify(
          [{ ...items[0], url: 'https://app.lobehub.com/resource/library/kb1' }],
          null,
          2,
        ),
      );
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
      mockSdk.knowledgeBases.create.mockResolvedValue(
        envelope({ knowledgeBase: { id: 'kb-new', name: 'New KB' } }),
      );

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

      expect(mockSdk.knowledgeBases.create).toHaveBeenCalledWith({
        body: { description: 'Test desc', name: 'New KB' },
      });
      expect(mockTrpcClient.knowledgeBase.createKnowledgeBase.mutate).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('kb-new'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('/resource/library/kb-new'));
    });
  });

  describe('edit', () => {
    it('should update knowledge base', async () => {
      mockSdk.knowledgeBases.update.mockResolvedValue(envelope({ knowledgeBase: { id: 'kb1' } }));

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'kb', 'edit', 'kb1', '--name', 'Updated']);

      expect(mockSdk.knowledgeBases.update).toHaveBeenCalledWith({
        body: { name: 'Updated' },
        path: { id: 'kb1' },
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Updated knowledge base'));
    });

    it('should report a missing knowledge base instead of claiming success', async () => {
      mockSdk.knowledgeBases.update.mockRejectedValue(
        new LobeHubAPIError(404, { code: 'not_found', message: 'Knowledge base not found' }),
      );

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'kb', 'edit', 'kb-x', '--name', 'Updated']);

      expect(log.error).toHaveBeenCalledWith('Knowledge base not found: kb-x');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Updated knowledge base'),
      );
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
      mockSdk.knowledgeBases.addFiles.mockResolvedValue(
        envelope({ failed: [], successed: ['f1', 'f2'] }),
      );

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'kb', 'add-files', 'kb1', '--ids', 'f1', 'f2']);

      expect(mockSdk.knowledgeBases.addFiles).toHaveBeenCalledWith({
        body: { fileIds: ['f1', 'f2'] },
        path: { id: 'kb1' },
      });
      expect(mockTrpcClient.knowledgeBase.addFilesToKnowledgeBase.mutate).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Added 2 file(s)'));
    });

    it('should report files the API refused and exit non-zero', async () => {
      mockSdk.knowledgeBases.addFiles.mockResolvedValue(
        envelope({ failed: [{ fileId: 'f2', reason: 'not accessible' }], successed: ['f1'] }),
      );

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'kb', 'add-files', 'kb1', '--ids', 'f1', 'f2']);

      expect(log.error).toHaveBeenCalledWith('f2: not accessible');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('Added'));
    });

    it('should keep documents on tRPC, which resolves them to their mirror file', async () => {
      mockTrpcClient.knowledgeBase.addFilesToKnowledgeBase.mutate.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'kb', 'add-files', 'kb1', '--ids', 'docs_1', 'f1']);

      expect(mockTrpcClient.knowledgeBase.addFilesToKnowledgeBase.mutate).toHaveBeenCalledWith({
        ids: ['docs_1', 'f1'],
        knowledgeBaseId: 'kb1',
      });
      expect(mockSdk.knowledgeBases.addFiles).not.toHaveBeenCalled();
    });
  });

  describe('remove-files', () => {
    it('should remove files through the REST API', async () => {
      mockSdk.knowledgeBases.removeFiles.mockResolvedValue(
        envelope({ failed: [], successed: ['f1'] }),
      );

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'kb',
        'remove-files',
        'kb1',
        '--ids',
        'f1',
        '--yes',
      ]);

      expect(mockSdk.knowledgeBases.removeFiles).toHaveBeenCalledWith({
        body: { fileIds: ['f1'] },
        path: { id: 'kb1' },
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Removed 1 file(s)'));
    });

    it('should keep documents on tRPC', async () => {
      mockTrpcClient.knowledgeBase.removeFilesFromKnowledgeBase.mutate.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'kb',
        'remove-files',
        'kb1',
        '--ids',
        'docs_1',
        '--yes',
      ]);

      expect(mockTrpcClient.knowledgeBase.removeFilesFromKnowledgeBase.mutate).toHaveBeenCalledWith(
        { ids: ['docs_1'], knowledgeBaseId: 'kb1' },
      );
      expect(mockSdk.knowledgeBases.removeFiles).not.toHaveBeenCalled();
    });
  });
});
