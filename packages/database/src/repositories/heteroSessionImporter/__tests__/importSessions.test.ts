import type { HeteroSessionImportPayload } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agents,
  messagePlugins,
  messages,
  threads,
  topics,
  users,
  workspaces,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { HeteroSessionImporterRepo } from '../index';

const userId = 'session-importer-user';
const agentId = 'session-importer-agent';
let serverDB: LobeChatDatabase;

const basePayload = (): HeteroSessionImportPayload => ({
  messages: [
    {
      clientId: 'cc-s1-u1',
      content: 'hello',
      createdAt: '2026-07-01T00:00:00.000Z',
      role: 'user',
    },
    {
      clientId: 'cc-s1-a1',
      content: 'running a tool',
      createdAt: '2026-07-01T00:00:01.000Z',
      metadata: { heteroMessageId: 'msg_1', heteroSessionId: 's1' },
      model: 'claude-opus-4-8',
      parentClientId: 'cc-s1-u1',
      provider: 'claude-code',
      reasoning: { content: 'thinking...' },
      role: 'assistant',
      tools: [
        {
          apiName: 'Bash',
          arguments: '{"cmd":"ls"}',
          id: 'tool_1',
          identifier: 'claude-code',
          type: 'default',
        },
      ],
      usage: { totalInputTokens: 5, totalOutputTokens: 7, totalTokens: 12 },
    },
    {
      clientId: 'cc-s1-r1',
      content: 'file list',
      createdAt: '2026-07-01T00:00:02.000Z',
      parentClientId: 'cc-s1-a1',
      plugin: {
        apiName: 'Bash',
        arguments: '{"cmd":"ls"}',
        identifier: 'claude-code',
        type: 'default',
      },
      role: 'tool',
      toolCallId: 'tool_1',
    },
  ],
  metadata: {
    heteroSessionId: 's1',
    heteroSessionIdByWorkingDirectory: { '/repo': 's1' },
    importedFrom: 'claude-code-local',
  },
  sessionId: 's1',
  source: 'claude-code',
  title: 'Session One',
  topicClientId: 'cc-session-s1',
});

