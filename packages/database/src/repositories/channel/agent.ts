import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { isHeterogeneousAgentModelId } from '@lobechat/const';
import type { ChannelExecutionConfig, ChannelMemberConfig, LobeAgentConfig } from '@lobechat/types';
import { agentDisplayName, isChannelRuntime } from '@lobechat/types';
import { cleanObject } from '@lobechat/utils';
import { and, eq } from 'drizzle-orm';
import type { PartialDeep } from 'type-fest';

import type { ChannelItem, ChannelMemberItem } from '../../schemas';
import { agents, channelMembers, userSettings } from '../../schemas';
import type { Transaction } from '../../type';
import { agentUsableByWhere } from '../../utils/agent-access';
import { mergeAgentDefaultConfig } from '../../utils/agentConfig';
import { ChannelError } from './error';

/** Explicitly select environment fields so legacy or untyped copies cannot override an Agent. */
export const memberEnvironment = (config?: ChannelMemberConfig | null): ChannelMemberConfig =>
  cleanObject({
    deviceId: config?.deviceId,
    deviceOwnerId: config?.deviceOwnerId,
    workingDirectory: config?.workingDirectory,
  });

export interface ChannelAddAgentInput {
  agentId: string;
  config?: ChannelMemberConfig;
  /** Optional Channel-specific routing description and identity label. */
  description?: string;
  name?: string;
}

/** Check Agent scope and hold it through creation of the Channel/member reference. */
export const requireChannelAgent = async (
  tx: Transaction,
  workspaceId: string | null,
  userId: string,
  agentId: string,
) => {
  const [agent] = await tx
    .select({ name: agents.name, title: agents.title })
    .from(agents)
    .where(agentUsableByWhere(agentId, { userId, workspaceId: workspaceId ?? undefined }))
    .for('share');
  if (!agent) throw new ChannelError('NOT_FOUND', 'Agent not found');
  return agent;
};

/** Called under the Channel lock after the caller's admin role has been checked. */
export const addAgentMember = async (
  tx: Transaction,
  channel: ChannelItem,
  userId: string,
  input: ChannelAddAgentInput,
): Promise<ChannelMemberItem> => {
  if (channel.agentId) {
    if (input.agentId !== channel.agentId)
      throw new ChannelError('BAD_REQUEST', 'A direct conversation is bound to one Agent');
    const [existing] = await tx
      .select({ id: channelMembers.id })
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, channel.id), eq(channelMembers.actorType, 'agent')));
    if (existing)
      throw new ChannelError('CONFLICT', 'The direct conversation already has its Agent');
  }
  if (!input.agentId.trim())
    throw new ChannelError('BAD_REQUEST', 'An Agent reference is required');
  const agent = await requireChannelAgent(tx, channel.workspaceId, userId, input.agentId);
  // Idempotent per Agent: retrying a partly applied batch must not add a second member that
  // answers the same requests again.
  const [joined] = await tx
    .select()
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, channel.id),
        eq(channelMembers.agentId, input.agentId),
        eq(channelMembers.status, 'active'),
      ),
    )
    .limit(1);
  if (joined) return joined;
  const [member] = await tx
    .insert(channelMembers)
    .values({
      actorType: 'agent',
      agentId: input.agentId,
      channelId: channel.id,
      config: memberEnvironment(input.config),
      description: input.description,
      name: input.name?.trim() || agentDisplayName(agent, 'Agent'),
    })
    .returning();
  return member;
};

/** An active Agent member of this Channel; people and departed Agents have no environment. */
export const requireAgentMember = async (tx: Transaction, channelId: string, memberId: string) => {
  const [member] = await tx
    .select()
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.id, memberId),
        eq(channelMembers.actorType, 'agent'),
        eq(channelMembers.status, 'active'),
      ),
    )
    .limit(1);
  if (!member?.agentId) throw new ChannelError('NOT_FOUND', 'Agent member not found');
  return member as ChannelMemberItem & { agentId: string };
};

/** Read current settings with the requester's Agent permissions, then freeze the effective config. */
export const resolveExecutionConfig = async (
  tx: Transaction,
  channel: ChannelItem,
  member: ChannelMemberItem,
  userId: string,
  serverDefault: PartialDeep<LobeAgentConfig>,
): Promise<ChannelExecutionConfig | null> => {
  if (!member.agentId) return null;
  const [agent] = await tx
    .select({
      agencyConfig: agents.agencyConfig,
      avatar: agents.avatar,
      backgroundColor: agents.backgroundColor,
      chatConfig: agents.chatConfig,
      editorData: agents.editorData,
      fewShots: agents.fewShots,
      model: agents.model,
      name: agents.name,
      openingMessage: agents.openingMessage,
      openingQuestions: agents.openingQuestions,
      params: agents.params,
      plugins: agents.plugins,
      profile: agents.profile,
      provider: agents.provider,
      systemRole: agents.systemRole,
      title: agents.title,
      tts: agents.tts,
      virtual: agents.virtual,
    })
    .from(agents)
    .where(
      agentUsableByWhere(member.agentId, { userId, workspaceId: channel.workspaceId ?? undefined }),
    )
    .for('share');
  if (!agent) return null;
  const [settings] = channel.workspaceId
    ? []
    : await tx
        .select({ defaultAgent: userSettings.defaultAgent })
        .from(userSettings)
        .where(eq(userSettings.id, userId));
  const config = mergeAgentDefaultConfig(agent, {
    serverDefault,
    userDefault: settings?.defaultAgent,
    workspaceId: channel.workspaceId,
  });
  // Match ordinary Agent execution, including Agents created before agencyConfig existed.
  const runtime =
    config.agencyConfig?.heterogeneousProvider?.type ??
    (isHeterogeneousAgentModelId(config.model) ? config.model : 'native');
  if (!isChannelRuntime(runtime)) return null;
  return {
    ...config,
    ...memberEnvironment(member.config),
    provider: config.provider || DEFAULT_PROVIDER,
    runtime,
  };
};
