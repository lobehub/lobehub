// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentDocuments, agents, documents, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { AgentDocumentModel } from '../agentDocument';

const userId = 'binding-states-user';
const otherUserId = 'binding-states-other-user';
const agentId = 'binding-states-agent';
const secondAgentId = 'binding-states-agent-2';

const serverDB: LobeChatDatabase = await getTestDB();
let model: AgentDocumentModel;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(agents).values([
    { id: agentId, userId },
    { id: secondAgentId, userId },
  ]);
  model = new AgentDocumentModel(serverDB, userId);
});

describe('AgentDocumentModel binding states', () => {
  it('lists live and deleted bindings of the agent by document id or binding id', async () => {
    const live = await model.create(agentId, 'live.md', 'live');
    const deleted = await model.create(agentId, 'deleted.md', 'deleted');
    const other = await model.create(secondAgentId, 'other.md', 'other');
    await model.delete(deleted.id);

    const rows = await model.listBindingStatesByRefs(agentId, [
      live.documentId,
      deleted.id,
      other.documentId,
      'docs_missing',
      'not-a-uuid-or-doc',
    ]);

    expect(rows.map((row) => row.id).sort()).toEqual([live.id, deleted.id].sort());
    expect(rows.find((row) => row.id === live.id)?.deletedAt).toBeNull();
    expect(rows.find((row) => row.id === deleted.id)?.deletedAt).toBeInstanceOf(Date);
    expect(rows.find((row) => row.id === deleted.id)?.documentId).toBe(deleted.documentId);
  });

  it("never returns another user's bindings", async () => {
    const doc = await model.create(agentId, 'mine.md', 'mine');
    const otherModel = new AgentDocumentModel(serverDB, otherUserId);

    expect(await otherModel.listBindingStatesByRefs(agentId, [doc.documentId, doc.id])).toEqual([]);
    expect(await model.listBindingStatesByRefs(agentId, [])).toEqual([]);
  });

  it('reports a document deleted from every agent it was bound to', async () => {
    const doc = await model.create(agentId, 'rules.md', 'rules');
    expect(await model.isDeletedFromAllAgents(doc.documentId)).toBe(false);

    const copy = await model.associate({ agentId: secondAgentId, documentId: doc.documentId });
    await model.delete(doc.id);
    // Still live on the second agent.
    expect(await model.isDeletedFromAllAgents(doc.documentId)).toBe(false);

    await model.delete(copy.id);
    expect(await model.isDeletedFromAllAgents(doc.documentId)).toBe(true);
  });

  it('never reports a plain document that no agent was bound to', async () => {
    const [doc] = await serverDB
      .insert(documents)
      .values({
        content: 'kb page',
        fileType: 'custom/document',
        source: 'kb',
        sourceType: 'api',
        totalCharCount: 7,
        totalLineCount: 1,
        userId,
      })
      .returning();

    expect(await model.isDeletedFromAllAgents(doc.id)).toBe(false);
    expect(
      await serverDB.select().from(agentDocuments).where(eq(agentDocuments.documentId, doc.id)),
    ).toEqual([]);
  });
});
