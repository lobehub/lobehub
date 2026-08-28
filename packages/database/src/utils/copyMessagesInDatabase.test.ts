// @vitest-environment node
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../core/getTestDB';
import { agents } from '../schemas/agent';
import { files } from '../schemas/file';
import {
  messageChunks,
  messageGroups,
  messagePlugins,
  messageQueries,
  messageQueryChunks,
  messages,
  messagesFiles,
  messageTranslates,
  messageTTS,
} from '../schemas/message';
import { chunks } from '../schemas/rag';
import { topics } from '../schemas/topic';
import { users } from '../schemas/user';
import type { LobeChatDatabase } from '../type';
import { copyMessagesInDatabase, type IdPair } from './copyMessagesInDatabase';

const userId = 'copy-msg-test-user';
const targetUserId = 'copy-msg-target-user';

const serverDB: LobeChatDatabase = await getTestDB();

const sourceAgentId = 'copy-msg-src-agent';
const newAgentId = 'copy-msg-new-agent';
const otherAgentId = 'copy-msg-other-agent';
const sourceTopicId = 'copy-msg-src-topic';
const newTopicId = 'copy-msg-new-topic';

/** Agent-flow expressions, mirroring WorkspaceImportService */
const agentFlowExprs = {
  agentIdExpr: sql`case when ${messages.agentId} is null or ${messages.agentId} = ${sourceAgentId} then ${newAgentId} else ${messages.agentId} end`,
  targetIdExpr: sql`case when ${messages.targetId} = ${sourceAgentId} then ${newAgentId} else ${messages.targetId} end`,
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: targetUserId }]);
  await serverDB.insert(agents).values([
    { id: sourceAgentId, userId },
    { id: newAgentId, userId: targetUserId },
    { id: otherAgentId, userId },
  ]);
  await serverDB.insert(topics).values([
    { agentId: sourceAgentId, id: sourceTopicId, userId },
    { agentId: newAgentId, id: newTopicId, userId: targetUserId },
  ]);
});

const runCopy = (messageIdPairs: IdPair[], topicIdPairs?: IdPair[]) =>
  serverDB.transaction(async (tx) =>
    copyMessagesInDatabase({
      ...agentFlowExprs,
      executor: tx,
      groupId: null,
      messageIdPairs,
      targetUserId,
      targetWorkspaceId: null,
      threadIdPairs: [],
      topicIdPairs: topicIdPairs ?? [[sourceTopicId, newTopicId]],
    }),
  );

