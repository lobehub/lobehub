import type {
  HeteroSessionImportMessage,
  HeteroSessionImportPayload,
  HeteroSessionImportResult,
  HeteroSessionImportStatus,
} from '@lobechat/types';
import { and, count, eq, inArray, isNotNull, like, or, sql } from 'drizzle-orm';

import { messagePlugins, messages, threads, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { idGenerator } from '../../utils/idGenerator';
import { buildWorkspaceWhere } from '../../utils/workspace';

/** topic clientId convention of an imported session: `<source>-session-<sessionId>` */
const IMPORT_CLIENT_ID_PREFIXES = ['claude-code-session-', 'codex-session-'];

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

  /**
   * Workspace-aware ownership predicate: lookups must stay inside the active
   * personal/team scope, or importing from a workspace would reuse (and append
   * to) a topic the same user already imported in another scope.
   */
  private scopeWhere = (cols: { userId: any; workspaceId: any }) =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, cols);

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
      // the source transcript's last raw-record timestamp — the picker compares it
      // with a fresh digest's endAt to detect "grew since last import" (message
      // counts are NOT comparable across transcript records and DB rows).
      // It MUST come from the parser: deriving it from the normalized messages
      // yields an earlier value (assistant records sharing a `message.id` merge
      // onto the first record's timestamp), which would make every imported
      // session look perpetually out of sync.
      const sourceEndAt = session.sourceEndAt;

      // hetero resume + project grouping read the bound cwd off
      // `topic.metadata.workingDirectory` — persist the transcript cwd so
      // imported topics resume/group under the directory they were recorded in
      const metadataPatch = {
        ...(sourceEndAt ? { heteroSourceEndAt: sourceEndAt } : {}),
        ...(session.workingDirectory ? { workingDirectory: session.workingDirectory } : {}),
      };

      // 1. find or create the topic by clientId within the active scope
      const [existingTopic] = await tx
        .select({ id: topics.id, metadata: topics.metadata })
        .from(topics)
        .where(and(eq(topics.clientId, session.topicClientId), this.scopeWhere(topics)));

      // the (clientId, userId) unique index makes one session = one topic per
      // user GLOBALLY — if it exists outside the active scope, appending there
      // would leak content across scopes and inserting here would violate the
      // index. Reject explicitly with the reason instead.
      if (!existingTopic) {
        const [foreignTopic] = await tx
          .select({ id: topics.id, workspaceId: topics.workspaceId })
          .from(topics)
          .where(and(eq(topics.clientId, session.topicClientId), eq(topics.userId, this.userId)));
        if (foreignTopic) {
          throw new Error(
            `session ${session.sessionId} is already imported in ${
              foreignTopic.workspaceId ? `workspace ${foreignTopic.workspaceId}` : 'personal space'
            }; switch to that scope to sync it`,
          );
        }
      }

      let topicId = existingTopic?.id;
      const created = !existingTopic;
      if (topicId) {
        if (Object.keys(metadataPatch).length > 0)
          await tx
            .update(topics)
            .set({ metadata: { ...existingTopic.metadata, ...metadataPatch } })
            .where(eq(topics.id, topicId));
      } else {
        topicId = idGenerator('topics');
        await tx.insert(topics).values({
          agentId,
          clientId: session.topicClientId,
          groupId: groupId || null,
          id: topicId,
          metadata: { ...session.metadata, ...metadataPatch },
          title: session.title || 'Imported Session',
          userId: this.userId,
          workspaceId: this.workspaceId ?? null,
        });
      }

      // 2. load existing message clientIds of this session (incremental base)
      const existingRows = existingTopic
        ? await tx
            .select({
              clientId: messages.clientId,
              createdAt: messages.createdAt,
              id: messages.id,
              threadId: messages.threadId,
            })
            .from(messages)
            .where(and(eq(messages.topicId, topicId), this.scopeWhere(messages)))
        : [];
      const clientIdToDbId = new Map<string, string>();
      for (const row of existingRows) if (row.clientId) clientIdToDbId.set(row.clientId, row.id);

      // incremental syncs must continue AFTER the already-imported tail: the
      // first import may have bumped identical source timestamps to t+1, t+2…,
      // so a fresh batch seeded at the raw source time would sort before them
      const maxExistingTs = (threadId: string | null) =>
        existingRows.reduce(
          (max: number, row: (typeof existingRows)[number]) =>
            row.threadId === threadId && row.createdAt && row.createdAt.getTime() > max
              ? row.createdAt.getTime()
              : max,
          0,
        );

      // 3. insert main-chain messages
      const mainStats = await this.insertMessages(tx, {
        agentId,
        clientIdToDbId,
        importMessages: session.messages,
        seedTs: maxExistingTs(null),
        topicId,
      });

      // 4. threads (subagent transcripts)
      let insertedThreads = 0;
      for (const thread of session.threads ?? []) {
        const [existingThread] = await tx
          .select({ id: threads.id })
          .from(threads)
          .where(and(eq(threads.clientId, thread.clientId), this.scopeWhere(threads)));

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
          seedTs: existingThread ? maxExistingTs(threadId) : 0,
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
      /** max createdAt (ms) of the already-imported rows in this chain */
      seedTs?: number;
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
    // (seeded past the already-imported tail) so the transcript order survives
    // the sort even across incremental syncs
    const now = Date.now();
    let lastTs = params.seedTs ?? 0;
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
   * Import status of the caller's hetero-session topics, for the picker UI badges:
   * - `imported`: a topic whose clientId follows the `<source>-session-<id>` convention
   *   (re-import = incremental sync)
   * - `linked`: a topic carries a sessionId in `metadata.heteroSessionId` but was NOT
   *   imported — the session originated from a LobeHub live run and importing it
   *   would duplicate the conversation
   *
   * Takes no input on purpose: a machine can hold thousands of local transcripts, and
   * passing them all in would blow the tRPC query input limit (`maxURLLength` 2083 —
   * about 16 sessions). The result is bounded by what the user already has in LobeHub,
   * and the picker matches its local digests against it client-side.
   */
  getImportStatus = async (): Promise<HeteroSessionImportStatus> => {
    const metadataSessionId = sql<string>`${topics.metadata}->>'heteroSessionId'`;
    const metadataSourceEndAt = sql<string>`${topics.metadata}->>'heteroSourceEndAt'`;
    const isImportedClientId = or(
      ...IMPORT_CLIENT_ID_PREFIXES.map((prefix) => like(topics.clientId, `${prefix}%`)),
    );

    const rows = await this.db
      .select({
        clientId: topics.clientId,
        id: topics.id,
        metaSessionId: metadataSessionId,
        sourceEndAt: metadataSourceEndAt,
      })
      .from(topics)
      .where(and(this.scopeWhere(topics), or(isImportedClientId, isNotNull(metadataSessionId))));

    const importedRows = rows.filter(
      (r) => r.clientId && IMPORT_CLIENT_ID_PREFIXES.some((p) => r.clientId!.startsWith(p)),
    );

    const messageCounts = new Map<string, number>();
    if (importedRows.length > 0) {
      const counts = await this.db
        .select({ topicId: messages.topicId, total: count() })
        .from(messages)
        .where(
          and(
            this.scopeWhere(messages),
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
