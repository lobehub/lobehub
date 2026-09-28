// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import {
  acceptances,
  verifyCheckResults,
  verifyEvidence,
  verifyRuns,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
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
});
