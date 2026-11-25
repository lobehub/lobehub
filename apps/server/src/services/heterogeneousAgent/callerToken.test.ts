import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import type { HeteroOperationJwtClaims } from '@/libs/trpc/utils/internalJwt';

import { authorizeHeteroCallerToken, HeteroCallerTokenError } from './callerToken';
import type * as OperationPrincipal from './operationPrincipal';
import { HeteroOperationPrincipalError } from './operationPrincipal';

const { resolvePrincipal } = vi.hoisted(() => ({ resolvePrincipal: vi.fn() }));

vi.mock('./operationPrincipal', async (importOriginal) => ({
  ...(await importOriginal<typeof OperationPrincipal>()),
  resolveActiveHeteroOperationPrincipal: resolvePrincipal,
}));

const claims = (overrides: Partial<HeteroOperationJwtClaims> = {}): HeteroOperationJwtClaims => ({
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

const db = {} as LobeChatDatabase;

const rejection = async (promise: Promise<unknown>) => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HeteroCallerTokenError);
  return error as HeteroCallerTokenError;
};

describe('authorizeHeteroCallerToken', () => {
  beforeEach(() => {
    resolvePrincipal.mockReset();
    resolvePrincipal.mockResolvedValue({ operationId: 'op-1', userId: 'user-initiator' });
  });

  it("accepts a running operation's token in its own workspace", async () => {
    await authorizeHeteroCallerToken({ claims: claims(), db, requestedWorkspaceId: 'ws-team' });

    expect(resolvePrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'caller:act', operationId: 'op-1' }),
    );
  });

  it('accepts a personal run in the personal space', async () => {
    await authorizeHeteroCallerToken({
      claims: claims({ workspace_id: undefined }),
      db,
      requestedWorkspaceId: null,
    });

    expect(resolvePrincipal).toHaveBeenCalledOnce();
  });

  it("refuses another of the caller's workspaces before touching the operation", async () => {
    const error = await rejection(
      authorizeHeteroCallerToken({ claims: claims(), db, requestedWorkspaceId: 'ws-other' }),
    );

    expect(error.status).toBe(403);
    expect(error.message).toBe(
      "This run's token only works in workspace ws-team, not in workspace ws-other.",
    );
    expect(resolvePrincipal).not.toHaveBeenCalled();
  });

  it('refuses the personal space for a workspace run, and the reverse', async () => {
    expect((await rejection(authorizeHeteroCallerToken({ claims: claims(), db }))).status).toBe(
      403,
    );
    expect(
      (
        await rejection(
          authorizeHeteroCallerToken({
            claims: claims({ workspace_id: undefined }),
            db,
            requestedWorkspaceId: 'ws-team',
          }),
        )
      ).message,
    ).toBe("This run's token only works in the personal space, not in workspace ws-team.");
  });

  it('turns an ended run into 401', async () => {
    resolvePrincipal.mockRejectedValue(
      new HeteroOperationPrincipalError('Operation has already ended', 409),
    );

    const error = await rejection(
      authorizeHeteroCallerToken({ claims: claims(), db, requestedWorkspaceId: 'ws-team' }),
    );

    expect(error.status).toBe(401);
    expect(error.message).toBe('This run has ended, so its token no longer works.');
  });

  it('keeps scope and membership refusals as 403', async () => {
    resolvePrincipal.mockRejectedValue(
      new HeteroOperationPrincipalError('Workspace membership is no longer active', 403),
    );

    const error = await rejection(
      authorizeHeteroCallerToken({ claims: claims(), db, requestedWorkspaceId: 'ws-team' }),
    );

    expect(error.status).toBe(403);
    expect(error.message).toBe('Workspace membership is no longer active');
  });
});
