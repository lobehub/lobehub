// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, documents, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { AgentDocumentModel } from '../agentDocument';

const userId = 'agent-document-list-test-user';
const agentId = 'agent-document-list-test-agent';

let agentDocumentModel: AgentDocumentModel;
const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
  await serverDB.insert(agents).values([{ id: agentId, userId }]);
  agentDocumentModel = new AgentDocumentModel(serverDB, userId);
});

describe('AgentDocumentModel list timestamps', () => {
  // The document tree sorts by these; a content edit only touches `documents`.
  it('returns the backing document creation and last-change times', async () => {
    const created = await agentDocumentModel.create(agentId, 'notes.md', 'content', {
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const createdAt = new Date('2025-12-01T00:00:00.000Z');
    const documentUpdatedAt = new Date('2026-02-01T00:00:00.000Z');
    await serverDB
      .update(documents)
      .set({ createdAt, updatedAt: documentUpdatedAt })
      .where(eq(documents.id, created.documentId));

    const [byAgent] = await agentDocumentModel.listByAgent(agentId);
    const [byIds] = await agentDocumentModel.listByDocumentIds(agentId, [created.documentId]);

    for (const item of [byAgent, byIds]) {
      expect(item.createdAt).toEqual(createdAt);
      expect(item.documentUpdatedAt).toEqual(documentUpdatedAt);
      expect(item.updatedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    }
  });
});
