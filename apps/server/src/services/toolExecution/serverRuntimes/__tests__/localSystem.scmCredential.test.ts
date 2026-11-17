import { LocalSystemApiName } from '@lobechat/builtin-tool-local-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolExecutionContext } from '../../types';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  resolveCredential: vi.fn(),
}));

vi.mock('@/server/services/deviceGateway/authorizedToolCall', () => ({
  executeAuthorizedDeviceToolCall: (_db: unknown, ...args: unknown[]) => mocks.execute(...args),
}));
vi.mock('@/server/services/scm/requester/toolCallCredential', () => ({
  resolveToolCallScmCredential: mocks.resolveCredential,
  SCM_CREDENTIAL_TOOL_ARG: '__scmCredential',
}));
vi.mock('../resolveWorkspaceScope', () => ({
  resolveContentWorkspaceId: async () => 'ws-1',
  resolveRunWorkspaceId: async () => 'ws-1',
}));

const { localSystemRuntime } = await import('../localSystem');

const context = (): ToolExecutionContext => ({
  activeDeviceId: 'device-jp-1',
  agentShareVisitor: { agentId: 'agt', shareId: 'shr', visitorUserId: 'user-visitor' },
  operationId: 'op-1',
  serverDB: {} as any,
  toolCallId: 'call-1',
  toolManifestMap: {},
  userId: 'user-owner',
  workingDirectory: '/srv/repo',
});

const proxy = () =>
  localSystemRuntime.factory(context()) as Record<string, (args: any) => Promise<any>>;
const sentArgs = () => JSON.parse(mocks.execute.mock.calls[0][1].arguments);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue({ content: 'ok', success: true });
  mocks.resolveCredential.mockResolvedValue({ kind: 'off' });
});

describe('localSystem runCommand requester credential', () => {
  it('attaches the host-owned credential arg for an in-scope device', async () => {
    mocks.resolveCredential.mockResolvedValue({
      arg: { gitEmail: 'e@users.noreply.github.com', gitName: 'Arvin Xu', jwt: 'jwt-5m' },
      kind: 'issue',
    });

    await proxy()[LocalSystemApiName.runCommand]({
      __scmCredential: { jwt: 'model-forged' },
      command: 'git push',
    });

    expect(sentArgs().__scmCredential).toEqual({
      gitEmail: 'e@users.noreply.github.com',
      gitName: 'Arvin Xu',
      jwt: 'jwt-5m',
    });
    expect(mocks.resolveCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'device-jp-1',
        deviceWorkspaceId: 'ws-1',
        operationId: 'op-1',
        ownerUserId: 'user-owner',
        runWorkspaceId: 'ws-1',
        shareVisitorUserId: 'user-visitor',
      }),
    );
  });

  it('answers with the refusal instead of running the command as the device', async () => {
    mocks.resolveCredential.mockResolvedValue({
      detail: 'Update lh on the device.',
      kind: 'refuse',
    });

    const result = await proxy()[LocalSystemApiName.runCommand]({ command: 'git push' });

    expect(mocks.execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({ content: 'Update lh on the device.', success: false });
  });

  it('drops a model-supplied credential arg when the policy does not apply', async () => {
    await proxy()[LocalSystemApiName.runCommand]({
      __scmCredential: { jwt: 'model-forged' },
      command: 'ls',
    });

    expect(sentArgs()).not.toHaveProperty('__scmCredential');
  });

  it('drops a model-supplied credential arg on file operations too', async () => {
    await proxy()[LocalSystemApiName.readFile]({ __scmCredential: { jwt: 'x' }, path: 'a.txt' });

    expect(sentArgs()).not.toHaveProperty('__scmCredential');
    expect(mocks.resolveCredential).not.toHaveBeenCalled();
  });
});
