import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { trpc } from '@/libs/trpc/lambda/init';
import type * as CallerToken from '@/server/services/heterogeneousAgent/callerToken';

import { apiKeyScopeGuard } from '../apiKeyScope';
import { oidcAuth } from '../oidcAuth';

const { authorizeCaller } = vi.hoisted(() => ({ authorizeCaller: vi.fn() }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/server/services/heterogeneousAgent/callerToken', async (importOriginal) => ({
  ...(await importOriginal<typeof CallerToken>()),
  authorizeHeteroCallerToken: authorizeCaller,
}));

// The same order as `authedProcedure`: oidcAuth resolves the principal, then the scope guard.
const authed = trpc.procedure.use(oidcAuth).use(apiKeyScopeGuard);

const testRouter = trpc.router({
  acceptance: trpc.router({ accept: authed.mutation(() => 'accepted') }),
  apiKey: trpc.router({ createApiKey: authed.mutation(() => 'minted') }),
  document: trpc.router({ updateDocument: authed.mutation(() => 'updated') }),
  task: trpc.router({ run: authed.mutation(() => 'started') }),
  verify: trpc.router({ uploadEvidence: authed.mutation(() => 'uploaded') }),
  workspace: trpc.router({
    delete: authed.mutation(() => 'deleted'),
    getById: authed.query(() => 'workspace'),
  }),
});

const createCaller = createCallerFactory(testRouter);

const callerToken = {
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
};

/**
 * Regression: a caller token acted as its user on every endpoint, so a run started by a
 * workspace owner could delete the workspace. It now holds HETERO_CALLER_SCOPES only.
 */
describe('a device run caller token is limited to HETERO_CALLER_SCOPES', () => {
  beforeEach(() => {
    authorizeCaller.mockReset();
    authorizeCaller.mockResolvedValue({ operationId: 'op-1', userId: 'user-initiator' });
  });

  const caller = () => createCaller({ oidcAuth: callerToken, workspaceId: 'ws-team' } as any);

  it('reaches the work an agent does through lh', async () => {
    await expect(caller().acceptance.accept()).resolves.toBe('accepted');
    await expect(caller().verify.uploadEvidence()).resolves.toBe('uploaded');
    await expect(caller().document.updateDocument()).resolves.toBe('updated');
    await expect(caller().task.run()).resolves.toBe('started');
    await expect(caller().workspace.getById()).resolves.toBe('workspace');
  });

  it('is refused on high-risk routes, with a message for the agent', async () => {
    await expect(caller().workspace.delete()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining("An agent run cannot access 'workspace.delete'"),
    });
    await expect(caller().apiKey.createApiKey()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('leaves a normal sign-in unrestricted', async () => {
    const session = createCaller({ oidcAuth: { sub: 'user-abc' } } as any);

    await expect(session.workspace.delete()).resolves.toBe('deleted');
  });

  /** `acceptance:*` is internal, so granting it to caller tokens opens nothing to API keys. */
  it('keeps acceptance closed to a restricted API key', async () => {
    const apiKey = createCaller({ apiKeyScopes: ['agent:write', 'knowledge:write'] } as any);

    await expect(apiKey.acceptance.accept()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('This API key cannot access'),
    });
  });
});
