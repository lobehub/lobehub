import { isAgentShareVisitorHeteroType } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type { AgentAccessMissing, AgentAccessResult, LobeAgentAgencyConfig } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import type { AgentShareData } from '@/database/models/agentShare';
import { AgentShareModel } from '@/database/models/agentShare';
import { agentRuntime } from '@/database/repositories/channel/agent';
import type { ChannelAgentAccess } from '@/database/repositories/channel/agentAccess';
import {
  latestAgentAccessRequest,
  resolveChannelAgentAccess,
} from '@/database/repositories/channel/agentAccess';
import { agents, agentShares, channelMembers, channels } from '@/database/schemas';
import { resolveShareVisitorDeviceAccess } from '@/server/services/aiAgent/shareGate/deviceAccess';

/** What a share holds for one requester: admission, and the owner's device when it runs there. */
export interface ShareAccess {
  /** The share admits them (`AgentShareModel.admitsVisitor`). */
  admits: boolean;
  /** `shareConfig.deviceAccess` grants them the device (`resolveShareVisitorDeviceAccess`). */
  canUseDevice: boolean;
  /** A local CLI Agent, which runs for a visitor only on its owner's device. */
  local: boolean;
  /** Its runtime runs for a visitor at all: Native, or a local CLI (never a remote runtime). */
  runnable: boolean;
}

type AgentRuntimeSource = { agencyConfig?: LobeAgentAgencyConfig | null; model?: string | null };

/** Whether an Agent runs for a share visitor at all, and whether it needs its owner's device. */
const visitorRuntime = (agent: AgentRuntimeSource) => {
  const runtime = agentRuntime({
    agencyConfig: agent.agencyConfig ?? undefined,
    model: agent.model ?? '',
  });
  const local = runtime !== 'native' && isAgentShareVisitorHeteroType(runtime);
  return { local, runnable: runtime === 'native' || local };
};

/**
 * The one reading of a share for a requester, used before an opening is posted (the Channel's
 * share admission), at dispatch, and by {@link resolveAgentAccess}: so a local CLI share that
 * does not grant the device refuses the request before anything acknowledges it.
 */
export const evaluateShareAccess = async (
  db: LobeChatDatabase,
  share: Pick<
    AgentShareData,
    'agentAgencyConfig' | 'agentModel' | 'ownerId' | 'shareConfig' | 'shareId' | 'visibility'
  > & { workspaceId: string | null },
  requesterUserId: string,
): Promise<ShareAccess> => {
  const { local, runnable } = visitorRuntime({
    agencyConfig: share.agentAgencyConfig,
    model: share.agentModel,
  });
  const admits = await AgentShareModel.admitsVisitor(db, share, requesterUserId);
  const canUseDevice = admits
    ? await resolveShareVisitorDeviceAccess(db, share, requesterUserId)
    : false;
  return { admits, canUseDevice, local, runnable };
};

export interface ResolveAgentAccessParams {
  agentId: string;
  /** The Channel the requester asks in; without one, their direct conversation with the Agent. */
  channelId?: string;
  requesterUserId: string;
  /** The requester's scope when no Channel is given (the active workspace, or personal). */
  workspaceId?: string | null;
}

const UNAVAILABLE: AgentAccessResult = {
  missing: [],
  ownerId: null,
  request: null,
  state: 'unavailable',
  via: null,
};

/**
 * Whether `requesterUserId` may use `agentId`, and if not, what its owner would have to grant and
 * where their request stands. The single answer behind the Channel's claim (`claimJob`, through
 * `resolveChannelAgentAccess`), its share admission (`evaluateShareAccess`) and the client's check
 * on entering an Agent's conversation or profile:
 *
 * - as their own (`agentUsableByWhere`), or
 * - through a share that admits them (`AgentShareModel.admitsVisitor`), in their direct
 *   conversation with it or in a group whose owner allowed them, and, for a local CLI Agent, that
 *   grants them its owner's device (`resolveShareVisitorDeviceAccess`).
 *
 * A Channel the requester is not an active member of reads as `unavailable`, never revealing
 * anything of it.
 */
