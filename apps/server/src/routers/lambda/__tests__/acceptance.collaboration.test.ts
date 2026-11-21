// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  acceptanceComments,
  acceptances,
  agentOperations,
  agents,
  messages,
  topics,
  users,
  verifyRuns,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { acceptanceRouter } from '../acceptance';
import { cleanupTestUser, createTestContext, createTestUser } from './integration/setup';

let serverDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => serverDB }));
vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFileAccessUrl = async ({ url }: { url?: string | null }) => url ?? '';
  },
}));
const mockExecAgent = vi.fn();
const aiAgentScopes: unknown[][] = [];
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function (...args: unknown[]) {
    aiAgentScopes.push(args);
    return { execAgent: mockExecAgent };
  }),
}));

/**
 * Edit-collaboration hands a reader the owner's conversation for one
 * acceptance: they read it and talk to its agent, and everything they start
 * runs as the owner. Without the grant, none of it is reachable.
 */
describe('acceptanceRouter collaboration', () => {
  let ownerId: string;
  let collaboratorId: string;
  let acceptanceId: string;
  let agentId: string;
  let topicId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    ownerId = await createTestUser(serverDB);
    collaboratorId = await createTestUser(serverDB);
    await serverDB
      .update(users)
      .set({ fullName: 'Canis Reviewer' })
      .where(eq(users.id, collaboratorId));

    const [agent] = await serverDB
      .insert(agents)
      .values({ title: 'Landing Builder', userId: ownerId })
      .returning();
    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId: agent.id, title: 'Simplify the project home', userId: ownerId })
      .returning();
    agentId = agent.id;
    topicId = topic.id;
    await serverDB.insert(messages).values({
      agentId,
      content: 'Round 1 is ready for review.',
      role: 'assistant',
      topicId,
      userId: ownerId,
    });

    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({
        status: 'delivered',
        subjectId: randomUUID(),
        subjectType: 'standalone',
        userId: ownerId,
        visibility: 'public',
      })
      .returning();
    acceptanceId = acceptance.id;
    await serverDB.insert(verifyRuns).values({
      acceptanceId,
      metadata: { origin: { agentId, topicId } },
      roundIndex: 1,
      status: 'passed',
      userId: ownerId,
    });
  });

  afterEach(async () => {
    mockExecAgent.mockReset();
    aiAgentScopes.length = 0;
    await cleanupTestUser(serverDB, collaboratorId);
    await cleanupTestUser(serverDB, ownerId);
  });

  const grant = (status: 'granted' | 'revoked' = 'granted') =>
    serverDB.insert(acceptanceComments).values({
      acceptanceId,
      authorUserId: collaboratorId,
      clientId: randomUUID(),
      content: '',
      kind: 'access_request',
      metadata: { accessRequest: { permission: 'collaborate', status } },
    });

  const caller = (userId: string) => acceptanceRouter.createCaller(createTestContext(userId));

  it('keeps the conversation from a reader who was never granted collaboration', async () => {
    await expect(
      caller(collaboratorId).getOriginConversation({ id: acceptanceId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller(collaboratorId).sendToOriginAgent({ content: 'hi', id: acceptanceId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('stops honouring a revoked grant', async () => {
    await grant('revoked');

    await expect(
      caller(collaboratorId).getOriginConversation({ id: acceptanceId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('shows a collaborator the bound conversation, without the owner’s identity', async () => {
    await grant();

    const result = await caller(collaboratorId).getOriginConversation({ id: acceptanceId });

    expect(result.running).toBe(false);
    expect(result.agentId).toBe(agentId);
    expect(result.messages.map((message) => message.content)).toContain(
      'Round 1 is ready for review.',
    );
    expect(result.messages.every((message) => !(message as any).sender)).toBe(true);
  });

  it('tells a collaborator what conversation they can talk in, but never its ids', async () => {
    await grant();

    const bundle = await caller(collaboratorId).getBundle({ id: acceptanceId });

    expect(bundle).toMatchObject({
      canCollaborate: true,
      canReject: true,
      canReview: false,
      collaboration: {
        agent: { title: 'Landing Builder' },
        topicTitle: 'Simplify the project home',
      },
      origin: null,
      repairDispatchAvailable: true,
    });
    expect(JSON.stringify(bundle.collaboration)).not.toContain(topicId);
  });

  it('sends a collaborator’s message to the owner’s agent, as the owner, signed by them', async () => {
    await grant();
    mockExecAgent.mockResolvedValue({ operationId: 'op_collab' });

    const result = await caller(collaboratorId).sendToOriginAgent({
      content: 'Keep only chat and task in the composer',
      id: acceptanceId,
    });

    expect(result).toEqual({ operationId: 'op_collab' });
    expect(aiAgentScopes.at(-1)?.[1]).toBe(ownerId);
    expect(mockExecAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId, appContext: { topicId } }),
    );
    const prompt = mockExecAgent.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('Canis Reviewer');
    expect(prompt).toContain('Keep only chat and task in the composer');
  });

  it('refuses a second message while the agent is still replying', async () => {
    await grant();
    await serverDB
      .insert(agentOperations)
      .values({ id: `op_${randomUUID()}`, status: 'running', topicId, userId: ownerId });

    await expect(
      caller(collaboratorId).sendToOriginAgent({ content: 'one more thing', id: acceptanceId }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mockExecAgent).not.toHaveBeenCalled();
    await expect(
      caller(collaboratorId).getOriginConversation({ id: acceptanceId }),
    ).resolves.toMatchObject({ running: true });
  });

  it('leaves the owner on their own chat', async () => {
    await expect(caller(ownerId).getOriginConversation({ id: acceptanceId })).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
  });
});
