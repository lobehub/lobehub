import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { trpc } from '@/libs/trpc/lambda/init';
import type * as CallerToken from '@/server/services/heterogeneousAgent/callerToken';
import type * as OperationPrincipal from '@/server/services/heterogeneousAgent/operationPrincipal';

import { apiKeyScopeGuard } from '../apiKeyScope';
import { oidcAuth } from '../oidcAuth';

const { authorizeCaller, resolveOperation } = vi.hoisted(() => ({
  authorizeCaller: vi.fn(),
  resolveOperation: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/server/services/heterogeneousAgent/callerToken', async (importOriginal) => ({
  ...(await importOriginal<typeof CallerToken>()),
  authorizeHeteroCallerToken: authorizeCaller,
}));
vi.mock('@/server/services/heterogeneousAgent/operationPrincipal', async (importOriginal) => ({
  ...(await importOriginal<typeof OperationPrincipal>()),
  resolveActiveHeteroOperationPrincipal: resolveOperation,
}));

// The same order as `authedProcedure`: oidcAuth resolves the principal, then the scope guard.
const authed = trpc.procedure.use(oidcAuth).use(apiKeyScopeGuard);

/** Which identity a request ran under: the run's own route (`scope`) or the caller. */
const principal = ({
  ctx,
}: {
  ctx: { heteroOperationScope?: string; userId?: string | null };
}) => ({
  scope: ctx.heteroOperationScope ?? null,
  userId: ctx.userId ?? null,
});

const testRouter = trpc.router({
  acceptance: trpc.router({ accept: authed.mutation(() => 'accepted') }),
  apiKey: trpc.router({ createApiKey: authed.mutation(() => 'minted') }),
  agentTrace: trpc.router({ listOperations: authed.query(() => 'traces') }),
  botMessage: trpc.router({ sendMessage: authed.mutation(() => 'sent') }),
  device: trpc.router({
    browseDirectory: authed.query(() => 'listing'),
    listDevices: authed.query(() => 'devices'),
  }),
  document: trpc.router({ updateDocument: authed.mutation(() => 'updated') }),
  file: trpc.router({ createFile: authed.mutation(principal) }),
  user: trpc.router({ getUserState: authed.query(principal) }),
  task: trpc.router({ run: authed.mutation(() => 'started') }),
  verify: trpc.router({
    submitCheckEvidence: authed.mutation(principal),
    uploadEvidence: authed.mutation(() => 'uploaded'),
  }),
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
    resolveOperation.mockReset();
    resolveOperation.mockResolvedValue({
      operationId: 'op-1',
      userId: 'user-initiator',
      workspaceId: 'ws-team',
    });
  });

  const caller = () => createCaller({ oidcAuth: callerToken, workspaceId: 'ws-team' } as any);

  it('reaches the work an agent does through lh', async () => {
    await expect(caller().acceptance.accept()).resolves.toBe('accepted');
    await expect(caller().document.updateDocument()).resolves.toBe('updated');
    await expect(caller().task.run()).resolves.toBe('started');
    await expect(caller().workspace.getById()).resolves.toBe('workspace');
  });

  /**
   * Regression: the guide sends device runs to `lh bot message`, `lh trace op` and
   * `lh agent run --device`, and the caller scopes refused all three.
   */
  it('reaches bot messages, traces and the device list, but no other device read', async () => {
    await expect(caller().botMessage.sendMessage()).resolves.toBe('sent');
    await expect(caller().agentTrace.listOperations()).resolves.toBe('traces');
    await expect(caller().device.listDevices()).resolves.toBe('devices');
    await expect(caller().device.browseDirectory()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  /**
   * Regression: a run without `acceptance:evidence` reached `verify.*` as its user,
   * skipping the own-round and evidence-only checks, so it could write verdicts
   * into the user's other verification rounds.
   */
  it('keeps verify on the run route, refused without the round capability', async () => {
    await expect(caller().verify.submitCheckEvidence()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(authorizeCaller).not.toHaveBeenCalled();

    const taskRun = createCaller({
      oidcAuth: {
        ...callerToken,
        capabilities: [...callerToken.capabilities, 'acceptance:evidence'],
      },
      workspaceId: 'ws-team',
    } as any);
    await expect(taskRun.verify.submitCheckEvidence()).resolves.toEqual({
      scope: 'op-1',
      userId: 'user-initiator',
    });
  });

  /**
   * Regression: a library upload was refused as a run attachment, and the CLI's
   * only way through was retrying with the machine's stored login.
   */
  it('files a library upload as the caller and any other upload as a run attachment', async () => {
    await expect(caller().file.createFile({ knowledgeBaseId: 'kb-1' })).resolves.toEqual({
      scope: null,
      userId: 'user-initiator',
    });
    await expect(caller().file.createFile({ parentId: 'folder-1' })).resolves.toEqual({
      scope: null,
      userId: 'user-initiator',
    });
    await expect(caller().file.createFile({ source: 'tool-result' })).resolves.toEqual({
      scope: 'op-1',
      userId: 'user-initiator',
    });
  });

  it('reads the user state as the caller unless the token holds the evidence capability', async () => {
    await expect(caller().user.getUserState()).resolves.toEqual({
      scope: null,
      userId: 'user-initiator',
    });
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
