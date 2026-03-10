import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerProviderCommand } from './provider';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    aiProvider: {
      getAiProviderById: { query: vi.fn() },
      getAiProviderList: { query: vi.fn() },
      removeAiProvider: { mutate: vi.fn() },
      toggleProviderEnabled: { mutate: vi.fn() },
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
