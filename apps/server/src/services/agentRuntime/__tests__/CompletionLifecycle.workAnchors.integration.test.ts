// @vitest-environment node
import { type Message, parse } from '@lobechat/conversation-flow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentDocumentModel } from '@/database/models/agentDocuments';
import { MessageModel } from '@/database/models/message';
import { WorkModel } from '@/database/models/work';
import { agents, messages, topics, users } from '@/database/schemas';

import { CompletionLifecycle } from '../CompletionLifecycle';

// No terminal files are discovered: the Work was already registered by a tool.
vi.mock('@/server/services/workRegistration', () => ({
  registerWorksForOperation: vi.fn(async () => ({ attempted: 0, failed: 0 })),
}));

const db = await getTestDB();
const userId = 'anchor-user';
const topicId = 'anchor-topic';
const agentId = 'anchor-agent';
const operationId = 'anchor-operation';
const workModel = new WorkModel(db, userId);
const messageModel = new MessageModel(db, userId);
const lifecycle = new CompletionLifecycle(db, userId);

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: agentId, userId });
  await db.insert(topics).values({ id: topicId, userId });
  await db.insert(messages).values([
    { id: 'source', role: 'user', content: 'Create a document', topicId, userId },
    {
      id: 'intermediate',
      role: 'assistant',
      content: '',
      parentId: 'source',
      topicId,
      userId,
      tools: [
        {
          apiName: 'createDocument',
          arguments: '{}',
          id: 'create-document',
          identifier: 'lobe-agent-documents',
          result_msg_id: 'tool',
          type: 'builtin',
        },
      ],
    },
    { id: 'tool', role: 'tool', content: 'Created', parentId: 'intermediate', topicId, userId },
    {
      id: 'final',
      role: 'assistant',
      content: 'Created the document',
      parentId: 'tool',
      metadata: { finishType: 'stop' },
      topicId,
      userId,
    },
  ]);
});

const registerDocument = async () => {
  const doc = await new AgentDocumentModel(db, userId).create(agentId, 'notes.md', 'Notes', {
    title: 'Notes',
  });
  return workModel.registerDocument({
    agentDocumentId: doc.id,
    agentId,
    documentId: doc.documentId,
    changeType: 'created',
    rootOperationId: operationId,
    toolName: 'createDocument',
    toolIdentifier: 'lobe-agent-documents',
    toolCallId: 'create-document',
    topicId,
  });
};

describe('completion Work anchors with persisted messages and registered outputs', () => {
  it('attaches registered document and external Works only to the explicit final reply', async () => {
    const document = await registerDocument();
    const external = await workModel.registerExternal({
      changeType: 'created',
      resourceId: 'issue-1',
      resourceType: 'linear_issue',
      rootOperationId: operationId,
      toolIdentifier: 'linear',
      toolName: 'save_issue',
      toolCallId: 'create-issue',
      title: 'Follow up',
      topicId,
    });
    const raw = await messageModel.query({ topicId });
    const folded = parse(raw as unknown as Message[]).flatList;
    expect(folded.some((message) => message.role === 'assistantGroup')).toBe(true);
    const state = {
      messages: folded,
      metadata: { workAssistantMessageId: 'final' },
      origin: { sourceMessageId: 'source' },
    };
    await lifecycle.registerFileWorks(operationId, state);
    const result = await messageModel.query({ topicId });
    const final = result.find((message) => message.id === 'final');
    expect(final?.metadata).toMatchObject({
      finishType: 'stop',
      work: { rootOperationId: operationId, userMessageId: 'source' },
    });
    expect(final?.works?.map((work) => work.id).sort()).toEqual(
      [document!.id, external!.id].sort(),
    );
    expect(
      result.filter((message) => message.id !== 'final').every((message) => !message.works),
    ).toBe(true);
    expect(state.metadata).toHaveProperty('_fileWorksRegistered', true);
  });

  it("does not attach another operation's existing Work to an empty reply", async () => {
    await registerDocument();
    await lifecycle.registerFileWorks('empty-operation', {
      metadata: { assistantMessageId: 'final' },
    });
    const final = (await messageModel.query({ topicId })).find((message) => message.id === 'final');
    expect(final?.metadata?.work).toBeUndefined();
    expect(final?.works).toBeUndefined();
  });

  it('retries an unsuccessful anchor update after the final message becomes available', async () => {
    await registerDocument();
    const state = { metadata: { assistantMessageId: 'late-final' } };
    await lifecycle.registerFileWorks(operationId, state);
    expect(state.metadata).not.toHaveProperty('_fileWorksRegistered');
    await db
      .insert(messages)
      .values({ id: 'late-final', role: 'assistant', content: 'Done', topicId, userId });
    await lifecycle.registerFileWorks(operationId, state);
    const final = (await messageModel.query({ topicId })).find(
      (message) => message.id === 'late-final',
    );
    expect(final?.works).toHaveLength(1);
    expect(state.metadata).toHaveProperty('_fileWorksRegistered', true);
  });
});
