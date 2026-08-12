import {
  LocalSystemApiName,
  LocalSystemIdentifier,
  LocalSystemManifest,
} from '@lobechat/builtin-tool-local-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolExecutionContext } from '../../types';

// Mock deviceGateway
const mockExecuteToolCall = vi.fn();
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    executeToolCall: (...args: any[]) => mockExecuteToolCall(...args),
  },
}));

// Import after mock setup
const { localSystemRuntime } = await import('../localSystem');

describe('localSystemRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have the correct identifier', () => {
    expect(localSystemRuntime.identifier).toBe(LocalSystemIdentifier);
  });

  describe('factory', () => {
    it('should throw when userId is missing', () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        toolManifestMap: {},
      };

      expect(() => localSystemRuntime.factory(context)).toThrow(
        'userId is required for Local System device proxy execution',
      );
    });

    it('should throw when activeDeviceId is missing', () => {
      const context: ToolExecutionContext = {
        toolManifestMap: {},
        userId: 'user-1',
      };

      expect(() => localSystemRuntime.factory(context)).toThrow(
        'activeDeviceId is required for Local System device proxy execution',
      );
    });

    it('should create a proxy with a function for each API in LocalSystemManifest', () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        toolManifestMap: {},
        userId: 'user-1',
      };

      const proxy = localSystemRuntime.factory(context);

      for (const api of LocalSystemManifest.api) {
        expect(proxy[api.name]).toBeDefined();
        expect(typeof proxy[api.name]).toBe('function');
      }
    });

    it('should call deviceGateway.executeToolCall with correct arguments when a proxy function is invoked', async () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        operationId: 'op-1',
        toolManifestMap: {},
        userId: 'user-1',
      };

      const expectedResult = { content: 'ok', success: true };
      mockExecuteToolCall.mockResolvedValue(expectedResult);

      const proxy = localSystemRuntime.factory(context);
      const apiName = LocalSystemManifest.api[0].name;
      const args = { path: '/tmp/test' };

      const result = await proxy[apiName](args);

      expect(mockExecuteToolCall).toHaveBeenCalledWith(
        { deviceId: 'device-1', operationId: 'op-1', userId: 'user-1', workspaceId: undefined },
        {
          apiName,
          arguments: JSON.stringify(args),
          identifier: LocalSystemIdentifier,
        },
        undefined,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should JSON.stringify the arguments passed to the proxy function', async () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-2',
        toolManifestMap: {},
        userId: 'user-2',
      };

      mockExecuteToolCall.mockResolvedValue({ content: '', success: true });

      const proxy = localSystemRuntime.factory(context);
      const apiName = LocalSystemManifest.api[0].name;
      const complexArgs = { keywords: 'test', fileTypes: ['txt', 'md'], limit: 10 };

      await proxy[apiName](complexArgs);

      expect(mockExecuteToolCall).toHaveBeenCalledWith(
        { deviceId: 'device-2', userId: 'user-2', workspaceId: undefined },
        expect.objectContaining({
          arguments: JSON.stringify(complexArgs),
        }),
        undefined,
      );
    });

    it('should forward workspaceId so workspace-owned devices route to the correct gateway pool', async () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-ws',
        toolManifestMap: {},
        userId: 'user-1',
        workspaceId: 'ws-42',
      };

      mockExecuteToolCall.mockResolvedValue({ content: '', success: true });

      const proxy = localSystemRuntime.factory(context);
      const apiName = LocalSystemManifest.api[0].name;

      await proxy[apiName]({ path: '/tmp' });

      expect(mockExecuteToolCall).toHaveBeenCalledWith(
        { deviceId: 'device-ws', userId: 'user-1', workspaceId: 'ws-42' },
        expect.objectContaining({
          apiName,
          identifier: LocalSystemIdentifier,
        }),
        undefined,
      );
    });

    it('addresses a personal-scope active device via the personal pool even in a workspace run', async () => {
      // Workspace agent + per-user `local` override: the routed
      // device only has a connection under the personal principal, so the
      // workspace id must NOT be forwarded to the gateway call.
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-personal',
        activeDeviceScope: 'personal',
        toolManifestMap: {},
        userId: 'user-1',
        workspaceId: 'ws-42',
      };

      mockExecuteToolCall.mockResolvedValue({ content: '', success: true });

      const proxy = localSystemRuntime.factory(context);
      const apiName = LocalSystemManifest.api[0].name;

      await proxy[apiName]({ path: '/tmp' });

      expect(mockExecuteToolCall).toHaveBeenCalledWith(
        { deviceId: 'device-personal', userId: 'user-1', workspaceId: undefined },
        expect.objectContaining({
          apiName,
          identifier: LocalSystemIdentifier,
        }),
        undefined,
      );
    });

    it('recovers the workspace scope from the running agent when context.workspaceId is missing', async () => {
      // Minimal drizzle-like chain resolving the agent's workspace_id.
      const serverDB = {
        select: () => ({
          from: () => ({
            where: () => ({ limit: () => Promise.resolve([{ workspaceId: 'ws-1' }]) }),
          }),
        }),
      } as any;
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-ws',
        agentId: 'agt-1',
        serverDB,
        toolManifestMap: {},
        userId: 'user-1',
      };

      mockExecuteToolCall.mockResolvedValue({ content: '', success: true });

      const proxy = localSystemRuntime.factory(context);
      const apiName = LocalSystemManifest.api[0].name;

      await proxy[apiName]({ path: '/tmp' });

      // The follow-up filesystem call routes to the recovered workspace pool.
      expect(mockExecuteToolCall).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'device-ws', userId: 'user-1', workspaceId: 'ws-1' }),
        expect.objectContaining({ apiName, identifier: LocalSystemIdentifier }),
        undefined,
      );
    });
  });

  describe('working directory injection', () => {
    const parseArgs = () => JSON.parse(mockExecuteToolCall.mock.calls[0][1].arguments);

    const buildProxy = (workingDirectory?: string) => {
      mockExecuteToolCall.mockResolvedValue({ content: '', success: true });
      return localSystemRuntime.factory({
        activeDeviceId: 'device-1',
        toolManifestMap: {},
        userId: 'user-1',
        workingDirectory,
      });
    };

    it('injects cwd into runCommand when the model omits it', async () => {
      const proxy = buildProxy('/Users/me/repo');
      await proxy[LocalSystemApiName.runCommand]({ command: 'git status' });

      expect(parseArgs()).toEqual({ command: 'git status', cwd: '/Users/me/repo' });
    });

    it('forwards the sandbox decision to runCommand', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: '', success: true });
      const proxy = localSystemRuntime.factory({
        activeDeviceId: 'device-1',
        localSandbox: true,
        toolManifestMap: {},
        userId: 'user-1',
        workingDirectory: '/Users/me/repo',
      });
      await proxy[LocalSystemApiName.runCommand]({ command: 'git status' });

      expect(parseArgs()).toEqual({
        command: 'git status',
        cwd: '/Users/me/repo',
        sandbox: true,
        sandboxNetwork: false,
      });
    });

    it('never lets a model-supplied cwd become the fence root', async () => {
      // The sandbox policy is built from `params.cwd` on the device, so this
      // stripping is what stops a guessed or replayed `cwd` from choosing what
      // the command is fenced to. `cwd` is off-manifest for every api, but the
      // arg schema does not reject extra properties — pin the behaviour here so
      // relaxing the strip can never silently hand the model its own fence.
      mockExecuteToolCall.mockResolvedValue({ content: '', success: true });
      const proxy = localSystemRuntime.factory({
        activeDeviceId: 'device-1',
        localSandbox: true,
        toolManifestMap: {},
        userId: 'user-1',
        workingDirectory: '/Users/me/repo',
      });
      await proxy[LocalSystemApiName.runCommand]({
        command: 'cat ~/.ssh/id_rsa',
        cwd: '/Users/me',
      });

      expect(parseArgs().cwd).toBe('/Users/me/repo');
      expect(parseArgs().sandbox).toBe(true);
    });

    it('forwards the network allowance for a fenced run', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: '', success: true });
      const proxy = localSystemRuntime.factory({
        activeDeviceId: 'device-1',
        localSandbox: true,
        localSandboxNetwork: true,
        toolManifestMap: {},
        userId: 'user-1',
        workingDirectory: '/Users/me/repo',
      });
      await proxy[LocalSystemApiName.runCommand]({ command: 'npm install' });

      expect(parseArgs().sandboxNetwork).toBe(true);
    });

    it('omits the network flag when the run is not fenced', async () => {
      // `sandboxNetwork` is meaningless without a sandbox — don't add noise to
      // an unfenced command's args.
      mockExecuteToolCall.mockResolvedValue({ content: '', success: true });
      const proxy = localSystemRuntime.factory({
        activeDeviceId: 'device-1',
        localSandbox: false,
        localSandboxNetwork: true,
        toolManifestMap: {},
        userId: 'user-1',
        workingDirectory: '/Users/me/repo',
      });
      await proxy[LocalSystemApiName.runCommand]({ command: 'git status' });

      expect(parseArgs()).not.toHaveProperty('sandboxNetwork');
      expect(parseArgs().sandbox).toBe(false);
    });

    it('overrides a sandbox flag the model tried to set itself', async () => {
      // The manifest never exposes `sandbox`, but a model that guesses the field
      // must not be able to unfence its own commands — the run's context wins.
      mockExecuteToolCall.mockResolvedValue({ content: '', success: true });
      const proxy = localSystemRuntime.factory({
        activeDeviceId: 'device-1',
        localSandbox: true,
        toolManifestMap: {},
        userId: 'user-1',
        workingDirectory: '/Users/me/repo',
      });
      await proxy[LocalSystemApiName.runCommand]({ command: 'rm -rf /', sandbox: false });

      expect(parseArgs().sandbox).toBe(true);
    });

    it('leaves runCommand untouched when the run is not sandboxed', async () => {
      const proxy = buildProxy('/Users/me/repo');
      await proxy[LocalSystemApiName.runCommand]({ command: 'git status' });

      expect(parseArgs()).not.toHaveProperty('sandbox');
    });

    it('injects scope into search ops that honor it', async () => {
      const proxy = buildProxy('/Users/me/repo');
      await proxy[LocalSystemApiName.grepContent]({ pattern: 'TODO' });

      expect(parseArgs()).toEqual({ pattern: 'TODO', scope: '/Users/me/repo' });
    });

    it('injects scope into globFiles when omitted', async () => {
      const proxy = buildProxy('/Users/me/repo');
      await proxy[LocalSystemApiName.globFiles]({ pattern: '**/*.ts' });

      expect(parseArgs()).toEqual({ pattern: '**/*.ts', scope: '/Users/me/repo' });
    });

    it('replaces scope "." with workingDirectory for globFiles', async () => {
      const proxy = buildProxy('/Users/me/repo');
      await proxy[LocalSystemApiName.globFiles]({ pattern: '**/*.ts', scope: '.' });

      expect(parseArgs()).toEqual({ pattern: '**/*.ts', scope: '/Users/me/repo' });
    });

    it('replaces scope "." with workingDirectory for searchFiles', async () => {
      const proxy = buildProxy('/Users/me/repo');
      await proxy[LocalSystemApiName.searchFiles]({ keywords: 'foo', scope: '.' });

      expect(parseArgs()).toEqual({ keywords: 'foo', scope: '/Users/me/repo' });
    });

    it('replaces scope "." with Windows workingDirectory for search ops', async () => {
      const proxy = buildProxy('D:\\some-project');

      await proxy[LocalSystemApiName.globFiles]({ pattern: '**/*.ts', scope: '.' });
      expect(parseArgs()).toEqual({ pattern: '**/*.ts', scope: 'D:\\some-project' });

      mockExecuteToolCall.mockClear();
      await proxy[LocalSystemApiName.searchFiles]({ keywords: 'foo', scope: '.' });
      expect(parseArgs()).toEqual({ keywords: 'foo', scope: 'D:\\some-project' });
    });

    it('does not override an explicit absolute scope on search ops', async () => {
      const proxy = buildProxy('/Users/me/repo');
      await proxy[LocalSystemApiName.globFiles]({ pattern: '**/*.ts', scope: '/explicit' });

      expect(parseArgs()).toEqual({ pattern: '**/*.ts', scope: '/explicit' });
    });

    // Security: `cwd` is not a manifest field, so a model can never legitimately
    // set it — and the out-of-scope intervention audit does not inspect it. If a
    // provider forwards the unknown argument, honoring it would let
    // `readFile({ path: 'passwd', cwd: '/etc' })` pass the audit (only `path` is
    // checked, and it looks workspace-relative) and then execute against /etc.
    it('overrides an off-contract cwd supplied by the model', async () => {
      const proxy = buildProxy('/Users/me/repo');
      await proxy[LocalSystemApiName.runCommand]({ command: 'ls', cwd: '/explicit' });

      expect(parseArgs()).toEqual({ command: 'ls', cwd: '/Users/me/repo' });
    });

    it('drops an off-contract cwd on file ops when a working directory is bound', async () => {
      const proxy = buildProxy('/Users/me/repo');
      await proxy[LocalSystemApiName.readFile]({ cwd: '/etc', path: 'passwd' });

      expect(parseArgs()).toEqual({ cwd: '/Users/me/repo', path: 'passwd' });
    });

    // Search apis take `scope`, not `cwd` — but downstream `cwd` doubles as a
    // legacy search-root alias and as the base a relative `scope` resolves
    // against, so leaving it in place would let an audited workspace-relative
    // `scope` execute somewhere else entirely.
    it.each([
      [LocalSystemApiName.globFiles, { cwd: '/', pattern: 'passwd', scope: 'etc' }],
      [LocalSystemApiName.grepContent, { cwd: '/', pattern: 'root', scope: 'etc' }],
      [LocalSystemApiName.searchFiles, { cwd: '/', keywords: 'passwd', scope: 'etc' }],
    ])('strips an off-contract cwd from %s while keeping the audited scope', async (api, args) => {
      mockExecuteToolCall.mockClear();
      const proxy = buildProxy('/Users/me/repo');
      await proxy[api](args);

      const forwarded = JSON.parse(mockExecuteToolCall.mock.calls[0][1].arguments);
      expect(forwarded.cwd).toBeUndefined();
      expect(forwarded.scope).toBe('etc');
    });

    it('injects cwd into file ops so the daemon can resolve a relative path', async () => {
      const proxy = buildProxy('/Users/me/repo');
      await proxy[LocalSystemApiName.readFile]({ path: 'src/index.ts' });

      // The daemon's resolveAgainstCwd anchors the relative path to cwd; an
      // absolute path the model supplies passes through unchanged there.
      expect(parseArgs()).toEqual({ cwd: '/Users/me/repo', path: 'src/index.ts' });
    });

    it('injects cwd into writeFile / editFile / moveFiles', async () => {
      for (const api of [
        LocalSystemApiName.writeFile,
        LocalSystemApiName.editFile,
        LocalSystemApiName.moveFiles,
      ]) {
        mockExecuteToolCall.mockClear();
        const proxy = buildProxy('/Users/me/repo');
        await proxy[api]({ path: 'x' });
        expect(JSON.parse(mockExecuteToolCall.mock.calls[0][1].arguments).cwd).toBe(
          '/Users/me/repo',
        );
      }
    });

    it('does not inject for command-id ops (getCommandOutput / killCommand)', async () => {
      const proxy = buildProxy('/Users/me/repo');
      await proxy[LocalSystemApiName.getCommandOutput]({ shell_id: 'cmd-1' });

      expect(parseArgs()).toEqual({ shell_id: 'cmd-1' });
    });

    it('leaves args untouched when no working directory is bound', async () => {
      const proxy = buildProxy(undefined);
      await proxy[LocalSystemApiName.runCommand]({ command: 'pwd' });

      expect(parseArgs()).toEqual({ command: 'pwd' });
    });

    // With nothing trusted to overwrite it with, an off-contract cwd is dropped
    // rather than forwarded — the device then falls back to its own default.
    it('strips an off-contract cwd when no working directory is bound', async () => {
      const proxy = buildProxy(undefined);
      await proxy[LocalSystemApiName.readFile]({ cwd: '/etc', path: 'passwd' });

      expect(parseArgs()).toEqual({ path: 'passwd' });
    });
  });

  // A device shell runs the user's own `lh` against their stored credentials,
  // which default to PERSONAL scope — so a workspace agent asking the CLI to
  // edit itself silently read and wrote the wrong tenancy.
  describe('lh workspace scope on device commands', () => {
    const parseArgs = () => JSON.parse(mockExecuteToolCall.mock.calls[0][1].arguments);

    const buildProxy = (context: Partial<ToolExecutionContext>) => {
      mockExecuteToolCall.mockResolvedValue({ content: '', success: true });
      return localSystemRuntime.factory({
        activeDeviceId: 'device-1',
        toolManifestMap: {},
        userId: 'user-1',
        ...context,
      });
    };

    it('injects the workspace scope into lh commands', async () => {
      const proxy = buildProxy({ workspaceId: 'ws-42' });
      await proxy[LocalSystemApiName.runCommand]({ command: 'lh agent edit agt_1 -t x' });

      expect(parseArgs().env).toEqual({ LOBEHUB_WORKSPACE_ID: 'ws-42' });
    });

    it('never sends the caller JWT to the device', async () => {
      const proxy = buildProxy({ workspaceId: 'ws-42' });
      await proxy[LocalSystemApiName.runCommand]({ command: 'lh agent list' });

      expect(parseArgs().env).not.toHaveProperty('LOBEHUB_JWT');
    });

    it('keeps the scope on a personal-scope device, which is addressed personally but still edits workspace content', async () => {
      const proxy = buildProxy({ activeDeviceScope: 'personal', workspaceId: 'ws-42' });
      await proxy[LocalSystemApiName.runCommand]({ command: 'lh agent edit agt_1 -t x' });

      // Gateway addressing drops the workspace (no `workspace:<id>` connection
      // for this device) — the CONTENT scope must not follow it down.
      expect(mockExecuteToolCall.mock.calls[0][0].workspaceId).toBeUndefined();
      expect(parseArgs().env).toEqual({ LOBEHUB_WORKSPACE_ID: 'ws-42' });
    });

    // Regression: injection used to be gated on detecting `lh` in command
    // position, so a command that reaches `lh` through a child shell, a script
    // or a Makefile got no scope and silently used the device credentials'
    // personal tenancy. The device merges env into the spawned process, so
    // every descendant inherits it — which is the only way to cover these.
    it.each([
      ['child shell', "bash -lc 'lh whoami'"],
      ['shell script', './sync.sh'],
      ['makefile target', 'make deploy'],
      ['npm script', 'npm run sync'],
    ])('scopes a workspace run invoking lh via a %s', async (_label, command) => {
      const proxy = buildProxy({ workspaceId: 'ws-42' });
      await proxy[LocalSystemApiName.runCommand]({ command });

      expect(parseArgs().env).toEqual({ LOBEHUB_WORKSPACE_ID: 'ws-42' });
    });

    it('does not inject in a personal run', async () => {
      const proxy = buildProxy({});
      await proxy[LocalSystemApiName.runCommand]({ command: 'lh agent list' });

      expect(parseArgs()).toEqual({ command: 'lh agent list' });
    });

    it('lets a model-supplied env win', async () => {
      const proxy = buildProxy({ workspaceId: 'ws-42' });
      await proxy[LocalSystemApiName.runCommand]({
        command: 'lh agent list',
        env: { LOBEHUB_WORKSPACE_ID: 'ws-explicit' },
      });

      expect(parseArgs().env).toEqual({ LOBEHUB_WORKSPACE_ID: 'ws-explicit' });
    });
  });
});
