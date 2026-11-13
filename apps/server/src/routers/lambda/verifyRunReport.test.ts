import { beforeEach, describe, expect, it, vi } from 'vitest';

import { router } from '@/libs/trpc/lambda';

import { verifyRunReportProcedures } from './verifyRunReport';

const mocks = vi.hoisted(() => ({
  getMember: vi.fn(),
  getServerDB: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mocks.getServerDB }));
vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: vi.fn(function () {
    return { getMember: mocks.getMember };
  }),
}));
vi.mock('@/server/services/verify', () => ({ createEvidenceFileResolver: vi.fn() }));

const RUN_UUID = '61a3475e-52b5-4a58-8ccc-e3ba43062c7a';
const ACCEPTANCE_UUID = '0b7f4c1e-9d2a-4e55-8a3b-1f6c2d9e7a10';

const testRouter = router(verifyRunReportProcedures);
const callerFor = (userId?: string) => testRouter.createCaller({ userId } as any);

const serveRun = (run: Record<string, unknown> | undefined) => {
  const findFirst = vi.fn(async () => run);
  mocks.getServerDB.mockResolvedValue({ query: { verifyRuns: { findFirst } } });
  return findFirst;
};

const baseRun = {
  acceptanceId: ACCEPTANCE_UUID,
  id: RUN_UUID,
  roundIndex: 3,
  userId: 'owner-user',
  visibility: 'public',
  workspaceId: null,
};

describe('verifyRunReportProcedures.getRunAcceptanceRound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMember.mockResolvedValue(undefined);
  });

  it('resolves a public run to its acceptance round without a session', async () => {
    serveRun(baseRun);

    expect(await callerFor().getRunAcceptanceRound({ verifyRunId: RUN_UUID })).toEqual({
      acceptanceId: ACCEPTANCE_UUID,
      roundIndex: 3,
    });
  });

  it('reads a run outside any acceptance as null', async () => {
    serveRun({ ...baseRun, acceptanceId: null, roundIndex: null });

    expect(await callerFor().getRunAcceptanceRound({ verifyRunId: RUN_UUID })).toBeNull();
  });

  it('reads a missing run as null', async () => {
    serveRun(undefined);

    expect(await callerFor().getRunAcceptanceRound({ verifyRunId: RUN_UUID })).toBeNull();
  });

  it('never queries for a malformed run id', async () => {
    const findFirst = serveRun(baseRun);

    expect(
      await callerFor().getRunAcceptanceRound({ verifyRunId: `${RUN_UUID}（本轮` }),
    ).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('hides a private run from visitors, but not from its owner', async () => {
    serveRun({ ...baseRun, visibility: 'private' });
    expect(await callerFor().getRunAcceptanceRound({ verifyRunId: RUN_UUID })).toBeNull();
    expect(
      await callerFor('someone-else').getRunAcceptanceRound({ verifyRunId: RUN_UUID }),
    ).toBeNull();

    expect(await callerFor('owner-user').getRunAcceptanceRound({ verifyRunId: RUN_UUID })).toEqual({
      acceptanceId: ACCEPTANCE_UUID,
      roundIndex: 3,
    });
  });

  it('lets workspace members resolve a private workspace run', async () => {
    serveRun({ ...baseRun, visibility: 'private', workspaceId: 'ws-1' });
    mocks.getMember.mockResolvedValue({ role: 'viewer' });

    expect(await callerFor('member').getRunAcceptanceRound({ verifyRunId: RUN_UUID })).toEqual({
      acceptanceId: ACCEPTANCE_UUID,
      roundIndex: 3,
    });
    expect(mocks.getMember).toHaveBeenCalledWith('ws-1', 'member');
  });
});
