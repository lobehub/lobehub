/**
 * Characterization of every DeviceGateway method that relays one device RPC:
 * the RPC address (default timeout, channel, scope), the method name and
 * params, and what each method returns when the gateway is unconfigured, when
 * the device answers `success: false`, and when the transport throws.
 */
import type * as DeviceGatewayClientModule from '@lobechat/device-gateway-client';
import type { DeviceGitPullRequestAction } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeviceGateway } from '.';
import { configureGateway, mockClient, resetGatewayMocks } from './testUtils';

vi.mock('@/server/services/redis/client', () =>
  import('./testUtils').then((m) => ({ getRedisServiceClient: m.getRedisServiceClient })),
);

vi.mock('@/envs/gateway', () => import('./testUtils').then((m) => ({ gatewayEnv: m.mockEnv })));

vi.mock('@lobechat/device-gateway-client', async (importOriginal) => ({
  ...(await importOriginal<typeof DeviceGatewayClientModule>()),
  GatewayHttpClient: (await import('./testUtils')).MockGatewayHttpClient,
}));

const base = { deviceId: 'device-1', userId: 'user-1', workspaceId: 'ws-1' };
const address = (timeout: number, extra: Record<string, unknown> = {}) => ({
  ...extra,
  deviceId: 'device-1',
  timeout,
  userId: 'user-1',
  workspaceId: 'ws-1',
});
const DATA = { answered: true };
const NET_DOWN = 'net down';

/**
 * - `undefined`: every failure degrades to `undefined`.
 * - `errorResult`: failures come back as `{ error, success: false }`.
 * - `throws`: failures reject.
 */
type FailureMode =
  | { kind: 'undefined' }
  | { defaultError: string; kind: 'errorResult'; unconfigured: string }
  | { defaultError: string; kind: 'throws'; unconfigured: string };

interface RpcCase {
  address: Record<string, unknown>;
  call: (gateway: DeviceGateway) => Promise<unknown>;
  failure: FailureMode;
  name: string;
  payload: Record<string, unknown>;
  /** Expected result for a successful `{ data: DATA }` answer; defaults to `DATA`. */
  success?: unknown;
}

const UNDEFINED: FailureMode = { kind: 'undefined' };
const errorResult = (defaultError: string): FailureMode => ({
  defaultError,
  kind: 'errorResult',
  unconfigured: 'Device gateway not configured',
});
const fileThrow = (defaultError: string): FailureMode => ({
  defaultError,
  kind: 'throws',
  unconfigured: 'Device gateway not configured',
});
const terminalThrow = (method: string): FailureMode => ({
  defaultError: `${method} failed`,
  kind: 'throws',
  unconfigured: 'Device gateway is not configured on this deployment.',
});

const prAction = { type: 'ready' } as unknown as DeviceGitPullRequestAction;
const repo = { name: 'repo', owner: 'owner' };
const env = { TOKEN: 'x' };

