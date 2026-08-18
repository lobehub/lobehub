import { and, count, eq, inArray, not, notExists, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  agentDocuments,
  documentHistories,
  documents,
  SKILL_MANAGEMENT_SOURCE,
  SKILL_MANAGEMENT_SOURCE_TYPE,
  taskDocuments,
  topicDocuments,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { buildWorkspaceWhere } from './workspace';

/**
 * `sourceType` values stamped on DEDICATED agent-created documents:
 * `createWithTx` defaults to 'agent' (`AGENT_DOCUMENT_SOURCE_TYPE`), and the
 * skill-management flows pass 'agent-signal'. NOT sufficient alone — other
 * flows also stamp `sourceType: 'agent'` on standalone documents (e.g. Verify
 * criterion instructions), so classification additionally requires a `source`
 * produced by the agent-document machinery itself. An unknown provenance
 * fails safe: the document is treated as associated and never changes owner.
 */
const DEDICATED_AGENT_DOCUMENT_SOURCE_TYPES = ['agent', SKILL_MANAGEMENT_SOURCE_TYPE] as const;
const AGENT_DOCUMENT_SOURCE_PREFIX = 'agent-document://';

const isDedicatedProvenance = (source: string | null, sourceType: string | null) =>
  !!sourceType &&
  (DEDICATED_AGENT_DOCUMENT_SOURCE_TYPES as readonly string[]).includes(sourceType) &&
  !!source &&
  (source.startsWith(AGENT_DOCUMENT_SOURCE_PREFIX) || source === SKILL_MANAGEMENT_SOURCE);

interface AgentDocumentsHandoverParams {
  agentIds: string[];
  fromUserId: string;
  recipientId: string;
  workspaceId: string;
}

type Db = LobeChatDatabase | Transaction;

/**
 * Document policy for an ownership handover. Two kinds of rows hang off
 * `agent_documents`, and they must not be treated alike:
 *
 * - DEDICATED agent files (created via `createWithTx`, `source` stamped
 *   `agent-document://…`): they exist only for this agent, but both the link
 *   row's and the backing document's `user_id` cascade on user deletion — the
 *   previous owner's rows re-home with the agent or their account deletion
 *   would strip the agent's skills.
 * - ASSOCIATED pre-existing documents (`associate` — a personal document made
 *   visible to the agent): the document is NOT the agent's property and its
 *   ownership never changes. A binding whose document the recipient cannot
 *   see is detached explicitly (counted into the manifest's knowledge-detach
 *   line); an accessible one keeps working, with only the link row re-homed
 *   so it cannot cascade away with the previous owner's account.
 */
export const rehomeAgentDocumentsForRecipient = async (
  db: Db,
  params: AgentDocumentsHandoverParams,
): Promise<void> => {
  const { agentIds, fromUserId, recipientId, workspaceId } = params;
  if (agentIds.length === 0) return;

  const rows = await db
    .select({
      accessible: sql<boolean>`(${buildWorkspaceWhere(
        { userId: recipientId, workspaceId },
        documents,
      )})`,
      agentId: agentDocuments.agentId,
      bindingId: agentDocuments.id,
      documentId: agentDocuments.documentId,
      docUserId: documents.userId,
      source: documents.source,
      sourceType: documents.sourceType,
    })
    .from(agentDocuments)
    .innerJoin(documents, eq(documents.id, agentDocuments.documentId))
    .where(and(inArray(agentDocuments.agentId, agentIds), eq(agentDocuments.userId, fromUserId)));
  if (rows.length === 0) return;

  const dedicatedCandidates = rows.filter(
    (row) => row.docUserId === fromUserId && isDedicatedProvenance(row.source, row.sourceType),
  );
  // A document created for THIS agent can still have been `associate`d to
  // another agent, a topic or a task since: those external consumers make it
  // shared content, so it falls back to the associated policy (ownership
  // never changes) instead of being yanked from under the other consumer.
  const externallyBound = new Set<string>();
  if (dedicatedCandidates.length > 0) {
    const candidateDocIds = dedicatedCandidates.map((row) => row.documentId);
    const [externalAgents, topicRefs, taskRefs] = await Promise.all([
      db
        .selectDistinct({ documentId: agentDocuments.documentId })
        .from(agentDocuments)
        .where(
          and(
            inArray(agentDocuments.documentId, candidateDocIds),
            notInArray(agentDocuments.agentId, agentIds),
          ),
        ),
      db
        .selectDistinct({ documentId: topicDocuments.documentId })
        .from(topicDocuments)
        .where(inArray(topicDocuments.documentId, candidateDocIds)),
      db
        .selectDistinct({ documentId: taskDocuments.documentId })
        .from(taskDocuments)
        .where(inArray(taskDocuments.documentId, candidateDocIds)),
    ]);
    for (const row of [...externalAgents, ...topicRefs, ...taskRefs])
      externallyBound.add(row.documentId);
  }
  const dedicated = dedicatedCandidates.filter((row) => !externallyBound.has(row.documentId));
  const associated = rows.filter((row) => !dedicated.includes(row));
  const detached = associated.filter((row) => !row.accessible);
  const retained = associated.filter((row) => row.accessible);

  // Bindings are unique per (agent, document, user): where the RECIPIENT
  // already holds their own binding for the same pair, the previous owner's
  // row merges away instead of colliding on re-home — same policy as the
  // duplicate file-mount merge in the knowledge handover.
  const recipientPairs = await db
    .select({ agentId: agentDocuments.agentId, documentId: agentDocuments.documentId })
    .from(agentDocuments)
    .where(and(inArray(agentDocuments.agentId, agentIds), eq(agentDocuments.userId, recipientId)));
  const duplicatePairs = new Set(recipientPairs.map((row) => `${row.agentId}:${row.documentId}`));
  const isDuplicate = (row: { agentId: string; documentId: string }) =>
    duplicatePairs.has(`${row.agentId}:${row.documentId}`);

  const bindingsToDelete = [
    ...detached,
    ...dedicated.filter(isDuplicate),
    ...retained.filter(isDuplicate),
  ];
  const bindingsToRehome = [
    ...dedicated.filter((row) => !isDuplicate(row)),
    ...retained.filter((row) => !isDuplicate(row)),
  ];

  if (bindingsToDelete.length > 0) {
    await db.delete(agentDocuments).where(
      inArray(
        agentDocuments.id,
        bindingsToDelete.map((row) => row.bindingId),
      ),
    );
  }
  if (bindingsToRehome.length > 0) {
    await db
      .update(agentDocuments)
      .set({ userId: recipientId })
      .where(
        inArray(
          agentDocuments.id,
          bindingsToRehome.map((row) => row.bindingId),
        ),
      );
  }
  if (dedicated.length > 0) {
    const dedicatedDocIds = dedicated.map((row) => row.documentId);
    await db
      .update(documents)
      .set({ clientId: null, userId: recipientId })
      .where(and(inArray(documents.id, dedicatedDocIds), eq(documents.userId, fromUserId)));
    // Revision history rows also cascade on user deletion — they follow their
    // document, or the transferred document would survive while its history
    // dies with the previous owner's account.
    await db
      .update(documentHistories)
      .set({ userId: recipientId })
      .where(
        and(
          inArray(documentHistories.documentId, dedicatedDocIds),
          eq(documentHistories.userId, fromUserId),
        ),
      );
  }
};

/**
 * Read-only companion for the transfer manifest: associated document bindings
 * the handover above will DETACH (backing document invisible to the
 * recipient). Must stay predicate-identical to the detach branch.
 */
export const countAssociatedAgentDocumentsToDetach = async (
  db: Db,
  params: AgentDocumentsHandoverParams,
): Promise<number> => {
  const { agentIds, fromUserId, recipientId, workspaceId } = params;
  if (agentIds.length === 0) return 0;
  const externalBinding = alias(agentDocuments, 'external_agent_document');
  const [row] = await db
    .select({ value: count() })
    .from(agentDocuments)
    .innerJoin(documents, eq(documents.id, agentDocuments.documentId))
    .where(
      and(
        inArray(agentDocuments.agentId, agentIds),
        eq(agentDocuments.userId, fromUserId),
        not(
          and(
            eq(documents.userId, fromUserId),
            inArray(documents.sourceType, [...DEDICATED_AGENT_DOCUMENT_SOURCE_TYPES]),
            or(
              sql`${documents.source} LIKE ${`${AGENT_DOCUMENT_SOURCE_PREFIX}%`}`,
              eq(documents.source, SKILL_MANAGEMENT_SOURCE),
            ),
            notExists(
              db
                .select({ one: sql`1` })
                .from(externalBinding)
                .where(
                  and(
                    eq(externalBinding.documentId, agentDocuments.documentId),
                    notInArray(externalBinding.agentId, agentIds),
                  ),
                ),
            ),
            notExists(
              db
                .select({ one: sql`1` })
                .from(topicDocuments)
                .where(eq(topicDocuments.documentId, agentDocuments.documentId)),
            ),
            notExists(
              db
                .select({ one: sql`1` })
                .from(taskDocuments)
                .where(eq(taskDocuments.documentId, agentDocuments.documentId)),
            ),
          )!,
        ),
        not(buildWorkspaceWhere({ userId: recipientId, workspaceId }, documents)),
      ),
    );
  return row.value;
};
