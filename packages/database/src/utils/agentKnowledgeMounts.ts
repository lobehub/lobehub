import { and, count, eq, exists, inArray, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { agentsFiles, agentsKnowledgeBases, files, knowledgeBases } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { buildWorkspaceWhere } from './workspace';

interface AgentKnowledgeMountParams {
  agentIds: string[];
  /** The member the agent is being re-homed to — accessibility is judged as THEM. */
  recipientId: string;
  workspaceId: string;
}

type Db = LobeChatDatabase | Transaction;

/**
 * Mount rows on `agentIds` whose referenced knowledge base is NOT visible to
 * the recipient — the exact predicate `getAgentAssignedKnowledge` will apply
 * once the recipient owns the agent, so "will be detached" and "would render
 * as an unavailable placeholder" are the same set.
 */
const inaccessibleKnowledgeBaseMounts = (db: Db, params: AgentKnowledgeMountParams) =>
  and(
    inArray(agentsKnowledgeBases.agentId, params.agentIds),
    buildWorkspaceWhere(
      { userId: params.recipientId, workspaceId: params.workspaceId },
      agentsKnowledgeBases,
    ),
    notExists(
      db
        .select({ id: knowledgeBases.id })
        .from(knowledgeBases)
        .where(
          and(
            eq(knowledgeBases.id, agentsKnowledgeBases.knowledgeBaseId),
            buildWorkspaceWhere(
              { userId: params.recipientId, workspaceId: params.workspaceId },
              knowledgeBases,
            ),
          ),
        ),
    ),
  );

/** Same as above, for direct file mounts. */
const inaccessibleFileMounts = (db: Db, params: AgentKnowledgeMountParams) =>
  and(
    inArray(agentsFiles.agentId, params.agentIds),
    buildWorkspaceWhere(
      { userId: params.recipientId, workspaceId: params.workspaceId },
      agentsFiles,
    ),
    notExists(
      db
        .select({ id: files.id })
        .from(files)
        .where(
          and(
            eq(files.id, agentsFiles.fileId),
            buildWorkspaceWhere(
              { userId: params.recipientId, workspaceId: params.workspaceId },
              files,
            ),
          ),
        ),
    ),
  );

/**
 * Detach knowledge-base / file mounts the RECIPIENT of an ownership handover
 * cannot access (private to another member, or outside the workspace). Left
 * in place, such a mount survives the handover as a dead link: the knowledge
 * runtime silently filters it out and the transferred agent stops using that
 * knowledge with no visible cause. Detaching makes the loss explicit — the
 * mount disappears from the editor list — and the transfer manifest surfaces
 * the count to both parties BEFORE acceptance. Shared by the member and group
 * handovers.
 */
export const detachAgentKnowledgeMountsForRecipient = async (
  db: Db,
  params: AgentKnowledgeMountParams,
): Promise<void> => {
  if (params.agentIds.length === 0) return;
  await db.delete(agentsKnowledgeBases).where(inaccessibleKnowledgeBaseMounts(db, params));
  await db.delete(agentsFiles).where(inaccessibleFileMounts(db, params));
};

/**
 * Re-home the RETAINED mount rows the previous owner created (public KBs /
 * files the recipient can keep using) onto the recipient. The junction rows'
 * `user_id` cascades on user deletion, so left pointing at the previous owner
 * they would silently strip knowledge off the transferred agent if that
 * account is ever deleted — same rationale as re-homing cron/bot rows. Runs
 * AFTER the detach above, so only accessible mounts remain in scope; scoped
 * to the same workspace rows the read path sees. `agents_files` carries
 * `user_id` in its primary key, so a mount the recipient ALREADY has for the
 * same (file, agent) merges by dropping the previous owner's duplicate row.
 */
export const rehomeRetainedAgentKnowledgeMounts = async (
  db: Db,
  params: AgentKnowledgeMountParams & { fromUserId: string },
): Promise<void> => {
  const { agentIds, fromUserId, recipientId, workspaceId } = params;
  if (agentIds.length === 0) return;
  const workspaceCtx = { userId: recipientId, workspaceId };

  await db
    .update(agentsKnowledgeBases)
    .set({ userId: recipientId })
    .where(
      and(
        inArray(agentsKnowledgeBases.agentId, agentIds),
        eq(agentsKnowledgeBases.userId, fromUserId),
        buildWorkspaceWhere(workspaceCtx, agentsKnowledgeBases),
      ),
    );

  const recipientMount = alias(agentsFiles, 'recipient_file_mount');
  await db.delete(agentsFiles).where(
    and(
      inArray(agentsFiles.agentId, agentIds),
      eq(agentsFiles.userId, fromUserId),
      exists(
        db
          .select({ one: sql`1` })
          .from(recipientMount)
          .where(
            and(
              eq(recipientMount.agentId, agentsFiles.agentId),
              eq(recipientMount.fileId, agentsFiles.fileId),
              eq(recipientMount.userId, recipientId),
            ),
          ),
      ),
    ),
  );
  await db
    .update(agentsFiles)
    .set({ userId: recipientId })
    .where(
      and(
        inArray(agentsFiles.agentId, agentIds),
        eq(agentsFiles.userId, fromUserId),
        buildWorkspaceWhere(workspaceCtx, agentsFiles),
      ),
    );
};

/**
 * Read-only companion for the transfer manifest: how many mounts the detach
 * above WOULD remove. Must stay predicate-identical to it.
 */
export const countAgentKnowledgeMountsToDetach = async (
  db: Db,
  params: AgentKnowledgeMountParams,
): Promise<number> => {
  if (params.agentIds.length === 0) return 0;
  const [[kbRow], [fileRow]] = await Promise.all([
    db
      .select({ value: count() })
      .from(agentsKnowledgeBases)
      .where(inaccessibleKnowledgeBaseMounts(db, params)),
    db.select({ value: count() }).from(agentsFiles).where(inaccessibleFileMounts(db, params)),
  ]);
  return kbRow.value + fileRow.value;
};
