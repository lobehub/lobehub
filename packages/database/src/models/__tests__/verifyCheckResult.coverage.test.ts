// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, verifyCheckResults, verifyCriteria, verifyRuns } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { VerifyCheckResultModel } from '../verifyCheckResult';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'verify-result-coverage-user';
const otherUserId = 'verify-result-coverage-other';

let criterionId: string;
let verifyRunId: string;

beforeEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  const [criterion] = await serverDB
    .insert(verifyCriteria)
    .values({ title: 'goal met', userId, verifierType: 'llm' })
    .returning();
  criterionId = criterion.id;

  const [run] = await serverDB
    .insert(verifyRuns)
    .values({
      plan: [
        {
          id: 'item-from-criterion',
          index: 0,
          onFail: 'manual',
          required: true,
          sourceCriterionId: criterionId,
          title: 'goal met',
          verifierConfig: {},
          verifierType: 'llm',
        },
        {
          id: 'item-inline',
          index: 1,
          onFail: 'manual',
          required: true,
          title: 'inline check',
          verifierConfig: {},
          verifierType: 'llm',
        },
      ],
      userId,
    })
    .returning();
  verifyRunId = run.id;
});

afterEach(async () => {
  // Results, runs and criteria cascade from their owning user.
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('VerifyCheckResultModel coverage', () => {
  describe('sourceCriterionId resolution', () => {
    it('copies the plan item source criterion onto the result, null for inline items', async () => {
      const model = new VerifyCheckResultModel(serverDB, userId);

      const fromCriterion = await model.create({
        checkItemId: 'item-from-criterion',
        verifierType: 'llm',
        verifyRunId,
      });
      const inline = await model.create({
        checkItemId: 'item-inline',
        verifierType: 'llm',
        verifyRunId,
      });
      const unknownItem = await model.create({
        checkItemId: 'item-not-in-plan',
        verifierType: 'llm',
        verifyRunId,
      });

      expect(fromCriterion.sourceCriterionId).toBe(criterionId);
      expect(inline.sourceCriterionId).toBeNull();
      expect(unknownItem.sourceCriterionId).toBeNull();
    });

    it('creates a result with no verify run and no source criterion', async () => {
      const model = new VerifyCheckResultModel(serverDB, userId);

      const result = await model.create({ checkItemId: 'standalone', verifierType: 'llm' });

      expect(result).toMatchObject({
        checkItemId: 'standalone',
        sourceCriterionId: null,
        userId,
        verifyRunId: null,
      });
    });

    it('createMany resolves the source criterion per row and skips run-less rows', async () => {
      const model = new VerifyCheckResultModel(serverDB, userId);

      const rows = await model.createMany([
        { checkItemId: 'item-from-criterion', verifierType: 'llm', verifyRunId },
        { checkItemId: 'standalone', verifierType: 'llm' },
      ]);

      const byItem = Object.fromEntries(rows.map((r) => [r.checkItemId, r]));
      expect(byItem['item-from-criterion'].sourceCriterionId).toBe(criterionId);
      expect(byItem.standalone).toMatchObject({ sourceCriterionId: null, verifyRunId: null });
    });
  });

  describe('upsertByCheckItem', () => {
    it("throws instead of overwriting another user's row on the same (run, item) key", async () => {
      await serverDB.insert(verifyCheckResults).values({
        checkItemId: 'item-inline',
        status: 'passed',
        userId: otherUserId,
        verifierType: 'llm',
        verifyRunId,
      });

      const model = new VerifyCheckResultModel(serverDB, userId);

      await expect(
        model.upsertByCheckItem({
          checkItemId: 'item-inline',
          status: 'failed',
          verifierType: 'llm',
          verifyRunId,
        }),
      ).rejects.toThrow('Verify check result "item-inline" not found in the current workspace');

      const [kept] = await serverDB
        .select()
        .from(verifyCheckResults)
        .where(inArray(verifyCheckResults.verifyRunId, [verifyRunId]));
      expect(kept).toMatchObject({ status: 'passed', userId: otherUserId });
    });
  });

  describe('listByCriterion', () => {
    const seed = (checkItemId: string, createdAt: string, owner = userId) =>
      serverDB
        .insert(verifyCheckResults)
        .values({
          checkItemId,
          createdAt: new Date(createdAt),
          sourceCriterionId: criterionId,
          userId: owner,
          verifierType: 'llm',
        })
        .returning()
        .then(([row]) => row);

    it("lists the user's results for a criterion, newest first, with the default limit", async () => {
      const older = await seed('older', '2026-01-01T00:00:00Z');
      const newer = await seed('newer', '2026-01-02T00:00:00Z');
      // Another user's result on the same criterion stays out.
      await seed('foreign', '2026-01-03T00:00:00Z', otherUserId);

      const rows = await new VerifyCheckResultModel(serverDB, userId).listByCriterion(criterionId);

      expect(rows.map((r) => r.id)).toEqual([newer.id, older.id]);
    });

    it('clamps the limit to at least one row', async () => {
      await seed('older', '2026-01-01T00:00:00Z');
      const latest = await seed('newer', '2026-01-02T00:00:00Z');

      const rows = await new VerifyCheckResultModel(serverDB, userId).listByCriterion(
        criterionId,
        0,
      );

      expect(rows.map((r) => r.id)).toEqual([latest.id]);
    });

    it('ignores a caller-supplied source criterion on a run-less create', async () => {
      const created = await new VerifyCheckResultModel(serverDB, userId).create({
        checkItemId: 'standalone',
        sourceCriterionId: criterionId,
        verifierType: 'llm',
      });

      expect(created.sourceCriterionId).toBeNull();
    });
  });

  describe('listByRuns', () => {
    it('returns an empty list for no run ids', async () => {
      const model = new VerifyCheckResultModel(serverDB, userId);
      await model.create({ checkItemId: 'item-inline', verifierType: 'llm', verifyRunId });

      expect(await model.listByRuns([])).toEqual([]);
    });

    it("lists the user's results across runs in display-index order", async () => {
      const [secondRun] = await serverDB.insert(verifyRuns).values({ userId }).returning();
      const model = new VerifyCheckResultModel(serverDB, userId);
      await model.create({
        checkItemId: 'second',
        checkItemIndex: 1,
        verifierType: 'llm',
        verifyRunId,
      });
      await model.create({
        checkItemId: 'first',
        checkItemIndex: 0,
        verifierType: 'llm',
        verifyRunId: secondRun.id,
      });
      await serverDB.insert(verifyCheckResults).values({
        checkItemId: 'foreign',
        checkItemIndex: 2,
        userId: otherUserId,
        verifierType: 'llm',
        verifyRunId,
      });

      const rows = await model.listByRuns([verifyRunId, secondRun.id]);

      expect(rows.map((r) => r.checkItemId)).toEqual(['first', 'second']);
    });
  });
});
