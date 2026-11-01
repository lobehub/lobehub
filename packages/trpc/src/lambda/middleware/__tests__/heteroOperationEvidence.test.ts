import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { trpc } from '@/libs/trpc/lambda/init';

import {
  HETERO_OPERATION_JWT_AUDIENCE,
  HETERO_OPERATION_JWT_ISSUER,
  HETERO_OPERATION_JWT_PURPOSE,
} from '../../../utils/internalJwt';
import { oidcAuth } from '../oidcAuth';

const { resolvePrincipal } = vi.hoisted(() => ({ resolvePrincipal: vi.fn() }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));

vi.mock('@/server/services/heterogeneousAgent/operationPrincipal', () => {
  class HeteroOperationPrincipalError extends Error {
    constructor(
      message: string,
      readonly status: 401 | 403 | 409,
    ) {
      super(message);
    }
  }
  return { HeteroOperationPrincipalError, resolveActiveHeteroOperationPrincipal: resolvePrincipal };
});

const scopeOf = ({ ctx }: { ctx: any }) => ({
  scope: ctx.heteroOperationScope ?? null,
  userId: ctx.userId,
  workspaceId: ctx.workspaceId ?? null,
});

const testRouter = trpc.router({
  verify: trpc.router({
    deleteRun: trpc.procedure.use(oidcAuth).mutation(scopeOf),
    submitCheckEvidence: trpc.procedure.use(oidcAuth).mutation(scopeOf),
  }),
});

const createCaller = createCallerFactory(testRouter);

const operationToken = (overrides: Record<string, unknown> = {}) => ({
  aud: HETERO_OPERATION_JWT_AUDIENCE,
  capabilities: ['hetero:ingest', 'hetero:finish', 'acceptance:evidence'],
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  iss: HETERO_OPERATION_JWT_ISSUER,
  jti: 'jti-1',
  operation_id: 'op_task_run',
  purpose: HETERO_OPERATION_JWT_PURPOSE,
  sub: 'operation-owner',
  workspace_id: 'ws_1',
  ...overrides,
});

describe('oidcAuth with a Task run operation token', () => {
  beforeEach(() => {
    resolvePrincipal.mockReset();
    resolvePrincipal.mockResolvedValue({
      operationId: 'op_task_run',
      userId: 'operation-owner',
      workspaceId: 'ws_1',
    });
  });

  it("files evidence as the operation's owner, bound to its operation and workspace", async () => {
    // The device running the Task may be logged in as another member; this token
    // is the only identity that can reach the round the operation's owner holds.
    const caller = createCaller({ oidcAuth: operationToken() } as any);

    await expect(caller.verify.submitCheckEvidence()).resolves.toEqual({
      scope: 'op_task_run',
      userId: 'operation-owner',
      workspaceId: 'ws_1',
    });
    expect(resolvePrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'acceptance:evidence', operationId: 'op_task_run' }),
    );
  });

  it('keeps rejecting the token on every other route', async () => {
    const caller = createCaller({ oidcAuth: operationToken() } as any);

    await expect(caller.verify.deleteRun()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(resolvePrincipal).not.toHaveBeenCalled();
  });

  it('rejects a token minted without acceptance:evidence', async () => {
    const caller = createCaller({
      oidcAuth: operationToken({ capabilities: ['hetero:ingest', 'hetero:finish'] }),
    } as any);

    await expect(caller.verify.submitCheckEvidence()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects a workspace header that names another workspace', async () => {
    const caller = createCaller({ oidcAuth: operationToken(), workspaceId: 'ws_other' } as any);

    await expect(caller.verify.submitCheckEvidence()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(resolvePrincipal).not.toHaveBeenCalled();
  });

  it('rejects the token once its run has ended', async () => {
    const { HeteroOperationPrincipalError } =
      await import('@/server/services/heterogeneousAgent/operationPrincipal');
    resolvePrincipal.mockRejectedValueOnce(
      new HeteroOperationPrincipalError('Operation has already ended', 409),
    );
    const caller = createCaller({ oidcAuth: operationToken() } as any);

    await expect(caller.verify.submitCheckEvidence()).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
