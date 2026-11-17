// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveToolCallScmCredential } from './toolCallCredential';

const mocks = vi.hoisted(() => ({
  findWorkspaceDeviceById: vi.fn(),
  resolveDevice: vi.fn(),
  sign: vi.fn(),
  trigger: vi.fn(),
}));

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn(function () {
    return { findWorkspaceDeviceById: mocks.findWorkspaceDeviceById };
  }),
}));
vi.mock('@/libs/trpc/utils/internalJwt', () => ({ signHeteroOperationJWT: mocks.sign }));
vi.mock('./deviceCredential', () => ({ resolveDeviceRequesterCredential: mocks.resolveDevice }));

const db = {
  select: () => ({
    from: () => ({ where: () => ({ limit: async () => [{ trigger: mocks.trigger() }] }) }),
  }),
} as any;

const resolve = (overrides: Record<string, unknown> = {}) =>
  resolveToolCallScmCredential({
    db,
    deviceId: 'device-jp-1',
    deviceWorkspaceId: 'ws-1',
    operationId: 'op-1',
    ownerUserId: 'user-owner',
    readSystemInfo: vi.fn(),
    runWorkspaceId: 'ws-1',
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.trigger.mockReturnValue('bot');
  mocks.findWorkspaceDeviceById.mockResolvedValue({ visibility: 'public', workspaceId: 'ws-1' });
  mocks.sign.mockResolvedValue('jwt-5m');
  mocks.resolveDevice.mockImplementation(async ({ resign }) => ({
    jwt: await resign({ deviceId: 'device-jp-1', requesterUserId: 'user-requester' }),
    kind: 'issue',
    requesterLine: 'line',
    scmCredential: { gitEmail: 'e@users.noreply.github.com', gitName: 'Arvin Xu' },
  }));
});

describe('resolveToolCallScmCredential', () => {
  it('signs a five-minute credential-only token for the resolved requester', async () => {
    await expect(
      resolve({
        botContext: { isOwner: false, platform: 'discord', senderExternalUserId: 'discord-42' },
      }),
    ).resolves.toEqual({
      arg: { gitEmail: 'e@users.noreply.github.com', gitName: 'Arvin Xu', jwt: 'jwt-5m' },
      kind: 'issue',
    });

    expect(mocks.sign).toHaveBeenCalledWith({
      capabilities: ['scm:github-credential'],
      deviceId: 'device-jp-1',
      expiration: '5m',
      operationId: 'op-1',
      requesterUserId: 'user-requester',
      userId: 'user-owner',
      workspaceId: 'ws-1',
    });
    expect(mocks.resolveDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        device: { visibility: 'public', workspaceId: 'ws-1' },
        requesterInput: {
          botIsOwner: false,
          botSender: { id: 'discord-42', platform: 'discord' },
          ownerUserId: 'user-owner',
          shareVisitorUserId: undefined,
          trigger: 'bot',
        },
      }),
    );
  });

  it('passes a refusal through for the tool result', async () => {
    mocks.resolveDevice.mockResolvedValue({
      detail: 'too old',
      kind: 'refuse',
      reason: 'cli_too_old',
    });

    await expect(resolve()).resolves.toEqual({ detail: 'too old', kind: 'refuse' });
  });

  it('does nothing for a personal device or a call outside an operation', async () => {
    await expect(resolve({ deviceWorkspaceId: undefined })).resolves.toEqual({ kind: 'off' });
    await expect(resolve({ operationId: undefined })).resolves.toEqual({ kind: 'off' });
    expect(mocks.resolveDevice).not.toHaveBeenCalled();
  });
});
