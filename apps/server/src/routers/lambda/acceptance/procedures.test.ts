// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ACCEPTANCE_DECISION_FORBIDDEN, resolveAcceptanceForWrite } from './procedures';

const canManage = vi.hoisted(() => vi.fn());
const getMember = vi.hoisted(() => vi.fn());

vi.mock('../_helpers/acceptanceWriteScope', () => ({
  canManageAcceptance: (...args: unknown[]) => canManage(...args),
}));
vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: class {
    getMember = getMember;
  },
}));
vi.mock('@/server/services/verify', () => ({ AcceptanceService: class {} }));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', () => {
  const procedure = { use: () => procedure };
  return { requireWorkspaceRoleWhenScoped: () => ({}), wsCompatProcedure: procedure };
});
vi.mock('@/libs/trpc/lambda', () => {
  const procedure = { use: () => procedure };
  return { publicProcedure: procedure };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({ serverDatabase: {} }));

const ID = '00000000-0000-4000-8000-000000000001';
const row = {
  id: ID,
  userId: 'author',
  visibility: 'private',
  workspaceId: 'ws_a',
};
const ctx = (found: unknown) =>
  ({
    serverDB: { query: { acceptances: { findFirst: vi.fn().mockResolvedValue(found) } } },
    userId: 'me',
  }) as never;

beforeEach(() => {
  canManage.mockReset();
  getMember.mockReset();
});

describe('resolveAcceptanceForWrite', () => {
  it('resolves a row the caller may decide on', async () => {
    canManage.mockResolvedValue(true);

    await expect(resolveAcceptanceForWrite(ctx(row), ID)).resolves.toMatchObject({
      acceptance: row,
    });
  });

  it('tells a teammate who can read it that they lack the right, not that it is missing', async () => {
    canManage.mockResolvedValue(false);
    getMember.mockResolvedValue({ role: 'member' });

    await expect(resolveAcceptanceForWrite(ctx(row), ID)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: ACCEPTANCE_DECISION_FORBIDDEN,
    });
    expect(getMember).toHaveBeenCalledWith('ws_a', 'me');
  });

  it('keeps an outsider at NOT_FOUND so existence does not leak', async () => {
    canManage.mockResolvedValue(false);
    getMember.mockResolvedValue(undefined);

    await expect(resolveAcceptanceForWrite(ctx(row), ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('answers NOT_FOUND for a missing row', async () => {
    await expect(resolveAcceptanceForWrite(ctx(undefined), ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(canManage).not.toHaveBeenCalled();
  });
});
