import type { TransferResourceType } from '@lobechat/types';
import { and, count, eq, inArray, ne } from 'drizzle-orm';

import {
  agentBotProviders,
  agentCronJobs,
  agents,
  chatGroups,
  chatGroupsAgents,
  projectAgents,
  projects,
  tasks,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  collectBoundDeviceIds,
  sanitizeAgencyConfigsForWorkspace,
} from '../../utils/agencyConfigDevices';
import { countAgentConnectorsAffected } from '../../utils/agentConnectors';
import { countAssociatedAgentDocumentsToDetach } from '../../utils/agentDocumentsOwnership';
import { countAgentExpertiseAffected } from '../../utils/agentExpertise';
import { countAgentKnowledgeMountsToDetach } from '../../utils/agentKnowledgeMounts';
import { resolveGroupMembershipType } from '../../utils/groupMembership';

/**
 * What a member-to-member handover of this resource will actually carry, so
 * BOTH parties can see it before committing: the initiator when composing the
 * request, the recipient on the pending-request card. Fixes the flow's worst
 * property — silence: neither side should have to guess which attached
 * configuration rides along, arrives disabled, or gets detached.
 */
export interface MemberTransferManifest {
  /** Number of the owner's bot bindings that transfer DISABLED (a platform can have several). */
  botBindings: number;
  /** Distinct platforms of those bindings, for display. */
  botPlatforms: string[];
  /** Connectors disconnected (agent-owned, reauthorize with the recipient's account) or unmounted (other members' linked rows). */
  connectorsAffected: number;
  /** Owner's scheduled jobs that transfer DISABLED. */
  cronJobs: number;
  /** Any device binding exists that recipient-aware sanitation may reset. */
  deviceBindingAffected: boolean;
  /** Private expertise domains adjusted: agent-exclusive ones re-home, shared ones unbind. */
  expertiseAffected: number;
  /** Agent only: groups (not the recipient's) that reference this PRIVATE agent and will drop it on handover. */
  groupsToLeave: number;
  /** Group only: a referenced member is private to someone other than the recipient — acceptance will be refused. */
  hiddenReferencedMember: boolean;
  /** Knowledge attachments (KB / file mounts, associated documents) the recipient cannot access, detached on accept. */
  knowledgeToDetach: number;
  /** Current owner of the resource (the side whose attachments ride along). */
  ownerId: string;
  /** Projects (not the recipient's) that attached a PRIVATE transferred agent and will drop it on handover. */
  projectsToLeave: number;
  /** Task assignments to a PRIVATE agent that will be detached on accept. */
  tasksToDetach: number;
}

/**
 * Compute the manifest for one resource. Returns `null` when the resource does
 * not exist in the workspace — the caller decides how to surface that.
 * Read-only; authorization is the caller's responsibility.
 */
