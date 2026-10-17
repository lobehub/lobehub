// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import type { VerifyCheckItem } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import { VerifyRunModel } from '@/database/models/verifyRun';
import { users } from '@/database/schemas';

import { carryPassedResultsForward } from '../carryForward';
import { VerifyExecutorService } from '../executor';

// No stored files in this scenario; the real service only refuses to build without S3 env.
vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));

const serverDB = await getTestDB();
const userId = 'carry-forward-db-user';
const sourceOperationId = 'carry-forward-source-op';
const repairOperationId = 'carry-forward-repair-op';

const planItem = (id: string, index: number, title: string) =>
  ({
    id,
    index,
    required: true,
    title,
    verifierConfig: {},
    verifierType: 'agent',
  }) as VerifyCheckItem;

const plan: VerifyCheckItem[] = [
  planItem('list', 0, 'List migrated'),
  planItem('reader', 1, 'Reader migrated'),
  planItem('keys', 2, 'Dead keys removed'),
];

const runs = () => new VerifyRunModel(serverDB, userId);
const results = () => new VerifyCheckResultModel(serverDB, userId);
const evidence = () => new VerifyEvidenceModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  await new AgentOperationModel(serverDB, userId).recordStart({ operationId: sourceOperationId });
  await new AgentOperationModel(serverDB, userId).recordStart({ operationId: repairOperationId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

/**
 * The production shape that looped T-776: round N passed two checks and
 * failed one, the repair turn only evidenced the failed one, and every
 * repair round then re-gated the two passing checks on zero evidence.
 */
describe('repair round carry-forward (database)', () => {
  it('keeps passed checks and their evidence, and judges only the repaired check', async () => {
    const source = await runs().ensureForOperation(sourceOperationId);
    await runs().setPlan(source.id, plan);
    await runs().confirmPlan(source.id);
    for (const [item, verdict] of [
      [plan[0], 'passed'],
      [plan[1], 'failed'],
      [plan[2], 'passed'],
    ] as const) {
      const result = await results().upsertByCheckItem({
        checkItemId: item.id,
        checkItemIndex: item.index,
        checkItemTitle: item.title,
        completedAt: new Date(),
        status: verdict,
        toulmin: { reasoning: `${item.title} judged ${verdict}` },
        verdict,
        verifierType: 'agent',
        verifyRunId: source.id,
      });
      await evidence().createMany([
        {
          capturedAt: new Date(),
          capturedBy: 'cli',
          checkResultId: result.id,
          content: `${item.id} evidence`,
          description: `${item.id} caption`,
          documentId: null,
          fileId: null,
          metadata: null,
          type: 'text',
        },
      ]);
    }

    // What prepareRepairRound does for the repair operation.
    const repair = await runs().ensureForOperation(repairOperationId);
    await runs().setPlan(repair.id, plan);
    await runs().confirmPlan(repair.id);
    const carried = await carryPassedResultsForward(serverDB, userId, {
      excludeItemIds: ['reader'],
      operationId: repairOperationId,
      plan,
      sourceRoundIndex: 1,
      sourceRunId: source.id,
      targetRunId: repair.id,
    });
    expect(carried).toEqual(['list', 'keys']);

    // The repair turn evidences only the check it was asked to fix.
    const reader = await results().upsertByCheckItem({
      checkItemId: 'reader',
      checkItemIndex: 1,
      checkItemTitle: 'Reader migrated',
      verifierType: 'agent',
      verifyRunId: repair.id,
    });
    await evidence().createMany([
      {
        capturedAt: new Date(),
        capturedBy: 'cli',
        checkResultId: reader.id,
        content: 'reader fix evidence',
        description: 'reader fixed',
        documentId: null,
        fileId: null,
        metadata: null,
        type: 'text',
      },
    ]);

    const runVerifierAgent = vi.fn().mockResolvedValue({ verifierOperationId: null });
    await new VerifyExecutorService(serverDB, userId).execute({
      deliverable: 'Fixed the reader. No other code changed this round.',
      goal: 'migrate agent documents to replica',
      modelConfig: { model: 'gpt-4o-mini', provider: 'openai' },
      operationId: repairOperationId,
      runVerifierAgent,
    });

    // Only the repaired check reaches a verifier.
    expect(runVerifierAgent).toHaveBeenCalledTimes(1);
    expect(runVerifierAgent.mock.calls[0][0].checkItem.id).toBe('reader');

    const repaired = await results().listByRun(repair.id);
    const byItem = Object.fromEntries(repaired.map((row) => [row.checkItemId, row]));
    for (const id of ['list', 'keys']) {
      expect(byItem[id]).toMatchObject({ status: 'passed', verdict: 'passed' });
      expect(byItem[id].metadata).toMatchObject({
        carriedFrom: { roundIndex: 1, verifyRunId: source.id },
      });
      expect(byItem[id].toulmin?.reasoning).toContain('judged passed');
    }

    // The carried checks hold the earlier round's evidence, so the Goal review
    // and the acceptance page still read a real artifact for each of them.
    const repairEvidence = await evidence().listByRun(repair.id);
    expect(
      repairEvidence
        .map((row) => [row.checkItemId, row.content])
        .sort(([a], [b]) => a.localeCompare(b)),
    ).toEqual([
      ['keys', 'keys evidence'],
      ['list', 'list evidence'],
      ['reader', 'reader fix evidence'],
    ]);
  });
});
