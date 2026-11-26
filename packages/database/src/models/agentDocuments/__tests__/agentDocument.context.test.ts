// @vitest-environment node
// `findContextByAgent` against a real database: the rows the agent runtime
// reads to build the agent-document context of a step.
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentDocuments, agents, documents, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { AgentDocumentModel, PolicyLoad } from '../agentDocument';

const userId = 'agent-document-context-user';
const agentId = 'agent-document-context-agent';

const serverDB: LobeChatDatabase = await getTestDB();
let model: AgentDocumentModel;

const cleanup = async () => {
  // Users cascade to agents, documents and agent_documents.
  await serverDB.delete(users).where(eq(users.id, userId));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, userId });
  model = new AgentDocumentModel(serverDB, userId);
});

afterEach(cleanup);

/** Binds a folder row the way the tool-result archive creates `.tool-results`. */
const createFolder = async (filename: string, policyLoad: PolicyLoad) => {
  const [folder] = await serverDB
    .insert(documents)
    .values({
      fileType: 'custom/folder',
      filename,
      source: `test://${filename}`,
      sourceType: 'agent',
      title: filename,
      totalCharCount: 0,
      totalLineCount: 0,
      userId,
    })
    .returning();
  await serverDB
    .insert(agentDocuments)
    .values({ agentId, documentId: folder!.id, policyLoad, userId });
  return folder!;
};

describe('AgentDocumentModel.findContextByAgent', () => {
  beforeEach(async () => {
    await model.create(agentId, 'notes.md', 'progressive notes');
    await model.create(agentId, 'style.md', 'Always follow the style guide.', {
      policyLoad: PolicyLoad.ALWAYS,
    });
    await model.create(agentId, 'paused.md', 'disabled for now', {
      policyLoad: PolicyLoad.DISABLED,
    });
    await createFolder('.tool-results', PolicyLoad.PROGRESSIVE);
  });

  it('reads every live document by default', async () => {
    const rows = await model.findContextByAgent(agentId);

    expect(rows.map((row) => row.filename).sort()).toEqual([
      '.tool-results',
      'notes.md',
      'paused.md',
      'style.md',
    ]);
  });

  it('loads description only for always documents', async () => {
    await serverDB
      .update(documents)
      .set({ description: 'summary' })
      .where(eq(documents.userId, userId));

    const rows = await model.findContextByAgent(agentId);

    expect(rows.find((row) => row.filename === 'style.md')?.description).toBe('summary');
    expect(rows.find((row) => row.filename === 'notes.md')?.description).toBeNull();
  });

  it('keeps only always documents and folders when asked', async () => {
    const rows = await model.findContextByAgent(agentId, { excludeProgressive: true });

    expect(rows.map((row) => row.filename).sort()).toEqual(['.tool-results', 'style.md']);
    expect(rows.find((row) => row.filename === 'style.md')).toMatchObject({
      content: 'Always follow the style guide.',
      policyLoad: PolicyLoad.ALWAYS,
    });
  });
});
