import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import type { HeteroOperationJwtClaims } from '@/libs/trpc/utils/internalJwt';

import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from './operationPrincipal';

const { activeUser, hasMembership, hasPermission } = vi.hoisted(() => ({
  activeUser: vi.fn(),
  hasMembership: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('@/libs/oidc-provider/access-control', () => ({ assertOIDCUserActive: activeUser }));
vi.mock('@/database/models/workspace', () => ({
  hasActiveWorkspaceMembership: hasMembership,
}));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = hasPermission;
  },
}));
vi.mock('@/utils/rbac', () => ({ getScopePermissions: () => ['permission'] }));

const claims: HeteroOperationJwtClaims = {
  aud: 'urn:lobehub:hetero-operation',
  capabilities: ['model:invoke'],
  exp: 2,
  iat: 1,
  iss: 'urn:lobehub:internal',
  jti: 'jti-1',
  operation_id: 'op-1',
  purpose: 'hetero-operation',
  sub: 'user-1',
};

const dbWithOperation = (operation: unknown) => {
  const query = {
    from: vi.fn(() => query),
    limit: vi.fn(async () => (operation ? [operation] : [])),
    where: vi.fn(() => query),
  };
  return { select: vi.fn(() => query) } as unknown as LobeChatDatabase;
};

describe('resolveActiveHeteroOperationPrincipal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeUser.mockResolvedValue(undefined);
    hasMembership.mockResolvedValue(true);
    hasPermission.mockResolvedValue(true);
  });

  it('re-authorizes the durable running operation on each request', async () => {
    const principal = await resolveActiveHeteroOperationPrincipal({
      capability: 'model:invoke',
      claims,
      db: dbWithOperation({ id: 'op-1', status: 'running', userId: 'user-1', workspaceId: null }),
      operationId: 'op-1',
    });

    expect(principal).toEqual({ operationId: 'op-1', userId: 'user-1', workspaceId: undefined });
    expect(activeUser).toHaveBeenCalledWith(expect.anything(), 'user-1');
    expect(hasPermission).toHaveBeenCalledOnce();
  });

  it('rejects a token that does not grant the requested operation', async () => {
    await expect(
      resolveActiveHeteroOperationPrincipal({
        capability: 'model:invoke',
        claims,
        db: dbWithOperation(null),
        operationId: 'other',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(activeUser).not.toHaveBeenCalled();
  });

  it('rejects a settled operation', async () => {
    await expect(
      resolveActiveHeteroOperationPrincipal({
        capability: 'model:invoke',
        claims,
        db: dbWithOperation({ id: 'op-1', status: 'done', userId: 'user-1', workspaceId: null }),
        operationId: 'op-1',
      }),
    ).rejects.toEqual(new HeteroOperationPrincipalError('Operation has already ended', 409));
  });

  it('rejects a model selection that no longer matches the operation', async () => {
    await expect(
      resolveActiveHeteroOperationPrincipal({
        capability: 'model:invoke',
        claims: { ...claims, model: 'model-a', provider_id: 'openai' },
        db: dbWithOperation({
          id: 'op-1',
          model: 'model-b',
          provider: 'openai',
          status: 'running',
          userId: 'user-1',
          workspaceId: null,
        }),
        operationId: 'op-1',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rechecks workspace membership and RBAC', async () => {
    hasMembership.mockResolvedValue(false);
    const workspaceClaims = { ...claims, workspace_id: 'workspace-1' };
    const db = dbWithOperation({
      id: 'op-1',
      status: 'running',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    await expect(
      resolveActiveHeteroOperationPrincipal({
        capability: 'model:invoke',
        claims: workspaceClaims,
        db,
        operationId: 'op-1',
      }),
    ).rejects.toMatchObject({ status: 403 });

    hasMembership.mockResolvedValue(true);
    hasPermission.mockResolvedValue(false);
    await expect(
      resolveActiveHeteroOperationPrincipal({
        capability: 'model:invoke',
        claims: workspaceClaims,
        db,
        operationId: 'op-1',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