describe('HeteroSessionImporterRepo.importSessions', () => {
  beforeEach(async () => {
    serverDB = await getTestDB();
    await serverDB.delete(users);
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: userId }]);
      await tx.insert(agents).values({ id: agentId, title: 'Test Agent', userId });
    });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('imports a session as topic + messages + plugin rows with clientIds', async () => {
    const repo = new HeteroSessionImporterRepo(serverDB, userId);
    const [result] = await repo.importSessions({ agentId, sessions: [basePayload()] });

    expect(result.created).toBe(true);
    expect(result.insertedMessages).toBe(3);
    expect(result.skippedMessages).toBe(0);

    const [topic] = await serverDB.select().from(topics).where(eq(topics.id, result.topicId));
    expect(topic.clientId).toBe('cc-session-s1');
    expect(topic.title).toBe('Session One');
    expect((topic.metadata as any).heteroSessionId).toBe('s1');

    const rows = await serverDB
      .select()
      .from(messages)
      .where(eq(messages.topicId, result.topicId))
      .orderBy(messages.createdAt);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant', 'tool']);
    expect(rows[1].parentId).toBe(rows[0].id);
    expect(rows[2].parentId).toBe(rows[1].id);
    expect(rows[1].usage).toEqual({ totalInputTokens: 5, totalOutputTokens: 7, totalTokens: 12 });
    expect(rows[1].tools).toHaveLength(1);
    expect(rows.map((r) => r.clientId)).toEqual(['cc-s1-u1', 'cc-s1-a1', 'cc-s1-r1']);

    const [pluginRow] = await serverDB
      .select()
      .from(messagePlugins)
      .where(eq(messagePlugins.id, rows[2].id));
    expect(pluginRow.toolCallId).toBe('tool_1');
    expect(pluginRow.apiName).toBe('Bash');
  });

  it('is idempotent: re-importing the same payload inserts nothing', async () => {
    const repo = new HeteroSessionImporterRepo(serverDB, userId);
    await repo.importSessions({ agentId, sessions: [basePayload()] });
    const [second] = await repo.importSessions({ agentId, sessions: [basePayload()] });

    expect(second.created).toBe(false);
    expect(second.insertedMessages).toBe(0);
    expect(second.skippedMessages).toBe(3);

    const rows = await serverDB
      .select()
      .from(messages)
      .where(and(eq(messages.userId, userId)));
    expect(rows).toHaveLength(3);
  });

  it('imports incrementally: a grown transcript only inserts the new tail', async () => {
    const repo = new HeteroSessionImporterRepo(serverDB, userId);
    const [first] = await repo.importSessions({ agentId, sessions: [basePayload()] });

    const grown = basePayload();
    grown.messages.push({
      clientId: 'cc-s1-a2',
      content: 'follow-up answer',
      createdAt: '2026-07-01T00:00:03.000Z',
      parentClientId: 'cc-s1-r1',
      provider: 'claude-code',
      role: 'assistant',
    });
    const [second] = await repo.importSessions({ agentId, sessions: [grown] });

    expect(second.created).toBe(false);
    expect(second.topicId).toBe(first.topicId);
    expect(second.insertedMessages).toBe(1);
    expect(second.skippedMessages).toBe(3);

    const rows = await serverDB
      .select()
      .from(messages)
      .where(eq(messages.topicId, first.topicId))
      .orderBy(messages.createdAt);
    expect(rows).toHaveLength(4);
    // new tail's parentId resolves to the PRE-EXISTING tool message row
    expect(rows[3].parentId).toBe(rows[2].id);
  });

  it('imports subagent transcripts as threads under the session topic', async () => {
    const payload = basePayload();
    payload.threads = [
      {
        clientId: 'cc-s1-agent-x',
        messages: [
          {
            clientId: 'cc-s1-agent-x-u1',
            content: 'subagent prompt',
            role: 'user',
          },
          {
            clientId: 'cc-s1-agent-x-a1',
            content: 'subagent answer',
            parentClientId: 'cc-s1-agent-x-u1',
            provider: 'claude-code',
            role: 'assistant',
          },
        ],
        sourceMessageClientId: 'cc-s1-r1',
        title: 'Explore something',
        type: 'standalone',
      },
    ];

    const repo = new HeteroSessionImporterRepo(serverDB, userId);
    const [result] = await repo.importSessions({ agentId, sessions: [payload] });

    expect(result.insertedThreads).toBe(1);
    expect(result.insertedMessages).toBe(5);

    const [threadRow] = await serverDB
      .select()
      .from(threads)
      .where(eq(threads.topicId, result.topicId));
    expect(threadRow.clientId).toBe('cc-s1-agent-x');
    expect(threadRow.type).toBe('standalone');

    const threadMessages = await serverDB
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadRow.id))
      .orderBy(messages.createdAt);
    expect(threadMessages).toHaveLength(2);
    // thread hangs on the main-chain tool message
    const [sourceRow] = await serverDB
      .select()
      .from(messages)
      .where(eq(messages.clientId, 'cc-s1-r1'));
    expect(threadRow.sourceMessageId).toBe(sourceRow.id);

    // re-import: thread and its messages are skipped
    const [second] = await repo.importSessions({ agentId, sessions: [payload] });
    expect(second.insertedThreads).toBe(0);
    expect(second.insertedMessages).toBe(0);
  });

  it('keeps message order when the source repeats identical timestamps', async () => {
    // Codex rewrites resumed history with identical timestamps; the UI sorts by
    // createdAt, so the importer must keep timestamps strictly increasing
    const payload = basePayload();
    const sameTs = '2026-07-01T00:00:00.000Z';
    for (const m of payload.messages) m.createdAt = sameTs;

    const repo = new HeteroSessionImporterRepo(serverDB, userId);
    const [result] = await repo.importSessions({ agentId, sessions: [payload] });

    const rows = await serverDB
      .select()
      .from(messages)
      .where(eq(messages.topicId, result.topicId))
      .orderBy(messages.createdAt);
    expect(rows.map((r) => r.clientId)).toEqual(['cc-s1-u1', 'cc-s1-a1', 'cc-s1-r1']);
    expect(rows[1].createdAt.getTime()).toBeGreaterThan(rows[0].createdAt.getTime());
    expect(rows[2].createdAt.getTime()).toBeGreaterThan(rows[1].createdAt.getTime());
  });

  it('records the source-transcript end timestamp for syncable detection', async () => {
    const repo = new HeteroSessionImporterRepo(serverDB, userId);
    const [first] = await repo.importSessions({ agentId, sessions: [basePayload()] });

    let [topic] = await serverDB.select().from(topics).where(eq(topics.id, first.topicId));
    expect((topic.metadata as any).heteroSourceEndAt).toBe('2026-07-01T00:00:02.000Z');

    // incremental import with a newer tail advances the fingerprint
    const grown = basePayload();
    grown.messages.push({
      clientId: 'cc-s1-a2',
      content: 'later',
      createdAt: '2026-07-02T00:00:00.000Z',
      parentClientId: 'cc-s1-r1',
      role: 'assistant',
    });
    await repo.importSessions({ agentId, sessions: [grown] });

    [topic] = await serverDB.select().from(topics).where(eq(topics.id, first.topicId));
    expect((topic.metadata as any).heteroSourceEndAt).toBe('2026-07-02T00:00:00.000Z');
  });

  it('persists the transcript workingDirectory on create and on incremental update', async () => {
    const repo = new HeteroSessionImporterRepo(serverDB, userId);
    const payload = { ...basePayload(), workingDirectory: '/repo' };
    const [first] = await repo.importSessions({ agentId, sessions: [payload] });

    const [created] = await serverDB.select().from(topics).where(eq(topics.id, first.topicId));
    expect((created.metadata as any).workingDirectory).toBe('/repo');

    // the session later moves cwd (e.g. worktree) — re-import refreshes the binding
    await repo.importSessions({
      agentId,
      sessions: [{ ...basePayload(), workingDirectory: '/repo/worktree' }],
    });
    const [updated] = await serverDB.select().from(topics).where(eq(topics.id, first.topicId));
    expect((updated.metadata as any).workingDirectory).toBe('/repo/worktree');
    expect((updated.metadata as any).heteroSessionId).toBe('s1');
  });

  it('scopes lookups to the active workspace and rejects cross-scope re-imports', async () => {
    await serverDB
      .insert(workspaces)
      .values({ id: 'ws-1', name: 'Team', primaryOwnerId: userId, slug: 'team-ws' });
    const personalRepo = new HeteroSessionImporterRepo(serverDB, userId);
    const workspaceRepo = new HeteroSessionImporterRepo(serverDB, userId, 'ws-1');

    const [personal] = await personalRepo.importSessions({ agentId, sessions: [basePayload()] });

    // (clientId, userId) is globally unique: importing the same session from a
    // workspace must NOT silently append to the personal topic — it rejects
    // with the owning scope instead
    await expect(
      workspaceRepo.importSessions({ agentId, sessions: [basePayload()] }),
    ).rejects.toThrow('personal space');
    const personalRows = await serverDB
      .select()
      .from(messages)
      .where(eq(messages.topicId, personal.topicId));
    expect(personalRows).toHaveLength(3);
    expect(personalRows.every((r) => r.workspaceId === null)).toBe(true);

    // a session imported IN the workspace lands there and stays scope-local
    const wsPayload = basePayload();
    wsPayload.sessionId = 's2';
    wsPayload.topicClientId = 'cc-session-s2';
    for (const m of wsPayload.messages) {
      m.clientId = `ws-${m.clientId}`;
      if (m.parentClientId) m.parentClientId = `ws-${m.parentClientId}`;
    }
    const [team] = await workspaceRepo.importSessions({ agentId, sessions: [wsPayload] });
    expect(team.created).toBe(true);

    // status badges are scoped: each side only reports its own scope's topics
    const wanted = [
      { sessionId: 's1', topicClientId: 'cc-session-s1' },
      { sessionId: 's2', topicClientId: 'cc-session-s2' },
    ];
    const personalStatus = await personalRepo.getImportStatus(wanted);
    const teamStatus = await workspaceRepo.getImportStatus(wanted);
    expect(personalStatus.imported.map((i) => i.topicId)).toEqual([personal.topicId]);
    expect(teamStatus.imported.map((i) => i.topicId)).toEqual([team.topicId]);
  });

  it('seeds incremental timestamps past the already-imported tail', async () => {
    const repo = new HeteroSessionImporterRepo(serverDB, userId);
    // codex-style: every record repeats the same source timestamp
    const t = '2026-07-01T00:00:00.000Z';
    const flat = basePayload();
    for (const m of flat.messages) m.createdAt = t;
    await repo.importSessions({ agentId, sessions: [flat] });

    const grown = basePayload();
    for (const m of grown.messages) m.createdAt = t;
    grown.messages.push({
      clientId: 'cc-s1-a2',
      content: 'synced follow-up',
      createdAt: t,
      parentClientId: 'cc-s1-r1',
      role: 'assistant',
    });
    const [second] = await repo.importSessions({ agentId, sessions: [grown] });
    expect(second.insertedMessages).toBe(1);

    const rows = await serverDB
      .select()
      .from(messages)
      .where(eq(messages.topicId, second.topicId))
      .orderBy(messages.createdAt);
    // the synced tail must sort AFTER the rows bumped to t+1, t+2 on first import
    expect(rows.map((r) => r.clientId)).toEqual(['cc-s1-u1', 'cc-s1-a1', 'cc-s1-r1', 'cc-s1-a2']);
  });

  describe('getImportStatus', () => {
    it('reports imported topics and flags LobeHub-originated sessions as linked', async () => {
      const repo = new HeteroSessionImporterRepo(serverDB, userId);
      await repo.importSessions({ agentId, sessions: [basePayload()] });
      // a live-run topic carries heteroSessionId in metadata but has no import clientId
      await serverDB.insert(topics).values({
        agentId,
        id: 'tpc_live_run',
        metadata: { heteroSessionId: 's-live' },
        title: 'live run',
        userId,
      });

      const status = await repo.getImportStatus([
        { sessionId: 's1', topicClientId: 'cc-session-s1' },
        { sessionId: 's-live', topicClientId: 'cc-session-s-live' },
        { sessionId: 's-none', topicClientId: 'cc-session-s-none' },
      ]);

      expect(status.imported).toHaveLength(1);
      expect(status.imported[0]).toMatchObject({
        messageCount: 3,
        sourceEndAt: '2026-07-01T00:00:02.000Z',
        topicClientId: 'cc-session-s1',
      });
      expect(status.linked).toEqual(['s-live']);
    });
  });

  it('keeps sessions independent: one failing session does not roll back others', async () => {
    const repo = new HeteroSessionImporterRepo(serverDB, userId);
    const bad = basePayload();
    bad.sessionId = 's2';
    bad.topicClientId = 'cc-session-s2';
    // force a failure: message referencing an agent that does not exist
    const ok = basePayload();

    const results = await repo
      .importSessions({ agentId: 'missing-agent', sessions: [bad] })
      .catch(() => null);
    expect(results).toBeNull();

    const [okResult] = await repo.importSessions({ agentId, sessions: [ok] });
    expect(okResult.insertedMessages).toBe(3);
  });
});
