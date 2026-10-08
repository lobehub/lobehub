// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * REST contract for agent-account writes.
 *
 * An account carries an address and, through the credential sub-resource, a
 * secret — so a write must prove the caller may **edit** the agent, not merely
 * use it. `assertAgentUsableBy` answers visibility (a foreign private agent is
 * a 404); the resource ACL answers editability (a `view` / `use` shared agent is
 * a 403). Writes run both, in that order, so the ACL never becomes a way to
 * probe for an agent the caller cannot see.
 */

const assertAgentUsableBy = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/database/utils/agent-access', () => ({ assertAgentUsableBy }));

const assertCanEditResource = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/server/services/resourcePermission', () => ({ assertCanEditResource }));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn(async () => ({})) },
}));

const registry = vi.hoisted(() => ({ has: vi.fn(() => true), list: vi.fn(() => []) }));
vi.mock('@/server/services/agentIdentity/providers', () => ({
  createDefaultAgentAccountRegistry: vi.fn(() => registry),
}));

const identityService = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 'acc_1' })),
  get: vi.fn(async () => ({ agentId: 'agt_1', id: 'acc_1' })),
  provision: vi.fn(async () => ({ id: 'acc_2' })),
  revoke: vi.fn(async () => 'acc_1'),
  setCredential: vi.fn(async () => 'acc_1'),
  update: vi.fn(async () => 'acc_1'),
}));
vi.mock('@/server/services/agentIdentity', () => ({
  AgentAccountService: vi.fn(function () {
    return identityService;
  }),
  isAgentAccountError: () => false,
}));

const { AgentAccountRestService } = await import('./agent-account.service');

const service = new AgentAccountRestService({} as any, 'user-1', 'ws-1');

const forbidden = () =>
  Object.assign(new Error('You do not have permission to edit this resource'), {
    code: 'FORBIDDEN',
    name: 'TRPCError',
  });

beforeEach(() => {
  vi.clearAllMocks();
  identityService.get.mockResolvedValue({ agentId: 'agt_1', id: 'acc_1' });
});

describe('agent-account REST writes', () => {
  it('authorizes the agent before mounting an account', async () => {
    await service.createAccount('agt_1', {
      capabilities: { receive: false, send: false },
      identifier: 'agent@github',
      kind: 'service',
      provider: 'user',
    } as any);

    expect(assertCanEditResource).toHaveBeenCalledWith({
      db: expect.anything(),
      resourceId: 'agt_1',
      resourceType: 'agent',
      userId: 'user-1',
      workspaceId: 'ws-1',
    });
  });

  it('authorizes each account-addressed mutation against the path agent', async () => {
    await service.updateAccount('agt_1', 'acc_1', { displayName: 'Renamed' } as any);

    expect(assertCanEditResource).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'agt_1', resourceType: 'agent' }),
    );
    expect(identityService.update).toHaveBeenCalledWith('acc_1', { displayName: 'Renamed' });
  });

  it('refuses a use-only agent before rotating the credential', async () => {
    assertCanEditResource.mockRejectedValueOnce(forbidden());

    await expect(
      service.setCredential('agt_1', 'acc_1', { credential: { password: 'secret' } } as any),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(identityService.setCredential).not.toHaveBeenCalled();
  });

  it('refuses a use-only agent before releasing the account', async () => {
    assertCanEditResource.mockRejectedValueOnce(forbidden());

    await expect(service.revokeAccount('agt_1', 'acc_1', {} as any)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    expect(identityService.revoke).not.toHaveBeenCalled();
  });

  it('answers a foreign private agent as NOT_FOUND without consulting the ACL', async () => {
    assertAgentUsableBy.mockRejectedValueOnce(
      Object.assign(new Error('Agent not found'), { code: 'NOT_FOUND', name: 'TRPCError' }),
    );

    await expect(
      service.createAccount('agt_private', {
        capabilities: { receive: false, send: false },
        identifier: 'x@y',
        kind: 'mail',
        provider: 'user',
      } as any),
    ).rejects.toMatchObject({ name: 'NotFoundError' });

    expect(assertCanEditResource).not.toHaveBeenCalled();
  });
});
