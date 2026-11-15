import type { AgentKnowledgeSpaceItem } from '@lobechat/types';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  agentDocuments,
  agents,
  agentsKnowledgeBases,
  documents,
  knowledgeBases,
} from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { isDedicatedToAgentWhere } from '../../utils/agentDocumentsOwnership';
import { buildWorkspaceWhere } from '../../utils/workspace';

const AGENT_SPACE_TYPE = 'agent';
const DEFAULT_MIGRATION_BATCH_SIZE = 200;

type Db = LobeChatDatabase | Transaction;

export interface AgentSpaceMigrationResult {
  /** No dedicated document of this agent is left outside its space. */
  done: boolean;
  /** Documents moved into the space by this batch. */
  migrated: number;
  /** Another batch held the agent's lock, so this one did nothing. */
  skipped: boolean;
}

/**
 * Owns the knowledge base dedicated to one agent and moves its documents in at runtime.
 *
 * Ownership lives in `knowledge_bases.type` + `settings.owner`, and the agent reaches
 * its space through a disabled `agents_knowledge_bases` row. None of that is a database
 * constraint, so uniqueness per agent is enforced here with an advisory lock.
 *
 * Migration only fills `documents.knowledge_base_id`. `agent_documents` stays the read
 * path, so a half-migrated agent behaves exactly like an unmigrated one.
 */
export class AgentSpaceRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  /**
   * Finds the space of an agent visible to the caller, without creating one.
   */
  async findId(agentId: string, db: Db = this.db): Promise<string | undefined> {
    const [space] = await db
      .select({ id: knowledgeBases.id })
      .from(agentsKnowledgeBases)
      .innerJoin(knowledgeBases, eq(knowledgeBases.id, agentsKnowledgeBases.knowledgeBaseId))
      .innerJoin(agents, eq(agents.id, agentsKnowledgeBases.agentId))
      .where(
        and(
          eq(agentsKnowledgeBases.agentId, agentId),
          // The mount is keyed by agent alone, so the caller's access comes from the agent.
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agents),
          eq(knowledgeBases.type, AGENT_SPACE_TYPE),
          sql`${knowledgeBases.settings} -> 'owner' ->> 'id' = ${agentId}`,
        ),
      )
      .limit(1);

    return space?.id;
  }

  /**
   * Lists the spaces of every agent visible to the caller, most recently edited agent first.
   */
  async list(): Promise<AgentKnowledgeSpaceItem[]> {
    return this.db
      .select({
        agentId: agents.id,
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        description: agents.description,
        id: knowledgeBases.id,
        title: agents.title,
      })
      .from(agentsKnowledgeBases)
      .innerJoin(knowledgeBases, eq(knowledgeBases.id, agentsKnowledgeBases.knowledgeBaseId))
      .innerJoin(agents, eq(agents.id, agentsKnowledgeBases.agentId))
      .where(
        and(
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agents),
          // A space keeps its own visibility, so listing it needs access to both.
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            knowledgeBases,
          ),
          eq(knowledgeBases.type, AGENT_SPACE_TYPE),
          sql`${knowledgeBases.settings} -> 'owner' ->> 'id' = ${agents.id}`,
        ),
      )
      .orderBy(desc(agents.updatedAt));
  }

  /**
   * Returns the agent's space, creating it on first use.
   *
   * Returns:
   * - The knowledge base id, or undefined when the agent is not visible to the caller.
   */
  async ensure(agentId: string): Promise<string | undefined> {
    return (
      (await this.findId(agentId)) ?? this.db.transaction((trx) => this.ensureWithTx(trx, agentId))
    );
  }

  /**
   * Same as {@link ensure}, inside a caller-owned transaction so a document insert
   * and its space commit together.
   */
  async ensureWithTx(trx: Transaction, agentId: string): Promise<string | undefined> {
    await trx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`agentSpace:${agentId}`})::bigint)`,
    );

    // Re-check under the lock: the previous holder may have just created it.
    const existingId = await this.findId(agentId, trx);
    if (existingId) return existingId;

    const [agent] = await trx
      .select({
        title: agents.title,
        userId: agents.userId,
        visibility: agents.visibility,
        workspaceId: agents.workspaceId,
      })
      .from(agents)
      .where(
        and(
          eq(agents.id, agentId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agents),
        ),
      )
      .limit(1);
    if (!agent) return undefined;

    const owner = { userId: agent.userId, workspaceId: agent.workspaceId };
    const [space] = await trx
      .insert(knowledgeBases)
      .values({
        ...owner,
        name: agent.title || agentId,
        settings: { owner: { id: agentId, type: AGENT_SPACE_TYPE } },
        type: AGENT_SPACE_TYPE,
        visibility: agent.visibility,
      })
      .returning({ id: knowledgeBases.id });

    // Disabled: the space must never join the agent's RAG sources.
    await trx
      .insert(agentsKnowledgeBases)
      .values({ ...owner, agentId, enabled: false, knowledgeBaseId: space.id });

    return space.id;
  }

  /**
   * Moves one batch of the agent's dedicated documents into its space.
   *
   * Use when:
   * - An agent is accessed and may still have documents outside its space. Callers
   *   repeat until `done`; a repeat after completion is a cheap no-op, which also
   *   picks up documents written by older server versions.
   *
   * Expects:
   * - The caller has already authorized access to `agentId`.
   *
   * Returns:
   * - Progress for this batch. Never waits for a concurrent batch of the same agent.
   */
  async migrateBatch(
    agentId: string,
    limit = DEFAULT_MIGRATION_BATCH_SIZE,
  ): Promise<AgentSpaceMigrationResult> {
    return this.db.transaction(async (trx) => {
      const lockKey = `agentSpaceMigration:${agentId}`;
      const { rows } = await trx.execute<{ locked: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})::bigint) AS locked`,
      );
      if (!rows[0]?.locked) return { done: false, migrated: 0, skipped: true };

      const candidates = await trx
        .select({ id: documents.id })
        .from(agentDocuments)
        .innerJoin(documents, eq(documents.id, agentDocuments.documentId))
        .where(
          and(
            // Soft-deleted bindings are included so a restored document is already in place.
            eq(agentDocuments.agentId, agentId),
            isNull(documents.knowledgeBaseId),
            isDedicatedToAgentWhere(agentId),
          ),
        )
        .orderBy(asc(documents.id))
        .limit(limit);

      // Agents without dedicated documents never get an empty space.
      if (candidates.length === 0) return { done: true, migrated: 0, skipped: false };

      const spaceId = await this.ensureWithTx(trx, agentId);
      if (!spaceId) return { done: false, migrated: 0, skipped: true };

      const migrated = await trx
        .update(documents)
        // Explicit `updatedAt` bypasses `$onUpdate`: moving a document is not an edit.
        .set({ knowledgeBaseId: spaceId, updatedAt: documents.updatedAt as unknown as Date })
        .where(
          and(
            inArray(
              documents.id,
              candidates.map(({ id }) => id),
            ),
            isNull(documents.knowledgeBaseId),
          ),
        )
        .returning({ id: documents.id });

      return { done: candidates.length < limit, migrated: migrated.length, skipped: false };
    });
  }
}
