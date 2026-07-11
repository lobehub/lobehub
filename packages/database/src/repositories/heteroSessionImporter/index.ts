import type {
  HeteroSessionImportMessage,
  HeteroSessionImportPayload,
  HeteroSessionImportResult,
  HeteroSessionImportStatus,
} from '@lobechat/types';
import { and, count, eq, inArray, or, sql } from 'drizzle-orm';

import { messagePlugins, messages, threads, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { idGenerator } from '../../utils/idGenerator';

export interface ImportHeteroSessionsParams {
  agentId: string;
  groupId?: string | null;
  /** normalized payloads produced by `@lobechat/heterogeneous-agents/transcript` */
  sessions: HeteroSessionImportPayload[];
}

const BATCH_SIZE = 100;

/**
 * Dedicated importer for external CLI agent sessions (Claude Code / Codex
 * local transcripts).
 *
 * Unlike `TopicImporterRepo` (generic user-facing JSON import, always creates
 * a new topic), this importer is IDEMPOTENT and INCREMENTAL:
 * - every entity carries a deterministic `clientId` derived from the source
 *   transcript; the `(clientId, userId)` unique indexes make re-imports skip
 *   existing rows
 * - importing a session whose topic already exists only inserts the new
 *   messages (the transcript grew since the last import), rebuilding
 *   `parentId` references across old and new rows
 * - subagent transcripts import as threads under the session topic
 */
export class HeteroSessionImporterRepo {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  importSessions = async (
    params: ImportHeteroSessionsParams,
  ): Promise<HeteroSessionImportResult[]> => {
    const results: HeteroSessionImportResult[] = [];
    // one transaction per session: a corrupt session must not roll back the batch
    for (const session of params.sessions) {
      results.push(await this.importSession(session, params.agentId, params.groupId));
    }
    return results;
  };

  importSession = async (
    session: HeteroSessionImportPayload,
    agentId: string,
    groupId?: string | null,
  ): Promise<HeteroSessionImportResult> =>
    this.db.transaction(async (tx) => {
      // the source transcript's last timestamp — the picker UI compares it with
      // a fresh digest's endAt to detect "grew since last import" (message
      // counts are NOT comparable across transcript records and DB rows)
      const sourceEndAt = [
        ...session.messages,
        ...(session.threads ?? []).flatMap((t) => t.messages),
      ].reduce<string | undefined>(
        (max, m) => (m.createdAt && (!max || m.createdAt > max) ? m.createdAt : max),
        undefined,
      );

      // 1. find or create the topic by clientId
      const [existingTopic] = await tx
        .select({ id: topics.id, metadata: topics.metadata })
        .from(topics)
        .where(and(eq(topics.clientId, session.topicClientId), eq(topics.userId, this.userId)));

      let topicId = existingTopic?.id;
      const created = !existingTopic;
      if (topicId) {
        if (sourceEndAt)
          await tx
            .update(topics)
            .set({ metadata: { ...existingTopic.metadata, heteroSourceEndAt: sourceEndAt } })
            .where(eq(topics.id, topicId));
      } else {
        topicId = idGenerator('topics');
        await tx.insert(topics).values({
          agentId,
          clientId: session.topicClientId,
          groupId: groupId || null,
          id: topicId,
          metadata: {
            ...session.metadata,
            ...(sourceEndAt ? { heteroSourceEndAt: sourceEndAt } : {}),
          },
          title: session.title || 'Imported Session',
          userId: this.userId,
          workspaceId: this.workspaceId ?? null,
        });
      }

      // 2. load existing message clientIds of this session (incremental base)
      const existingRows = existingTopic
        ? await tx
            .select({ clientId: messages.clientId, id: messages.id })
            .from(messages)
            .where(and(eq(messages.topicId, topicId), eq(messages.userId, this.userId)))
        : [];
      const clientIdToDbId = new Map<string, string>();
      for (const row of existingRows) if (row.clientId) clientIdToDbId.set(row.clientId, row.id);

      // 3. insert main-chain messages
      const mainStats = await this.insertMessages(tx, {
        agentId,
        clientIdToDbId,
        importMessages: session.messages,
        topicId,
      });

      // 4. threads (subagent transcripts)
      let insertedThreads = 0;
      for (const thread of session.threads ?? []) {
        const [existingThread] = await tx
          .select({ id: threads.id })
          .from(threads)
          .where(and(eq(threads.clientId, thread.clientId), eq(threads.userId, this.userId)));

        let threadId = existingThread?.id;
        if (!threadId) {
          threadId = idGenerator('threads', 16);
          await tx.insert(threads).values({
            agentId,
            clientId: thread.clientId,
            id: threadId,
            sourceMessageId: thread.sourceMessageClientId
              ? (clientIdToDbId.get(thread.sourceMessageClientId) ?? null)
              : null,
            status: thread.status ?? 'completed',
            title: thread.title?.slice(0, 200) ?? null,
            topicId,
            type: thread.type,
            userId: this.userId,
            workspaceId: this.workspaceId ?? null,
          });
          insertedThreads++;
        }

        const threadStats = await this.insertMessages(tx, {
          agentId,
          clientIdToDbId,
          importMessages: thread.messages,
          threadId,
          topicId,
        });
        mainStats.inserted += threadStats.inserted;
        mainStats.skipped += threadStats.skipped;
      }

      return {
        created,
        insertedMessages: mainStats.inserted,
        insertedThreads,
        sessionId: session.sessionId,
        skippedMessages: mainStats.skipped,
        topicId,
      };
    });

  private insertMessages = async (
    tx: any,
    params: {
      agentId: string;
      /** shared across main chain + threads; mutated with newly assigned ids */
      clientIdToDbId: Map<string, string>;
      importMessages: HeteroSessionImportMessage[];
      threadId?: string;
      topicId: string;
    },
  ): Promise<{ inserted: number; skipped: number }> => {
    const { agentId, clientIdToDbId, importMessages, threadId, topicId } = params;

    const fresh = importMessages.filter((m) => !clientIdToDbId.has(m.clientId));
    const skipped = importMessages.length - fresh.length;
    if (fresh.length === 0) return { inserted: 0, skipped };

    // assign db ids first so parent references resolve across old + new rows
    for (const m of fresh) clientIdToDbId.set(m.clientId, idGenerator('messages'));

    // Codex rewrites resumed history with IDENTICAL timestamps, and the UI
    // orders by createdAt — keep timestamps strictly increasing within a batch
    // so the transcript order survives the sort
    const now = Date.now();
    let lastTs = 0;
    const messageRows = fresh.map((m, index) => {
      const parsedTs = m.createdAt ? new Date(m.createdAt).getTime() : now + index;
      const ts = Math.max(parsedTs, lastTs + 1);
      lastTs = ts;
      const timestamp = new Date(ts);
      return {
        agentId,
        clientId: m.clientId,
        content: m.content,
        createdAt: timestamp,
        id: clientIdToDbId.get(m.clientId)!,
        metadata: m.metadata ?? null,
        model: m.model ?? null,
        parentId: m.parentClientId ? (clientIdToDbId.get(m.parentClientId) ?? null) : null,
        provider: m.provider ?? null,
        reasoning: m.reasoning ?? null,
        role: m.role,
        threadId: threadId ?? null,
        tools: m.tools ?? null,
        topicId,
        updatedAt: timestamp,
        usage: m.usage ?? null,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      };
    });

    const pluginRows = fresh
      .filter((m) => m.plugin || m.toolCallId)
      .map((m) => ({
        apiName: m.plugin?.apiName ?? null,
        arguments: m.plugin?.arguments ?? null,
        clientId: m.clientId,
        id: clientIdToDbId.get(m.clientId)!,
        identifier: m.plugin?.identifier ?? null,
        state: m.pluginState ?? null,
        toolCallId: m.toolCallId ?? null,
        type: m.plugin?.type ?? null,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      }));

    for (let i = 0; i < messageRows.length; i += BATCH_SIZE) {
      await tx.insert(messages).values(messageRows.slice(i, i + BATCH_SIZE));
    }
    for (let i = 0; i < pluginRows.length; i += BATCH_SIZE) {
      await tx.insert(messagePlugins).values(pluginRows.slice(i, i + BATCH_SIZE));
    }

    return { inserted: fresh.length, skipped };
  };

  /**
   * Import status of local sessions, for the picker UI badges:
   * - `imported`: a topic with the session's clientId exists (re-import = incremental sync)
   * - `linked`: a topic carries the sessionId in `metadata.heteroSessionId` but was NOT
   *   imported — the session originated from a LobeHub live run and importing it
   *   would duplicate the conversation
   */
  getImportStatus = async (
    sessions: { sessionId: string; topicClientId: string }[],
  ): Promise<HeteroSessionImportStatus> => {
    if (sessions.length === 0) return { imported: [], linked: [] };

    const clientIds = sessions.map((s) => s.topicClientId);
    const sessionIds = sessions.map((s) => s.sessionId);
    const metadataSessionId = sql<string>`${topics.metadata}->>'heteroSessionId'`;
    const metadataSourceEndAt = sql<string>`${topics.metadata}->>'heteroSourceEndAt'`;

    const rows = await this.db
      .select({
        clientId: topics.clientId,
        id: topics.id,
        metaSessionId: metadataSessionId,
        sourceEndAt: metadataSourceEndAt,
      })
      .from(topics)
      .where(
        and(
          eq(topics.userId, this.userId),
          or(inArray(topics.clientId, clientIds), inArray(metadataSessionId, sessionIds)),
        ),
      );

    const wantedClientIds = new Set(clientIds);
    const importedRows = rows.filter((r) => r.clientId && wantedClientIds.has(r.clientId));

    const messageCounts = new Map<string, number>();
    if (importedRows.length > 0) {
      const counts = await this.db
        .select({ topicId: messages.topicId, total: count() })
        .from(messages)
        .where(
          and(
            eq(messages.userId, this.userId),
            inArray(
              messages.topicId,
              importedRows.map((r) => r.id),
            ),
          ),
        )
        .groupBy(messages.topicId);
      for (const row of counts) if (row.topicId) messageCounts.set(row.topicId, Number(row.total));
    }

    const importedClientIds = new Set(importedRows.map((r) => r.clientId));
    const linked = [
      ...new Set(
        rows
          .filter((r) => r.metaSessionId && !importedClientIds.has(r.clientId))
          .map((r) => r.metaSessionId),
      ),
    ];

    return {
      imported: importedRows.map((r) => ({
        messageCount: messageCounts.get(r.id) ?? 0,
        sourceEndAt: r.sourceEndAt ?? undefined,
        topicClientId: r.clientId!,
        topicId: r.id,
      })),
      linked,
    };
  };
}
