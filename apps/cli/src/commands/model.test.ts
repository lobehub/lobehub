import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerModelCommand } from './model';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    aiModel: {
      getAiModelById: { query: vi.fn() },
      getAiProviderModelList: { query: vi.fn() },
      removeAiModel: { mutate: vi.fn() },
      toggleModelEnabled: { mutate: vi.fn() },
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

describe('model command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.aiModel)) {
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
    registerModelCommand(program);
    return program;
  }

  describe('list', () => {
    it('should list models for provider', async () => {
      mockTrpcClient.aiModel.getAiProviderModelList.query.mockResolvedValue([
        { displayName: 'GPT-4', enabled: true, id: 'gpt-4', type: 'chat' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'model', 'list', 'openai']);

      expect(mockTrpcClient.aiModel.getAiProviderModelList.query).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'openai' }),
      );
      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('view', () => {
    it('should display model details', async () => {
      mockTrpcClient.aiModel.getAiModelById.query.mockResolvedValue({
        displayName: 'GPT-4',
        enabled: true,
        id: 'gpt-4',
        providerId: 'openai',
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'model', 'view', 'gpt-4']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('GPT-4'));
    });

    it('should exit when not found', async () => {
      mockTrpcClient.aiModel.getAiModelById.query.mockResolvedValue(null);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'model', 'view', 'nonexistent']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });
  });

  describe('toggle', () => {
    it('should enable model', async () => {
      mockTrpcClient.aiModel.toggleModelEnabled.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'model',
        'toggle',
        'gpt-4',
        '--provider',
        'openai',
        '--enable',
      ]);

      expect(mockTrpcClient.aiModel.toggleModelEnabled.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, id: 'gpt-4' }),
      );
    });
  });

  describe('delete', () => {
    it('should delete model', async () => {
      mockTrpcClient.aiModel.removeAiModel.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'model',
        'delete',
        'gpt-4',
        '--provider',
        'openai',
        '--yes',
      ]);

      expect(mockTrpcClient.aiModel.removeAiModel.mutate).toHaveBeenCalledWith({
        id: 'gpt-4',
        providerId: 'openai',
      });
    });
  });
});
