import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerMemoryCommand } from './memory';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    userMemory: {
      createIdentity: { mutate: vi.fn() },
      deleteIdentity: { mutate: vi.fn() },
      getActivities: { query: vi.fn() },
      getContexts: { query: vi.fn() },
      getExperiences: { query: vi.fn() },
      getIdentities: { query: vi.fn() },
      getMemoryExtractionTask: { query: vi.fn() },
      getPersona: { query: vi.fn() },
      getPreferences: { query: vi.fn() },
      requestMemoryFromChatTopic: { mutate: vi.fn() },
      updateIdentity: { mutate: vi.fn() },
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

describe('memory command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.userMemory)) {
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
    registerMemoryCommand(program);
    return program;
  }

  describe('list', () => {
    it('should list all categories when no category specified', async () => {
      mockTrpcClient.userMemory.getIdentities.query.mockResolvedValue([
        { description: 'Dev', id: '1', type: 'professional' },
      ]);
      mockTrpcClient.userMemory.getActivities.query.mockResolvedValue([]);
      mockTrpcClient.userMemory.getContexts.query.mockResolvedValue([]);
      mockTrpcClient.userMemory.getExperiences.query.mockResolvedValue([]);
      mockTrpcClient.userMemory.getPreferences.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'memory', 'list']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Identity'));
    });

    it('should list specific category', async () => {
      mockTrpcClient.userMemory.getIdentities.query.mockResolvedValue([
        { description: 'Dev', id: '1', type: 'professional' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'memory', 'list', 'identity']);

      expect(mockTrpcClient.userMemory.getIdentities.query).toHaveBeenCalled();
    });

    it('should output JSON', async () => {
      const items = [{ id: '1', type: 'professional' }];
      mockTrpcClient.userMemory.getIdentities.query.mockResolvedValue(items);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'memory', 'list', 'identity', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(items, null, 2));
    });

    it('should reject invalid category', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'memory', 'list', 'invalid']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Invalid category'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('create', () => {
    it('should create an identity memory', async () => {
      mockTrpcClient.userMemory.createIdentity.mutate.mockResolvedValue({ id: 'mem-1' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'memory',
        'create',
        '--type',
        'professional',
        '--description',
        'Software dev',
      ]);

      expect(mockTrpcClient.userMemory.createIdentity.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Software dev', type: 'professional' }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('mem-1'));
    });
  });

  describe('edit', () => {
    it('should update an identity memory', async () => {
      mockTrpcClient.userMemory.updateIdentity.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'memory',
        'edit',
        'identity',
        'mem-1',
        '--description',
        'Updated desc',
      ]);

      expect(mockTrpcClient.userMemory.updateIdentity.mutate).toHaveBeenCalledWith({
        data: { description: 'Updated desc' },
        id: 'mem-1',
      });
    });
  });

  describe('delete', () => {
    it('should delete a memory with --yes', async () => {
      mockTrpcClient.userMemory.deleteIdentity.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'memory', 'delete', 'identity', 'mem-1', '--yes']);

      expect(mockTrpcClient.userMemory.deleteIdentity.mutate).toHaveBeenCalledWith({
        id: 'mem-1',
      });
    });
  });

  describe('persona', () => {
    it('should display persona', async () => {
      mockTrpcClient.userMemory.getPersona.query.mockResolvedValue('You are a developer.');

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'memory', 'persona']);

      expect(consoleSpy).toHaveBeenCalledWith('You are a developer.');
    });

    it('should output JSON', async () => {
      const persona = { summary: 'Developer' };
      mockTrpcClient.userMemory.getPersona.query.mockResolvedValue(persona);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'memory', 'persona', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(persona, null, 2));
    });
  });

  describe('extract', () => {
    it('should start memory extraction', async () => {
      mockTrpcClient.userMemory.requestMemoryFromChatTopic.mutate.mockResolvedValue({
        id: 'task-1',
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'memory', 'extract']);

      expect(mockTrpcClient.userMemory.requestMemoryFromChatTopic.mutate).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('extraction started'));
    });
  });

  describe('extract-status', () => {
    it('should show extraction task status', async () => {
      mockTrpcClient.userMemory.getMemoryExtractionTask.query.mockResolvedValue({
        id: 'task-1',
        status: 'completed',
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'memory', 'extract-status']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('task-1'));
    });
  });
});
