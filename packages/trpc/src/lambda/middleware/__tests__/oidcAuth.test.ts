import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { trpc } from '@/libs/trpc/lambda/init';
import type * as CallerToken from '@/server/services/heterogeneousAgent/callerToken';

import { oidcAuth } from '../oidcAuth';

const { authorizeCaller } = vi.hoisted(() => ({ authorizeCaller: vi.fn() }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/server/services/heterogeneousAgent/callerToken', async (importOriginal) => ({
  ...(await importOriginal<typeof CallerToken>()),
  authorizeHeteroCallerToken: authorizeCaller,
}));

// Minimal router that exercises oidcAuth
const testRouter = trpc.router({
  ping: trpc.procedure.use(oidcAuth).query(({ ctx }) => ctx.userId ?? null),
});

const createCaller = createCallerFactory(testRouter);

describe('oidcAuth middleware', () => {
  it('sets userId from sub when oidcAuth is a normal token', async () => {
    const caller = createCaller({
      oidcAuth: { purpose: 'cli-sandbox', sub: 'user-abc' },
    } as any);

    const result = await caller.ping();

    expect(result).toBe('user-abc');
  });

  it('sets userId when oidcAuth has no purpose field (standard OIDC token)', async () => {
    const caller = createCaller({
      oidcAuth: { sub: 'user-abc' },
    } as any);

    const result = await caller.ping();

    expect(result).toBe('user-abc');
  });

  it('passes through with null userId when oidcAuth is absent', async () => {
    const caller = createCaller({} as any);

    const result = await caller.ping();

    expect(result).toBeNull();
  });

  it('rejects hetero-operation tokens to block misuse on normal authed routes', async () => {
    const caller = createCaller({
      oidcAuth: { purpose: 'hetero-operation', sub: 'user-abc' },
    } as any);

    await expect(caller.ping()).rejects.toThrow(TRPCError);
    await expect(caller.ping()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

/**
 * Regression: a device run's agent had only a token these routes refused, so it
 * fell back to the device's own login and wrote as whoever was logged in there.
 */
describe('oidcAuth with a device run caller token', () => {
  const callerToken = (overrides: Record<string, unknown> = {}) => ({
    aud: 'urn:lobehub:hetero-operation',
    capabilities: ['caller:act', 'hetero:ingest', 'hetero:finish'],
    exp: 2,
    iat: 1,
    iss: 'urn:lobehub:internal',
    jti: 'jti-1',
    operation_id: 'op-1',
    purpose: 'hetero-operation',
    sub: 'user-initiator',
    workspace_id: 'ws-team',
    ...overrides,
  });

  beforeEach(() => {
    authorizeCaller.mockReset();
    authorizeCaller.mockResolvedValue({ operationId: 'op-1', userId: 'user-initiator' });
  });

  it('acts as the user who started the run, in the requested workspace', async () => {
    const caller = createCaller({ oidcAuth: callerToken(), workspaceId: 'ws-team' } as any);

    await expect(caller.ping()).resolves.toBe('user-initiator');
    expect(authorizeCaller).toHaveBeenCalledWith(
      expect.objectContaining({
        claims: expect.objectContaining({ operation_id: 'op-1', sub: 'user-initiator' }),
        requestedWorkspaceId: 'ws-team',
      }),
    );
  });

  it('still refuses an operation token without caller:act, with the message lh falls back on', async () => {
    const caller = createCaller({
      oidcAuth: callerToken({ capabilities: ['hetero:ingest', 'hetero:finish'] }),
      workspaceId: 'ws-team',
    } as any);

    await expect(caller.ping()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'hetero-operation tokens are not accepted on this endpoint',
    });
    expect(authorizeCaller).not.toHaveBeenCalled();
  });

  it('reports an ended run as UNAUTHORIZED and another workspace as FORBIDDEN', async () => {
    const { HeteroCallerTokenError } =
      await import('@/server/services/heterogeneousAgent/callerToken');
    const caller = createCaller({ oidcAuth: callerToken(), workspaceId: 'ws-team' } as any);

    authorizeCaller.mockRejectedValueOnce(
      new HeteroCallerTokenError('This run has ended, so its token no longer works.', 401),
    );
    await expect(caller.ping()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'This run has ended, so its token no longer works.',
    });

    authorizeCaller.mockRejectedValueOnce(
      new HeteroCallerTokenError(
        "This run's token only works in workspace ws-team, not in workspace ws-other.",
        403,
      ),
    );
    await expect(caller.ping()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
