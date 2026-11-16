import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerLegacyPluginCommand } from './plugin';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    market: {
      getMcpList: { query: vi.fn() },
    },
    plugin: {
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
describe('legacy-plugin command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of [
      ...Object.values(mockTrpcClient.plugin),
      ...Object.values(mockTrpcClient.market),
    ]) {
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
    registerLegacyPluginCommand(program);
    return program;
  }

  describe('command name', () => {
    it('should register legacy-plugin with a plugin alias and a legacy description', () => {
      const program = createProgram();
      const command = program.commands.find((c) => c.name() === 'legacy-plugin');

      expect(command).toBeDefined();
      expect(command!.aliases()).toEqual(['plugin']);
      expect(command!.description()).toBe(
        'Manage legacy 1.0 plugins (user_installed_plugins). Add new MCP servers with lh connector add',
      );
      expect(program.commands.some((c) => c.name() === 'plugin')).toBe(false);
    });

    it('should resolve legacy-plugin and its plugin alias to the same subcommands', async () => {
      const program = createProgram();
      const subcommands = (name: string) =>
        program.commands
          .find((c) => c.name() === name || c.aliases().includes(name))!
          .commands.map((c) => c.name());

      expect(subcommands('plugin')).toEqual(subcommands('legacy-plugin'));
      expect(subcommands('legacy-plugin')).toEqual(['list', 'search', 'uninstall', 'update']);

      mockTrpcClient.plugin.getPlugins.query.mockResolvedValue([
        { id: 'p1', identifier: 'search', type: 'plugin' },
      ]);
      await createProgram().parseAsync(['node', 'test', 'legacy-plugin', 'list', '--json']);
      await createProgram().parseAsync(['node', 'test', 'plugin', 'list', '--json']);

      expect(mockTrpcClient.plugin.getPlugins.query).toHaveBeenCalledTimes(2);
      expect(consoleSpy.mock.calls[1]).toEqual(consoleSpy.mock.calls[0]);
    });
  });

  describe('list', () => {
    it('should list plugins', async () => {
      mockTrpcClient.plugin.getPlugins.query.mockResolvedValue([
        { id: 'p1', identifier: 'search', type: 'plugin' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'legacy-plugin', 'list']);

      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    it('should output JSON', async () => {
      const plugins = [{ id: 'p1', identifier: 'search' }];
      mockTrpcClient.plugin.getPlugins.query.mockResolvedValue(plugins);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'legacy-plugin', 'list', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(plugins, null, 2));
    });
  });

  describe('search', () => {
    it('should query the MCP marketplace and mark installed plugins', async () => {
      mockTrpcClient.market.getMcpList.query.mockResolvedValue({
        items: [
          { description: 'Web search', identifier: 'tavily', name: 'Tavily' },
          { description: 'Repos', identifier: 'github', name: 'GitHub' },
        ],
        totalCount: 2,
      });
      mockTrpcClient.plugin.getPlugins.query.mockResolvedValue([{ identifier: 'github' }]);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'legacy-plugin',
        'search',
        'search',
        '--category',
        'web-search',
        '--limit',
        '5',
        '--json',
        'identifier,installed',
      ]);

      expect(mockTrpcClient.market.getMcpList.query).toHaveBeenCalledWith({
        category: 'web-search',
        pageSize: 5,
        q: 'search',
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        JSON.stringify(
          [
            { identifier: 'tavily', installed: false },
            { identifier: 'github', installed: true },
          ],
          null,
          2,
        ),
      );
    });

    it('should browse without a query', async () => {
      mockTrpcClient.market.getMcpList.query.mockResolvedValue({ items: [], totalCount: 0 });
      mockTrpcClient.plugin.getPlugins.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'legacy-plugin', 'search']);

      expect(mockTrpcClient.market.getMcpList.query).toHaveBeenCalledWith({
        category: undefined,
        pageSize: 20,
        q: undefined,
      });
      expect(consoleSpy).toHaveBeenCalledWith('No plugins found.');
    });
  });

  describe('uninstall', () => {
    it('should uninstall with --yes', async () => {
      mockTrpcClient.plugin.removePlugin.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'legacy-plugin', 'uninstall', 'p1', '--yes']);

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
        'legacy-plugin',
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
      await program.parseAsync(['node', 'test', 'legacy-plugin', 'update', 'p1']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No changes'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
