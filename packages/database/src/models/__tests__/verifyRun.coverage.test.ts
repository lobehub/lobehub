// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { acceptances, users, verifyCheckResults, verifyRuns, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { VerifyRunModel } from '../verifyRun';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'verify-run-coverage-user';
const otherUserId = 'verify-run-coverage-other';
const userIds = [userId, otherUserId];
const workspaceId = 'verify-run-coverage-ws';

const insertAcceptance = async () => {
  const [acceptance] = await serverDB
    .insert(acceptances)
    .values({ subjectId: 'verify-run-coverage-task', subjectType: 'task', userId })
    .returning();
  return acceptance;
};

const insertRun = async (values: Partial<typeof verifyRuns.$inferInsert> = {}) => {
  const [run] = await serverDB
    .insert(verifyRuns)
    .values({ userId, ...values })
    .returning();
  return run;
};

beforeEach(async () => {
  // Runs, results, acceptances and the workspace cascade from their owning users.
  await serverDB.delete(users).where(inArray(users.id, userIds));
  await serverDB.insert(users).values(userIds.map((id) => ({ id })));
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, userIds));
});

describe('VerifyRunModel coverage', () => {
  it('creates workspace-scoped runs as private by default', async () => {
    const run = await new VerifyRunModel(serverDB, userId, workspaceId).create({ title: 'ws' });

    expect(run).toMatchObject({ userId, visibility: 'private', workspaceId });
  });

  it('reads a malformed id as not found', async () => {
    const model = new VerifyRunModel(serverDB, userId);

    expect(await model.findById('not-a-uuid')).toBeUndefined();
    expect(await model.getState('not-a-uuid')).toBeNull();
  });

  it('getState maps a run without metadata or status to null fields', async () => {
    const run = await insertRun({ metadata: null, plan: null, status: null });

    expect(await new VerifyRunModel(serverDB, userId).getState(run.id)).toEqual({
      verifyAutoRepair: null,
      verifyPlan: null,
      verifyPlanConfirmedAt: null,
      verifyRunId: run.id,
      verifyStatus: null,
    });
  });

  describe('attachToAcceptance', () => {
    it('inherits an explicit visibility from the acceptance', async () => {
      const acceptance = await insertAcceptance();
      const run = await insertRun({ visibility: 'public' });

      const attached = await new VerifyRunModel(serverDB, userId).attachToAcceptance(
        run.id,
        acceptance.id,
        'private',
      );

      expect(attached).toMatchObject({
        acceptanceId: acceptance.id,
        roundIndex: 1,
        visibility: 'private',
      });
    });

    it("throws for another user's run and leaves it detached", async () => {
      const acceptance = await insertAcceptance();
      const foreign = await insertRun({ userId: otherUserId });

      await expect(
        new VerifyRunModel(serverDB, userId).attachToAcceptance(foreign.id, acceptance.id),
      ).rejects.toThrow(`Verify run "${foreign.id}" not found in the current workspace`);

      const [row] = await serverDB.select().from(verifyRuns).where(eq(verifyRuns.id, foreign.id));
      expect(row.acceptanceId).toBeNull();
    });
  });

  describe('foldIntoRound', () => {
    it('throws when either run is not visible to the caller', async () => {
      const draft = await insertRun({ status: 'planned' });
      const foreign = await insertRun({ userId: otherUserId });

      await expect(
        new VerifyRunModel(serverDB, userId).foldIntoRound(foreign.id, draft.id),
      ).rejects.toThrow('Verify run not found in the current workspace');

      const [row] = await serverDB.select().from(verifyRuns).where(eq(verifyRuns.id, foreign.id));
      expect(row).toBeDefined();
    });

    it('refuses to fold when a run already has results', async () => {
      const draft = await insertRun({ status: 'planned' });
      const source = await insertRun({ status: 'verifying' });
      await serverDB
        .insert(verifyCheckResults)
        .values({ checkItemId: 'c1', userId, verifierType: 'llm', verifyRunId: source.id });

      await expect(
        new VerifyRunModel(serverDB, userId).foldIntoRound(source.id, draft.id),
      ).rejects.toThrow('A run with results cannot fold into a draft round');

      const rows = await serverDB
        .select()
        .from(verifyRuns)
        .where(inArray(verifyRuns.id, [source.id, draft.id]));
      expect(rows).toHaveLength(2);
    });

    it('folds two runs that both have no plan into an empty plan', async () => {
      const draft = await insertRun({ plan: null, status: 'planned' });
      const source = await insertRun({ plan: null, status: null });

      const folded = await new VerifyRunModel(serverDB, userId).foldIntoRound(source.id, draft.id);

      expect(folded).toMatchObject({ id: draft.id, plan: [], status: null });
      expect(folded.planConfirmedAt).toBeInstanceOf(Date);
      const [gone] = await serverDB.select().from(verifyRuns).where(eq(verifyRuns.id, source.id));
      expect(gone).toBeUndefined();
    });
  });
});
