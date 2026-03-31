import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerProviderCommand } from './provider';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    aiProvider: {
      checkProviderConnectivity: { mutate: vi.fn() },
      createAiProvider: { mutate: vi.fn() },
      getAiProviderById: { query: vi.fn() },
      getAiProviderList: { query: vi.fn() },
      removeAiProvider: { mutate: vi.fn() },
      toggleProviderEnabled: { mutate: vi.fn() },
      updateAiProvider: { mutate: vi.fn() },
      updateAiProviderConfig: { mutate: vi.fn() },
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

describe('provider command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.aiProvider)) {
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
    registerProviderCommand(program);
    return program;
  }

  describe('list', () => {
    it('should list providers', async () => {
      mockTrpcClient.aiProvider.getAiProviderList.query.mockResolvedValue([
        { enabled: true, id: 'openai', name: 'OpenAI' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'provider', 'list']);

      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    it('should output JSON', async () => {
      const providers = [{ id: 'openai', name: 'OpenAI' }];
      mockTrpcClient.aiProvider.getAiProviderList.query.mockResolvedValue(providers);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'provider', 'list', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(providers, null, 2));
    });
  });

  describe('view', () => {
    it('should display provider details', async () => {
      mockTrpcClient.aiProvider.getAiProviderById.query.mockResolvedValue({
        enabled: true,
        id: 'openai',
        name: 'OpenAI',
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'provider', 'view', 'openai']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('OpenAI'));
    });

    it('should exit when not found', async () => {
      mockTrpcClient.aiProvider.getAiProviderById.query.mockResolvedValue(null);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'provider', 'view', 'nonexistent']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('should exit when empty object returned', async () => {
      mockTrpcClient.aiProvider.getAiProviderById.query.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'provider', 'view', 'nonexistent']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });
  });

  describe('create', () => {
    it('should create a provider', async () => {
      mockTrpcClient.aiProvider.createAiProvider.mutate.mockResolvedValue('my-provider');

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'provider',
        'create',
        '--id',
        'my-provider',
        '-n',
        'My Provider',
        '-d',
        'Test desc',
        '--sdk-type',
        'openai',
      ]);

      expect(mockTrpcClient.aiProvider.createAiProvider.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'my-provider',
          name: 'My Provider',
          description: 'Test desc',
          sdkType: 'openai',
          source: 'custom',
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Created provider'));
    });
  });

  describe('edit', () => {
    it('should update provider name', async () => {
      mockTrpcClient.aiProvider.updateAiProvider.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'provider', 'edit', 'openai', '-n', 'New Name']);

      expect(mockTrpcClient.aiProvider.updateAiProvider.mutate).toHaveBeenCalledWith({
        id: 'openai',
        value: expect.objectContaining({ name: 'New Name' }),
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Updated provider'));
    });

    it('should error when no changes specified', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'provider', 'edit', 'openai']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No changes'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('config', () => {
    it('should set api key and base url', async () => {
      mockTrpcClient.aiProvider.updateAiProviderConfig.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'provider',
        'config',
        'openai',
        '--api-key',
        'sk-test',
        '--base-url',
        'https://api.test.com/v1',
      ]);

      expect(mockTrpcClient.aiProvider.updateAiProviderConfig.mutate).toHaveBeenCalledWith({
        id: 'openai',
        value: expect.objectContaining({
          keyVaults: { apiKey: 'sk-test', baseURL: 'https://api.test.com/v1' },
        }),
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Updated config'));
    });

    it('should enable response api', async () => {
      mockTrpcClient.aiProvider.updateAiProviderConfig.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'provider',
        'config',
        'openai',
        '--enable-response-api',
      ]);

      expect(mockTrpcClient.aiProvider.updateAiProviderConfig.mutate).toHaveBeenCalledWith({
        id: 'openai',
        value: expect.objectContaining({
          config: { enableResponseApi: true },
        }),
      });
    });

    it('should show current config', async () => {
      mockTrpcClient.aiProvider.getAiProviderById.query.mockResolvedValue({
        checkModel: 'gpt-4o',
        fetchOnClient: true,
        id: 'openai',
        keyVaults: { apiKey: 'sk-test12345678', baseURL: 'https://api.test.com/v1' },
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'provider', 'config', 'openai', '--show']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Config for openai'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('gpt-4o'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('https://api.test.com/v1'));
    });

    it('should error when no config specified', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'provider', 'config', 'openai']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No config specified'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('test', () => {
    it('should show success when provider is reachable', async () => {
      mockTrpcClient.aiProvider.checkProviderConnectivity.mutate.mockResolvedValue({
        model: 'gpt-4o',
        ok: true,
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'provider', 'test', 'openai', '--model', 'gpt-4o']);

      expect(mockTrpcClient.aiProvider.checkProviderConnectivity.mutate).toHaveBeenCalledWith({
        id: 'openai',
        model: 'gpt-4o',
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('reachable'));
    });

    it('should show failure and exit 1', async () => {
      mockTrpcClient.aiProvider.checkProviderConnectivity.mutate.mockResolvedValue({
        error: 'InvalidProviderAPIKey',
        model: 'gpt-4o',
        ok: false,
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'provider', 'test', 'openai', '--model', 'gpt-4o']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('check failed'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('InvalidProviderAPIKey'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should output JSON', async () => {
      const result = { model: 'gpt-4o', ok: true };
      mockTrpcClient.aiProvider.checkProviderConnectivity.mutate.mockResolvedValue(result);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'provider',
        'test',
        'openai',
        '--model',
        'gpt-4o',
        '--json',
      ]);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
    });
  });

  describe('toggle', () => {
    it('should enable provider', async () => {
      mockTrpcClient.aiProvider.toggleProviderEnabled.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'provider', 'toggle', 'openai', '--enable']);

      expect(mockTrpcClient.aiProvider.toggleProviderEnabled.mutate).toHaveBeenCalledWith({
        enabled: true,
        id: 'openai',
      });
    });

    it('should error when no flag specified', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'provider', 'toggle', 'openai']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('--enable or --disable'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('delete', () => {
    it('should delete provider', async () => {
      mockTrpcClient.aiProvider.removeAiProvider.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'provider', 'delete', 'openai', '--yes']);

      expect(mockTrpcClient.aiProvider.removeAiProvider.mutate).toHaveBeenCalledWith({
        id: 'openai',
      });
    });
  });
});
