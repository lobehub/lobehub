import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FormatUtils from '../utils/format';
import { log } from '../utils/logger';
import {
  buildCreateInput,
  deriveIdentifier,
  parseHeaders,
  registerConnectorCommand,
  resolveConnectorId,
} from './connector';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    connector: {
      create: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
      list: { query: vi.fn() },
      startOAuth: { mutate: vi.fn() },
      syncTools: { mutate: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

const { mockConfirm } = vi.hoisted(() => ({ mockConfirm: vi.fn() }));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
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
        JSON.stringify({ id: ID, identifier: 'deepwiki', isNew: true, toolCount: 3 }, null, 2),
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

  describe('sync', () => {
    it('resolves the identifier and syncs tools', async () => {
      mockTrpcClient.connector.list.query.mockResolvedValue([{ id: ID, identifier: 'deepwiki' }]);
      mockTrpcClient.connector.syncTools.mutate.mockResolvedValue({ toolCount: 3 });

      await run('sync', 'deepwiki', '--json');

      expect(mockTrpcClient.connector.syncTools.mutate).toHaveBeenCalledWith({ id: ID });
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ id: ID, toolCount: 3 }, null, 2));
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
