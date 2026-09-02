import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketService } from '@/server/services/market';
import { type SandboxService } from '@/server/services/sandbox';

import { type ToolExecutionContext } from '../../types';
import { credsRuntime, writeEnvCredsToSandbox } from '../creds';

const { getMember } = vi.hoisted(() => ({
  getMember: vi.fn(),
}));

vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: vi.fn().mockImplementation(() => ({ getMember })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(),
}));

describe('credsRuntime', () => {
  const serverDB = {} as NonNullable<ToolExecutionContext['serverDB']>;

  beforeEach(() => {
    vi.clearAllMocks();
    getMember.mockResolvedValue({ role: 'member' });
  });

  it('signs verified workspace context into the Market trusted-client identity', async () => {
    await credsRuntime.factory({
      serverDB,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(getMember).toHaveBeenCalledWith('workspace-1', 'user-1');
    expect(MarketService).toHaveBeenCalledWith({
      userInfo: { userId: 'user-1', workspaceId: 'workspace-1' },
    });
  });

  it('rejects workspace context without an active membership', async () => {
    getMember.mockResolvedValue(undefined);

    await expect(
      credsRuntime.factory({
        serverDB,
        toolManifestMap: {},
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    ).rejects.toThrow('Workspace membership is required for workspace Creds execution');
    expect(MarketService).not.toHaveBeenCalled();
  });

  it('fails closed when workspace membership cannot be queried', async () => {
    await expect(
      credsRuntime.factory({
        toolManifestMap: {},
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    ).rejects.toThrow('serverDB is required for workspace Creds execution');
    expect(getMember).not.toHaveBeenCalled();
    expect(MarketService).not.toHaveBeenCalled();
  });

  it('keeps personal runtime identity outside a workspace', async () => {
    await credsRuntime.factory({
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(getMember).not.toHaveBeenCalled();
    expect(MarketService).toHaveBeenCalledWith({
      userInfo: { userId: 'user-1', workspaceId: undefined },
    });
  });

  it('rejects runtime creation without a user identity', async () => {
    await expect(credsRuntime.factory({ toolManifestMap: {} })).rejects.toThrow(
      'userId is required for Creds execution',
    );
  });
});

describe('writeEnvCredsToSandbox', () => {
  const buildSandboxService = (callTool = vi.fn()): SandboxService =>
    ({ callTool }) as unknown as SandboxService;

  /**
   * Reverses `shellQuote`'s escaping (`'a'\''b'` -> `a'b`) so tests can
   * round-trip a value through the two nested quoting layers instead of
   * hand-deriving the exact escaped string — hand-derivation is exactly
   * the kind of thing that's easy to get subtly wrong for values containing
   * their own quotes, which is the case that actually matters here.
   */
  const posixUnquote = (quoted: string): string => {
    if (!quoted.startsWith("'") || !quoted.endsWith("'")) {
      throw new Error(`Not a single-quoted shell literal: ${quoted}`);
    }
    return quoted.slice(1, -1).replaceAll("'\\''", "'");
  };

  /** Extracts the single printf argument from a one-entry writeEnvCredsToSandbox command. */
  const extractWrittenLine = (command: string): string => {
    const match = command.match(/printf '%s\\n' (.+)\) >> ~\/\.creds\/env$/);
    if (!match) throw new Error(`Could not find printf argument in command: ${command}`);
    return posixUnquote(match[1]);
  };

  /** Extracts and unquotes the value from an `export KEY=<quoted value>` line. */
  const extractExportedValue = (exportLine: string, key: string): string => {
    const prefix = `export ${key}=`;
    if (!exportLine.startsWith(prefix)) {
      throw new Error(`Expected an "${prefix}" line, got: ${exportLine}`);
    }
    return posixUnquote(exportLine.slice(prefix.length));
  };

  it('is a no-op and never calls the sandbox when there is nothing to write', async () => {
    const callTool = vi.fn();
    const result = await writeEnvCredsToSandbox(buildSandboxService(callTool), {});

    expect(callTool).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it('writes each entry into ~/.creds/env as an `export` assignment via a single runCommand call', async () => {
    const callTool = vi.fn().mockResolvedValue({ result: null, success: true });

    const result = await writeEnvCredsToSandbox(buildSandboxService(callTool), {
      DC_CLI_TOKEN: 'secret-token',
      DC_BASE_URL: 'https://dc.lobe.li',
    });

    expect(result).toEqual({ skippedInvalidNames: [] });
    expect(callTool).toHaveBeenCalledTimes(1);
    const [toolName, params] = callTool.mock.calls[0];
    expect(toolName).toBe('runCommand');
    expect(params.command).toContain('mkdir -p ~/.creds');
    expect(params.command).toContain('>> ~/.creds/env');
    // `export`, not a bare assignment — a bare NAME=value is a shell
    // variable invisible to any child process the sourcing shell spawns.
    expect(params.command).toContain("printf '%s\\n' 'export DC_CLI_TOKEN='\\''secret-token'\\'''");
    expect(params.command).toContain(
      "printf '%s\\n' 'export DC_BASE_URL='\\''https://dc.lobe.li'\\'''",
    );
  });

  it('round-trips a value containing shell metacharacters back to the exact original, proving `source` would load it as an inert literal', async () => {
    const callTool = vi.fn().mockResolvedValue({ result: null, success: true });
    const dangerousValue = '$(rm -rf ~); echo pwned `whoami` && exit 1 # trailing';

    await writeEnvCredsToSandbox(buildSandboxService(callTool), { TOKEN: dangerousValue });

    const command = callTool.mock.calls[0][1].command as string;
    const exportLine = extractWrittenLine(command);
    expect(exportLine.startsWith('export TOKEN=')).toBe(true);
    expect(extractExportedValue(exportLine, 'TOKEN')).toBe(dangerousValue);
  });

  it('round-trips a value that itself contains a single quote, through both nested quoting layers', async () => {
    const callTool = vi.fn().mockResolvedValue({ result: null, success: true });
    const trickyValue = "it's a 'quoted' secret";

    await writeEnvCredsToSandbox(buildSandboxService(callTool), { TOKEN: trickyValue });

    const command = callTool.mock.calls[0][1].command as string;
    const exportLine = extractWrittenLine(command);
    expect(extractExportedValue(exportLine, 'TOKEN')).toBe(trickyValue);
  });

  it('skips a credential key that is not a valid shell identifier and reports it, without touching the sandbox for it', async () => {
    const callTool = vi.fn().mockResolvedValue({ result: null, success: true });

    const result = await writeEnvCredsToSandbox(buildSandboxService(callTool), {
      'TEST-WORKSPACE-CREDS-KV': 'value-a',
      'VALID_KEY': 'value-b',
    });

    expect(result.skippedInvalidNames).toEqual(['TEST-WORKSPACE-CREDS-KV']);
    const command = callTool.mock.calls[0][1].command as string;
    expect(command).toContain('export VALID_KEY=');
    expect(command).not.toContain('TEST-WORKSPACE-CREDS-KV');
  });

  it('never calls the sandbox when every key is an invalid shell identifier', async () => {
    const callTool = vi.fn();

    const result = await writeEnvCredsToSandbox(buildSandboxService(callTool), {
      'bad key': 'value',
    });

    expect(callTool).not.toHaveBeenCalled();
    expect(result).toEqual({ skippedInvalidNames: ['bad key'] });
  });

  it('surfaces a descriptive error when the sandbox write fails', async () => {
    const callTool = vi.fn().mockResolvedValue({
      error: { message: 'sandbox unreachable' },
      result: null,
      success: false,
    });

    const result = await writeEnvCredsToSandbox(buildSandboxService(callTool), { KEY: 'value' });

    expect(result).toEqual({ error: 'sandbox unreachable', skippedInvalidNames: [] });
  });

  it('falls back to a generic error message when the sandbox failure carries none', async () => {
    const callTool = vi.fn().mockResolvedValue({ result: null, success: false });

    const result = await writeEnvCredsToSandbox(buildSandboxService(callTool), { KEY: 'value' });

    expect(result.error).toBe('Failed to write credentials into the sandbox');
  });
});
