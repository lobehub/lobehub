// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { AcceptanceFlowDefinition } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { acceptances, users, verifyCheckResults, verifyRuns } from '../../schemas';
import { acceptanceFlows } from '../../schemas/acceptanceFlow';
import { AcceptanceFlowModel } from '../acceptanceFlow';

const db = await getTestDB();

const owner = 'flow-guard-owner';
const other = 'flow-guard-other';

const model = new AcceptanceFlowModel(db, owner);

let acceptanceId: string;

/** A single-node journey: enough to publish, small enough to reason about. */
const singleCheck = (title: string): AcceptanceFlowDefinition => {
  const nodeId = randomUUID();
  return {
    title,
    entryNodeId: nodeId,
    nodes: [
      {
        id: nodeId,
        check: {
          id: randomUUID(),
          title: `Check ${title}`,
          definition: {
            steps: [{ id: 'open', instruction: 'Open chat' }],
            expected: 'Composer visible',
          },
        },
      },
    ],
    edges: [],
  };
};

const seedAcceptance = async (status: 'accepted' | 'pending' = 'pending') => {
  const [row] = await db
    .insert(acceptances)
    .values({ subjectId: randomUUID(), subjectType: 'standalone', userId: owner, status })
    .returning();
  return row;
};

const seedRound = async (
  targetAcceptanceId: string,
  values: Partial<typeof verifyRuns.$inferInsert> = {},
) => {
  const [row] = await db
    .insert(verifyRuns)
    .values({ acceptanceId: targetAcceptanceId, roundIndex: 1, userId: owner, ...values })
    .returning();
  return row;
};

beforeEach(async () => {
  await db.insert(users).values([{ id: owner }, { id: other }]).onConflictDoNothing();
  const acceptance = await seedAcceptance();
  acceptanceId = acceptance.id;
});

afterEach(async () => {
  await db.delete(users).where(eq(users.id, owner));
  await db.delete(users).where(eq(users.id, other));
});

describe('AcceptanceFlowModel · start guards', () => {
  it('reports a flow that does not exist in this acceptance', async () => {
    await expect(model.start(acceptanceId, randomUUID())).rejects.toThrow('Flow not found');
  });

  it('reports a flow whose graph has no nodes', async () => {
    const [empty] = await db
      .insert(acceptanceFlows)
      .values({ acceptanceId, title: 'Nothing to verify' })
      .returning();

    await expect(model.start(acceptanceId, empty.id)).rejects.toThrow('Empty flow');
  });

  it('refuses a replay pinned to a round that never snapshotted this flow', async () => {
    const { flowId } = await model.publish(acceptanceId, singleCheck('Replay source'));
    const source = await seedRound(acceptanceId, { flowSnapshots: [], plan: [] });

    await expect(
      model.start(acceptanceId, flowId, undefined, source.id),
    ).rejects.toThrow('Flow snapshot not found');
  });

  it('refuses to extend a round that has already left planning', async () => {
    const { flowId } = await model.publish(acceptanceId, singleCheck('Second flow'));
    const running = await seedRound(acceptanceId, {
      flowSnapshots: [],
      plan: [],
      status: 'running',
    });

    await expect(model.start(acceptanceId, flowId, running.id)).rejects.toThrow(
      'Verification plan is already frozen',
    );
  });

  it('refuses a round that belongs to another acceptance', async () => {
    const { flowId } = await model.publish(acceptanceId, singleCheck('Foreign round'));
    const [otherAcceptance] = await db
      .insert(acceptances)
      .values({ subjectId: randomUUID(), subjectType: 'standalone', userId: owner })
      .returning();
    const foreignRound = await seedRound(otherAcceptance.id, { flowSnapshots: [], plan: [] });

    await expect(model.start(acceptanceId, flowId, foreignRound.id)).rejects.toThrow(
      'An open verification round is required',
    );
  });
});

describe('AcceptanceFlowModel · publish guards', () => {
  it('leaves a draft round that holds no snapshot alone while the graph is edited', async () => {
    const { flowId, hash } = await model.publish(acceptanceId, singleCheck('Editable'));
    // A draft that never planned this flow has nothing to refresh.
    await seedRound(acceptanceId, { flowSnapshots: [], plan: [], roundIndex: 2 });

    await expect(
      model.publish(acceptanceId, singleCheck('Editable'), flowId, hash),
    ).resolves.toEqual(expect.objectContaining({ flowId }));
  });
});

describe('AcceptanceFlowModel · delete guards', () => {
  it('refuses to delete a flow whose open draft already recorded a result', async () => {
    const { flowId } = await model.publish(acceptanceId, singleCheck('Recorded'));
    const { verifyRunId } = await model.start(acceptanceId, flowId);
    const [round] = await db.select().from(verifyRuns).where(eq(verifyRuns.id, verifyRunId));
    const [plannedItem] = round.plan ?? [];
    await db.insert(verifyCheckResults).values({
      checkItemId: plannedItem!.id,
      userId: owner,
      verifierType: 'agent',
      verifyRunId,
    });

    await expect(model.delete(acceptanceId, flowId)).rejects.toThrow(
      'This flow already has recorded results',
    );
  });
});

describe('AcceptanceFlowModel · record guards', () => {
  it('reports an unknown verification round', async () => {
    await expect(
      model.record(acceptanceId, {
        checkItemId: 'check-1',
        observation: 'looks fine',
        verdict: 'passed',
        verifyRunId: randomUUID(),
      }),
    ).rejects.toThrow('Verification round not found');
  });

  it('reports a check item that is not part of the flow plan', async () => {
    const round = await seedRound(acceptanceId, { flowSnapshots: [], plan: [], status: 'planned' });

    await expect(
      model.record(acceptanceId, {
        checkItemId: 'check-1',
        observation: 'looks fine',
        verdict: 'passed',
        verifyRunId: round.id,
      }),
    ).rejects.toThrow('Flow check item not found');
  });

  it('refuses to record against a settled acceptance', async () => {
    const settled = await seedAcceptance('accepted');
    const round = await seedRound(settled.id, {
      plan: [
        {
          definition: undefined,
          id: 'flow-item-1',
          required: true,
          sourceFlowNode: { flowId: randomUUID(), nodeId: randomUUID() },
          title: 'Ready',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ] as never,
      status: 'planned',
    });

    await expect(
      model.record(settled.id, {
        checkItemId: 'flow-item-1',
        observation: 'looks fine',
        verdict: 'passed',
        verifyRunId: round.id,
      }),
    ).rejects.toThrow('Acceptance is closed');
  });
});
