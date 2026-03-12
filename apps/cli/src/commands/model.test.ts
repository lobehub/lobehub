import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerModelCommand } from './model';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    aiModel: {
      batchToggleAiModels: { mutate: vi.fn() },
      batchUpdateAiModels: { mutate: vi.fn() },
      clearModelsByProvider: { mutate: vi.fn() },
      clearRemoteModels: { mutate: vi.fn() },
      createAiModel: { mutate: vi.fn() },
      getAiModelById: { query: vi.fn() },
      getAiProviderModelList: { query: vi.fn() },
      removeAiModel: { mutate: vi.fn() },
      toggleModelEnabled: { mutate: vi.fn() },
      updateAiModel: { mutate: vi.fn() },
      updateAiModelOrder: { mutate: vi.fn() },
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

    it('should output JSON', async () => {
      const models = [{ displayName: 'GPT-4', id: 'gpt-4' }];
      mockTrpcClient.aiModel.getAiProviderModelList.query.mockResolvedValue(models);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'model', 'list', 'openai', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(models, null, 2));
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

  describe('create', () => {
    it('should create a model', async () => {
      mockTrpcClient.aiModel.createAiModel.mutate.mockResolvedValue('test-model');

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'model',
        'create',
        '--id',
        'test-model',
        '--provider',
        'openai',
        '--display-name',
        'Test Model',
        '--type',
        'chat',
      ]);

      expect(mockTrpcClient.aiModel.createAiModel.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-model',
          providerId: 'openai',
          displayName: 'Test Model',
          type: 'chat',
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Created model'));
    });
  });

  describe('edit', () => {
    it('should update model display name', async () => {
      mockTrpcClient.aiModel.updateAiModel.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'model',
        'edit',
        'gpt-4',
        '--provider',
        'openai',
        '--display-name',
        'New Name',
      ]);

      expect(mockTrpcClient.aiModel.updateAiModel.mutate).toHaveBeenCalledWith({
        id: 'gpt-4',
        providerId: 'openai',
        value: expect.objectContaining({ displayName: 'New Name' }),
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Updated model'));
    });

    it('should error when no changes specified', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'model', 'edit', 'gpt-4', '--provider', 'openai']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No changes'));
      expect(exitSpy).toHaveBeenCalledWith(1);
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

    it('should error when no flag specified', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'model',
        'toggle',
        'gpt-4',
        '--provider',
        'openai',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('--enable or --disable'));
      expect(exitSpy).toHaveBeenCalledWith(1);
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

  describe('batch-toggle', () => {
    it('should batch enable models', async () => {
      mockTrpcClient.aiModel.batchToggleAiModels.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'model',
        'batch-toggle',
        'gpt-4',
        'gpt-3.5',
        '--provider',
        'openai',
        '--enable',
      ]);

      expect(mockTrpcClient.aiModel.batchToggleAiModels.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          id: 'openai',
          models: ['gpt-4', 'gpt-3.5'],
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('2 model(s)'));
    });

    it('should error when no flag specified', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'model',
        'batch-toggle',
        'gpt-4',
        '--provider',
        'openai',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('--enable or --disable'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('batch-update', () => {
    it('should batch update models', async () => {
      mockTrpcClient.aiModel.batchUpdateAiModels.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'model',
        'batch-update',
        'openai',
        '--models',
        '[{"id":"gpt-4","displayName":"GPT-4 Updated"}]',
      ]);

      expect(mockTrpcClient.aiModel.batchUpdateAiModels.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'openai',
          models: [{ id: 'gpt-4', displayName: 'GPT-4 Updated' }],
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Batch updated'));
    });

    it('should reject invalid JSON', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'model',
        'batch-update',
        'openai',
        '--models',
        'not-json',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Invalid models JSON'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('sort', () => {
    it('should update model sort order', async () => {
      mockTrpcClient.aiModel.updateAiModelOrder.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'model',
        'sort',
        'openai',
        '--sort-map',
        '[{"id":"gpt-4","sort":0},{"id":"gpt-3.5","sort":1}]',
      ]);

      expect(mockTrpcClient.aiModel.updateAiModelOrder.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'openai',
          sortMap: [
            { id: 'gpt-4', sort: 0 },
            { id: 'gpt-3.5', sort: 1 },
          ],
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Updated sort order'));
    });

    it('should reject invalid JSON', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'model', 'sort', 'openai', '--sort-map', '{bad}']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Invalid sort-map JSON'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('clear', () => {
    it('should clear all models for provider', async () => {
      mockTrpcClient.aiModel.clearModelsByProvider.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'model', 'clear', '--provider', 'openai', '--yes']);

      expect(mockTrpcClient.aiModel.clearModelsByProvider.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: 'openai' }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Cleared all models'));
    });

    it('should clear only remote models', async () => {
      mockTrpcClient.aiModel.clearRemoteModels.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'model',
        'clear',
        '--provider',
        'openai',
        '--remote',
        '--yes',
      ]);

      expect(mockTrpcClient.aiModel.clearRemoteModels.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: 'openai' }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('remote models'));
    });
  });
});
