// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentDocuments, agents, documents, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentDocumentModel } from '../agentDocuments';
import { AgentSignalReviewContextModel } from '../agentSignal/reviewContext';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-signal-review-workspace-user';
const workspaceId = 'agent-signal-review-workspace';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Agent Signal Review Workspace',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
  await serverDB.insert(agents).values([
    {
      chatConfig: { selfIteration: { enabled: true } },
      id: 'personal-review-agent',
      title: 'Personal Review Agent',
      userId,
      virtual: false,
      workspaceId: null,
    },
    {
      chatConfig: { selfIteration: { enabled: true } },
      id: 'workspace-review-agent',
      title: 'Workspace Review Agent',
      userId,
      virtual: false,
      workspaceId,
    },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentSignalReviewContextModel workspace scope', () => {
  it('isolates self-iteration checks and document activity by workspace', async () => {
    const personalContext = new AgentSignalReviewContextModel(serverDB, userId);
    const workspaceContext = new AgentSignalReviewContextModel(serverDB, userId, workspaceId);
    const personalDocumentModel = new AgentDocumentModel(serverDB, userId);
    const workspaceDocumentModel = new AgentDocumentModel(serverDB, userId, workspaceId);

    const personalDoc = await personalDocumentModel.create(
      'personal-review-agent',
      'personal.md',
      '# Personal',
    );
    const workspaceDoc = await workspaceDocumentModel.create(
      'workspace-review-agent',
      'workspace.md',
      '# Workspace',
    );

    await expect(personalContext.canAgentRunSelfIteration('personal-review-agent')).resolves.toBe(
      true,
    );
    await expect(personalContext.canAgentRunSelfIteration('workspace-review-agent')).resolves.toBe(
      false,
    );
    await expect(workspaceContext.canAgentRunSelfIteration('personal-review-agent')).resolves.toBe(
      false,
    );
    await expect(workspaceContext.canAgentRunSelfIteration('workspace-review-agent')).resolves.toBe(
      true,
    );

    const window = {
      agentId: 'workspace-review-agent',
      windowEnd: new Date('2100-01-01'),
      windowStart: new Date('2000-01-01'),
    };

    await expect(personalContext.listDocumentActivity(window)).resolves.toEqual([]);
    await expect(workspaceContext.listDocumentActivity(window)).resolves.toEqual([
      expect.objectContaining({
        agentDocumentId: workspaceDoc.id,
        documentId: workspaceDoc.documentId,
      }),
    ]);

    await expect(
      workspaceContext.listDocumentActivity({
        ...window,
        agentId: 'personal-review-agent',
      }),
    ).resolves.toEqual([]);
    await expect(personalDocumentModel.findById(personalDoc.id)).resolves.toBeDefined();
  });
});

afterEach(async () => {
  await serverDB.delete(agentDocuments).where(eq(agentDocuments.userId, userId));
  await serverDB.delete(documents).where(eq(documents.userId, userId));
  await serverDB.delete(agents).where(eq(agents.userId, userId));
});