const cases: RpcCase[] = [
  {
    address: address(30_000),
    call: (g) =>
      g.antigravityQuota({
        ...base,
        command: '/bin/agy',
        env: { AGY_PROFILE: 'test' },
        force: true,
      }),
    failure: UNDEFINED,
    name: 'antigravityQuota',
    payload: {
      method: 'getAntigravityQuota',
      params: { command: '/bin/agy', env: { AGY_PROFILE: 'test' }, force: true },
    },
  },
  // ─── git reads ───
  {
    address: address(15_000),
    call: (g) => g.gitBranch({ ...base, path: '/p' }),
    failure: UNDEFINED,
    name: 'gitBranch',
    payload: { method: 'getGitBranch', params: { path: '/p' } },
  },
  {
    address: address(15_000),
    call: (g) => g.gitLinkedPullRequest({ ...base, branch: 'b', path: '/p', pullRequestNumber: 3 }),
    failure: UNDEFINED,
    name: 'gitLinkedPullRequest',
    payload: {
      method: 'getLinkedPullRequest',
      params: { branch: 'b', path: '/p', pullRequestNumber: 3 },
    },
  },
  {
    address: address(20_000),
    call: (g) => g.gitPullRequestDetail({ ...base, coreOnly: true, number: 5, path: '/p' }),
    failure: UNDEFINED,
    name: 'gitPullRequestDetail',
    payload: { method: 'getPullRequestDetail', params: { coreOnly: true, number: 5, path: '/p' } },
  },
  {
    address: address(20_000),
    call: (g) => g.gitPullRequestActivity({ ...base, number: 5, path: '/p' }),
    failure: UNDEFINED,
    name: 'gitPullRequestActivity',
    payload: { method: 'getPullRequestActivity', params: { number: 5, path: '/p' } },
  },
  {
    address: address(20_000),
    call: (g) =>
      g.gitPullRequestMergeContext({
        ...base,
        baseRefName: 'main',
        headRefOid: 'abc',
        number: 5,
        path: '/p',
        repo,
      }),
    failure: UNDEFINED,
    name: 'gitPullRequestMergeContext',
    payload: {
      method: 'getPullRequestMergeContext',
      params: { baseRefName: 'main', headRefOid: 'abc', number: 5, path: '/p', repo },
    },
  },
  {
    address: address(15_000),
    call: (g) => g.gitWorkingTreeStatus({ ...base, path: '/p' }),
    failure: UNDEFINED,
    name: 'gitWorkingTreeStatus',
    payload: { method: 'getGitWorkingTreeStatus', params: { path: '/p' } },
  },
  {
    address: address(15_000),
    call: (g) => g.gitAheadBehind({ ...base, path: '/p' }),
    failure: UNDEFINED,
    name: 'gitAheadBehind',
    payload: { method: 'getGitAheadBehind', params: { path: '/p' } },
  },
  {
    address: address(15_000),
    call: (g) => g.listGitWorktrees({ ...base, path: '/p' }),
    failure: UNDEFINED,
    name: 'listGitWorktrees',
    payload: { method: 'listGitWorktrees', params: { path: '/p' } },
  },
  {
    address: address(15_000),
    call: (g) => g.listGitBranches({ ...base, path: '/p' }),
    failure: UNDEFINED,
    name: 'listGitBranches',
    payload: { method: 'listGitBranches', params: { path: '/p' } },
  },
  {
    address: address(15_000),
    call: (g) => g.listGitRemoteBranches({ ...base, path: '/p' }),
    failure: UNDEFINED,
    name: 'listGitRemoteBranches',
    payload: { method: 'listGitRemoteBranches', params: { path: '/p' } },
  },
  {
    address: address(30_000),
    call: (g) => g.getGitWorkingTreePatches({ ...base, path: '/p' }),
    failure: UNDEFINED,
    name: 'getGitWorkingTreePatches',
    payload: { method: 'getGitWorkingTreePatches', params: { path: '/p' } },
  },
  {
    address: address(30_000),
    call: (g) => g.getGitBranchDiff({ ...base, baseRef: 'main', path: '/p' }),
    failure: UNDEFINED,
    name: 'getGitBranchDiff',
    payload: { method: 'getGitBranchDiff', params: { baseRef: 'main', path: '/p' } },
  },
  {
    address: address(15_000),
    call: (g) => g.getGitWorkingTreeFiles({ ...base, path: '/p' }),
    failure: UNDEFINED,
    name: 'getGitWorkingTreeFiles',
    payload: { method: 'getGitWorkingTreeFiles', params: { path: '/p' } },
  },
  // ─── git mutations ───
  {
    address: address(30_000),
    call: (g) => g.checkoutGitBranch({ ...base, branch: 'b', create: true, path: '/p' }),
    failure: errorResult('Checkout failed'),
    name: 'checkoutGitBranch',
    payload: { method: 'checkoutGitBranch', params: { branch: 'b', create: true, path: '/p' } },
  },
  {
    address: address(30_000),
    call: (g) => g.renameGitBranch({ ...base, from: 'a', path: '/p', to: 'b' }),
    failure: errorResult('Rename failed'),
    name: 'renameGitBranch',
    payload: { method: 'renameGitBranch', params: { from: 'a', path: '/p', to: 'b' } },
  },
  {
    address: address(30_000),
    call: (g) => g.deleteGitBranch({ ...base, branch: 'b', path: '/p' }),
    failure: errorResult('Delete failed'),
    name: 'deleteGitBranch',
    payload: { method: 'deleteGitBranch', params: { branch: 'b', path: '/p' } },
  },
  {
    address: address(30_000),
    call: (g) => g.removeGitWorktree({ ...base, path: '/p', worktreePath: '/w' }),
    failure: errorResult('Remove worktree failed'),
    name: 'removeGitWorktree',
    payload: { method: 'removeGitWorktree', params: { path: '/p', worktreePath: '/w' } },
  },
  {
    address: address(30_000),
    call: (g) => g.addGitWorktree({ ...base, branch: 'b', path: '/p', worktreePath: '/w' }),
    failure: errorResult('Add worktree failed'),
    name: 'addGitWorktree',
    payload: {
      method: 'addGitWorktree',
      params: { branch: 'b', path: '/p', worktreePath: '/w' },
    },
  },
  {
    address: address(65_000),
    call: (g) => g.pullGitBranch({ ...base, path: '/p' }),
    failure: errorResult('Pull failed'),
    name: 'pullGitBranch',
    payload: { method: 'pullGitBranch', params: { path: '/p' } },
  },
  {
    address: address(65_000),
    call: (g) => g.pushGitBranch({ ...base, path: '/p' }),
    failure: errorResult('Push failed'),
    name: 'pushGitBranch',
    payload: { method: 'pushGitBranch', params: { path: '/p' } },
  },
  {
    address: address(65_000),
    call: (g) => g.runGitPullRequestAction({ ...base, action: prAction, number: 5, path: '/p' }),
    failure: errorResult('Pull request action failed'),
    name: 'runGitPullRequestAction',
    payload: {
      method: 'runPullRequestAction',
      params: { action: prAction, number: 5, path: '/p' },
    },
  },
  {
    address: address(15_000),
    call: (g) => g.revertGitFile({ ...base, filePath: 'a.ts', path: '/p' }),
    failure: errorResult('Revert failed'),
    name: 'revertGitFile',
    payload: { method: 'revertGitFile', params: { filePath: 'a.ts', path: '/p' } },
  },
  // ─── agent CLIs ───
  {
    address: address(15_000),
    call: (g) => g.claudeCodeQuota({ ...base, env, force: true }),
    failure: UNDEFINED,
    name: 'claudeCodeQuota',
    payload: { method: 'getClaudeCodeQuota', params: { env, force: true } },
  },
  {
    address: address(15_000),
    call: (g) => g.codexQuota({ ...base, command: 'codex', env, force: true }),
    failure: UNDEFINED,
    name: 'codexQuota',
    payload: { method: 'getCodexQuota', params: { command: 'codex', env, force: true } },
  },
  {
    address: address(15_000),
    call: (g) => g.kimiCodeQuota({ ...base, env, force: true }),
    failure: UNDEFINED,
    name: 'kimiCodeQuota',
    payload: { method: 'getKimiCodeQuota', params: { env, force: true } },
  },
  // ─── workspace ───
  {
    address: address(60_000),
    call: (g) =>
      g.prepareSkillDirectory({ ...base, forceRefresh: true, url: 'https://x', zipHash: 'h' }),
    failure: {
      defaultError: 'prepareSkillDirectory failed',
      kind: 'errorResult',
      unconfigured: 'Device Gateway is not configured',
    },
    name: 'prepareSkillDirectory',
    payload: {
      method: 'prepareSkillDirectory',
      params: { forceRefresh: true, url: 'https://x', zipHash: 'h' },
    },
  },
  {
    address: { deviceId: 'device-1', timeout: 30_000, userId: 'user-1' },
    call: (g) => g.enrollWorkspace({ ...base, identityOnly: true, token: 't' }),
    failure: {
      defaultError: 'enrollWorkspace failed',
      kind: 'errorResult',
      unconfigured: 'Device Gateway is not configured',
    },
    name: 'enrollWorkspace',
    payload: {
      method: 'enrollWorkspace',
      params: { identityOnly: true, token: 't', workspaceId: 'ws-1' },
    },
    success: { identity: DATA, success: true },
  },
  {
    address: address(10_000),
    call: (g) => g.unenrollWorkspace(base),
    failure: {
      defaultError: 'unenrollWorkspace failed',
      kind: 'errorResult',
      unconfigured: 'Device Gateway is not configured',
    },
    name: 'unenrollWorkspace',
    payload: { method: 'unenrollWorkspace', params: { workspaceId: 'ws-1' } },
    success: { success: true },
  },
  {
    address: address(8000),
    call: (g) => g.statPath({ ...base, path: '/p' }),
    failure: UNDEFINED,
    name: 'statPath',
    payload: { method: 'statPath', params: { path: '/p' } },
  },
  {
    address: address(10_000),
    call: (g) => g.listListeningPorts({ ...base, cwd: '/p' }),
    failure: UNDEFINED,
    name: 'listListeningPorts',
    payload: { method: 'listListeningPorts', params: { cwd: '/p' } },
  },
  // ─── project files (reads) ───
  {
    address: address(30_000),
    call: (g) => g.getProjectFileIndex({ ...base, scope: '/p' }),
    failure: UNDEFINED,
    name: 'getProjectFileIndex',
    payload: { method: 'getProjectFileIndex', params: { scope: '/p' } },
  },
  {
    address: address(30_000),
    call: (g) => g.listProjectDirectory({ ...base, relativePath: 'src', root: '/p' }),
    failure: UNDEFINED,
    name: 'listProjectDirectory',
    payload: { method: 'listProjectDirectory', params: { relativePath: 'src', root: '/p' } },
  },
  {
    address: address(10_000),
    call: (g) => g.browseDirectory({ ...base, cursor: 'c', limit: 10, path: '/p' }),
    failure: UNDEFINED,
    name: 'browseDirectory',
    payload: { method: 'browseDirectory', params: { cursor: 'c', limit: 10, path: '/p' } },
  },
  {
    address: address(30_000),
    call: (g) =>
      g.searchProjectFiles({
        ...base,
        changedOnly: true,
        excludeIgnored: true,
        limit: 5,
        query: 'q',
        scope: '/p',
      }),
    failure: UNDEFINED,
    name: 'searchProjectFiles',
    payload: {
      method: 'searchProjectFiles',
      params: { changedOnly: true, excludeIgnored: true, limit: 5, query: 'q', scope: '/p' },
    },
  },
  {
    address: address(30_000),
    call: (g) => g.listProjectSkills({ ...base, scope: '/p' }),
    failure: UNDEFINED,
    name: 'listProjectSkills',
    payload: { method: 'listProjectSkills', params: { scope: '/p' } },
  },
  {
    address: address(30_000),
    call: (g) => g.listClaudeCodeMemory({ ...base, scope: '/p' }),
    failure: UNDEFINED,
    name: 'listClaudeCodeMemory',
    payload: { method: 'listClaudeCodeMemory', params: { scope: '/p' } },
  },
  {
    address: address(30_000),
    call: (g) =>
      g.copyAssetForPublish({ ...base, from: '/x/a.png', to: '/p/a.png', workingDirectory: '/p' }),
    failure: errorResult('Failed to copy publish asset'),
    name: 'copyAssetForPublish',
    payload: {
      method: 'copyAssetForPublish',
      params: { from: '/x/a.png', to: '/p/a.png', workingDirectory: '/p' },
    },
  },
  {
    address: address(30_000),
    call: (g) =>
      g.readExternalAssetForPublish({ ...base, path: '/x/a.png', workingDirectory: '/p' }),
    failure: errorResult('Failed to read external publish asset'),
    name: 'readExternalAssetForPublish',
    payload: {
      method: 'readExternalAssetForPublish',
      params: { path: '/x/a.png', workingDirectory: '/p' },
    },
  },
  // ─── project files (mutations) ───
  {
    address: address(30_000),
    call: (g) =>
      g.moveProjectFiles({
        ...base,
        items: [{ newPath: '/p/b.ts', oldPath: '/p/a.ts' }],
        workingDirectory: '/p',
      }),
    failure: fileThrow('Move failed'),
    name: 'moveProjectFiles',
    payload: {
      method: 'moveLocalFiles',
      params: { items: [{ newPath: '/p/b.ts', oldPath: '/p/a.ts' }], workspaceRoot: '/p' },
    },
  },
  {
    address: address(30_000),
    call: (g) =>
      g.renameProjectFile({ ...base, newName: 'b.ts', path: '/p/a.ts', workingDirectory: '/p' }),
    failure: fileThrow('Rename failed'),
    name: 'renameProjectFile',
    payload: {
      method: 'renameLocalFile',
      params: { newName: 'b.ts', path: '/p/a.ts', workspaceRoot: '/p' },
    },
  },
  {
    address: address(30_000),
    call: (g) =>
      g.writeProjectFile({ ...base, content: 'x', path: '/p/a.ts', workingDirectory: '/p' }),
    failure: fileThrow('Write failed'),
    name: 'writeProjectFile',
    payload: {
      method: 'writeLocalFile',
      params: { content: 'x', path: '/p/a.ts', workspaceRoot: '/p' },
    },
  },
  {
    address: address(30_000),
    call: (g) =>
      g.createProjectFile({ ...base, content: 'x', path: '/p/a.ts', workingDirectory: '/p' }),
    failure: fileThrow('Create file failed'),
    name: 'createProjectFile',
    payload: {
      method: 'createLocalFile',
      params: { content: 'x', path: '/p/a.ts', workspaceRoot: '/p' },
    },
  },
  {
    address: address(30_000),
    call: (g) => g.createProjectDirectory({ ...base, path: '/p/dir', workingDirectory: '/p' }),
    failure: fileThrow('Create folder failed'),
    name: 'createProjectDirectory',
    payload: { method: 'createLocalDirectory', params: { path: '/p/dir', workspaceRoot: '/p' } },
  },
  {
    address: address(30_000),
    call: (g) => g.createDirectory({ ...base, name: 'dir', parentPath: '/p' }),
    failure: fileThrow('Create folder failed'),
    name: 'createDirectory',
    payload: { method: 'createLocalDirectory', params: { path: '/p/dir', workspaceRoot: '/p' } },
  },
  {
    address: address(60_000),
    call: (g) =>
      g.copyProjectFiles({ ...base, items: [{ sourcePath: '/p/a.ts' }], workingDirectory: '/p' }),
    failure: fileThrow('Copy failed'),
    name: 'copyProjectFiles',
    payload: {
      method: 'copyLocalFiles',
      params: { items: [{ sourcePath: '/p/a.ts' }], workspaceRoot: '/p' },
    },
  },
  {
    address: address(30_000),
    call: (g) => g.trashProjectFiles({ ...base, paths: ['/p/a.ts'], workingDirectory: '/p' }),
    failure: fileThrow('Move to trash failed'),
    name: 'trashProjectFiles',
    payload: { method: 'trashLocalFiles', params: { paths: ['/p/a.ts'], workspaceRoot: '/p' } },
  },
  // ─── terminal ───
  {
    address: address(15_000, { channel: 'cli' }),
    call: (g) => g.createTerminalSession({ ...base, cols: 80, cwd: '/p', rows: 24 }),
    failure: terminalThrow('createTerminalSession'),
    name: 'createTerminalSession',
    payload: { method: 'createTerminalSession', params: { cols: 80, cwd: '/p', rows: 24 } },
  },
  {
    address: address(15_000, { channel: 'cli' }),
    call: (g) => g.writeTerminal({ ...base, data: 'ls', id: 't1' }),
    failure: terminalThrow('writeTerminal'),
    name: 'writeTerminal',
    payload: { method: 'writeTerminal', params: { data: 'ls', id: 't1' } },
    success: undefined,
  },
  {
    address: address(15_000, { channel: 'cli' }),
    call: (g) => g.readTerminal({ ...base, cursor: 0, id: 't1' }),
    failure: terminalThrow('readTerminal'),
    name: 'readTerminal',
    payload: { method: 'readTerminal', params: { cursor: 0, id: 't1' } },
  },
  {
    address: address(15_000, { channel: 'cli' }),
    call: (g) => g.resizeTerminal({ ...base, cols: 100, id: 't1', rows: 30 }),
    failure: terminalThrow('resizeTerminal'),
    name: 'resizeTerminal',
    payload: { method: 'resizeTerminal', params: { cols: 100, id: 't1', rows: 30 } },
    success: undefined,
  },
  {
    address: address(15_000, { channel: 'cli' }),
    call: (g) => g.closeTerminal({ ...base, id: 't1' }),
    failure: terminalThrow('closeTerminal'),
    name: 'closeTerminal',
    payload: { method: 'closeTerminal', params: { id: 't1' } },
  },
];