export const buildMemberTransferManifest = async (
  db: LobeChatDatabase,
  params: {
    recipientId: string;
    resourceId: string;
    resourceType: TransferResourceType;
    workspaceId: string;
  },
): Promise<MemberTransferManifest | null> => {
  const { recipientId, resourceId, resourceType, workspaceId } = params;

  let ownerId: string;
  /** Agents whose owner-attributed rows ride along (the agent itself, or a group's owned members). */
  let agentIds: string[] = [];
  let privateAgentIds: string[] = [];
  let agencyConfigs: Array<unknown> = [];
  let hiddenReferencedMember = false;
  let groupsToLeave = 0;

  switch (resourceType) {
    case 'agent': {
      const [agent] = await db
        .select({
          agencyConfig: agents.agencyConfig,
          id: agents.id,
          userId: agents.userId,
          visibility: agents.visibility,
        })
        .from(agents)
        .where(and(eq(agents.id, resourceId), eq(agents.workspaceId, workspaceId)));
      if (!agent) return null;
      ownerId = agent.userId;
      agentIds = [agent.id];
      privateAgentIds = agent.visibility === 'private' ? [agent.id] : [];
      agencyConfigs = [agent.agencyConfig];
      if (agent.visibility === 'private') {
        const groupLinks = await db
          .select({ groupOwnerId: chatGroups.userId })
          .from(chatGroupsAgents)
          .innerJoin(chatGroups, eq(chatGroupsAgents.chatGroupId, chatGroups.id))
          .where(eq(chatGroupsAgents.agentId, agent.id));
        groupsToLeave = groupLinks.filter((link) => link.groupOwnerId !== recipientId).length;
      }
      break;
    }
    case 'agentGroup': {
      const [group] = await db
        .select({ id: chatGroups.id, userId: chatGroups.userId })
        .from(chatGroups)
        .where(and(eq(chatGroups.id, resourceId), eq(chatGroups.workspaceId, workspaceId)));
      if (!group) return null;
      ownerId = group.userId;

      // Raw roster read, same split as `transferGroupOwnership`.
      const memberRows = await db
        .select({
          agencyConfig: agents.agencyConfig,
          agentId: chatGroupsAgents.agentId,
          agentUserId: agents.userId,
          role: chatGroupsAgents.role,
          slug: agents.slug,
          virtual: agents.virtual,
          visibility: agents.visibility,
        })
        .from(chatGroupsAgents)
        .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
        .where(eq(chatGroupsAgents.chatGroupId, resourceId));

      for (const row of memberRows) {
        if (resolveGroupMembershipType(row) === 'owned') {
          agentIds.push(row.agentId);
          if (row.visibility === 'private') privateAgentIds.push(row.agentId);
          agencyConfigs.push(row.agencyConfig);
        } else if (row.visibility === 'private' && row.agentUserId !== recipientId) {
          hiddenReferencedMember = true;
        }
      }
      break;
    }
    default: {
      return null;
    }
  }

  const [
    botRows,
    [cronRow],
    [taskRow],
    knowledgeMountsToDetach,
    connectorsAffected,
    expertiseAffected,
    associatedDocsToDetach,
  ] = await Promise.all([
    agentIds.length > 0
      ? db
          .select({ platform: agentBotProviders.platform })
          .from(agentBotProviders)
          .where(
            and(
              inArray(agentBotProviders.agentId, agentIds),
              eq(agentBotProviders.userId, ownerId),
            ),
          )
      : Promise.resolve([]),
    agentIds.length > 0
      ? db
          .select({ value: count() })
          .from(agentCronJobs)
          .where(and(inArray(agentCronJobs.agentId, agentIds), eq(agentCronJobs.userId, ownerId)))
      : Promise.resolve([{ value: 0 }]),
    privateAgentIds.length > 0
      ? db
          .select({ value: count() })
          .from(tasks)
          .where(
            and(
              inArray(tasks.assigneeAgentId, privateAgentIds),
              ne(tasks.createdByUserId, recipientId),
            ),
          )
      : Promise.resolve([{ value: 0 }]),
    countAgentKnowledgeMountsToDetach(db, { agentIds, recipientId, workspaceId }),
    countAgentConnectorsAffected(db, { agentIds, recipientId }),
    countAgentExpertiseAffected(db, { agentIds, recipientId, workspaceId }),
    countAssociatedAgentDocumentsToDetach(db, {
      agentIds,
      fromUserId: ownerId,
      recipientId,
      workspaceId,
    }),
  ]);

  // "Affected" means the recipient-aware sanitation would actually CHANGE the
  // config — bindings to devices the recipient can reach survive and must not
  // produce a false reset warning.
  let deviceBindingAffected = false;
  const boundConfigs = agencyConfigs.filter(
    (config) => collectBoundDeviceIds(config as never).length > 0,
  );
  if (boundConfigs.length > 0) {
    const sanitized = await sanitizeAgencyConfigsForWorkspace(
      db,
      workspaceId,
      boundConfigs as never,
      { viewerUserId: recipientId },
    );
    deviceBindingAffected = sanitized.some(
      (config, index) => JSON.stringify(config) !== JSON.stringify(boundConfigs[index]),
    );
  }

  const knowledgeToDetach = knowledgeMountsToDetach + associatedDocsToDetach;

  // Mirror of the handover's explicit project-leave for PRIVATE agents.
  let projectsToLeave = 0;
  if (privateAgentIds.length > 0) {
    const projectLinks = await db
      .select({ projectOwnerId: projects.userId })
      .from(projectAgents)
      .innerJoin(projects, eq(projectAgents.projectId, projects.id))
      .where(inArray(projectAgents.agentId, privateAgentIds));
    projectsToLeave = projectLinks.filter((link) => link.projectOwnerId !== recipientId).length;
  }

  return {
    botBindings: botRows.length,
    connectorsAffected,
    expertiseAffected,
    groupsToLeave,
    botPlatforms: [...new Set(botRows.map((row) => row.platform))],
    cronJobs: cronRow.value,
    deviceBindingAffected,
    hiddenReferencedMember,
    knowledgeToDetach,
    ownerId,
    projectsToLeave,
    tasksToDetach: taskRow.value,
  };
};