export const resolveAgentAccess = async (
  db: LobeChatDatabase,
  { agentId, channelId, requesterUserId, workspaceId }: ResolveAgentAccessParams,
): Promise<AgentAccessResult> => {
  const [agent] = await db
    .select({
      agencyConfig: agents.agencyConfig,
      isDeleted: agents.isDeleted,
      model: agents.model,
      ownerId: agents.userId,
    })
    .from(agents)
    .where(eq(agents.id, agentId));
  if (!agent?.ownerId || agent.isDeleted === true) return UNAVAILABLE;

  const context = channelId
    ? await channelContext(db, channelId, agentId, requesterUserId)
    : {
        agentMember: { agentId, id: '' },
        channel: { agentId, workspaceId: workspaceId ?? null },
        requesterMemberId: undefined,
      };
  if (!context) return UNAVAILABLE;

  const access: ChannelAgentAccess = await resolveChannelAgentAccess(
    db,
    context.channel,
    context.agentMember,
    { memberId: context.requesterMemberId, userId: requesterUserId },
  );
  if (access.kind === 'own')
    return { missing: [], ownerId: agent.ownerId, request: null, state: 'ok', via: 'own' };
  if (access.kind === 'unavailable') return { ...UNAVAILABLE, ownerId: agent.ownerId };

  const runtime = visitorRuntime(agent);
  if (!runtime.runnable) return { ...UNAVAILABLE, ownerId: agent.ownerId };
  const latest = await latestAgentAccessRequest(db, { agentId, channelId, requesterUserId });
  const request = latest
    ? {
        channelId: latest.channelId,
        createdAt: latest.createdAt,
        decidedAt: latest.decidedAt,
        id: latest.id,
        status: latest.status,
      }
    : null;

  let missing: AgentAccessMissing[];
  if (access.kind === 'share') {
    const share = await AgentShareModel.findByShareId(db, access.share.shareId);
    const evaluated = share && (await evaluateShareAccess(db, share, requesterUserId));
    if (!evaluated?.admits) missing = ['share'];
    else if (evaluated.local && !evaluated.canUseDevice) missing = ['device'];
    else return { missing: [], ownerId: agent.ownerId, request, state: 'ok', via: 'share' };
  } else {
    missing = [...access.missing];
    if (runtime.local && !(await sharedDeviceAllows(db, agentId, requesterUserId)))
      missing.push('device');
  }

  // In a Channel, the request covering them there; without one, their latest anywhere.
  const status = channelId
    ? access.kind === 'request'
      ? access.grant?.status
      : undefined
    : request?.status;
  const state =
    status === 'pending' ? 'grant_pending' : status === 'rejected' ? 'denied' : 'needs_grant';
  return { missing, ownerId: agent.ownerId, request, state, via: null };
};

/** The requester's active member in the Channel and the Agent's, or undefined when either is not. */
const channelContext = async (
  db: LobeChatDatabase,
  channelId: string,
  agentId: string,
  requesterUserId: string,
) => {
  const [channel] = await db
    .select({ agentId: channels.agentId, workspaceId: channels.workspaceId })
    .from(channels)
    .where(eq(channels.id, channelId));
  if (!channel) return;
  const members = await db
    .select({
      agentId: channelMembers.agentId,
      id: channelMembers.id,
      userId: channelMembers.userId,
    })
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.status, 'active')));
  const requester = members.find((member) => member.userId === requesterUserId);
  const agentMember = members.find((member) => member.agentId === agentId);
  if (!requester || !agentMember) return;
  return { agentMember, channel, requesterMemberId: requester.id };
};

/** Whether the Agent's share, admitting or not, already grants the requester its device. */
const sharedDeviceAllows = async (
  db: LobeChatDatabase,
  agentId: string,
  requesterUserId: string,
) => {
  const [row] = await db
    .select({ id: agentShares.id })
    .from(agentShares)
    .where(eq(agentShares.agentId, agentId));
  const share = row && (await AgentShareModel.findByShareId(db, row.id));
  return !!share && (await resolveShareVisitorDeviceAccess(db, share, requesterUserId));
};
