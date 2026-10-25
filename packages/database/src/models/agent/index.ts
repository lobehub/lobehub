import { and, asc, eq, inArray } from 'drizzle-orm';

import { AgentDeletionRepository } from '../../repositories/agentDeletion';
import { AgentTransferRepository } from '../../repositories/agentTransfer';
import type { AgentItem } from '../../schemas';
import { agents, agentsToSessions, documents } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { notFileBackedPlaceholder } from '../../utils/fileBackedPlaceholder';
import { normalizeInboxAgentMeta } from '../../utils/inboxAgent';
import { readOriginalCharCount } from '../../utils/parsedDocument';
import { type AgentModelContext, createAgentModelContext } from './context';
import * as create from './create';
import * as remove from './delete';
import * as find from './find';
import * as groupMembership from './groupMembership';
import * as knowledge from './knowledge';
import * as list from './list';
import * as transfer from './transfer';
import * as transferOwnership from './transferOwnership';
import * as trash from './trash';
import { type AgentTransferOptions } from './types';
import * as update from './update';

export {
  AGENT_OWNED_BY_GROUP,
  AGENT_OWNERSHIP_STALE,
  AGENT_SHARED_TRANSFER_BLOCKED,
  AgentOwnedByGroupError,
} from './errors';
export type { AgentGroupMembershipRef, DeviceBindingCandidate } from './types';

