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

  it('is a no-op and never calls the sandbox when there is nothing to write', async () => {
    const callTool = vi.fn();
    const result = await writeEnvCredsToSandbox(buildSandboxService(callTool), {});

    expect(callTool).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it('writes each entry into ~/.creds/env via a single runCommand call', async () => {
    const callTool = vi.fn().mockResolvedValue({ result: null, success: true });

    const result = await writeEnvCredsToSandbox(buildSandboxService(callTool), {
      DC_CLI_TOKEN: 'secret-token',
      DC_BASE_URL: 'https://dc.lobe.li',
    });

    expect(result).toEqual({});
    expect(callTool).toHaveBeenCalledTimes(1);
    const [toolName, params] = callTool.mock.calls[0];
    expect(toolName).toBe('runCommand');
    expect(params.command).toContain('mkdir -p ~/.creds');
    expect(params.command).toContain('>> ~/.creds/env');
    expect(params.command).toContain("printf '%s=%s\\n' 'DC_CLI_TOKEN' 'secret-token'");
    expect(params.command).toContain("printf '%s=%s\\n' 'DC_BASE_URL' 'https://dc.lobe.li'");
  });

  it('single-quotes a value that itself contains a single quote, without breaking the command', async () => {
    const callTool = vi.fn().mockResolvedValue({ result: null, success: true });

    await writeEnvCredsToSandbox(buildSandboxService(callTool), { TOKEN: "it's-a-secret" });

    const command = callTool.mock.calls[0][1].command as string;
    // Standard POSIX single-quote escaping: close, escaped quote, reopen.
    expect(command).toContain("'it'\\''s-a-secret'");
  });

  it('surfaces a descriptive error when the sandbox write fails', async () => {
    const callTool = vi.fn().mockResolvedValue({
      error: { message: 'sandbox unreachable' },
      result: null,
      success: false,
    });

    const result = await writeEnvCredsToSandbox(buildSandboxService(callTool), { KEY: 'value' });

    expect(result).toEqual({ error: 'sandbox unreachable' });
  });

  it('falls back to a generic error message when the sandbox failure carries none', async () => {
    const callTool = vi.fn().mockResolvedValue({ result: null, success: false });

    const result = await writeEnvCredsToSandbox(buildSandboxService(callTool), { KEY: 'value' });

    expect(result.error).toBe('Failed to write credentials into the sandbox');
  });
});
