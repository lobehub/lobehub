import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerPluginCommand } from './plugin';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    plugin: {
      createOrInstallPlugin: { mutate: vi.fn() },
      createPlugin: { mutate: vi.fn() },
      getPlugins: { query: vi.fn() },
      removePlugin: { mutate: vi.fn() },
      updatePlugin: { mutate: vi.fn() },
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

describe('plugin command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.plugin)) {
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
    registerPluginCommand(program);
    return program;
  }

  describe('list', () => {
    it('should list plugins', async () => {
      mockTrpcClient.plugin.getPlugins.query.mockResolvedValue([
        { id: 'p1', identifier: 'search', type: 'plugin' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'plugin', 'list']);

      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    it('should output JSON', async () => {
      const plugins = [{ id: 'p1', identifier: 'search' }];
      mockTrpcClient.plugin.getPlugins.query.mockResolvedValue(plugins);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'plugin', 'list', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(plugins, null, 2));
    });
  });

  describe('create', () => {
    it('should create a plugin', async () => {
      mockTrpcClient.plugin.createPlugin.mutate.mockResolvedValue({ identifier: 'my-plugin' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'plugin',
        'create',
        '-i',
        'my-plugin',
        '--manifest',
        '{"name":"test"}',
      ]);

      expect(mockTrpcClient.plugin.createPlugin.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'my-plugin',
          manifest: { name: 'test' },
          type: 'plugin',
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Created plugin'));
    });

    it('should reject invalid manifest JSON', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'plugin',
        'create',
        '-i',
        'my-plugin',
        '--manifest',
        'not-json',
      ]);

      expect(log.error).toHaveBeenCalledWith('Invalid manifest JSON.');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('install', () => {
    it('should install a plugin', async () => {
      mockTrpcClient.plugin.createOrInstallPlugin.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'plugin',
        'install',
        '-i',
        'my-plugin',
        '--manifest',
        '{"name":"test"}',
      ]);

      expect(mockTrpcClient.plugin.createOrInstallPlugin.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'my-plugin',
          manifest: { name: 'test' },
        }),
      );
    });

    it('should reject invalid manifest JSON', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'plugin',
        'install',
        '-i',
        'my-plugin',
        '--manifest',
        'not-json',
      ]);

      expect(log.error).toHaveBeenCalledWith('Invalid manifest JSON.');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('uninstall', () => {
    it('should uninstall with --yes', async () => {
      mockTrpcClient.plugin.removePlugin.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'plugin', 'uninstall', 'p1', '--yes']);

      expect(mockTrpcClient.plugin.removePlugin.mutate).toHaveBeenCalledWith({ id: 'p1' });
    });
  });

  describe('update', () => {
    it('should update plugin settings', async () => {
      mockTrpcClient.plugin.updatePlugin.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'plugin',
        'update',
        'p1',
        '--settings',
        '{"key":"value"}',
      ]);

      expect(mockTrpcClient.plugin.updatePlugin.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p1', settings: { key: 'value' } }),
      );
    });

    it('should exit when no changes', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'plugin', 'update', 'p1']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No changes'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