export class AgentModel {
  private ctx: AgentModelContext;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.ctx = createAgentModelContext({ db, userId, workspaceId });
  }

  /**
   * Binds an operation module function to this instance's context. The context
   * is read at call time, so the bound methods can be class fields even though
   * the context is assigned in the constructor body.
   */
  private withContext<A extends unknown[], R>(fn: (ctx: AgentModelContext, ...args: A) => R) {
    return (...args: A): R => fn(this.ctx, ...args);
  }

  // **************** List *************** //

  rank = this.withContext(list.rank);
  queryAgencyRoutingByIds = this.withContext(list.queryAgencyRoutingByIds);
  queryBoundToDevice = this.withContext(list.queryBoundToDevice);
  queryAgents = this.withContext(list.queryAgents);
  countAgents = this.withContext(list.countAgents);
  getAgentAvatarsByIds = this.withContext(list.getAgentAvatarsByIds);
  listMessengerBindableAgents = this.withContext(list.listMessengerBindableAgents);

  // **************** Read *************** //

  getAgentDisplayFields = this.withContext(find.getAgentDisplayFields);
  getAgentVisibility = this.withContext(find.getAgentVisibility);
  existsById = this.withContext(find.existsById);
  existsOwnedById = this.withContext(find.existsOwnedById);
  getAgentModelConfig = this.withContext(find.getAgentModelConfig);
  getAgentAgencyConfig = this.withContext(find.getAgentAgencyConfig);
  getAgentSnapshotForTaskCreate = this.withContext(find.getAgentSnapshotForTaskCreate);
  getTopicShareSubject = this.withContext(find.getTopicShareSubject);
  getAgentVisibilityMeta = this.withContext(find.getAgentVisibilityMeta);
  checkByMarketIdentifier = this.withContext(find.checkByMarketIdentifier);
  getAgentByMarketIdentifier = this.withContext(find.getAgentByMarketIdentifier);
  getAgentByForkedFromIdentifier = this.withContext(find.getAgentByForkedFromIdentifier);
  resolveIdBySlug = this.withContext(find.resolveIdBySlug);

  // **************** Knowledge & files *************** //

  getAgentAssignedKnowledge = this.withContext(knowledge.getAgentAssignedKnowledge);
  createAgentKnowledgeBase = this.withContext(knowledge.createAgentKnowledgeBase);
  deleteAgentKnowledgeBase = this.withContext(knowledge.deleteAgentKnowledgeBase);
  toggleKnowledgeBase = this.withContext(knowledge.toggleKnowledgeBase);
  createAgentFiles = this.withContext(knowledge.createAgentFiles);
  deleteAgentFile = this.withContext(knowledge.deleteAgentFile);
  toggleFile = this.withContext(knowledge.toggleFile);

  // **************** Create *************** //

  create = this.withContext(create.create);
  batchCreate = this.withContext(create.batchCreate);
  duplicate = this.withContext(create.duplicate);
  getBuiltinAgent = this.withContext(create.getBuiltinAgent);

  // **************** Update *************** //

  update = this.withContext(update.update);
  setVisibility = this.withContext(update.setVisibility);
  updateConfig = this.withContext(update.updateConfig);
  getAssignableSessionGroupVisibility = this.withContext(
    update.getAssignableSessionGroupVisibility,
  );
  updateSlug = this.withContext(update.updateSlug);

  // **************** Delete *************** //

  /**
   * Delete an agent with its session links and legacy session shells. The
   * unit of work spans the sessions aggregate, so it lives in
   * {@link AgentDeletionRepository}; this forwards to it.
   */
  delete = (agentId: string) =>
    new AgentDeletionRepository(this.ctx.db, this.ctx.userId, this.ctx.workspaceId).deleteAgent(
      agentId,
    );
  assertDeletable = this.withContext(remove.assertDeletable);
  findSessionIdsByAgentIds = this.withContext(remove.findSessionIdsByAgentIds);
  findAgentIdsBySessionIds = this.withContext(remove.findAgentIdsBySessionIds);
  batchDelete = this.withContext(remove.batchDelete);

  // **************** Recycle bin *************** //

  softDelete = this.withContext(trash.softDelete);
  restore = this.withContext(trash.restore);
  findTrashedByIds = this.withContext(trash.findTrashedByIds);
  lockTrashedForPurge = this.withContext(trash.lockTrashedForPurge);
  purge = this.withContext(trash.purge);

  // **************** Group membership *************** //

  getGroupMembershipImpact = this.withContext(groupMembership.getGroupMembershipImpact);

  // **************** Transfer *************** //

  transferHasForeignRows = this.withContext(transfer.transferHasForeignRows);
  /**
   * Cross-scope transfer of agents and everything they own. The unit of work
   * spans many aggregates, so it lives in {@link AgentTransferRepository};
   * this forwards to it.
   */
  transferAgents: AgentTransferRepository['transferAgents'] = (...args) =>
    new AgentTransferRepository(this.ctx.db, this.ctx.userId, this.ctx.workspaceId).transferAgents(
      ...args,
    );

  // **************** Ownership transfer *************** //

  transferAgentOwnership = this.withContext(transferOwnership.transferAgentOwnership);

  // **************** Methods that call other public methods *************** //

  getAgentConfigById = async (id: string) => {
    const agent = await this.ctx.db.query.agents.findFirst({
      where: and(eq(agents.id, id), this.ctx.ownership()),
    });

    if (!agent) return null;

    return this.enrichAgentWithKnowledge(agent);
  };

  /**
   * Get agent config by ID or slug (single query with OR condition)
   */
  getAgentConfig = async (idOrSlug: string) => {
    // Prefer an exact ID match over a slug match. The combined `or(id, slug)`
    // query has no inherent ordering, so resolve ID first for determinism.
    const agent =
      (await this.ctx.db.query.agents.findFirst({
        where: and(this.ctx.ownership(), eq(agents.id, idOrSlug)),
      })) ??
      (await this.ctx.db.query.agents.findFirst({
        where: and(this.ctx.ownership(), eq(agents.slug, idOrSlug)),
      }));

    if (!agent) return null;

    return this.enrichAgentWithKnowledge(agent);
  };

  /**
   * Enrich agent with knowledge base and files data
   */
  private enrichAgentWithKnowledge = async (agent: AgentItem) => {
    const knowledge = await this.getAgentAssignedKnowledge(agent.id);
    const normalizedAgent = normalizeInboxAgentMeta(agent, { slug: agent.slug });

    // Fetch document content for enabled files
    const enabledFileIds = knowledge.files
      .filter((f) => f.enabled)
      .map((f) => f.id)
      .filter((id) => id !== undefined);
    let files: Array<
      (typeof knowledge.files)[number] & { content?: string | null; originalCharCount?: number }
    > = knowledge.files;

    if (enabledFileIds.length > 0) {
      const documentsData = await this.ctx.db.query.documents.findMany({
        // A file can own several documents; take the oldest, like `DocumentModel.findByFileId`
        // (which `readAttachment` pages through), so the preview and its continuation agree.
        orderBy: [asc(documents.createdAt), asc(documents.id)],
        where: and(
          this.ctx.documentsOwnership(),
          inArray(documents.fileId, enabledFileIds),
          notFileBackedPlaceholder(),
        ),
      });

      const documentMap = new Map<string | null, (typeof documentsData)[number]>();
      for (const doc of documentsData) {
        if (!documentMap.has(doc.fileId)) documentMap.set(doc.fileId, doc);
      }
      files = knowledge.files.map((file) => {
        const document = file.enabled && file.id ? documentMap.get(file.id) : undefined;
        return {
          ...file,
          content: document?.content,
          originalCharCount: readOriginalCharCount(document?.metadata),
        };
      });
    }

    return { ...normalizedAgent, ...knowledge, files };
  };

  /**
   * Find agent by session id
   */
  findBySessionId = async (sessionId: string) => {
    const item = await this.ctx.db.query.agentsToSessions.findFirst({
      where: and(eq(agentsToSessions.sessionId, sessionId), this.ctx.agentsToSessionsOwnership()),
    });

    if (!item) return;

    const agentId = item.agentId;

    return this.getAgentConfigById(agentId);
  };

  /**
   * Whether the agent that owns a row is sitting in the bin — reached either
   * directly (`agent_id`) or, for legacy rows that only carry `session_id`,
   * through the session shell's agent link. Restoring such a row first would
   * bring it back under an invisible container.
   */
  hasTrashedOwner = async (owner: {
    agentId?: string | null;
    sessionId?: string | null;
  }): Promise<boolean> => {
    const agentIds = [
      ...(owner.agentId ? [owner.agentId] : []),
      ...(owner.sessionId ? await this.findAgentIdsBySessionIds([owner.sessionId]) : []),
    ];
    return (await this.findTrashedByIds([...new Set(agentIds)])).length > 0;
  };

  touchUpdatedAt = async (agentId: string) => {
    return this.update(agentId, {});
  };

  /**
   * Publish a private agent into the workspace. The `user_id = ?` +
   * `visibility = 'private'` guards lock the operation to the creator's own
   * still-private agent. The inverse transition (public → private) goes
   * through {@link setVisibility}, which the router gates to the creator or
   * a workspace owner.
   *
   * Use the existing `update` to change other fields; visibility is the only
   * one with these authorization rules.
   */
  publishToWorkspace = async (agentId: string) => {
    const agent = await this.ctx.db.query.agents.findFirst({
      columns: { agencyConfig: true, sessionGroupId: true, workspaceId: true },
      where: and(
        eq(agents.id, agentId),
        this.ctx.ownership(),
        eq(agents.userId, this.ctx.userId),
        eq(agents.visibility, 'private'),
      ),
    });

    if (!agent) {
      throw new Error('Agent not found, already published, or access denied');
    }

    // Re-check at the publication boundary. A legacy/stale fixed target may
    // predate the config-write guard; a concrete device must never be exposed
    // when workspace members cannot resolve it.
    await this.ctx.assertFixedExecutionTarget(agent.workspaceId, agent.agencyConfig);

    // Rehome exactly as `setVisibility` does: a folder cannot mix
    // visibilities, so publishing out of a private Category releases the
    // folder. Left in place the agent would be public while its folder is not,
    // and the sidebar would show it in Ungrouped rather than where it was
    // published from.
    const clearGroup = agent.sessionGroupId
      ? await this.getAssignableSessionGroupVisibility(agent.sessionGroupId)
          .then((visibility) => visibility !== 'public')
          .catch(() => true)
      : false;

    const [result] = await this.ctx.db
      .update(agents)
      .set({
        updatedAt: new Date(),
        visibility: 'public',
        ...(clearGroup ? { sessionGroupId: null } : {}),
      })
      .where(
        and(
          eq(agents.id, agentId),
          this.ctx.ownership(),
          eq(agents.userId, this.ctx.userId),
          eq(agents.visibility, 'private'),
        ),
      )
      .returning();

    if (!result) {
      throw new Error('Agent not found, already published, or access denied');
    }

    return result;
  };

  private assertSessionGroupAssignable = async (agentId: string, sessionGroupId: string) => {
    const groupVisibility = await this.getAssignableSessionGroupVisibility(sessionGroupId);
    const group = { visibility: groupVisibility };

    if (!this.ctx.workspaceId) return;

    const [agent] = await this.ctx.db
      .select({ visibility: agents.visibility })
      .from(agents)
      .where(and(eq(agents.id, agentId), this.ctx.ownership()))
      .limit(1);

    // Buckets must match exactly, not merely "public agent needs a public
    // folder". `processAgentList` resolves a private item's folder only against
    // the private folder set and a public item's only against the public one,
    // so a mismatch in either direction renders as Ungrouped rather than in
    // the folder the user picked.
    if (agent && agent.visibility !== group.visibility)
      throw new Error(
        `A ${agent.visibility} agent cannot be moved into a ${group.visibility} folder`,
      );
  };

  updateSessionGroupId = async (agentId: string, sessionGroupId: string | null) => {
    // The column is workspace-shared, so an unvalidated target corrupts the
    // sidebar for everyone, not just the caller. The foreign key only proves
    // the folder exists: another workspace's folder, or another member's
    // private one, passes it happily and then renders as Ungrouped for every
    // member who cannot see it.
    if (sessionGroupId) await this.assertSessionGroupAssignable(agentId, sessionGroupId);

    const result = await this.ctx.db
      .update(agents)
      .set({ sessionGroupId, updatedAt: new Date() })
      .where(and(eq(agents.id, agentId), this.ctx.ownership()))
      .returning();

    return result[0];
  };

  transferAgent = async (
    agentId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
    targetVisibility?: 'private' | 'public',
    options: AgentTransferOptions = {},
  ): Promise<{ agentId: string; slug: string | null; transferJobId: string | null }> => {
    const [result] = await this.transferAgents(
      [agentId],
      targetWorkspaceId,
      targetUserId,
      targetVisibility,
      options,
    );
    return result;
  };
}
