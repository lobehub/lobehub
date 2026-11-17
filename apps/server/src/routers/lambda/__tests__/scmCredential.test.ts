// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScmCredentialGrantModel } from '@/database/models/scm';
import { WorkspaceModel } from '@/database/models/workspace';
import { scmCredentialGrants, users, workspaceMembers, workspaces } from '@/database/schemas';
import { HeteroOperationPrincipalError } from '@/server/services/heterogeneousAgent/operationPrincipal';

import { scmCredentialRouter } from '../scmCredential';

const serverDB = await getTestDB();

const mocks = vi.hoisted(() => ({
  getFreshToken: vi.fn(),
  resolvePrincipal: vi.fn(),
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) => opts.next({ ctx: { ...opts.ctx, serverDB } }),
}));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.example.com' } }));
vi.mock('@/server/services/heterogeneousAgent/operationPrincipal', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveActiveHeteroOperationPrincipal: mocks.resolvePrincipal,
}));
vi.mock('@/server/services/scm/github/userToken', () => ({
  GithubUserTokenService: vi.fn(function () {
    return { getFreshToken: mocks.getFreshToken };
  }),
}));

const owner = 'cred-owner';
const requester = 'cred-requester';
const workspaceId = 'cred-ws';

const claims = (overrides: Record<string, unknown> = {}) => ({
  aud: 'urn:lobehub:hetero-operation',
  capabilities: ['hetero:ingest', 'scm:github-credential'],
  device_id: 'device-jp-1',
  exp: 2_000_000_000,
  iat: 1_900_000_000,
  iss: 'urn:lobehub:internal',
  jti: 'jti-1',
  operation_id: 'op-1',
  purpose: 'hetero-operation',
  requester,
  sub: owner,
  workspace_id: workspaceId,
  ...overrides,
});

const caller = (oidcAuth: Record<string, unknown> = claims()) =>
  scmCredentialRouter.createCaller({ oidcAuth, userId: oidcAuth.sub } as any);

const request = { host: 'github.com', path: 'lobehub/lobehub.git', protocol: 'https' };

beforeEach(async () => {
  vi.clearAllMocks();
  await serverDB.insert(users).values([{ id: owner }, { id: requester }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Cred',
    primaryOwnerId: owner,
    slug: 'cred',
  });
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: owner, workspaceId },
    { role: 'member', userId: requester, workspaceId },
  ]);
  await new WorkspaceModel(serverDB, owner).updateScmRequesterCredential(workspaceId, true);
  mocks.resolvePrincipal.mockResolvedValue({ operationId: 'op-1', userId: owner, workspaceId });
  mocks.getFreshToken.mockResolvedValue({
    expiresAt: new Date('2026-11-17T18:00:00Z'),
    gitEmail: '42+arvinxx@users.noreply.github.com',
    gitName: 'Arvin Xu',
    login: 'arvinxx',
    ok: true,
    token: 'ghu_requester',
  });
});

afterEach(async () => {
  await serverDB.delete(scmCredentialGrants);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

const grants = () => ScmCredentialGrantModel.list(serverDB, { workspaceId });

describe('scmCredentialRouter.github', () => {
  it("hands the requester's own token to the run and records the grant", async () => {
    await expect(caller().github(request)).resolves.toEqual({
      expiresAt: '2026-11-17T18:00:00.000Z',
      gitEmail: '42+arvinxx@users.noreply.github.com',
      gitName: 'Arvin Xu',
      ok: true,
      password: 'ghu_requester',
      username: 'x-access-token',
    });

    expect(mocks.getFreshToken).toHaveBeenCalledWith(requester);
    expect(mocks.resolvePrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'scm:github-credential', operationId: 'op-1' }),
    );
    expect(await grants()).toEqual([
      expect.objectContaining({
        deviceId: 'device-jp-1',
        operationId: 'op-1',
        path: 'hetero',
        repo: 'lobehub/lobehub',
        requesterUserId: requester,
        result: 'issued',
        tokenExpiresAt: new Date('2026-11-17T18:00:00Z'),
      }),
    ]);
  });

  it('records the tool-call path for a token without hetero capabilities', async () => {
    await caller(claims({ capabilities: ['scm:github-credential'] })).github(request);

    expect(await grants()).toEqual([expect.objectContaining({ path: 'tool-call' })]);
  });

  it('refuses a token that does not grant credentials', async () => {
    mocks.resolvePrincipal.mockRejectedValue(
      new HeteroOperationPrincipalError('Operation token does not grant this request', 403),
    );

    await expect(caller().github(request)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.getFreshToken).not.toHaveBeenCalled();
  });

  it('tells a finished run that its credential is gone', async () => {
    mocks.resolvePrincipal.mockRejectedValue(
      new HeteroOperationPrincipalError('Operation has already ended', 409),
    );

    await expect(caller().github(request)).resolves.toMatchObject({
      ok: false,
      reason: 'operation_ended',
    });
    expect(await grants()).toEqual([expect.objectContaining({ result: 'operation_ended' })]);
  });

  it('refuses a token without a requester', async () => {
    await expect(caller(claims({ requester: undefined })).github(request)).resolves.toMatchObject({
      ok: false,
      reason: 'no_requester',
    });
    expect(mocks.getFreshToken).not.toHaveBeenCalled();
  });

  it('refuses while the workspace has the policy off', async () => {
    await new WorkspaceModel(serverDB, owner).updateScmRequesterCredential(workspaceId, false);

    await expect(caller().github(request)).resolves.toMatchObject({
      ok: false,
      reason: 'policy_disabled',
    });
    expect(mocks.getFreshToken).not.toHaveBeenCalled();
  });

  it('refuses a requester who left the workspace', async () => {
    await serverDB.delete(workspaceMembers);
    await serverDB.insert(workspaceMembers).values({ role: 'owner', userId: owner, workspaceId });

    await expect(caller().github(request)).resolves.toMatchObject({
      ok: false,
      reason: 'requester_not_member',
    });
    expect(mocks.getFreshToken).not.toHaveBeenCalled();
  });

  it('sends a requester without an authorization to connect their account', async () => {
    mocks.getFreshToken.mockResolvedValue({ ok: false, reason: 'not_authorized' });

    await expect(caller().github(request)).resolves.toEqual({
      authorizeUrl:
        'https://app.example.com/api/webhooks/github/authorize?returnTo=%2Fsettings%2Fintegrations%2Fgithub',
      message: expect.any(String),
      ok: false,
      reason: 'not_authorized',
    });
    expect(await grants()).toEqual([expect.objectContaining({ result: 'not_authorized' })]);
  });

  it('refuses hosts other than github.com', async () => {
    await expect(caller().github({ ...request, host: 'gitlab.com' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('refuses a user session', async () => {
    await expect(caller({ sub: owner }).github(request)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