describe('copyMessagesInDatabase', () => {
  it('copies rows in-database with remapped references and preserved payloads', async () => {
    const createdAt = new Date('2026-01-02T03:04:05Z');
    await serverDB.insert(messages).values([
      {
        agentId: sourceAgentId,
        clientId: 'client-1',
        content: 'hello',
        createdAt,
        id: 'src-user',
        role: 'user',
        targetId: sourceAgentId,
        topicId: sourceTopicId,
        userId,
      },
      {
        agentId: null,
        content: 'reply',
        id: 'src-assistant',
        // forward reference: parent row appears LATER in the pair list — a
        // single INSERT ... SELECT checks FKs at end of statement, so order
        // must not matter
        parentId: 'src-user',
        quotaId: 'src-user',
        role: 'assistant',
        tools: [{ id: 'toolu_original', type: 'builtin' }, 'not-an-object'],
        topicId: sourceTopicId,
        userId,
      },
      {
        agentId: otherAgentId,
        content: 'outside parent',
        id: 'src-external-ref',
        // reference to a message OUTSIDE the copied set → must become NULL
        parentId: 'src-user',
        role: 'assistant',
        topicId: sourceTopicId,
        userId,
      },
    ]);
    await serverDB.insert(messagePlugins).values([
      {
        apiName: 'search',
        arguments: '{}',
        id: 'src-assistant',
        toolCallId: 'toolu_original',
        userId,
      },
      { apiName: 'noop', arguments: '{}', id: 'src-user', toolCallId: null, userId },
    ]);

    await runCopy([
      // deliberately list the child BEFORE its parent
      ['src-assistant', 'new-assistant'],
      ['src-user', 'new-user'],
    ]);

    const copied = await serverDB.query.messages.findMany({
      where: (m, { inArray: within }) => within(m.id, ['new-user', 'new-assistant']),
    });
    const byId = new Map(copied.map((m) => [m.id, m]));
    expect(copied).toHaveLength(2);

    const copiedUser = byId.get('new-user')!;
    expect(copiedUser).toEqual(
      expect.objectContaining({
        agentId: newAgentId,
        clientId: null,
        content: 'hello',
        targetId: newAgentId,
        topicId: newTopicId,
        userId: targetUserId,
        workspaceId: null,
      }),
    );
    expect(copiedUser.createdAt.getTime()).toBe(createdAt.getTime());

    const copiedAssistant = byId.get('new-assistant')!;
    // null agent falls back to the new agent; self references remap in-set
    expect(copiedAssistant.agentId).toBe(newAgentId);
    expect(copiedAssistant.parentId).toBe('new-user');
    expect(copiedAssistant.quotaId).toBe('new-user');

    // tools ids are remapped while non-object entries survive untouched
    const tools = copiedAssistant.tools as [{ id: string; type: string }, string];
    expect(tools[0].type).toBe('builtin');
    expect(tools[0].id).toMatch(/^toolu_/);
    expect(tools[0].id).not.toBe('toolu_original');
    expect(tools[1]).toBe('not-an-object');

    // the plugin row follows its message and keeps the tools linkage
    const copiedPlugins = await serverDB.query.messagePlugins.findMany({
      where: (p, { inArray: within }) => within(p.id, ['new-user', 'new-assistant']),
    });
    const pluginById = new Map(copiedPlugins.map((p) => [p.id, p]));
    expect(copiedPlugins).toHaveLength(2);
    expect(pluginById.get('new-assistant')!.toolCallId).toBe(tools[0].id);
    expect(pluginById.get('new-assistant')!.userId).toBe(targetUserId);
    expect(pluginById.get('new-user')!.toolCallId).toBeNull();

    // rows outside the map are untouched; external references null out
    expect(
      await serverDB.query.messages.findFirst({ where: (m, { eq }) => eq(m.id, 'src-user') }),
    ).toBeTruthy();
    const external = await serverDB.query.messages.findMany({
      where: (m, { eq }) => eq(m.userId, targetUserId),
    });
    expect(external.map((m) => m.id).sort()).toEqual(['new-assistant', 'new-user']);
  });

  it('copies every message satellite table with the message', async () => {
    await serverDB.insert(messages).values([
      { content: 'rich', id: 'src-rich', role: 'assistant', topicId: sourceTopicId, userId },
      { content: 'plain', id: 'src-plain', role: 'user', topicId: sourceTopicId, userId },
    ]);
    const [file] = await serverDB
      .insert(files)
      .values({ fileType: 'text/plain', name: 'f.txt', size: 1, url: 'https://x/f.txt', userId })
      .returning({ id: files.id });
    const [chunk] = await serverDB
      .insert(chunks)
      .values({ text: 'chunk text', userId })
      .returning({ id: chunks.id });

    await serverDB
      .insert(messageTranslates)
      .values({ content: '你好', from: 'en', id: 'src-rich', to: 'zh', userId });
    await serverDB
      .insert(messageTTS)
      .values({ contentMd5: 'md5', fileId: file.id, id: 'src-rich', userId, voice: 'alloy' });
    await serverDB.insert(messagesFiles).values({ fileId: file.id, messageId: 'src-rich', userId });
    const [query] = await serverDB
      .insert(messageQueries)
      .values({ messageId: 'src-rich', rewriteQuery: 'rq', userId, userQuery: 'uq' })
      .returning({ id: messageQueries.id });
    await serverDB.insert(messageQueryChunks).values({
      chunkId: chunk.id,
      messageId: 'src-rich',
      queryId: query.id,
      similarity: '0.90000',
      userId,
    });
    await serverDB
      .insert(messageChunks)
      .values({ chunkId: chunk.id, messageId: 'src-rich', userId });

    await runCopy([
      ['src-rich', 'new-rich'],
      ['src-plain', 'new-plain'],
    ]);

    const translate = await serverDB.query.messageTranslates.findFirst({
      where: (t, { eq }) => eq(t.id, 'new-rich'),
    });
    expect(translate).toEqual(
      expect.objectContaining({ content: '你好', userId: targetUserId, workspaceId: null }),
    );

    // TTS / file / chunk associations follow the message; the referenced
    // file/chunk rows themselves are NOT duplicated
    const tts = await serverDB.query.messageTTS.findFirst({
      where: (t, { eq }) => eq(t.id, 'new-rich'),
    });
    expect(tts).toEqual(
      expect.objectContaining({ fileId: file.id, userId: targetUserId, voice: 'alloy' }),
    );

    const fileLinks = await serverDB.query.messagesFiles.findMany({
      where: (f, { eq }) => eq(f.messageId, 'new-rich'),
    });
    expect(fileLinks).toHaveLength(1);
    expect(fileLinks[0]).toEqual(
      expect.objectContaining({ fileId: file.id, userId: targetUserId }),
    );

    // message_queries gets a fresh deterministic id and query_chunks follow it
    const copiedQueries = await serverDB.query.messageQueries.findMany({
      where: (q, { eq }) => eq(q.messageId, 'new-rich'),
    });
    expect(copiedQueries).toHaveLength(1);
    expect(copiedQueries[0].id).not.toBe(query.id);
    expect(copiedQueries[0]).toEqual(
      expect.objectContaining({ rewriteQuery: 'rq', userId: targetUserId, userQuery: 'uq' }),
    );

    const copiedQueryChunks = await serverDB.query.messageQueryChunks.findMany({
      where: (qc, { eq }) => eq(qc.messageId, 'new-rich'),
    });
    expect(copiedQueryChunks).toHaveLength(1);
    expect(copiedQueryChunks[0]).toEqual(
      expect.objectContaining({ chunkId: chunk.id, queryId: copiedQueries[0].id }),
    );

    const copiedChunks = await serverDB.query.messageChunks.findMany({
      where: (mc, { eq }) => eq(mc.messageId, 'new-rich'),
    });
    expect(copiedChunks).toHaveLength(1);
    expect(copiedChunks[0].chunkId).toBe(chunk.id);

    // a message without satellites copies cleanly alongside
    expect(
      await serverDB.query.messageTranslates.findFirst({
        where: (t, { eq }) => eq(t.id, 'new-plain'),
      }),
    ).toBeUndefined();

    // source satellites are untouched
    expect(
      await serverDB.query.messageQueries.findMany({
        where: (q, { eq }) => eq(q.messageId, 'src-rich'),
      }),
    ).toHaveLength(1);
  });

  it('marks copies without touching their token/cost figures', async () => {
    const usage = { cost: 0.05, totalInputTokens: 100, totalOutputTokens: 50 };
    await serverDB.insert(messages).values([
      {
        content: 'billed',
        id: 'src-billed',
        metadata: { performance: { tps: 42 }, pinned: true, usage },
        role: 'assistant',
        topicId: sourceTopicId,
        usage,
        userId,
      },
      // no metadata at all — the copy still has to be markable
      { content: 'bare', id: 'src-bare', role: 'assistant', topicId: sourceTopicId, userId },
    ]);

    await runCopy([
      ['src-billed', 'new-billed'],
      ['src-bare', 'new-bare'],
    ]);

    const copied = await serverDB.query.messages.findFirst({
      where: (m, { eq }) => eq(m.id, 'new-billed'),
    });
    // The figures describe the generation this transcript records: the chat UI
    // renders them and the context engine counts tokens from them, so a copy
    // keeps them. Usage REPORTS exclude the row via the marker instead.
    expect(copied?.usage).toEqual(usage);
    const metadata = copied?.metadata as Record<string, unknown>;
    expect(metadata.copied).toBe(true);
    expect(metadata.usage).toEqual(usage);
    expect(metadata.performance).toEqual({ tps: 42 });
    expect(metadata.pinned).toBe(true);

    const bare = await serverDB.query.messages.findFirst({
      where: (m, { eq }) => eq(m.id, 'new-bare'),
    });
    expect(bare?.metadata).toEqual({ copied: true });
  });

  it('duplicates message_groups and keeps copied messages pointing at the new groups', async () => {
    await serverDB.insert(messages).values([
      {
        content: 'group parent',
        id: 'src-gparent',
        role: 'user',
        topicId: sourceTopicId,
        userId,
      },
    ]);
    await serverDB.insert(messageGroups).values([
      {
        content: 'summary',
        id: 'mg_root',
        parentMessageId: 'src-gparent',
        topicId: sourceTopicId,
        type: 'compression',
        userId,
      },
      {
        id: 'mg_child',
        parentGroupId: 'mg_root',
        topicId: sourceTopicId,
        type: 'parallel',
        userId,
      },
    ]);
    await serverDB.insert(messages).values([
      {
        content: 'grouped',
        id: 'src-grouped',
        messageGroupId: 'mg_child',
        role: 'assistant',
        topicId: sourceTopicId,
        userId,
      },
    ]);

    await runCopy([
      ['src-gparent', 'new-gparent'],
      ['src-grouped', 'new-grouped'],
    ]);

    const copiedGroups = await serverDB.query.messageGroups.findMany({
      where: (g, { eq }) => eq(g.topicId, newTopicId),
    });
    expect(copiedGroups).toHaveLength(2);
    const byType = new Map(copiedGroups.map((g) => [g.type, g]));
    const root = byType.get('compression')!;
    const child = byType.get('parallel')!;
    expect(root.id).not.toBe('mg_root');
    expect(root.content).toBe('summary');
    expect(root.userId).toBe(targetUserId);
    // group→message and group→group references remap into the copied set
    expect(root.parentMessageId).toBe('new-gparent');
    expect(child.parentGroupId).toBe(root.id);

    // the copied message points at the copied group, not the source group
    const copiedGrouped = await serverDB.query.messages.findFirst({
      where: (m, { eq }) => eq(m.id, 'new-grouped'),
    });
    expect(copiedGrouped?.messageGroupId).toBe(child.id);

    // source rows are untouched
    expect(
      await serverDB.query.messageGroups.findFirst({ where: (g, { eq }) => eq(g.id, 'mg_root') }),
    ).toBeTruthy();
  });

  it('nulls references whose targets are outside the copied set', async () => {
    await serverDB.insert(messages).values([
      {
        content: 'kept outside',
        id: 'outside-parent',
        role: 'user',
        topicId: sourceTopicId,
        userId,
      },
      {
        content: 'copied child',
        id: 'src-child',
        parentId: 'outside-parent',
        role: 'assistant',
        topicId: sourceTopicId,
        userId,
      },
    ]);

    await runCopy([['src-child', 'new-child']]);

    const copied = await serverDB.query.messages.findFirst({
      where: (m, { eq }) => eq(m.id, 'new-child'),
    });
    expect(copied?.parentId).toBeNull();
    expect(copied?.content).toBe('copied child');
  });

  it('is a no-op for an empty message set', async () => {
    await runCopy([]);

    const copied = await serverDB.query.messages.findMany({
      where: (m, { eq }) => eq(m.userId, targetUserId),
    });
    expect(copied).toHaveLength(0);
  });

  it('can run twice inside one transaction (temp maps are rebuilt)', async () => {
    await serverDB.insert(messages).values([
      { content: 'a', id: 'src-a', role: 'user', topicId: sourceTopicId, userId },
      { content: 'b', id: 'src-b', role: 'user', topicId: sourceTopicId, userId },
    ]);

    await serverDB.transaction(async (tx) => {
      for (const [source, next] of [
        ['src-a', 'new-a'],
        ['src-b', 'new-b'],
      ] as IdPair[]) {
        await copyMessagesInDatabase({
          ...agentFlowExprs,
          executor: tx,
          groupId: null,
          messageIdPairs: [[source, next]],
          targetUserId,
          targetWorkspaceId: null,
          threadIdPairs: [],
          topicIdPairs: [[sourceTopicId, newTopicId]],
        });
      }
    });

    const copied = await serverDB.query.messages.findMany({
      where: (m, { eq }) => eq(m.userId, targetUserId),
    });
    expect(copied.map((m) => m.content).sort()).toEqual(['a', 'b']);
  });
});
