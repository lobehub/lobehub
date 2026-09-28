// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as InternalJwtModule from '@/libs/trpc/utils/internalJwt';
import type * as OperationPrincipalModule from '@/server/services/heterogeneousAgent/operationPrincipal';
import { HeteroOperationPrincipalError } from '@/server/services/heterogeneousAgent/operationPrincipal';

import { aiAgentRouter } from '../aiAgent';

const { resolvePrincipal, signOperationToken } = vi.hoisted(() => ({
  resolvePrincipal: vi.fn(),
  signOperationToken: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));
vi.mock('@/libs/trpc/utils/internalJwt', async (importOriginal) => ({
  ...(await importOriginal<typeof InternalJwtModule>()),
  signHeteroOperationJWT: signOperationToken,
}));
vi.mock('@/server/services/heterogeneousAgent/operationPrincipal', async (importOriginal) => ({
  ...(await importOriginal<typeof OperationPrincipalModule>()),
  resolveActiveHeteroOperationPrincipal: resolvePrincipal,
}));

const operationClaims = {
  aud: 'urn:lobehub:hetero-operation',
  capabilities: ['hetero:ingest', 'hetero:finish', 'hetero:intervention:read'],
  exp: 1_789_327_443,
  iat: 1_789_313_043,
  iss: 'urn:lobehub:internal',
  jti: 'jti-1',
  operation_id: 'op-1',
  purpose: 'hetero-operation',
  sub: 'user-1',
  workspace_id: 'workspace-1',
};

const caller = (oidcAuth: Record<string, unknown>) =>
  aiAgentRouter.createCaller({
    jwtPayload: { userId: oidcAuth.sub },
    oidcAuth,
    userId: oidcAuth.sub,
  } as any);

beforeEach(() => {
  vi.clearAllMocks();
  resolvePrincipal.mockResolvedValue({ operationId: 'op-1', userId: 'user-1' });
  signOperationToken.mockResolvedValue('renewed-token');
});

/**
 * Regression: a Goal Task ran past the four hours its operation token was
 * signed for, and there was no way to get another. Every ingest after that was
 * rejected, so the run's output and completion never reached the server.
 */
describe('aiAgentRouter.refreshHeteroOperationToken', () => {
  it('re-mints a token with the same scope for a running operation', async () => {
    await expect(
      caller(operationClaims).refreshHeteroOperationToken({ operationId: 'op-1' }),
    ).resolves.toEqual({ jwt: 'renewed-token' });

    expect(resolvePrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'hetero:ingest', operationId: 'op-1' }),
    );
    expect(signOperationToken).toHaveBeenCalledWith({
      capabilities: operationClaims.capabilities,
      model: undefined,
      operationId: 'op-1',
      providerId: undefined,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
  });

  it('refuses to renew once the operation has ended', async () => {
    resolvePrincipal.mockRejectedValue(
      new HeteroOperationPrincipalError('Operation has already ended', 409),
    );

    await expect(
      caller(operationClaims).refreshHeteroOperationToken({ operationId: 'op-1' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(signOperationToken).not.toHaveBeenCalled();
  });

  it('refuses a token scoped to a different operation', async () => {
    resolvePrincipal.mockRejectedValue(
      new HeteroOperationPrincipalError('Operation token does not grant this request', 403),
    );

    await expect(
      caller(operationClaims).refreshHeteroOperationToken({ operationId: 'op-2' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(signOperationToken).not.toHaveBeenCalled();
  });

  it('never turns a user session into an operation token', async () => {
    await expect(
      caller({ sub: 'user-1' }).refreshHeteroOperationToken({ operationId: 'op-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(signOperationToken).not.toHaveBeenCalled();
  });
});