const expectFailure = async (
  promise: Promise<unknown>,
  failure: FailureMode,
  message: string | undefined,
) => {
  switch (failure.kind) {
    case 'undefined': {
      await expect(promise).resolves.toBeUndefined();
      break;
    }
    case 'errorResult': {
      await expect(promise).resolves.toEqual({ error: message, success: false });
      break;
    }
    case 'throws': {
      await expect(promise).rejects.toThrow(message);
      break;
    }
  }
};

describe('DeviceGateway RPC surface', () => {
  beforeEach(() => {
    resetGatewayMocks();
  });

  it.each(cases)('$name relays its RPC and unwraps the answer', async (c) => {
    configureGateway();
    mockClient.invokeRpc.mockResolvedValue({ data: DATA, success: true });

    const result = await c.call(new DeviceGateway());

    expect(mockClient.invokeRpc).toHaveBeenCalledTimes(1);
    expect(mockClient.invokeRpc).toHaveBeenCalledWith(c.address, c.payload);
    expect(result).toEqual('success' in c ? c.success : DATA);
  });

  it.each(cases)('$name without a configured gateway', async (c) => {
    const promise = c.call(new DeviceGateway());

    await expectFailure(
      promise,
      c.failure,
      c.failure.kind === 'undefined' ? undefined : c.failure.unconfigured,
    );
    expect(mockClient.invokeRpc).not.toHaveBeenCalled();
  });

  it.each(cases)('$name when the device answers success: false', async (c) => {
    configureGateway();
    mockClient.invokeRpc.mockResolvedValue({ success: false });

    await expectFailure(
      c.call(new DeviceGateway()),
      c.failure,
      c.failure.kind === 'undefined' ? undefined : c.failure.defaultError,
    );
  });

  it.each(cases)('$name when the transport throws', async (c) => {
    configureGateway();
    mockClient.invokeRpc.mockRejectedValue(new Error(NET_DOWN));

    await expectFailure(c.call(new DeviceGateway()), c.failure, NET_DOWN);
  });

  describe('listHeterogeneousAgentModels', () => {
    const call = (type: 'antigravity' | 'codex' = 'codex') =>
      new DeviceGateway().listHeterogeneousAgentModels({
        ...base,
        args: ['--x'],
        command: type === 'antigravity' ? 'agy' : 'codex',
        cwd: '/p',
        env,
        type,
      });

    it.each(['antigravity', 'codex'] as const)(
      'relays the %s catalog RPC with a 20s budget',
      async (type) => {
        configureGateway();
        mockClient.invokeRpc.mockResolvedValue({ data: DATA, success: true });

        await expect(call(type)).resolves.toEqual(DATA);
        expect(mockClient.invokeRpc).toHaveBeenCalledWith(address(20_000), {
          method: 'listHeterogeneousAgentModels',
          params: {
            args: ['--x'],
            command: type === 'antigravity' ? 'agy' : 'codex',
            cwd: '/p',
            env,
            type,
          },
        });
      },
    );

    it.each([
      ['unconfigured', undefined, 'device_unavailable', 'Device gateway is not configured'],
      ['an outdated client', 'Unknown device RPC method: x', 'unsupported_client', undefined],
      [
        'a client without discovery',
        'does not support heterogeneous agent model discovery',
        'unsupported_client',
        undefined,
      ],
      ['a device error', 'boom', 'device_unavailable', undefined],
      ['a silent failure', '', 'device_unavailable', 'The device did not return a model catalog'],
    ])('reports %s', async (_label, error, code, message) => {
      if (error !== undefined) {
        configureGateway();
        mockClient.invokeRpc.mockResolvedValue({ error, success: false });
      }

      await expect(call()).resolves.toEqual({
        error: { code, message: message ?? error },
        status: 'error',
        updatedAt: expect.any(Number),
      });
    });

    it('reports a transport failure as unavailable', async () => {
      configureGateway();
      mockClient.invokeRpc.mockRejectedValue(new Error(NET_DOWN));

      await expect(call()).resolves.toEqual({
        error: { code: 'device_unavailable', message: NET_DOWN },
        status: 'error',
        updatedAt: expect.any(Number),
      });
    });
  });

  describe('dispatchAgentRun', () => {
    const params = {
      agentType: 'codex' as const,
      assistantMessageId: 'msg-1',
      jwt: 'jwt',
      operationId: 'op-1',
      prompt: 'hi',
      topicId: 'topic-1',
      userId: 'user-1',
    };

    it('passes the run straight to the gateway client', async () => {
      configureGateway();
      mockClient.dispatchAgentRun.mockResolvedValue({ success: true });

      await expect(new DeviceGateway().dispatchAgentRun(params)).resolves.toEqual({
        success: true,
      });
      expect(mockClient.dispatchAgentRun).toHaveBeenCalledWith(params);
    });

    it('reports an unconfigured gateway', async () => {
      await expect(new DeviceGateway().dispatchAgentRun(params)).resolves.toEqual({
        error: 'GATEWAY_NOT_CONFIGURED',
        success: false,
      });
    });

    it('reports a transport failure', async () => {
      configureGateway();
      mockClient.dispatchAgentRun.mockRejectedValue(new Error(NET_DOWN));

      await expect(new DeviceGateway().dispatchAgentRun(params)).resolves.toEqual({
        error: NET_DOWN,
        success: false,
      });
    });
  });
});
