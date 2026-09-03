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
  model: 'model-a',
  operation_id: 'op-1',
  provider_id: 'lobehub',
  purpose: 'hetero-operation',
  sub: 'user-1',
};

const activeOperation = (overrides: Record<string, unknown> = {}) => ({
  id: 'op-1',
  metadata: { agentType: 'kimi-code', serverDefaultHeterogeneous: true },
  model: 'model-a',
  provider: 'lobehub',
  status: 'running',
  userId: 'user-1',
  workspaceId: null,
  ...overrides,
});

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
      db: dbWithOperation(activeOperation()),
      operationId: 'op-1',
    });

    expect(principal).toEqual({
      agentType: 'kimi-code',
      operationId: 'op-1',
      userId: 'user-1',
      workspaceId: undefined,
    });
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
        db: dbWithOperation(activeOperation({ status: 'done' })),
        operationId: 'op-1',
      }),
    ).rejects.toEqual(new HeteroOperationPrincipalError('Operation has already ended', 409));
  });

  it('rejects a model selection that no longer matches the operation', async () => {
    await expect(
      resolveActiveHeteroOperationPrincipal({
        capability: 'model:invoke',
        claims,
        db: dbWithOperation(activeOperation({ model: 'model-b' })),
        operationId: 'op-1',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    ['missing server-default marker', { agentType: 'kimi-code' }],
    ['missing agent type', { serverDefaultHeterogeneous: true }],
    ['unsupported agent type', { agentType: 'opencode', serverDefaultHeterogeneous: true }],
  ])('rejects model invocation with %s in durable metadata', async (_label, metadata) => {
    await expect(
      resolveActiveHeteroOperationPrincipal({
        capability: 'model:invoke',
        claims,
        db: dbWithOperation(activeOperation({ metadata })),
        operationId: 'op-1',
      }),
    ).rejects.toEqual(
      new HeteroOperationPrincipalError('Operation token has no valid server model selection', 403),
    );
  });

  it('rejects a model-invocation token without model and provider claims', async () => {
    const { model: _model, provider_id: _providerId, ...unscopedClaims } = claims;

    await expect(
      resolveActiveHeteroOperationPrincipal({
        capability: 'model:invoke',
        claims: unscopedClaims,
        db: dbWithOperation(activeOperation()),
        operationId: 'op-1',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rechecks workspace membership and RBAC', async () => {
    hasMembership.mockResolvedValue(false);
    const workspaceClaims = { ...claims, workspace_id: 'workspace-1' };
    const db = dbWithOperation(activeOperation({ workspaceId: 'workspace-1' }));

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
