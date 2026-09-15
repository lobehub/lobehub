import { and, count, eq, inArray, isNull, not, notExists, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  AGENT_SKILL_TEMPLATE_ID,
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

/**
 * Provenance alone says the file was made by *an* agent, not by one of THESE
 * agents. Each shape carries its own origin evidence, and a binding without any
 * fails safe as associated — rehoming on a guess would quietly take another
 * member's resource out of the source scope.
 *
 * - `agent-document://<agentId>/<file>` names the agent it was created for, so
 *   an orphan created for a since-deleted agent and later associated to a
 *   moving one stays put.
 * - Skill-management documents carry no id in their source, but only the
 *   skill-management create/convert flows stamp `AGENT_SKILL_TEMPLATE_ID` on
 *   the BINDING they open; `AgentDocumentModel.associate` leaves it null. So a
 *   borrowed skill — someone else's bundle made visible to this agent — stays
 *   distinguishable from one the agent actually owns.
 */
const isDedicatedToAgents = (
  row: { bindingTemplateId: string | null; source: string | null; sourceType: string | null },
  agentIds: Set<string>,
) => {
  const { bindingTemplateId, source, sourceType } = row;
  if (!isDedicatedProvenance(source, sourceType)) return false;
  if (source === SKILL_MANAGEMENT_SOURCE) return bindingTemplateId === AGENT_SKILL_TEMPLATE_ID;

  const [provenanceAgentId] = source!.slice(AGENT_DOCUMENT_SOURCE_PREFIX.length).split('/');
  return agentIds.has(provenanceAgentId);
};

/**
 * A document tree moves or stays as a WHOLE.
 *
 * `documents.parent_id` is never rewritten by a transfer, and agent-document
 * traversal applies one scope predicate along the entire path — so a tree split
 * across scopes is unreachable from both ends: the parent loses the child, and
 * the child hangs under a parent the target cannot see. Managed skills are
 * exactly this shape (a `skills/bundle` parent over its `SKILL.md` index), so a
 * single external pin on either node has to hold the other one back too.
 *
 * Shrinks `movable` in place until every remaining tree is whole. Each pass can
 * only remove ids, so the loop terminates.
 */
const dropSplitTrees = async (db: Db, movable: Set<string>): Promise<void> => {
  while (movable.size > 0) {
    const ids = [...movable];
    const [moving, children] = await Promise.all([
      db
        .select({ id: documents.id, parentId: documents.parentId })
        .from(documents)
        .where(inArray(documents.id, ids)),
      db
        .select({ id: documents.id, parentId: documents.parentId })
        .from(documents)
        .where(inArray(documents.parentId, ids)),
    ]);

    const blocked = new Set<string>();
    // An ancestor staying behind pins everything under it.
    for (const row of moving) if (row.parentId && !movable.has(row.parentId)) blocked.add(row.id);
    // A descendant staying behind pins everything above it.
    for (const row of children) if (!movable.has(row.id)) blocked.add(row.parentId!);

    if (blocked.size === 0) return;
    for (const id of blocked) movable.delete(id);
  }
};

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

  // Provenance is not narrowed to `agentIds` here the way the scope transfer
  // narrows it: `docUserId === fromUserId` already keeps the handover to the
  // transferring member's own documents, and the SQL mirror in
  // `countAssociatedAgentDocumentsToDetach` must stay predicate-identical.
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

/**
 * Document policy for a CROSS-SCOPE transfer (personal ↔ workspace): the
 * agent's own documents are part of the agent and must move with it, or the
 * transfer strands them — the binding rows stop matching the target scope's
 * ownership predicate (the agent's Documents list goes empty) while the
 * backing rows linger in the source scope's Resource list with no agent left
 * to reach them from.
 *
 * The dedicated/associated split reuses the member-handover doctrine above,
 * with one scope-transfer twist: references from topics and tasks that move
 * in the SAME transfer are internal (those rows follow the agent anyway), so
 * only references from OUTSIDE the moving set make a document shared content
 * that stays behind.
 *
 * - DEDICATED documents (agent-created provenance, no external consumers):
 *   binding + backing document + revision history all re-scope to the target.
 *   Visibility cascades like the task rows in `transferAgents` — a `private`
 *   transfer must not leak previously-personal skill files to every member.
 * - ASSOCIATED documents (pre-existing content made visible to the agent, or
 *   dedicated files that grew external consumers): the backing document stays
 *   where it lives; the binding is detached — kept, it would be a dead link
 *   no scope can resolve (same rationale as the knowledge-mount detach).
 *
 * @returns the ids of the documents that actually moved, so the caller can
 *   split the topic/task junction rows the same way — a junction only resolves
 *   when both it and its document pass the target scope's predicate.
 */
export const moveAgentDocumentsForScopeTransfer = async (
  db: Db,
  params: {
    agentIds: string[];
    /** Tasks moving in the same transfer — their document refs are internal. */
    movedTaskIds: string[];
    /** Topics moving in the same transfer — their document refs are internal. */
    movedTopicIds: string[];
    targetUserId: string;
    targetVisibility?: 'private' | 'public';
    targetWorkspaceId: string | null;
  },
): Promise<string[]> => {
  const {
    agentIds,
    movedTaskIds,
    movedTopicIds,
    targetUserId,
    targetVisibility,
    targetWorkspaceId,
  } = params;
  if (agentIds.length === 0) return [];

  const rows = await db
    .select({
      agentId: agentDocuments.agentId,
      bindingId: agentDocuments.id,
      bindingTemplateId: agentDocuments.templateId,
      bindingUserId: agentDocuments.userId,
      documentId: agentDocuments.documentId,
      slug: documents.slug,
      source: documents.source,
      sourceType: documents.sourceType,
    })
    .from(agentDocuments)
    .innerJoin(documents, eq(documents.id, agentDocuments.documentId))
    .where(inArray(agentDocuments.agentId, agentIds));
  if (rows.length === 0) return [];

  const movingAgentIds = new Set(agentIds);
  const dedicatedCandidates = rows.filter((row) => isDedicatedToAgents(row, movingAgentIds));

  // External consumers pin a document to the source scope. Unlike the member
  // handover, topic/task references only count when the referencing row is
  // NOT itself moving with this transfer.
  const externallyBound = new Set<string>();
  if (dedicatedCandidates.length > 0) {
    const candidateDocIds = [...new Set(dedicatedCandidates.map((row) => row.documentId))];
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
        .where(
          and(
            inArray(topicDocuments.documentId, candidateDocIds),
            movedTopicIds.length > 0
              ? notInArray(topicDocuments.topicId, movedTopicIds)
              : undefined,
          ),
        ),
      db
        .selectDistinct({ documentId: taskDocuments.documentId })
        .from(taskDocuments)
        .where(
          and(
            inArray(taskDocuments.documentId, candidateDocIds),
            movedTaskIds.length > 0 ? notInArray(taskDocuments.taskId, movedTaskIds) : undefined,
          ),
        ),
    ]);
    for (const row of [...externalAgents, ...topicRefs, ...taskRefs])
      externallyBound.add(row.documentId);
  }

  const movable = new Set(
    dedicatedCandidates
      .filter((row) => !externallyBound.has(row.documentId))
      .map((row) => row.documentId),
  );
  await dropSplitTrees(db, movable);

  const dedicated = dedicatedCandidates.filter((row) => movable.has(row.documentId));
  const dedicatedDocIds = [...new Set(dedicated.map((row) => row.documentId))];
  const dedicatedBindingIds = new Set(dedicated.map((row) => row.bindingId));
  const associated = rows.filter((row) => !dedicatedBindingIds.has(row.bindingId));

  // Bindings are unique per (agent, document, user): re-scoping every rider to
  // `targetUserId` would collide where several members hold a binding for the
  // same pair, so keep the target owner's row (or the first) and merge the
  // rest away.
  const keptByPair = new Map<string, string>();
  const duplicateBindingIds: string[] = [];
  for (const row of dedicated) {
    const pair = `${row.agentId}:${row.documentId}`;
    const kept = keptByPair.get(pair);
    if (!kept) {
      keptByPair.set(pair, row.bindingId);
    } else if (row.bindingUserId === targetUserId) {
      duplicateBindingIds.push(kept);
      keptByPair.set(pair, row.bindingId);
    } else {
      duplicateBindingIds.push(row.bindingId);
    }
  }

  const bindingsToDelete = [...associated.map((row) => row.bindingId), ...duplicateBindingIds];
  if (bindingsToDelete.length > 0) {
    await db.delete(agentDocuments).where(inArray(agentDocuments.id, bindingsToDelete));
  }
  if (keptByPair.size > 0) {
    await db
      .update(agentDocuments)
      .set({ userId: targetUserId, workspaceId: targetWorkspaceId })
      .where(inArray(agentDocuments.id, [...keptByPair.values()]));
  }

  if (dedicatedDocIds.length === 0) return [];

  // Dedicated agent files carry no slug today, but a slugged row colliding
  // with the target scope's unique index must not abort the whole transfer —
  // drop the slug instead (the agent reaches its files by binding, not slug).
  //
  // The probe mirrors the INDEX, not the read predicate: `documents_slug_*`
  // covers every row in the target scope, so `buildWorkspaceWhere` would hide
  // another member's private document behind its visibility clause and let the
  // collision reach Postgres — aborting the entire transfer transaction.
  const sluggedDocs = dedicated.filter((row) => row.slug);
  const conflictedDocIds = new Set<string>();
  if (sluggedDocs.length > 0) {
    const targetScope = targetWorkspaceId
      ? eq(documents.workspaceId, targetWorkspaceId)
      : and(isNull(documents.workspaceId), eq(documents.userId, targetUserId));
    const conflictRows = await db
      .select({ slug: documents.slug })
      .from(documents)
      .where(
        and(
          targetScope,
          notInArray(documents.id, dedicatedDocIds),
          inArray(documents.slug, [...new Set(sluggedDocs.map((row) => row.slug!))]),
        ),
      );
    const taken = new Set(conflictRows.map((row) => row.slug));
    for (const row of sluggedDocs) if (taken.has(row.slug)) conflictedDocIds.add(row.documentId);
  }

  // Visibility only applies when landing in a workspace — mirror the task
  // cascade in `transferAgents`. `clientId` is cleared like the member
  // handover: it is unique per user and belongs to the source owner's sync.
  const documentScopeUpdate = {
    clientId: null,
    userId: targetUserId,
    workspaceId: targetWorkspaceId,
    ...(targetWorkspaceId && targetVisibility ? { visibility: targetVisibility } : {}),
  };
  const cleanDocIds = dedicatedDocIds.filter((id) => !conflictedDocIds.has(id));
  if (cleanDocIds.length > 0) {
    await db.update(documents).set(documentScopeUpdate).where(inArray(documents.id, cleanDocIds));
  }
  if (conflictedDocIds.size > 0) {
    await db
      .update(documents)
      .set({ ...documentScopeUpdate, slug: null })
      .where(inArray(documents.id, [...conflictedDocIds]));
  }

  // Revision history denormalizes the scope — left behind, scope-filtered
  // history reads for the moved document go stale. Author attribution
  // (`user_id`) survives a WORKSPACE target, which filters on `workspace_id`
  // alone; a PERSONAL target reads `user_id = owner AND workspace_id IS NULL`,
  // so another member's revisions would be invisible to the new owner and
  // would cascade away the day that member's account is deleted. Rehoming the
  // owner there mirrors the member handover above.
  await db
    .update(documentHistories)
    .set(
      targetWorkspaceId
        ? { workspaceId: targetWorkspaceId }
        : { userId: targetUserId, workspaceId: null },
    )
    .where(inArray(documentHistories.documentId, dedicatedDocIds));

  return dedicatedDocIds;
};
