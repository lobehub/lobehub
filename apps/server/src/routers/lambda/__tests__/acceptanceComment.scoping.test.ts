// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import {
  acceptanceComments,
  acceptances,
  verifyCheckResults,
  verifyCriteria,
  verifyEvidence,
  verifyRuns,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { acceptanceCommentRouter } from '../acceptanceComment';
import { cleanupTestUser, createTestAgent, createTestUser } from './integration/setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

const rect = { height: 0.2, width: 0.3, x: 0.1, y: 0.1 };

/**
 * A comment carries three references that the schema alone does not constrain:
 * the agent it speaks as, the round it was written against, and the evidence it
 * is pinned to. Access is resolved from `acceptanceId`, so each of those has to
 * be re-checked against that acceptance before it is stored — otherwise a
 * participant of one acceptance can name rows belonging to another.
 */
describe('acceptanceCommentRouter create reference scoping', () => {
  let serverDB: LobeChatDatabase;
  let ownerId: string;
  let strangerId: string;
  let acceptanceId: string;
  let foreignAcceptanceId: string;
  let ownAgentId: string;
  let foreignAgentId: string;
  let ownRunId: string;
  let ownEvidenceId: string;
  let foreignRunId: string;
  let foreignEvidenceId: string;

  const seedRound = async (targetAcceptanceId: string, userId: string) => {
    const [run] = await serverDB
      .insert(verifyRuns)
      .values({ acceptanceId: targetAcceptanceId, roundIndex: 1, userId })
      .returning();
    const [result] = await serverDB
      .insert(verifyCheckResults)
      .values({ checkItemId: 'c1', userId, verifierType: 'agent', verifyRunId: run.id })
      .returning();
    const [evidence] = await serverDB
      .insert(verifyEvidence)
      .values({ checkResultId: result.id, type: 'screenshot', userId })
      .returning();
    return { evidenceId: evidence.id, runId: run.id };
  };

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    ownerId = await createTestUser(serverDB);
    strangerId = await createTestUser(serverDB);
    ownAgentId = await createTestAgent(serverDB, ownerId);
    foreignAgentId = await createTestAgent(serverDB, strangerId);

    const [own, foreign] = await serverDB
      .insert(acceptances)
      .values([
        { subjectId: randomUUID(), subjectType: 'standalone', userId: ownerId },
        { subjectId: randomUUID(), subjectType: 'standalone', userId: strangerId },
      ])
      .returning();
    acceptanceId = own.id;
    foreignAcceptanceId = foreign.id;

    ({ evidenceId: ownEvidenceId, runId: ownRunId } = await seedRound(acceptanceId, ownerId));
    ({ evidenceId: foreignEvidenceId, runId: foreignRunId } = await seedRound(
      foreignAcceptanceId,
      strangerId,
    ));
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, strangerId);
    await cleanupTestUser(serverDB, ownerId);
    vi.clearAllMocks();
  });

  const caller = (userId: string) =>
    acceptanceCommentRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  it('rejects an agent the caller cannot use', async () => {
    await expect(
      caller(ownerId).create({
        acceptanceId,
        authorAgentId: foreignAgentId,
        clientId: `c-${randomUUID()}`,
        content: 'signed as someone else',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('attributes an agent the caller owns', async () => {
    const { data } = await caller(ownerId).create({
      acceptanceId,
      authorAgentId: ownAgentId,
      clientId: `c-${randomUUID()}`,
      content: 'signed as my own agent',
    });

    expect(data.author).toMatchObject({ id: ownAgentId, type: 'agent' });
  });

  it('rejects a round belonging to another acceptance', async () => {
    await expect(
      caller(ownerId).create({
        acceptanceId,
        clientId: `c-${randomUUID()}`,
        content: 'quoting a foreign round',
        contextRunId: foreignRunId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects evidence belonging to another acceptance', async () => {
    await expect(
      caller(ownerId).create({
        acceptanceId,
        anchor: { checkItemId: 'c1', evidenceId: foreignEvidenceId, rect },
        clientId: `c-${randomUUID()}`,
        content: 'pinned to foreign evidence',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('accepts the acceptance own round and evidence', async () => {
    const { data } = await caller(ownerId).create({
      acceptanceId,
      anchor: { checkItemId: 'c1', evidenceId: ownEvidenceId, rect },
      clientId: `c-${randomUUID()}`,
      content: 'pinned to my own evidence',
      contextRunId: ownRunId,
    });

    expect(data).toMatchObject({ contextRoundIndex: 1, evidenceId: ownEvidenceId });
  });
  it.each(['screenshot', 'video'] as const)(
    'keeps the viewing round when commenting on inherited %s evidence',
    async (type) => {
      await serverDB
        .update(verifyEvidence)
        .set({ type })
        .where(eq(verifyEvidence.id, ownEvidenceId));
      const [viewingRun] = await serverDB
        .insert(verifyRuns)
        .values({
          acceptanceId,
          roundIndex: 2,
          userId: ownerId,
        })
        .returning();
      const { data } = await caller(ownerId).create({
        acceptanceId,
        anchor: {
          checkItemId: 'c1',
          evidenceId: ownEvidenceId,
          rect,
          ...(type === 'video' ? { time: { start: 1.25 } } : {}),
        },
        clientId: randomUUID(),
        content: 'comment on inherited evidence while viewing round two',
        contextRunId: viewingRun.id,
      });
      expect(data).toMatchObject({ contextRoundIndex: 2, evidenceId: ownEvidenceId });
      const [stored] = await serverDB
        .select()
        .from(acceptanceComments)
        .where(eq(acceptanceComments.id, data.id));
      expect(stored.contextRunId).toBe(viewingRun.id);
      expect(stored.evidenceId).toBe(ownEvidenceId);
    },
  );

  it('rejects a foreign viewing round even when the evidence belongs to this acceptance', async () => {
    await expect(
      caller(ownerId).create({
        acceptanceId,
        anchor: { checkItemId: 'c1', evidenceId: ownEvidenceId, rect },
        clientId: randomUUID(),
        content: 'foreign round with local evidence',
        contextRunId: foreignRunId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each(['screenshot', 'gif', 'video'] as const)(
    'keeps flow occurrence identity for %s comments, including inherited evidence',
    async (type) => {
      const [asset] = await serverDB
        .insert(verifyCriteria)
        .values({ title: 'Shared criterion', verifierType: 'agent', userId: ownerId })
        .returning();
      const assetId = asset.id;
      const occurrenceId = 'node:branch';
      const otherOccurrenceId = 'node:other-branch';
      await serverDB
        .update(verifyRuns)
        .set({
          plan: [occurrenceId, otherOccurrenceId].map((id, index) => ({
            id,
            index,
            title: 'Shared flow criterion',
            onFail: 'manual' as const,
            verifierType: 'agent' as const,
            verifierConfig: {},
            required: true,
            sourceCriterionId: assetId,
            sourceFlowNode: { flowId: 'flow', nodeId: 'node', incomingEdgeId: id },
          })),
        })
        .where(eq(verifyRuns.id, ownRunId));
      const [evidence] = await serverDB
        .select()
        .from(verifyEvidence)
        .where(eq(verifyEvidence.id, ownEvidenceId));
      await serverDB
        .update(verifyCheckResults)
        .set({ checkItemId: occurrenceId, sourceCriterionId: assetId })
        .where(eq(verifyCheckResults.id, evidence.checkResultId));
      await serverDB
        .update(verifyEvidence)
        .set({ type })
        .where(eq(verifyEvidence.id, ownEvidenceId));
      // The viewing round need not contain the original flow plan.
      const [viewingRun] = await serverDB
        .insert(verifyRuns)
        .values({ acceptanceId, roundIndex: 2, userId: ownerId })
        .returning();
      const input = {
        acceptanceId,
        anchor: {
          checkItemId: occurrenceId,
          evidenceId: ownEvidenceId,
          rect,
          ...(type === 'video' ? { time: { start: 1.25 } } : {}),
        },
        clientId: randomUUID(),
        content: 'Feedback on this flow occurrence',
        contextRunId: viewingRun.id,
      };
      const { data } = await caller(ownerId).create(input);
      expect(data).toMatchObject({
        checkItemId: occurrenceId,
        contextRoundIndex: 2,
        evidenceId: ownEvidenceId,
      });
      const [stored] = await serverDB
        .select()
        .from(acceptanceComments)
        .where(eq(acceptanceComments.id, data.id));
      expect(stored).toMatchObject({ checkItemId: occurrenceId, contextRunId: viewingRun.id });
      for (const checkItemId of [assetId, otherOccurrenceId]) {
        await expect(
          caller(ownerId).create({
            ...input,
            anchor: { ...input.anchor, checkItemId },
            clientId: randomUUID(),
          }),
        ).rejects.toMatchObject({
          code: 'BAD_REQUEST',
          message: 'Evidence belongs to another check',
        });
      }
    },
  );

  it('uses the criterion identity for non-flow evidence', async () => {
    const [criterion] = await serverDB
      .insert(verifyCriteria)
      .values({ title: 'Ordinary criterion', verifierType: 'agent', userId: ownerId })
      .returning();
    const criterionId = criterion.id;
    await serverDB
      .update(verifyRuns)
      .set({
        plan: [
          {
            id: 'c1',
            index: 0,
            title: 'Ordinary check',
            onFail: 'manual',
            verifierType: 'agent',
            verifierConfig: {},
            required: true,
            sourceCriterionId: criterionId,
          },
        ],
      })
      .where(eq(verifyRuns.id, ownRunId));
    await serverDB
      .update(verifyCheckResults)
      .set({ sourceCriterionId: criterionId })
      .where(eq(verifyCheckResults.verifyRunId, ownRunId));
    const { data } = await caller(ownerId).create({
      acceptanceId,
      anchor: { checkItemId: criterionId, evidenceId: ownEvidenceId, rect },
      clientId: randomUUID(),
      content: 'Ordinary criterion feedback',
    });
    expect(data.checkItemId).toBe(criterionId);
    await expect(
      caller(ownerId).create({
        acceptanceId,
        anchor: { checkItemId: 'c1', evidenceId: ownEvidenceId, rect },
        clientId: randomUUID(),
        content: 'Wrong physical ID',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('round-trips a video frame and keeps repeated sends idempotent', async () => {
    await serverDB
      .update(verifyEvidence)
      .set({ type: 'video' })
      .where(eq(verifyEvidence.id, ownEvidenceId));
    const input = {
      acceptanceId,
      anchor: {
        checkItemId: 'c1',
        evidenceId: ownEvidenceId,
        rect,
        time: { start: 1.25 },
      },
      clientId: `video-${randomUUID()}`,
      content: 'this part needs explanation',
      contextRunId: ownRunId,
    };
    const first = await caller(ownerId).create(input);
    const retry = await caller(ownerId).create(input);
    expect(first.data.time).toEqual({ start: 1.25 });
    const [stored] = await serverDB
      .select()
      .from(acceptanceComments)
      .where(eq(acceptanceComments.id, first.data.id));
    expect(stored.metadata).toEqual({
      evidenceAnchor: { time: { start: 1.25 } },
    });
    expect(retry.data.id).toBe(first.data.id);
    const list = await caller(ownerId).list({ acceptanceId });
    expect(list.items.find((item) => item.id === first.data.id)?.time).toEqual(input.anchor.time);
    const [run] = await serverDB.select().from(verifyRuns).where(eq(verifyRuns.id, ownRunId));
    expect(run.userDecision).toBeNull();
  });

  it.each([undefined, { start: -1 }, { start: 'bad' }])(
    'does not expose invalid time from malformed metadata: %j',
    async (time) => {
      const { data } = await caller(ownerId).create({
        acceptanceId,
        anchor: { checkItemId: 'c1', evidenceId: ownEvidenceId, rect },
        clientId: randomUUID(),
        content: 'original image comment',
      });
      expect(data.time).toBeNull();
      // Seed malformed stored JSON directly rather
      // than weakening the new metadata contract to admit these values.
      await serverDB
        .update(acceptanceComments)
        .set({ metadata: sql`${JSON.stringify({ evidenceAnchor: { time } })}::jsonb` })
        .where(eq(acceptanceComments.id, data.id));
      const list = await caller(ownerId).list({ acceptanceId });
      expect(list.items.find((item) => item.id === data.id)).toMatchObject({
        time: null,
        rect,
        content: 'original image comment',
      });
    },
  );

  it('rejects a video time on an image and a mismatched check', async () => {
    const input = {
      acceptanceId,
      anchor: { checkItemId: 'c1', evidenceId: ownEvidenceId, rect, time: { start: 1 } },
      clientId: randomUUID(),
      content: 'bad anchor',
    };
    await expect(caller(ownerId).create(input)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller(ownerId).create({
        ...input,
        anchor: { ...input.anchor, checkItemId: 'c2', time: undefined },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it.each([{ start: -1 }, { start: NaN }, { start: Infinity }])(
    'rejects invalid time %j',
    async (time) => {
      await expect(
        caller(ownerId).create({
          acceptanceId,
          anchor: { checkItemId: 'c1', evidenceId: ownEvidenceId, rect, time },
          clientId: randomUUID(),
          content: 'invalid',
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    },
  );
});
