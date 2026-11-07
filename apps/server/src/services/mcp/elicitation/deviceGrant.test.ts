// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveMcpProducerUser } from './deviceGrant';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), device: vi.fn(), member: vi.fn() }));
vi.mock('@/libs/trpc/utils/internalJwt', () => ({ validateMcpDeviceGrant: mocks.verify }));
vi.mock('@/database/models/workspace', () => ({ hasActiveWorkspaceMembership: mocks.member }));
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {
    findWorkspaceDeviceById = mocks.device;
  },
}));
const identity = {
  operationId: 'A-op',
  assistantMessageId: 'A-assistant',
  toolCallId: 'call_1',
  toolMessageId: 'A-tool',
  identifier: 'fixture',
  apiName: 'form',
};
const grant = {
  ...identity,
  userId: 'A',
  workspaceId: 'workspace',
  deviceId: 'B-device',
  deadline: Date.now() + 30_000,
};
const ctx = { userId: 'B', workspaceId: 'workspace', serverDB: {} as never };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue(grant);
  mocks.member.mockResolvedValue(true);
  mocks.device.mockResolvedValue({ userId: 'B', visibility: 'public' });
});
describe('workspace device MCP callback delegation', () => {
  it('keeps initiator A while device owner B authenticates with its own login', async () => {
    expect(await resolveMcpProducerUser(ctx, identity, 'narrow-ticket')).toBe('A');
    expect(mocks.device).toHaveBeenCalledWith('B-device');
    expect(await resolveMcpProducerUser(ctx, identity)).toBe('B');
  });
  it.each([
    'operationId',
    'assistantMessageId',
    'toolCallId',
    'toolMessageId',
    'identifier',
    'apiName',
  ] as const)('rejects a different %s', async (key) => {
    await expect(
      resolveMcpProducerUser(ctx, { ...identity, [key]: 'other' }, 'ticket'),
    ).rejects.toThrow('authorization');
  });
  it('rejects cross-workspace, revoked/expired tickets, another device owner and an unshared device', async () => {
    await expect(
      resolveMcpProducerUser({ ...ctx, workspaceId: 'other' }, identity, 'ticket'),
    ).rejects.toThrow();
    mocks.verify.mockResolvedValueOnce(null);
    await expect(resolveMcpProducerUser(ctx, identity, 'expired')).rejects.toThrow();
    for (const device of [
      undefined,
      { userId: 'C', visibility: 'public' },
      { userId: 'B', visibility: 'private' },
    ]) {
      mocks.device.mockResolvedValueOnce(device);
      await expect(resolveMcpProducerUser(ctx, identity, 'ticket')).rejects.toThrow('device');
    }
  });
});

it('allows the initiating device owner to use a private workspace device without granting other members access', async () => {
  mocks.verify.mockResolvedValueOnce({ ...grant, userId: 'B' });
  mocks.device.mockResolvedValue({ userId: 'B', visibility: 'private' });
  await expect(resolveMcpProducerUser(ctx, identity, 'owner-ticket')).resolves.toBe('B');
  await expect(resolveMcpProducerUser(ctx, identity, 'foreign-ticket')).rejects.toThrow('device');
});
